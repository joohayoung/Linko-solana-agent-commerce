/**
 * 11. 캠페인 검색 (Gemini 활용 1번째 지점)
 * 자연어 검색어를 캠페인 목록과 매칭해 관련도 순으로 정렬합니다.
 */
import { fetchWithTimeout } from "./httpUtil.mjs";

const MODEL = "gemini-2.0-flash-lite";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/**
 * @param {Array<object>} campaigns 전체 캠페인 목록
 * @param {string} query 자연어 검색어
 * @returns {Promise<Array<object>>} 관련도 순으로 정렬된 캠페인 목록 (관련 없는 항목 제외)
 */
export async function searchCampaigns(campaigns, query) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return localSearchFallback(campaigns, query);

  const brief = campaigns.map((c) => ({
    id: c.id,
    advertiser: c.advertiser,
    product: c.product,
    description: c.description,
    tags: c.tags,
  }));

  const prompt = `다음은 광고 캠페인 목록입니다(JSON):
${JSON.stringify(brief, null, 2)}

사용자 검색어: "${query}"

이 검색어와 관련 있는 캠페인만 관련도 순으로 정렬해서 id 배열로 답하세요. 관련 없는 캠페인은 제외하세요.
아래 JSON 형식으로만 답하세요. 다른 설명 없이 JSON만 출력하세요.
{"ids": ["id1", "id2", ...]}`;

  try {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
      15000
    );

    if (!res.ok) {
      console.log(`[Search] Gemini 검색 API ${res.status} 응답 -> 로컬 키워드 검색 폴백 사용`);
      return localSearchFallback(campaigns, query);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return localSearchFallback(campaigns, query);

    const parsed = JSON.parse(text);
    const ids = Array.isArray(parsed.ids) ? parsed.ids : [];

    const byId = new Map(campaigns.map((c) => [c.id, c]));
    const matched = ids.map((id) => byId.get(id)).filter(Boolean);
    return matched.length > 0 ? matched : localSearchFallback(campaigns, query);
  } catch (err) {
    console.log(`[Search] Gemini 검색 오류 (${err.message}) -> 로컬 키워드 검색 폴백 사용`);
    return localSearchFallback(campaigns, query);
  }
}

function localSearchFallback(campaigns, query) {
  const q = query.toLowerCase().trim();
  const keywords = q.split(/\s+/).filter(Boolean);
  
  return campaigns.filter((c) => {
    const targetText = `${c.product} ${c.advertiser} ${c.description} ${c.tags.join(" ")}`.toLowerCase();
    return keywords.some((kw) => targetText.includes(kw));
  });
}
