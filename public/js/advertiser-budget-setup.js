let krwPerUsdc = 1400;
let currentAdvertiserId = null;
let budgetExists = false;

api("/api/config")
  .then((cfg) => {
    krwPerUsdc = cfg.krwPerUsdc || krwPerUsdc;
  })
  .catch(() => {});

document.getElementById("amountKrw").addEventListener("input", (e) => {
  const krw = Number(e.target.value) || 0;
  document.getElementById("usdcHint").textContent = krw ? `온체인에서는 약 ${(krw / krwPerUsdc).toFixed(2)} USDC로 처리돼요` : "";
});

async function loadStatus(advertiserId) {
  currentAdvertiserId = advertiserId;
  const statusPanel = document.getElementById("statusPanel");
  try {
    const info = await api(`/api/advertiser/${advertiserId}/budget`);
    budgetExists = info.exists;
    if (info.exists) {
      statusPanel.innerHTML = `
        <h2>현재 Budget 상태</h2>
        <div class="stat-row">
          <div class="stat-card"><div class="label">Vault 잔액</div><div class="value small">${won(Math.round(info.vaultBalanceUsdc * krwPerUsdc))}</div></div>
        </div>
        <p class="mono" style="margin-top:12px;">${escapeHtml(info.budgetPda)}</p>
        <a class="pill-btn" href="/advertiser-budget-agent.html" style="display:inline-block; margin-top:14px;">예산 에이전트 실행하러 가기 →</a>
      `;
      document.getElementById("amountLabel").textContent = "추가로 충전할 금액 (원)";
      document.getElementById("submitBtn").textContent = "추가 충전하기";
    } else {
      statusPanel.innerHTML = `<p style="color:var(--muted);">아직 Budget PDA가 없어요. 아래에서 충전하면 새로 만들어져요.</p>`;
      document.getElementById("amountLabel").textContent = "충전할 금액 (원)";
      document.getElementById("submitBtn").textContent = "충전하기";
    }
    document.getElementById("formPanel").style.display = "block";
  } catch (e) {
    statusPanel.innerHTML = `<p style="color:var(--danger);">${escapeHtml(e.message)}</p>`;
  }
}

document.getElementById("submitBtn").addEventListener("click", async () => {
  const btn = document.getElementById("submitBtn");
  const amountKrw = Number(document.getElementById("amountKrw").value);
  if (!amountKrw || amountKrw <= 0) return toast("충전할 금액을 입력해주세요.");
  if (!currentAdvertiserId) return toast("광고주 계정을 먼저 연결해주세요.");

  // 반올림 손실 방지: 원 -> USDC 변환에서 소수점을 미리 자르지 않고 그대로 넘김
  // (서버가 온체인 전송 직전 6자리에서 최종 반올림하므로, 여기서 2자리로 먼저 자르면
  //  예: 5000원 -> 3.57 USDC -> 4998원처럼 왕복 손실이 생김)
  const amountUsdc = amountKrw / krwPerUsdc;

  // 팝업 차단 방지: 비동기 요청 이후에 새 탭을 열면 "사용자 클릭 직후"가 아니라서 브라우저가
  // 막을 수 있음 -> 클릭 즉시 빈 탭을 먼저 열어두고, 응답이 오면 그 탭의 주소만 바꿔줌.
  const solscanTab = window.open("", "_blank");

  btn.disabled = true;
  const wasExisting = budgetExists;
  btn.textContent = "온체인 처리 중... (몇 초 걸려요)";
  try {
    const data = await api(`/api/advertiser/${currentAdvertiserId}/budget`, {
      method: "POST",
      body: JSON.stringify({ amountUsdc }),
    });
    toast(wasExisting ? `${won(amountKrw)}가 추가로 충전됐어요!` : `Budget PDA가 생성되고 ${won(amountKrw)}가 충전됐어요!`);
    if (data.solscanUrl && solscanTab) {
      solscanTab.location = data.solscanUrl;
    } else if (data.solscanUrl) {
      window.open(data.solscanUrl, "_blank");
    } else if (solscanTab) {
      solscanTab.close();
    }
    document.getElementById("amountKrw").value = "";
    document.getElementById("usdcHint").textContent = "";
    loadStatus(currentAdvertiserId);
  } catch (e) {
    if (solscanTab) solscanTab.close();
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = budgetExists ? "추가 충전하기" : "충전하기";
  }
});

linkoRequireAdvertiserSession((id) => loadStatus(id));
