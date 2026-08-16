let krwPerUsdc = 1400;
let currentAdvertiserId = null;
let currentAdvertiserWallet = null;
let budgetExists = false;
let lastSolscanUrl = null;

api("/api/config")
  .then((cfg) => {
    krwPerUsdc = cfg.krwPerUsdc || krwPerUsdc;
  })
  .catch(() => {});

document.getElementById("amountKrw").addEventListener("input", (e) => {
  const krw = Number(e.target.value) || 0;
  document.getElementById("usdcHint").textContent = krw ? `온체인에서는 약 ${(krw / krwPerUsdc).toFixed(2)} USDC로 처리돼요` : "";
});

async function loadStatus(advertiserId, walletAddress) {
  currentAdvertiserId = advertiserId;
  currentAdvertiserWallet = walletAddress || null;
  const statusPanel = document.getElementById("statusPanel");
  try {
    const query = currentAdvertiserWallet ? `?wallet=${encodeURIComponent(currentAdvertiserWallet)}` : "";
    const info = await api(`/api/advertiser/${advertiserId}/budget${query}`);
    budgetExists = info.exists;
    if (info.exists) {
      statusPanel.innerHTML = `
        <h2>현재 Budget 상태</h2>
        <div class="stat-row">
          <div class="stat-card"><div class="label">Vault 잔액</div><div class="value small">${won(Math.round(info.vaultBalanceUsdc * krwPerUsdc))}</div></div>
        </div>
        <p class="mono" style="margin-top:12px;">${escapeHtml(info.budgetPda)}</p>
        ${lastSolscanUrl ? `<a href="${escapeHtml(lastSolscanUrl)}" target="_blank" style="display:block; margin-top:8px; font-size:12.5px;">방금 낸 트랜잭션 Solscan에서 보기 →</a>` : ""}
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
  if (!currentAdvertiserWallet) return toast("지갑이 아직 연결되지 않았어요. 패스키로 다시 연결해주세요.");

  // 반올림 손실 방지: 원 -> USDC 변환에서 소수점을 미리 자르지 않고 그대로 넘김
  const amountUsdc = amountKrw / krwPerUsdc;

  btn.disabled = true;
  const wasExisting = budgetExists;
  try {
    // 1) 서버가 인스트럭션 + 주소 룩업 테이블만 조립(서명 없음)
    btn.textContent = "온체인 충전 준비 중...";
    const prep = await api(`/api/advertiser/${currentAdvertiserId}/budget/prepare`, {
      method: "POST",
      body: JSON.stringify({ advertiserWallet: currentAdvertiserWallet, amountUsdc }),
    });

    // 2) 광고주 실제 지갑(LazorKit 패스키)으로 직접 서명·전송
    btn.textContent = "지문/얼굴인식으로 서명해주세요...";
    const wallet = await linkoWaitForWalletWidget();
    const signResult = await wallet.signAndSendTransaction(prep.instructions, prep.altAddresses);
    const depositTx = typeof signResult === "string" ? signResult : signResult?.signature;
    if (!depositTx) throw new Error("서명은 됐는데 트랜잭션 서명값을 못 받았어요. 다시 시도해주세요.");

    // 3) 서버가 온체인에서 실제로 확인한 뒤 최신 잔액을 돌려줌
    btn.textContent = "충전 확인 중...";
    const data = await api(`/api/advertiser/${currentAdvertiserId}/budget/finalize`, {
      method: "POST",
      body: JSON.stringify({ advertiserWallet: currentAdvertiserWallet, depositTx }),
    });

    toast(wasExisting ? `내 지갑으로 직접 서명해서 ${won(amountKrw)}가 추가로 충전됐어요!` : `내 지갑으로 직접 서명해서 Budget PDA가 생성되고 ${won(amountKrw)}가 충전됐어요!`);
    lastSolscanUrl = data.solscanUrl || null;
    document.getElementById("amountKrw").value = "";
    document.getElementById("usdcHint").textContent = "";
    loadStatus(currentAdvertiserId, currentAdvertiserWallet);
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = budgetExists ? "추가 충전하기" : "충전하기";
  }
});

linkoRequireAdvertiserSession((id, advertiser) => loadStatus(id, advertiser?.walletAddress));
