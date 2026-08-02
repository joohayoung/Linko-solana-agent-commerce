/**
 * 타임아웃이 있는 fetch 래퍼.
 * 네이티브 fetch는 기본 타임아웃이 매우 길어서(수 분 단위), 네트워크가 멈추거나
 * 외부 API(Gemini 등)가 응답을 안 주면 요청이 몇 분씩 "멈춘 것처럼" 보일 수 있다.
 * AbortController로 명시적 제한시간을 걸어 실패를 빠르고 명확하게 드러낸다.
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error(`요청이 ${Math.round(timeoutMs / 1000)}초 안에 응답하지 않아 타임아웃됐습니다: ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
