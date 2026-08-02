const params = new URLSearchParams(location.search);
const refCode = params.get("ref");
let ctx = null; // { campaign, promoter, participation }
let currentOrder = null;

async function init() {
  if (!refCode) {
    renderNoRef();
    return;
  }
  try {
    const data = await api(`/api/participations/by-code/${refCode}`);
    ctx = data;
    renderProduct();
  } catch (e) {
    document.getElementById("content").innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function renderNoRef() {
  document.getElementById("content").innerHTML = `
    <div class="empty-state">추천 링크로 접속해주세요. (예: 캠페인 상세 페이지에서 발급받은 링크)</div>
  `;
}

function renderProduct() {
  const c = ctx.campaign;
  document.getElementById("content").innerHTML = `
    <div class="card" style="margin-bottom:20px;">
      <div class="card-media" style="height:180px; font-size:40px;">${initials(c.advertiser)}</div>
      <div class="card-body" style="padding:22px;">
        <p class="card-sub">${escapeHtml(ctx.promoter.name)}님의 추천 · ${escapeHtml(c.advertiser)}</p>
        <h2 style="margin:0 0 8px;">${escapeHtml(c.product)}</h2>
        <p style="color:var(--muted); margin:0 0 16px;">${escapeHtml(c.description)}</p>
        <div style="font-size:22px; font-weight:800; margin-bottom:18px;">${won(c.price)}</div>
        <button class="pill-btn" id="buyBtn" style="width:100%;">구매하기</button>
      </div>
    </div>
  `;
  document.getElementById("buyBtn").addEventListener("click", doCheckout);
}

async function doCheckout() {
  const btn = document.getElementById("buyBtn");
  btn.disabled = true;
  btn.textContent = "결제 처리 중...";
  try {
    const data = await api("/api/checkout", {
      method: "POST",
      body: JSON.stringify({ referralCode: refCode }),
    });
    currentOrder = data.order;
    renderOrderStatus();
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = "구매하기";
  }
}

function renderOrderStatus() {
  const o = currentOrder;
  const c = ctx.campaign;

  let settledBlock = "";
  if (o.status === "settled") {
    settledBlock = `
      <div style="background:var(--success-bg); border-radius:var(--radius-sm); padding:16px; margin-top:14px;">
        <b style="color:var(--success);">정산 완료!</b>
        <p style="margin:8px 0 4px; font-size:13.5px;">${escapeHtml(ctx.promoter.name)}님에게 ${won(o.commissionAmountKrw)}가 즉시 지급됐어요 (요율 ${pct(o.commissionRateApplied)}).</p>
        <p style="margin:0; font-size:11.5px; color:var(--muted);">실제 결제는 ${o.commissionAmountUsdc.toFixed(2)} USDC로 온체인 지급됐어요.</p>
        <a class="mono" href="https://solscan.io/tx/${o.settlementTx}?cluster=devnet" target="_blank">Solscan에서 트랜잭션 보기 ↗</a>
      </div>`;
  } else if (o.status === "cancelled") {
    settledBlock = `<div style="background:var(--danger-bg); border-radius:var(--radius-sm); padding:16px; margin-top:14px;"><b style="color:var(--danger);">주문이 취소됐어요.</b> 정산은 실행되지 않습니다.</div>`;
  }

  document.getElementById("content").innerHTML = `
    <div class="panel">
      <div class="flex-between" style="margin-bottom:10px;">
        <h2 style="margin:0;">주문 상태</h2>
        <span class="badge ${statusBadgeClass(o.status)}">${statusLabel(o.status)}</span>
      </div>
      <p style="color:var(--muted); font-size:13.5px; margin:0 0 4px;">${escapeHtml(c.product)} · ${won(o.amount)}</p>
      <p class="mono" style="font-size:12px;">주문번호: ${o.id}</p>
      ${settledBlock}
    </div>

    ${o.status === "purchased" || o.status === "pending_confirm" ? `
    <div class="panel">
      <h2>데모 컨트롤</h2>
      <p style="color:var(--muted); font-size:13px; margin-top:-6px;">
        실제로는 확정대기기간(${c.confirmDelayDays}일) 이후 쇼핑몰이 자동으로 구매확정 처리해요.
        데모에서는 버튼으로 즉시 시뮬레이션할 수 있어요.
      </p>
      <div style="display:flex; gap:10px;">
        <button class="pill-btn" id="confirmBtn">구매확정 시뮬레이션 → 즉시 정산</button>
        <button class="pill-btn ghost" id="cancelBtn">취소 시뮬레이션</button>
      </div>
    </div>` : ""}
  `;

  document.getElementById("confirmBtn")?.addEventListener("click", () => simulate("confirm"));
  document.getElementById("cancelBtn")?.addEventListener("click", () => simulate("cancel"));
}

async function simulate(action) {
  const btn = document.getElementById(action === "confirm" ? "confirmBtn" : "cancelBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> 처리 중...`;
  try {
    const data = await api(`/api/orders/${currentOrder.id}/${action}-simulate`, { method: "POST" });
    currentOrder = data.order;
    renderOrderStatus();
    if (action === "confirm" && data.order.status === "settled") {
      toast("정산까지 자동으로 완료됐어요!");
    } else if (action === "confirm") {
      toast("확정 처리됨 — 아직 정산 대기 중일 수 있어요.");
    } else {
      toast("취소 처리됐어요.");
    }
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
  }
}

init();
