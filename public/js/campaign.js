const params = new URLSearchParams(location.search);
const campaignId = params.get("id");
let currentCampaign = null;

async function loadCampaign() {
  if (!campaignId) {
    document.getElementById("content").innerHTML = `<div class="empty-state">캠페인 id가 없습니다.</div>`;
    return;
  }
  try {
    const data = await api(`/api/campaigns/${campaignId}`);
    currentCampaign = data.campaign;
    render(currentCampaign);
  } catch (e) {
    document.getElementById("content").innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function render(c) {
  document.getElementById("crumbTitle").textContent = c.product;
  document.title = `${c.product} — Linko`;

  const tiersHtml = c.commissionTiers
    .map((t) => {
      const range = t.maxSales == null ? `${t.minSales}건 이상` : `${t.minSales}~${t.maxSales}건`;
      return `<tr><td>${range}</td><td><b>${pct(t.rate)}</b></td><td>${won(Math.round(c.price * t.rate))}</td></tr>`;
    })
    .join("");

  document.getElementById("content").innerHTML = `
    <div class="card-media" style="height:200px; font-size:44px;"><img src="${c.thumbnail || '/images/campaigns/moisturizer.svg'}" alt="${escapeHtml(c.product)}" onError="this.src='/images/campaigns/moisturizer.svg'" /></div>
      <div class="card-body" style="padding:24px;">
        <div class="card-tags">${c.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
        <h1 style="margin:2px 0 6px; font-size:22px;">${escapeHtml(c.product)}</h1>
        <p style="color:var(--muted); margin:0 0 14px;">${escapeHtml(c.advertiser)} · ${escapeHtml(c.description)}</p>
        <div style="font-size:24px; font-weight:800;">${won(c.price)}</div>
        ${c.productUrl ? `<a href="${escapeHtml(c.productUrl)}" target="_blank" rel="noopener" style="display:inline-block; margin-top:10px; font-size:12.5px; color:var(--primary-dark); font-weight:700;">실제 상품 페이지 보러가기 ↗</a>` : ""}
      </div>
    </div>

    <div class="panel">
      <h2>누적 확정판매 건수에 따른 리워드 요율</h2>
      <table>
        <thead><tr><th>누적 확정 건수</th><th>리워드 요율</th><th>건당 리워드</th></tr></thead>
        <tbody>${tiersHtml}</tbody>
      </table>
      <p style="font-size:12.5px; color:var(--muted); margin:14px 0 0;">
        구매확정 후 <b>${c.confirmDelayDays}일</b> 확정대기기간이 지나 취소가 없어야 정산됩니다 (부정사용 방지).
        요율은 정산 시점의 내 누적 확정 건수 기준으로 결정돼요.
      </p>
    </div>

    ${c.guideline ? `
    <div class="panel">
      <h2>광고 가이드라인</h2>
      <p style="font-size:13.5px; white-space:pre-wrap; margin:0;">${escapeHtml(c.guideline)}</p>
    </div>` : ""}
  `;
}

const PROMOTER_ID = "promoter-jisu"; // 데모: 크리에이터는 지수로 고정

document.getElementById("participateBtn").addEventListener("click", async () => {
  const btn = document.getElementById("participateBtn");
  btn.disabled = true;
  btn.textContent = "처리 중...";
  try {
    await api(`/api/campaigns/${campaignId}/participate`, {
      method: "POST",
      body: JSON.stringify({ promoterId: PROMOTER_ID }),
    });
    location.href = `/promoter-campaign-detail.html?campaignId=${campaignId}`;
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = "광고 진행하기";
  }
});

loadCampaign();
