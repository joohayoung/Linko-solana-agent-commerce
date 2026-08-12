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
    document.getElementById("shopName").textContent = ctx.campaign.advertiser;
    document.getElementById("shopFooter").textContent = `© ${ctx.campaign.advertiser}. All rights reserved.`;
    document.title = `${ctx.campaign.product} — ${ctx.campaign.advertiser}`;
    renderProduct();
  } catch (e) {
    document.getElementById("content").innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function renderNoRef() {
  document.getElementById("content").innerHTML = `
    <div class="empty-state">유효하지 않은 접속이에요. 크리에이터의 추천 링크로 다시 접속해주세요.</div>
  `;
}

function renderProduct() {
  const c = ctx.campaign;
  document.getElementById("content").innerHTML = `
    <div class="product-card">
      <div class="product-media">${c.thumbnail ? `<img src="${c.thumbnail}" alt="${escapeHtml(c.product)}" />` : "🛍️"}</div>
      <div class="product-body">
        <div class="product-brand">${escapeHtml(c.advertiser)}</div>
        <h1 class="product-name">${escapeHtml(c.product)}</h1>
        <p class="product-desc">${escapeHtml(c.description || "")}</p>
        <div class="product-price">${won(c.price)}</div>
        <div class="qty-row">
          <label for="qtyInput">수량</label>
          <input type="number" id="qtyInput" value="1" min="1" max="20" />
        </div>
        <button class="buy-btn" id="buyBtn">구매하기</button>
      </div>
    </div>
    <p class="notice">${escapeHtml(ctx.promoter.name)}님의 추천을 통해 접속하셨어요.</p>
  `;
  document.getElementById("buyBtn").addEventListener("click", doCheckout);
}

async function doCheckout() {
  const btn = document.getElementById("buyBtn");
  const qtyInput = document.getElementById("qtyInput");
  const quantity = Math.max(1, Math.min(20, Number(qtyInput.value) || 1));
  btn.disabled = true;
  btn.textContent = "결제 처리 중...";
  try {
    const data = await api("/api/checkout", {
      method: "POST",
      body: JSON.stringify({ referralCode: refCode, quantity }),
    });
    currentOrder = data.order;
    renderOrderComplete();
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = "구매하기";
  }
}

function renderOrderComplete() {
  const o = currentOrder;
  const c = ctx.campaign;

  document.getElementById("content").innerHTML = `
    <div class="order-complete">
      <div class="order-check">✓</div>
      <h1 class="order-title">주문이 완료되었어요</h1>
      <p class="order-sub">${escapeHtml(c.advertiser)}에서 구매해주셔서 감사합니다.</p>
      <div class="order-info">
        <div><span class="label">상품</span><span>${escapeHtml(c.product)}</span></div>
        <div><span class="label">수량</span><span>${o.quantity || 1}개</span></div>
        <div><span class="label">결제금액</span><span>${won(o.amount)}</span></div>
        <div><span class="label">주문번호</span><span class="mono">${o.id}</span></div>
      </div>
      <button class="buy-btn ghost" onclick="location.reload()">쇼핑 계속하기</button>

      <div id="trackSection" style="margin-top:22px; padding-top:20px; border-top:1px dashed var(--shop-line);">
        <p class="track-status" style="margin-bottom:10px;">
          쇼핑몰 관리자가 주문을 확정 처리하면(예: 배송완료), 설치된 추적 스크립트가 자동으로 구매확정 신호를 보내요.
          <br />(데모에서는 버튼으로 그 시점을 대신 재현합니다)
        </p>
        <button class="buy-btn" id="confirmTrackBtn" style="background:var(--shop-accent);">구매확정 처리 (관리자)</button>
        <div id="trackResult"></div>
      </div>
    </div>
  `;

  document.getElementById("confirmTrackBtn").addEventListener("click", doConfirmTrack);
}

async function doConfirmTrack() {
  const btn = document.getElementById("confirmTrackBtn");
  btn.disabled = true;
  btn.textContent = "확정 신호 전송 중...";
  try {
    const data = await api(`/api/orders/${currentOrder.id}/confirm-simulate`, { method: "POST" });
    const resultEl = document.getElementById("trackResult");
    if (data.order.status === "settled") {
      resultEl.innerHTML = `
        <div class="order-info" style="margin-top:14px; margin-bottom:0;">
          <div><span class="label">구매확정</span><span>완료</span></div>
          <div><span class="label">크리에이터 정산</span><span>${won(data.order.commissionAmountKrw)}</span></div>
          <div><span class="label">온체인 tx</span><a class="mono" href="https://solscan.io/tx/${data.order.settlementTx}?cluster=devnet" target="_blank" style="color:var(--shop-accent);">${data.order.settlementTx.slice(0, 10)}...↗</a></div>
        </div>`;
      btn.textContent = "구매확정 처리됨";
    } else {
      resultEl.innerHTML = `<p class="track-status" style="margin-top:12px;">확정 신호는 전송됐지만 아직 정산 대기 중이에요.</p>`;
      btn.disabled = false;
      btn.textContent = "구매확정 처리 (관리자)";
    }
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = "구매확정 처리 (관리자)";
  }
}

init();