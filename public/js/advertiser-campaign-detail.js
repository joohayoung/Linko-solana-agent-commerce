const params = new URLSearchParams(location.search);
const campaignId = params.get("id");

async function load() {
  if (!campaignId) {
    document.getElementById("content").innerHTML = `<div class="empty-state">캠페인 id가 없습니다.</div>`;
    return;
  }
  try {
    const data = await api(`/api/campaigns/${campaignId}/advertiser-detail`);
    render(data);
  } catch (e) {
    document.getElementById("content").innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function render(data) {
  const c = data.campaign;
  const s = data.stats;
  document.getElementById("crumbTitle").textContent = c.product;
  document.title = `${c.product} — 광고주 상세 — Linko`;

  const tiersHtml = c.commissionTiers
    .map((t) => {
      const range = t.maxSales == null ? `${t.minSales}건 이상` : `${t.minSales}~${t.maxSales}건`;
      return `<tr><td>${range}</td><td><b>${pct(t.rate)}</b></td><td>${won(Math.round(c.price * t.rate))}</td></tr>`;
    })
    .join("");

  const creatorsHtml = data.creators.length
    ? data.creators
        .map(
          (cr) => `
    <tr>
      <td><b>${escapeHtml(cr.name)}</b></td>
      <td>${cr.purchaseCount}건</td>
      <td>${cr.confirmedCount}건</td>
      <td>${won(cr.settledKrw)}</td>
    </tr>`
        )
        .join("")
    : `<tr><td colspan="4" style="text-align:center; color:var(--muted); padding:24px;">아직 참여한 크리에이터가 없어요.</td></tr>`;

  document.getElementById("content").innerHTML = `
    <div class="card" style="margin-bottom:22px;">
      <div class="card-media" style="height:180px; font-size:40px;">${c.thumbnail ? `<img src="${c.thumbnail}" alt="${escapeHtml(c.product)}" />` : initials(c.advertiser)}</div>
      <div class="card-body" style="padding:24px;">
        <div class="card-tags">${c.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
        <h1 style="margin:2px 0 6px; font-size:22px;">${escapeHtml(c.product)}</h1>
        <p style="color:var(--muted); margin:0 0 14px;">${escapeHtml(c.advertiser)} · ${escapeHtml(c.description)}</p>
        <div style="font-size:22px; font-weight:800;">${won(c.price)}</div>
        <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-top:10px;">
          ${c.productUrl ? `<a href="${escapeHtml(c.productUrl)}" target="_blank" rel="noopener" style="font-size:12.5px; color:var(--primary-dark); font-weight:700;">실제 상품 페이지 ↗</a>` : ""}
          <a href="/advertiser-pixel-setup.html?id=${c.id}" class="pill-btn ghost">🔌 픽셀 설치 안내</a>
        </div>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat-card"><div class="label">예산</div><div class="value small">${won(s.budgetKrw)}</div></div>
      <div class="stat-card"><div class="label">집행</div><div class="value small">${won(s.spentKrw)}</div><div class="sub">${s.spentUsdc.toFixed(2)} USDC 온체인 정산</div></div>
      <div class="stat-card"><div class="label">잔여</div><div class="value small">${won(s.budgetKrw - s.spentKrw)}</div></div>
      <div class="stat-card"><div class="label">정산완료 / 확정대기 / 취소</div><div class="value small">${s.settledCount} / ${s.pendingCount} / ${s.cancelledCount}건</div></div>
    </div>

    <div class="panel">
      <h2>누적 확정판매 건수에 따른 리워드 비율</h2>
      <table>
        <thead><tr><th>누적 확정 건수</th><th>리워드 비율</th><th>건당 리워드</th></tr></thead>
        <tbody>${tiersHtml}</tbody>
      </table>
      <p style="font-size:12.5px; color:var(--muted); margin:14px 0 0;">
        구매확정 후 <b>${c.confirmDelayDays}일</b> 확정대기기간이 지나 취소가 없어야 정산됩니다 (부정사용 방지).
      </p>
    </div>

    ${c.guideline ? `
    <div class="panel">
      <h2>광고 가이드라인</h2>
      <p style="font-size:13.5px; white-space:pre-wrap; margin:0;">${escapeHtml(c.guideline)}</p>
    </div>` : ""}

    <div class="panel">
      <h2>참여 크리에이터별 실적</h2>
      <table>
        <thead><tr><th>크리에이터</th><th>구매건수</th><th>확정건수</th><th>지급액</th></tr></thead>
        <tbody>${creatorsHtml}</tbody>
      </table>
    </div>
  `;
}

document.getElementById("simConfirmBtn").addEventListener("click", async () => {
  const input = document.getElementById("simConfirmCount");
  const count = Math.max(1, Number(input.value) || 1);
  const btn = document.getElementById("simConfirmBtn");
  btn.disabled = true;
  btn.textContent = "처리 중...";
  try {
    const data = await api(`/api/campaigns/${campaignId}/simulate-confirm`, {
      method: "POST",
      body: JSON.stringify({ count }),
    });
    if (data.settledCount > 0) {
      toast(`${data.settledCount}건 정산 완료!${data.errorCount ? ` (${data.errorCount}건 실패)` : ""}`);
    } else if (data.errorCount > 0) {
      const firstError = data.results.find((r) => r.action === "error")?.detail || "알 수 없는 오류";
      toast(`정산 실패: ${firstError}`);
    } else {
      toast(`처리할 주문이 없거나 아직 대기 중이에요.`);
    }
    await load();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "정산하기";
  }
});

load();
