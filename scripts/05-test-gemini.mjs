/**
 * 6. Gemini API 연동 최소 테스트
 * 캠페인 목록 몇 개 + 자연어 검색 쿼리를 던져서 매칭이 그럴듯하게 나오는지 확인합니다.
 * 별도 SDK 없이 fetch로 REST 엔드포인트를 직접 호출합니다.
 *
 * 실행: node --env-file=.env scripts/05-test-gemini.mjs
 * (package.json의 "test-gemini" 스크립트로도 실행 가능: npm run test-gemini)
 */
const MODEL = "gemini-3.6-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const sampleCampaigns = [
  { id: "c1", brand: "선데이글로우", product: "무기자차 선크림 SPF50", tags: ["스킨케어", "여름", "자외선차단"] },
  { id: "c2", brand: "농심", product: "신라면 볶음면 멀티팩", tags: ["식품", "라면", "간편식"] },
  { id: "c3", brand: "LG전자", product: "무선 이어폰 톤프리", tags: ["전자기기", "이어폰", "블루투스"] },
];

async function searchCampaigns(query) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(".env에 GEMINI_API_KEY가 없습니다. 광고에이전트/.env 파일을 확인하세요.");
  }

  const prompt = `다음은 광고 캠페인 목록입니다(JSON):
${JSON.stringify(sampleCampaigns, null, 2)}

사용자 검색어: "${query}"

이 검색어와 가장 관련 있는 캠페인을 관련도 순으로 정렬해서, 아래 JSON 배열 형식으로만 답하세요. 다른 설명 없이 JSON만 출력하세요.
[{"id": "캠페인id", "reason": "왜 관련있는지 한 줄 이유"}]`;

  const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API 오류 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return text;
}

async function main() {
  console.log("=== Gemini API 연동 테스트 ===\n");
  const query = "여름철 피부 관리용 제품 찾아줘";
  console.log(`검색어: "${query}"\n`);

  try {
    const result = await searchCampaigns(query);
    console.log("Gemini 응답:");
    console.log(result);
  } catch (e) {
    console.error("실패:", e.message);
  }
}

main();
