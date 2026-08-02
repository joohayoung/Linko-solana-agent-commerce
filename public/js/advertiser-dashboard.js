const ADVERTISER_NAME = "선데이글로우"; // 데모: 광고주는 선데이글로우로 고정

async function load() {
  try {
    const data = await api(`/api/advertiser/dashboard?advertiser=${encodeURIComponent(ADVERTISER_NAME)}`);
    renderStats(data);
    renderCampaigns(data.campaigns);
  } catch (e) {
    toast(e.message);
  }
}

function renderStats(data) {
  const totalBudget = data.campaigns.reduce((s, c) => s + c.budgetKrw, 0);
  const totalSpentKrw = data.campaigns.reduce((s, c) => s + c.spentKrw, 0);
  const totalSpentUsdc = data.campaigns.reduce((s, c) => s + c.spentUsdc, 0);
  const totalSettled = data.campaigns.reduce((s, c) => s + c.settledCount, 0);
  const totalOrders = data.campaigns.reduce((s, c) => s + c.totalOrders, 0);

  document.getElementById("statRow").innerHTML = `
    <div class="stat-card"><div class="label">캠페인 수</div><div class="value">${data.campaigns.length}개</div></div>
    <div class="stat-card"><div class="label">전체 주문</div><div class="value">${totalOrders}건</div></div>
    <div class="stat-card"><div class="label">정산 완료</div><div class="value">${totalSettled}건</div></div>
    <div class="stat-card"><div class="label">총 집행 리워드</div><div class="value small">${won(totalSpentKrw)}</div><div class="sub">예산 ${won(totalBudget)} 중 · 실제 ${totalSpentUsdc.toFixed(2)} USDC 온체인 정산</div></div>
  `;
}

function renderCampaigns(campaigns) {
  const tbody = document.querySelector("#campaignTable tbody");
  tbody.innerHTML = campaigns
    .map(
      (c) => `
    <tr style="cursor:pointer;" onclick="location.href='/advertiser-campaign-detail.html?id=${c.id}'">
      <td><b>${escapeHtml(c.product)}</b><br/><span class="mono">${escapeHtml(c.advertiser)}</span></td>
      <td>${won(c.budgetKrw)}</td>
      <td>${won(c.spentKrw)}</td>
      <td>${won(c.budgetKrw - c.spentKrw)}</td>
      <td>${c.settledCount}건</td>
      <td>${c.pendingCount}건</td>
      <td>${c.cancelledCount}건</td>
    </tr>`
    )
    .join("");
}

load();
