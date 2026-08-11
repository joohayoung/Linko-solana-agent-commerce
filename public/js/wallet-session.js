// 지갑 연결(LazorKit 패스키) ↔ 프로모터 세션 매핑 공통 로직
// - 최초 방문: 지갑 연결 유도 배너 → 연결되면 /api/promoters/by-wallet 로 조회/생성 → localStorage에 저장
// - 재방문: localStorage에 저장된 promoterId를 그대로 써서 재서명 없이 바로 대시보드 진입
//   (요구사항: "지문/얼굴인식 서명은 회원가입 시 1회만" — 매번 재서명 요구하지 않음)

const LINKO_PROMOTER_ID_KEY = "linko_promoter_id";

function linkoGetSavedPromoterId() {
  return localStorage.getItem(LINKO_PROMOTER_ID_KEY);
}

function linkoClearSession() {
  localStorage.removeItem(LINKO_PROMOTER_ID_KEY);
  if (window.LinkoWallet) window.LinkoWallet.disconnect().catch(() => {});
}

async function linkoEnsurePromoterForWallet(walletAddress) {
  const data = await api("/api/promoters/by-wallet", {
    method: "POST",
    body: JSON.stringify({ walletAddress }),
  });
  localStorage.setItem(LINKO_PROMOTER_ID_KEY, data.promoter.id);
  return data.promoter;
}

function linkoWaitForWalletWidget() {
  return new Promise((resolve) => {
    if (window.LinkoWallet) return resolve(window.LinkoWallet);
    const iv = setInterval(() => {
      if (window.LinkoWallet) {
        clearInterval(iv);
        resolve(window.LinkoWallet);
      }
    }, 50);
  });
}

/**
 * 프로모터 세션이 필요한 페이지에서 호출.
 * - 저장된 세션이 있으면 즉시 onReady(promoterId) 호출 (지갑 재연결 없이)
 * - 없으면 지갑 연결 배너를 보여주고, 연결되면 프로모터를 찾거나 만든 뒤 onReady 호출
 */
async function linkoRequirePromoterSession(onReady) {
  const savedId = linkoGetSavedPromoterId();
  if (savedId) {
    onReady(savedId);
    return;
  }

  const banner = document.createElement("div");
  banner.id = "linkoWalletGate";
  banner.className = "panel";
  banner.style.cssText = "text-align:center; padding:36px 24px;";
  banner.innerHTML = `
    <p style="margin:0 0 4px; font-weight:800; font-size:15.5px;">지문/얼굴인식으로 지갑을 연결해주세요</p>
    <p style="margin:0 0 16px; color:var(--muted); font-size:13px;">시드문구 없이 1회만 인증하면 이후에는 자동으로 로그인돼요. 가스비는 플랫폼이 대신 내요.</p>
    <span data-linko-connect></span>
  `;
  const main = document.querySelector("main .wrap") || document.body;
  main.prepend(banner);

  const wallet = await linkoWaitForWalletWidget();
  wallet.subscribe(async (state) => {
    if (!state.isConnected || !state.walletAddress) return;
    if (banner.dataset.handled) return; // 중복 호출 방지
    banner.dataset.handled = "1";
    try {
      const promoter = await linkoEnsurePromoterForWallet(state.walletAddress);
      banner.remove();
      onReady(promoter.id);
    } catch (e) {
      banner.dataset.handled = "";
      toast(e.message);
    }
  });
}
