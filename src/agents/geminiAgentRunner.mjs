/**
 * 두 에이전트(분석/예산분배)가 공유하는 Gemini 멀티라운드 Function Calling 루프.
 * src/agent.mjs의 도구 호출 루프와 같은 패턴(모델 폴백, 라운드 반복)을 공용화했다.
 *
 * 도구 루프가 끝나면(Gemini가 functionCall 없이 텍스트로 응답하면) tools 없이
 * responseMimeType:"application/json"만 붙여 한 번 더 호출해서 최종 결과를 받는다 —
 * function_declarations와 강제 JSON 출력을 한 요청에 같이 넣는 조합은 검증되지 않아서
 * 이렇게 2단계로 분리했다.
 *
 * agent.mjs/search.mjs와 달리 AI Studio 직접 키가 아니라 Vertex AI(vertexClient.mjs)로 호출한다
 * (쿼터 풀 분리 이유는 vertexClient.mjs 상단 주석 참고).
 */
import { callVertexGenerateContent } from "./vertexClient.mjs";

// 2026-08 기준 Vertex AI(us-central1)에서 실제 확인된 모델 ID.
// gemini-2.0-flash/gemini-1.5-flash는 이미 단종돼 404(Publisher model not found)가 남 — 쓰지 말 것.
const MODELS = ["gemini-3.6-flash", "gemini-2.5-flash"];

async function callGemini({ systemPrompt, contents, tools }) {
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
  };
  if (tools) {
    body.tools = [{ function_declarations: tools }];
  } else {
    body.generationConfig = { responseMimeType: "application/json" };
  }

  let res;
  let lastErrText = "";
  for (const modelName of MODELS) {
    try {
      res = await callVertexGenerateContent(modelName, body);
      if (res.ok) break;
      lastErrText = await res.text(); // 429뿐 아니라 400 등 모든 실패 응답 본문을 남겨야 원인 진단 가능
    } catch (err) {
      lastErrText = err.message;
    }
  }
  if (!res || !res.ok) {
    throw new Error(`Gemini 호출 실패 (모든 모델 소진): ${lastErrText || res?.status || "unknown"}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts?.length) throw new Error("Gemini 응답이 비어있습니다.");
  return candidate;
}

/**
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {object[]} opts.tools function_declarations 배열
 * @param {string} opts.initialMessage 첫 사용자 메시지(조사 대상 데이터를 JSON으로 넣어줌)
 * @param {(name:string, args:object) => object} opts.executeToolCall 동기 도구 실행 함수
 * @param {string} opts.jsonInstruction 도구 루프 종료 후 최종 JSON을 요청하는 지시문
 * @param {number} [opts.maxRounds]
 * @returns {Promise<{output:object, transcript:object[], rounds:number}>}
 */
export async function runAgentLoop({ systemPrompt, tools, initialMessage, executeToolCall, jsonInstruction, maxRounds = 8 }) {
  const contents = [{ role: "user", parts: [{ text: initialMessage }] }];
  const transcript = [];
  let rounds = 0;

  while (rounds < maxRounds) {
    rounds++;
    const candidate = await callGemini({ systemPrompt, contents, tools });
    const parts = candidate.content.parts;
    contents.push(candidate.content);

    // Gemini가 한 턴에 여러 도구를 동시에 호출할 수 있음 — 요청한 functionCall 개수만큼
    // functionResponse를 정확히 채워 돌려줘야 함(안 그러면 400 INVALID_ARGUMENT).
    const functionCallParts = parts.filter((p) => p.functionCall);
    if (functionCallParts.length > 0) {
      const responseParts = [];
      for (const part of functionCallParts) {
        const { name, args } = part.functionCall;
        let result;
        try {
          result = await executeToolCall(name, args || {});
        } catch (e) {
          result = { error: e.message };
        }
        transcript.push({ type: "tool_call", round: rounds, name, args, result });
        responseParts.push({ functionResponse: { name, response: { result } } });
      }
      contents.push({ role: "user", parts: responseParts });
      continue;
    }

    const textPart = parts.find((p) => p.text);
    if (textPart?.text) transcript.push({ type: "note", round: rounds, text: textPart.text });
    break;
  }

  // 2단계: 도구 없이 JSON 강제 출력 요청
  contents.push({ role: "user", parts: [{ text: jsonInstruction }] });
  let output = await requestFinalJson({ systemPrompt, contents });

  transcript.push({ type: "final", output });
  return { output, transcript, rounds };
}

async function requestFinalJson({ systemPrompt, contents }) {
  const candidate = await callGemini({ systemPrompt, contents });
  const text = candidate.content.parts.find((p) => p.text)?.text || "";
  try {
    return JSON.parse(text);
  } catch {
    const retryContents = [
      ...contents,
      candidate.content,
      { role: "user", parts: [{ text: "방금 응답이 유효한 JSON이 아니었습니다. 설명 없이 JSON 객체만 다시 출력하세요." }] },
    ];
    const retryCandidate = await callGemini({ systemPrompt, contents: retryContents });
    const retryText = retryCandidate.content.parts.find((p) => p.text)?.text || "";
    return JSON.parse(retryText); // 여기서도 실패하면 호출부가 로컬 폴백으로 넘어감
  }
}
