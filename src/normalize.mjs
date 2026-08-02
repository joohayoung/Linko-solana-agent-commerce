/**
 * 다중 쇼핑몰 응답 정규화 (Gemini 활용 2번째 지점)
 * 서로 다른 쇼핑몰이 서로 다른 JSON 스키마로 주문 상태를 응답하기 때문에,
 * 쇼핑몰마다 파싱 코드를 따로 만드는 대신 Gemini에게 "이 응답이 확정/취소/대기 중
 * 무엇을 의미하는지"를 판단시켜 하나의 공통 상태로 정규화합니다.
 * 이 판단 결과가 곧바로 정산 실행 여부를 결정합니다(settlementEngine.mjs).
 */
import { fetchWithTimeout } from "./httpUtil.mjs";

const MODEL = "gemini-3.6-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/**
 * @param {object} rawShopResponse 쇼핑몰 API가 반환한 원본 JSON (스키마 무관)
 * @returns {Promise<{status: "confirmed"|"cancelled"|"pending", reason: string}>}
 */
export async function normalizeOrderStatus(rawShopResponse) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(".env에 GEMINI_API_KEY가 없습니다.");
  }

  const prompt = `아래는 어떤 쇼핑몰의 주문 상태 조회 API 응답입니다(스키마는 쇼핑몰마다 다를 수 있습니다):
${JSON.stringify(rawShopResponse, null, 2)}

이 주문이 다음 세 가지 중 무엇에 해당하는지 판단하세요:
- "confirmed": 구매확정, 배송완료 후 반품기간 종료 등 최종적으로 판매가 확정된 상태
- "cancelled": 취소, 반품, 환불 등 판매가 무효화된 상태
- "pending": 아직 결제완료/배송중 등 확정도 취소도 아닌 중간 상태

아래 JSON 형식으로만 답하세요. 다른 설명 없이 JSON만 출력하세요.
{"status": "confirmed" | "cancelled" | "pending", "reason": "판단 근거 한 줄"}`;

  const res = await fetchWithTimeout(
    `${ENDPOINT}?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
    30000
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API 오류 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini 응답이 비어있습니다.");

  const parsed = JSON.parse(text);
  if (!["confirmed", "cancelled", "pending"].includes(parsed.status)) {
    throw new Error(`Gemini가 알 수 없는 status를 반환함: ${parsed.status}`);
  }
  return parsed;
}
