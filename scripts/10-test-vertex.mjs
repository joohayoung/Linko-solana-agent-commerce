/**
 * Vertex AI 연동 단독 테스트 (AI Studio GEMINI_API_KEY와 무관 — vertexClient.mjs만 검증).
 * 예산분배 에이전트(geminiAgentRunner.mjs)가 실제로 쓰는 것과 동일한 경로.
 *
 * 실행: node --env-file=.env scripts/10-test-vertex.mjs
 */
import { callVertexGenerateContent } from "../src/agents/vertexClient.mjs";

async function main() {
  console.log("=== Vertex AI 연동 테스트 ===\n");
  console.log(`GOOGLE_CLOUD_PROJECT=${process.env.GOOGLE_CLOUD_PROJECT}`);
  console.log(`GOOGLE_CLOUD_LOCATION=${process.env.GOOGLE_CLOUD_LOCATION}`);
  console.log(`GOOGLE_APPLICATION_CREDENTIALS=${process.env.GOOGLE_APPLICATION_CREDENTIALS}\n`);

  try {
    const res = await callVertexGenerateContent("gemini-3.6-flash", {
      contents: [{ role: "user", parts: [{ text: "딱 한 문장으로: 오늘 날씨 상관없이 아무 인사말이나 해줘." }] }],
    });
    if (!res.ok) {
      console.error(`실패 (HTTP ${res.status}):`, await res.text());
      return;
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log("✅ Vertex AI 응답 성공:");
    console.log(text);
  } catch (e) {
    console.error("❌ 실패:", e.message);
  }
}

main();
