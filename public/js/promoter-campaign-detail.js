const PROMOTER_ID = "promoter-jisu"; // 데모: 크리에이터는 지수로 고정

const params = new URLSearchParams(location.search);
const campaignId = params.get("campaignId");
let ctx = null;

async function load() {
  if (!campaignId) {
    document.getElementById("content").innerHTML = `<div class="empty-state">캠페인 id가 없습니다.</div>`;
    return;
  }
  try {
    const data = await api(`/api/promoters/${PROMOTER_ID}/campaigns/${campaignId}`);
    ctx = data;
    render(data);
  } catch (e) {
    document.getElementById("content").innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function render(data) {
  const c = data.campaign;
  document.getElementById("crumbTitle").textContent = c.product;
  document.title = `${c.product} — 크리에이터 상세 — Linko`;

  const url = `${location.origin}/go/${data.participation.referralCode}`;
  const nextInfo = data.stats.nextTier
    ? `다음 구간까지 ${data.stats.nextTier.minSales - data.stats.confirmedCount}건 남음 (${pct(data.stats.nextTier.rate)}로 상승)`
    : "최고 구간 도달";

  document.getElementById("content").innerHTML = `
    <div class="card" style="margin-bottom:22px;">
      <div class="card-media" style="height:180px; font-size:40px;">${c.thumbnail ? `<img src="${c.thumbnail}" alt="${escapeHtml(c.product)}" />` : initials(c.advertiser)}</div>
      <div class="card-body" style="padding:24px;">
        <div class="card-tags">${c.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
        <h1 style="margin:2px 0 6px; font-size:22px;">${escapeHtml(c.product)}</h1>
        <p style="color:var(--muted); margin:0 0 14px;">${escapeHtml(c.advertiser)} · ${escapeHtml(c.description)}</p>
        <div style="font-size:22px; font-weight:800;">${won(c.price)}</div>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat-card"><div class="label">클릭수</div><div class="value">${data.stats.clicks}회</div></div>
      <div class="stat-card"><div class="label">구매건수</div><div class="value">${data.stats.purchaseCount}건</div></div>
      <div class="stat-card"><div class="label">확정건수</div><div class="value">${data.stats.confirmedCount}건</div></div>
      <div class="stat-card"><div class="label">누적 정산액</div><div class="value small">${won(data.stats.cumulativeSettledKrw)}</div><div class="sub">현재 비율 ${pct(data.stats.currentRate)} · ${nextInfo}</div></div>
    </div>
    <p style="color:var(--muted); font-size:12px; margin:-14px 0 22px;">실제 결제는 ${data.stats.cumulativeSettledUsdc.toFixed(2)} USDC로 온체인 지급돼요.</p>

    ${c.guideline ? `
    <div class="panel">
      <h2>광고 가이드라인</h2>
      <p style="font-size:13.5px; white-space:pre-wrap; margin:0;">${escapeHtml(c.guideline)}</p>
    </div>` : ""}

    <div class="panel">
      <h2>내 추천 링크</h2>
      <p style="color:var(--muted); font-size:13.5px; margin-top:-8px;">
        이 링크를 클릭하면 실제 상품 페이지로 연결돼요(클릭 로그 자동 기록). 판매가 확정될 때마다 리워드가 자동 정산돼요.
        ${c.productUrl ? `<a href="${escapeHtml(c.productUrl)}" target="_blank" rel="noopener" style="color:var(--primary-dark); font-weight:700;">실제 상품 페이지 보기 ↗</a>` : ""}
      </p>
      <div class="link-box">
        <span class="url" id="refUrl">${url}</span>
        <button class="pill-btn ghost" id="copyBtn" style="padding:6px 14px; font-size:12.5px;">복사</button>
      </div>
    </div>

    <div class="panel">
      <h2>주문 내역</h2>
      <table id="orderTable">
        <thead><tr><th>금액</th><th>상태</th><th>적용비율</th><th>리워드</th><th>정산 tx</th><th>시각</th></tr></thead>
        <tbody>${renderOrderRows(data.orders)}</tbody>
      </table>
      ${!data.orders.length ? `<div class="empty-state">아직 주문이 없어요. 오른쪽 아래 시뮬레이터로 구매를 발생시켜보세요.</div>` : ""}
    </div>
  `;

  document.getElementById("copyBtn").addEventListener("click", () => {
    navigator.clipboard?.writeText(url);
    toast("복사했어요.");
  });
}

function renderOrderRows(orders) {
  return orders
    .map(
      (o) => `
    <tr>
      <td>${won(o.amount)}</td>
      <td><span class="badge ${statusBadgeClass(o.status)}">${statusLabel(o.status)}</span></td>
      <td>${o.commissionRateApplied != null ? pct(o.commissionRateApplied) : "-"}</td>
      <td>${o.commissionAmountKrw != null ? won(o.commissionAmountKrw) : "-"}</td>
      <td>${o.settlementTx ? `<a class="mono" href="https://solscan.io/tx/${o.settlementTx}?cluster=devnet" target="_blank">${o.settlementTx.slice(0, 8)}...↗</a>` : "-"}</td>
      <td class="mono">${fmtDate(o.purchasedAt)}</td>
    </tr>`
    )
    .join("");
}

document.getElementById("simBuyBtn").addEventListener("click", async () => {
  if (!ctx) return;
  const input = document.getElementById("simBuyCount");
  const count = Math.max(1, Number(input.value) || 1);
  const btn = document.getElementById("simBuyBtn");
  btn.disabled = true;
  btn.textContent = "처리 중...";
  try {
    await api(`/api/participations/${ctx.participation.referralCode}/simulate-purchase`, {
      method: "POST",
      body: JSON.stringify({ count }),
    });
    toast(`${count}건 구매 시뮬레이션 완료!`);
    await load();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "구매하기";
  }
});

load();
