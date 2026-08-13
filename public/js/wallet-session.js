// 지갑 연결(LazorKit 패스키) ↔ 프로모터/광고주 세션 매핑 공통 로직
// - 최초 방문: 지갑 연결 유도 배너 → 연결되면 /api/<role>s/by-wallet 로 조회/생성 → localStorage에 저장
// - 재방문: localStorage에 저장된 id를 그대로 써서 재서명 없이 바로 진입
//   (요구사항: "지문/얼굴인식 서명은 회원가입 시 1회만" — 매번 재서명 요구하지 않음)
// - 상단 nav(topbar)에 #linkoRoleWalletBadge 요소가 있으면, 연결된 지갑 주소를 자동으로 채워줌
//   (광고주 탭 페이지엔 광고주 지갑, 크리에이터 탭 페이지엔 크리에이터 지갑이 각자 뜸)

const LINKO_ROLE_CONFIG = {
  promoter: { storageKey: "linko_promoter_id", endpoint: "/api/promoters/by-wallet", getEndpoint: "/api/promoters/", resultKey: "promoter" },
  advertiser: { storageKey: "linko_advertiser_id", endpoint: "/api/advertisers/by-wallet", getEndpoint: "/api/advertisers/", resultKey: "advertiser" },
};

function linkoGetSavedId(role) {
  return localStorage.getItem(LINKO_ROLE_CONFIG[role].storageKey);
}

function linkoClearRoleSession(role) {
  const cfg = LINKO_ROLE_CONFIG[role];
  localStorage.removeItem(cfg.storageKey);
  localStorage.removeItem(`${cfg.storageKey}_wallet`);
  if (window.LinkoWallet) window.LinkoWallet.disconnect().catch(() => {});
}

async function linkoEnsureAccountForWallet(role, walletAddress, name) {
  const cfg = LINKO_ROLE_CONFIG[role];
  const data = await api(cfg.endpoint, {
    method: "POST",
    body: JSON.stringify({ walletAddress, name }),
  });
  const account = data[cfg.resultKey];
  localStorage.setItem(cfg.storageKey, account.id);
  localStorage.setItem(`${cfg.storageKey}_wallet`, account.walletAddress);
  return account;
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

// 상단 nav의 #linkoRoleWalletBadge에 연결된 지갑 주소 + "다른 지갑으로 전환" 링크를 채워넣음
function linkoRenderWalletBadge(role, account) {
  const badge = document.getElementById("linkoRoleWalletBadge");
  if (!badge || !account?.walletAddress) return;
  const short = `${account.walletAddress.slice(0, 4)}...${account.walletAddress.slice(-4)}`;
  badge.innerHTML = `🔑 <span class="mono">${short}</span> · <a href="#" style="text-decoration:underline;">전환</a>`;
  badge.querySelector("a").addEventListener("click", (e) => {
    e.preventDefault();
    linkoClearRoleSession(role);
    location.reload();
  });
}

// 이미 저장된 세션이 있으면 배너 없이 조용히 배지만 채워줌 (없으면 아무것도 안 함 — 참여/등록 전엔
// 강제로 연결 안 시키고 그냥 둘러보게 하고 싶은 페이지에서 사용, 예: campaign.html)
async function linkoShowBadgeIfConnected(role) {
  const cfg = LINKO_ROLE_CONFIG[role];
  const savedId = linkoGetSavedId(role);
  if (!savedId) return;
  const savedWallet = localStorage.getItem(`${cfg.storageKey}_wallet`);
  if (savedWallet) {
    linkoRenderWalletBadge(role, { id: savedId, walletAddress: savedWallet });
    return;
  }
  try {
    const data = await api(`${cfg.getEndpoint}${savedId}`);
    const account = data[cfg.resultKey];
    if (account?.walletAddress) {
      localStorage.setItem(`${cfg.storageKey}_wallet`, account.walletAddress);
      linkoRenderWalletBadge(role, account);
    }
  } catch {
    /* 무시 — 배지 표시는 부가 기능이라 실패해도 페이지 동작엔 영향 없음 */
  }
}

/**
 * role("promoter" | "advertiser") 세션이 필요한 페이지에서 호출.
 * - 저장된 세션이 있으면 즉시 onReady(id, account) 호출 (지갑 재연결 없이. account는 캐시/조회로 채움)
 * - 없으면 지갑 연결 배너를 보여주고, 연결되면 계정을 찾거나 만든 뒤 onReady(id, account) 호출
 */
async function linkoRequireRoleSession(role, onReady, opts = {}) {
  const cfg = LINKO_ROLE_CONFIG[role];
  const savedId = linkoGetSavedId(role);
  if (savedId) {
    let account;
    const savedWallet = localStorage.getItem(`${cfg.storageKey}_wallet`);
    if (savedWallet) {
      account = { id: savedId, walletAddress: savedWallet };
    } else {
      // 예전 세션이라 지갑주소가 캐시에 없는 경우 — 서버에서 한 번 조회해서 캐시 보강
      try {
        const data = await api(`${cfg.getEndpoint}${savedId}`);
        account = data[cfg.resultKey];
        if (account?.walletAddress) localStorage.setItem(`${cfg.storageKey}_wallet`, account.walletAddress);
      } catch {
        account = { id: savedId };
      }
    }
    linkoRenderWalletBadge(role, account);
    onReady(savedId, account);
    return;
  }

  const copy =
    role === "advertiser"
      ? {
          title: "지문/얼굴인식으로 광고주 계정을 연결해주세요",
          sub: "시드문구 없이 1회만 인증하면 이후에는 자동으로 로그인돼요. 캠페인 예산 예치는 플랫폼이 대행해요.",
          namePlaceholder: "브랜드명 (선택, 예: 선데이글로우)",
        }
      : {
          title: "지문/얼굴인식으로 지갑을 연결해주세요",
          sub: "시드문구 없이 1회만 인증하면 이후에는 자동으로 로그인돼요. 가스비는 플랫폼이 대신 내요.",
          namePlaceholder: "닉네임 (선택, 예: 지수)",
        };

  const wallet = await linkoWaitForWalletWidget();

  // 이 브라우저에 "다른 role"에서 이미 연결해둔 지갑이 남아있으면(LazorKit은 브라우저/오리진 단위로
  // 지갑을 캐시하기 때문) 그대로 두면 그 지갑이 조용히 재사용돼서 광고주/크리에이터가 같은 주소를
  // 갖게 됨. role별로 다른 키를 쓰고 싶다는 요구사항이라, 저장된 세션이 없는 role에 처음 들어왔을 때는
  // 먼저 기존 연결을 끊어서 포털이 "Sign in / Create new account" 선택지를 다시 보여주게 만든다.
  try {
    const state = wallet.getState ? wallet.getState() : null;
    if (state?.isConnected) {
      await wallet.disconnect();
    }
  } catch {
    /* 무시 — 끊기 실패해도 아래 연결 플로우는 그대로 시도 */
  }

  const banner = document.createElement("div");
  banner.id = "linkoWalletGate";
  banner.className = "panel";
  banner.style.cssText = "text-align:center; padding:36px 24px;";
  banner.innerHTML = `
    <p style="margin:0 0 4px; font-weight:800; font-size:15.5px;">${copy.title}</p>
    <p style="margin:0 0 16px; color:var(--muted); font-size:13px;">${copy.sub}</p>
    <input
      id="linkoNicknameInput"
      type="text"
      placeholder="${copy.namePlaceholder}"
      maxlength="30"
      style="display:block; width:220px; margin:0 auto 14px; padding:9px 12px; border:1px solid var(--border, #ddd); border-radius:8px; font-size:13px; text-align:center;"
    />
    <p style="margin:0 0 16px; color:var(--muted); font-size:12px;">⚠️ 다른 역할(광고주/크리에이터)로 이미 연결한 적이 있다면, 포털에서 <b>"Create new account"</b>를 선택해야 서로 다른 지갑이 발급돼요. "Sign in"을 누르면 이전에 만든 지갑으로 다시 연결됩니다. (포털 안의 계정 이름 입력칸은 LazorKit 자체 설정이라 여기 닉네임과는 별개예요)</p>
    <span data-linko-connect></span>
  `;
  const main = document.querySelector("main .wrap") || document.body;
  main.prepend(banner);

  wallet.registerConnectSlot(banner.querySelector("[data-linko-connect]"));
  wallet.subscribe(async (state) => {
    if (!state.isConnected || !state.walletAddress) return;
    if (banner.dataset.handled) return; // 중복 호출 방지
    banner.dataset.handled = "1";
    try {
      const nicknameInput = banner.querySelector("#linkoNicknameInput");
      const typedName = nicknameInput?.value.trim();
      const account = await linkoEnsureAccountForWallet(role, state.walletAddress, typedName || opts.name);
      banner.remove();
      linkoRenderWalletBadge(role, account);
      onReady(account.id, account);
    } catch (e) {
      banner.dataset.handled = "";
      toast(e.message);
    }
  });
}

// ---------- 프로모터(크리에이터) 전용 래퍼 — 기존 페이지들과의 호환용 이름 유지 ----------
function linkoGetSavedPromoterId() {
  return linkoGetSavedId("promoter");
}
function linkoClearSession() {
  linkoClearRoleSession("promoter");
}
async function linkoEnsurePromoterForWallet(walletAddress) {
  return linkoEnsureAccountForWallet("promoter", walletAddress);
}
async function linkoRequirePromoterSession(onReady) {
  return linkoRequireRoleSession("promoter", onReady);
}

// ---------- 광고주 전용 래퍼 ----------
function linkoGetSavedAdvertiserId() {
  return linkoGetSavedId("advertiser");
}
function linkoClearAdvertiserSession() {
  linkoClearRoleSession("advertiser");
}
async function linkoEnsureAdvertiserForWallet(walletAddress) {
  return linkoEnsureAccountForWallet("advertiser", walletAddress);
}
async function linkoRequireAdvertiserSession(onReady) {
  return linkoRequireRoleSession("advertiser", onReady);
}
