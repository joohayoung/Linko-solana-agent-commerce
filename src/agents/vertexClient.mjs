/**
 * Vertex AI generateContent 클라이언트.
 * agent.mjs/search.mjs는 AI Studio 직접 키(GEMINI_API_KEY)를 계속 쓰고, 예산분배 에이전트만
 * 이 경로로 호출해서 쿼터 풀을 분리한다 — $300 무료 체험 크레딧이 2026-03부터 Gemini API/AI
 * Studio에는 적용되지 않지만 Vertex AI 경로는 적용 대상이라(§12), 서비스 계정 인증이 필요하다.
 *
 * 필요한 .env 값: GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION(기본 us-central1),
 * GOOGLE_APPLICATION_CREDENTIALS(서비스 계정 키 JSON 파일 경로) — google-auth-library의 ADC가
 * 이 셋 중 마지막 값을 자동으로 읽는다.
 */
import { GoogleAuth } from "google-auth-library";
import { fetchWithTimeout } from "../httpUtil.mjs";

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";

let auth = null;
let cachedClient = null;

async function getAccessToken() {
  if (!auth) auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
  if (!cachedClient) cachedClient = await auth.getClient();
  const { token } = await cachedClient.getAccessToken(); // google-auth-library가 만료 전까지 알아서 캐시함
  if (!token) throw new Error("Vertex AI 액세스 토큰 발급 실패 — GOOGLE_APPLICATION_CREDENTIALS 설정을 확인하세요.");
  return token;
}

/**
 * @param {string} modelName 예: "gemini-2.0-flash"
 * @param {object} body generateContent 요청 바디 (system_instruction, contents, tools?, generationConfig?)
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
export async function callVertexGenerateContent(modelName, body, timeoutMs = 40000) {
  if (!PROJECT) throw new Error(".env에 GOOGLE_CLOUD_PROJECT가 없습니다.");

  const token = await getAccessToken();
  // 최신 모델은 특정 리전이 아니라 global 엔드포인트로만 제공되는 경우가 있음 — 이때는
  // 호스트명에 리전 접두어를 붙이면 안 됨(aiplatform.googleapis.com, "global-aiplatform..." 아님).
  const host = LOCATION === "global" ? "aiplatform.googleapis.com" : `${LOCATION}-aiplatform.googleapis.com`;
  const endpoint = `https://${host}/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${modelName}:generateContent`;

  return fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs
  );
}
