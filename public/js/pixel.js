/**
 * Linko 구매확정 픽셀 로더.
 * 광고주 계정(스토어) 기준으로 딱 한 번만 설치하면 되고, 캠페인마다 다시 설치할 필요가 없다 —
 * 어떤 캠페인·크리에이터의 성과인지는 추천코드(referralCode)에 이미 담겨 있어서 서버가 구분한다.
 *
 * 동작:
 *   1) 크리에이터 링크(?ref=코드)로 들어온 방문을 감지해 30일짜리 1st-party 쿠키에 저장한다.
 *      (멀티 페이지 쇼핑몰에서 결제완료 페이지까지 쿼리파라미터가 유지된다는 보장이 없기 때문)
 *   2) 결제완료 페이지의 linko("trackPurchase", {...}) 호출을 받아 쿠키의 추천코드와 함께
 *      /api/pixel/conversion 으로 전송한다.
 */
(function () {
  var REF_COOKIE = "_lnk_ref";
  var REF_MAX_AGE_DAYS = 30;

  var scriptTag = document.currentScript;
  var storeId = scriptTag ? scriptTag.getAttribute("data-store-id") : null;
  var origin = scriptTag && scriptTag.src ? new URL(scriptTag.src, location.href).origin : location.origin;
  var endpoint = origin + "/api/pixel/conversion";

  function getQueryParam(name) {
    return new URLSearchParams(location.search).get(name);
  }

  function setCookie(name, value, days) {
    var expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = name + "=" + encodeURIComponent(value) + "; expires=" + expires + "; path=/; SameSite=Lax";
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : null;
  }

  var refFromUrl = getQueryParam("ref");
  if (refFromUrl) setCookie(REF_COOKIE, refFromUrl, REF_MAX_AGE_DAYS);

  function trackPurchase(payload) {
    var referralCode = getCookie(REF_COOKIE) || refFromUrl;
    if (!referralCode) {
      console.warn("[linko pixel] 추천 코드를 찾을 수 없어 이 구매는 집계되지 않아요 (크리에이터 링크를 거치지 않은 방문일 수 있어요).");
      return;
    }
    if (!payload || !payload.orderId || payload.amount == null) {
      console.warn("[linko pixel] trackPurchase에는 orderId와 amount가 필요해요.");
      return;
    }
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        referralCode: referralCode,
        storeId: storeId,
        orderId: String(payload.orderId),
        amount: Number(payload.amount),
      }),
      keepalive: true,
    }).catch(function () {});
  }

  function processCommand(args) {
    var action = args[0];
    var payload = args[1];
    if (action === "trackPurchase") trackPurchase(payload);
  }

  // 이 스크립트가 로드되기 전에 페이지의 스텁 큐(window.linko.q)에 쌓여있던 호출을 처리
  var queued = (window.linko && window.linko.q) || [];
  window.linko = function () {
    processCommand(arguments);
  };
  queued.forEach(processCommand);
})();
