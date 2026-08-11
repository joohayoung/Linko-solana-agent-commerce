async function loadDashboard(promoterId) {
  try {
    const data = await api(`/api/promoters/${promoterId}/dashboard`);
    document.getElementById("pageTitle").textContent = `${data.promoter.name}님의 대시보드`;
    renderStats(data);
    renderParticipations(data.participations);
    renderOrders(data.orders);
  } catch (e) {
    toast(e.message);
  }
}

function renderStats(data) {
  const settledCount = data.orders.filter((o) => o.status === "settled").length;
  document.getElementById("statRow").innerHTML = `
    <div class="stat-card"><div class="label">지갑 주소</div><div class="value small mono">${data.promoter.walletAddress.slice(0, 10)}...</div></div>
    <div class="stat-card"><div class="label">참여 캠페인</div><div class="value">${data.participations.length}개</div></div>
    <div class="stat-card"><div class="label">확정 판매</div><div class="value">${settledCount}건</div></div>
    <div class="stat-card"><div class="label">누적 정산액</div><div class="value small">${won(data.totalEarnedKrw)}</div><div class="sub">실제 ${data.totalEarnedUsdc.toFixed(2)} USDC 온체인 지급</div></div>
  `;
}

function renderParticipations(rows) {
  const tbody = document.querySelector("#participationTable tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--muted); text-align:center; padding:24px;">아직 참여한 캠페인이 없어요.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((r) => {
      const nextInfo = r.nextTier
        ? `${r.nextTier.minSales - r.cumulativeConfirmedCount}건 남음 (${pct(r.nextTier.rate)}로 상승)`
        : "최고 구간 도달";
      return `
    <tr style="cursor:pointer;" onclick="location.href='/promoter-campaign-detail.html?campaignId=${r.campaignId}'">
      <td><b>${escapeHtml(r.product)}</b></td>
      <td class="mono">${escapeHtml(r.referralCode)}</td>
      <td>${r.cumulativeConfirmedCount}건</td>
      <td><b>${pct(r.currentRate)}</b></td>
      <td>${nextInfo}</td>
    </tr>`;
    })
    .join("");
}

function renderOrders(orders) {
  const tbody = document.querySelector("#orderTable tbody");
  const empty = document.getElementById("orderEmpty");
  if (!orders.length) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  tbody.innerHTML = orders
    .map(
      (o) => `
    <tr>
      <td>${escapeHtml(o.product)}</td>
      <td>${won(o.amount)}</td>
      <td><span class="badge ${statusBadgeClass(o.status)}">${statusLabel(o.status)}</span></td>
      <td>${o.commissionRateApplied != null ? pct(o.commissionRateApplied) : "-"}</td>
      <td>${o.commissionAmountKrw != null ? won(o.commissionAmountKrw) : "-"}</td>
      <td>${o.settlementTx ? `<a class="mono" href="https://solscan.io/tx/${o.settlementTx}?cluster=devnet" target="_blank">${o.settlementTx.slice(0, 8)}...↗</a>` : "-"}</td>
    </tr>`
    )
    .join("");
}

linkoRequirePromoterSession(loadDashboard);
