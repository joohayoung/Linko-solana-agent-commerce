async function loadCampaigns(query) {
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const note = document.getElementById("searchNote");
  grid.innerHTML = `<div class="empty-state"><span class="spinner"></span> 불러오는 중...</div>`;

  try {
    const url = query ? `/api/campaigns?q=${encodeURIComponent(query)}` : "/api/campaigns";
    const data = await api(url);
    const campaigns = data.campaigns || [];

    if (query) {
      note.style.display = "block";
      note.innerHTML = `"<b>${escapeHtml(query)}</b>" 검색 결과 · Gemini가 관련도순으로 정렬했어요`;
    } else {
      note.style.display = "none";
    }

    if (campaigns.length === 0) {
      grid.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";

    grid.innerHTML = campaigns.map(cardHtml).join("");
  } catch (e) {
    grid.innerHTML = `<div class="empty-state">불러오기 실패: ${escapeHtml(e.message)}</div>`;
  }
}

function cardHtml(c) {
  const maxRate = Math.max(...c.commissionTiers.map((t) => t.rate));
  const minRate = Math.min(...c.commissionTiers.map((t) => t.rate));
  return `
  <a class="card" href="/campaign.html?id=${c.id}">
    <div class="card-media">
      <img src="${c.thumbnail || '/images/campaigns/moisturizer.svg'}" alt="${escapeHtml(c.product)}" onError="this.src='/images/campaigns/moisturizer.svg'" />
      <span class="badge-corner">최대 ${pct(maxRate)} 리워드</span>
    </div>
    <div class="card-body">
      <div class="card-tags">${c.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
      <p class="card-title">${escapeHtml(c.product)}</p>
      <p class="card-sub">${escapeHtml(c.advertiser)} · 확정대기 ${c.confirmDelayDays}일</p>
      <div class="flex-between">
        <div class="card-price">${won(c.price)}<span class="rate">${pct(minRate)}~${pct(maxRate)}</span></div>
      </div>
    </div>
  </a>`;
}

document.getElementById("searchBtn").addEventListener("click", () => {
  const q = document.getElementById("searchInput").value.trim();
  loadCampaigns(q || undefined);
});
document.getElementById("searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("searchBtn").click();
});

loadCampaigns();
