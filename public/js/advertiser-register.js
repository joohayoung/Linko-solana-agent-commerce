let tierCount = 0;
let krwPerUsdc = 1400; // /api/config 로딩 전 임시 기본값

function addTierRow(maxSales = "", rate = "") {
  const id = `tier-${tierCount++}`;
  const row = document.createElement("div");
  row.className = "tier-row";
  row.id = id;
  row.innerHTML = `
    <div class="tier-field">
      <label>적용 구간</label>
      <div class="tier-range-display" data-range-label>-</div>
    </div>
    <div class="tier-field">
      <label>최대 건수 (마지막 구간만 비워서 무제한)</label>
      <input type="number" placeholder="비우면 무제한" value="${maxSales}" data-field="maxSales" />
    </div>
    <div class="tier-field">
      <label>리워드 비율 (%)</label>
      <input type="number" placeholder="예: 10" value="${rate}" data-field="rate" />
    </div>
    <button type="button" class="pill-btn ghost" style="padding:8px 12px;" onclick="document.getElementById('${id}').remove(); recalcTierRanges();">삭제</button>
  `;
  document.getElementById("tierRows").appendChild(row);
  row.querySelector('[data-field="maxSales"]').addEventListener("input", recalcTierRanges);
  recalcTierRanges();
}

document.getElementById("addTierBtn").addEventListener("click", () => {
  addTierRow();
});

// 기본 2구간으로 시작 (0~10건: 10%, 11건 이상: 15%)
addTierRow(10, 10);
addTierRow("", 15);

// 구간은 이전 행의 "최대 건수 + 1"에서 시작하는 것으로 자동 계산 — 최소 건수는 따로 입력받지 않음
function recalcTierRanges() {
  let nextMin = 0;
  [...document.querySelectorAll(".tier-row")].forEach((row) => {
    const maxVal = row.querySelector('[data-field="maxSales"]').value;
    const maxSales = maxVal === "" ? null : Number(maxVal);
    const label = row.querySelector("[data-range-label]");
    label.textContent = maxSales == null ? `${nextMin}건 이상` : `${nextMin}~${maxSales}건`;
    nextMin = maxSales == null ? nextMin : maxSales + 1;
  });
}

function collectTiers() {
  let nextMin = 0;
  return [...document.querySelectorAll(".tier-row")].map((row) => {
    const maxVal = row.querySelector('[data-field="maxSales"]').value;
    const rate = row.querySelector('[data-field="rate"]').value;
    const minSales = nextMin;
    const maxSales = maxVal === "" ? null : Number(maxVal);
    nextMin = maxSales == null ? nextMin : maxSales + 1;
    return { minSales, maxSales, rate: Number(rate || 0) / 100 };
  });
}

// ---------- 예산 기준 최대 집행 가능 개수 실시간 추정 ----------

function tierRateAt(tiers, n) {
  const sorted = [...tiers].sort((a, b) => a.minSales - b.minSales);
  for (const t of sorted) {
    if (n >= t.minSales && (t.maxSales == null || n <= t.maxSales)) return t.rate;
  }
  return sorted[0]?.rate ?? 0;
}

function rewardUsdcAt(priceKrw, rate) {
  return Math.round(((priceKrw * rate) / krwPerUsdc) * 100) / 100;
}

function estimateMaxUnits(priceKrw, tiers, budgetUsdcEquivalent) {
  if (!priceKrw || !budgetUsdcEquivalent || !tiers.length) return { units: 0, spent: 0 };
  let spent = 0;
  let n = 0;
  const CAP = 10000; // 무한루프 방지용 안전장치
  while (n < CAP) {
    const rate = tierRateAt(tiers, n + 1);
    const reward = rewardUsdcAt(priceKrw, rate);
    if (reward <= 0 || spent + reward > budgetUsdcEquivalent) break;
    spent += reward;
    n++;
  }
  return { units: n, spent };
}

function updateEstimate() {
  const price = Number(document.getElementById("price").value) || 0;
  const budgetKrw = Number(document.getElementById("budgetKrw").value) || 0;
  const tiers = collectTiers().filter((t) => t.rate > 0);
  const result = document.getElementById("budgetEstimateResult");

  if (!price || !budgetKrw || !tiers.length) {
    result.innerHTML = `가격, 예산, 리워드 구간을 먼저 입력해주세요.`;
    return;
  }

  const budgetUsdcEquivalent = budgetKrw / krwPerUsdc;
  const { units, spent } = estimateMaxUnits(price, tiers, budgetUsdcEquivalent);
  result.innerHTML = `
    현재 설정으로 예산 <b>${won(budgetKrw)}</b> 안에서 최대 <b>${units}개</b> 제품까지 리워드 지급이 가능해요.
    <div class="sub">예상 소진액 약 ${won(Math.round(spent * krwPerUsdc))} (실제 정산은 ${spent.toFixed(2)} USDC로 온체인 지급, 비율은 판매량에 따라 구간별로 달라져요)</div>
  `;
}

document.getElementById("calcEstimateBtn").addEventListener("click", updateEstimate);

api("/api/config")
  .then((cfg) => {
    krwPerUsdc = cfg.krwPerUsdc || krwPerUsdc;
  })
  .catch(() => {});

document.getElementById("submitBtn").addEventListener("click", async () => {
  const btn = document.getElementById("submitBtn");
  const payload = {
    advertiser: document.getElementById("advertiser").value.trim(),
    product: document.getElementById("product").value.trim(),
    description: document.getElementById("description").value.trim(),
    productUrl: document.getElementById("productUrl").value.trim(),
    guideline: document.getElementById("guideline").value.trim(),
    tags: document.getElementById("tags").value.split(",").map((t) => t.trim()).filter(Boolean),
    price: Number(document.getElementById("price").value),
    confirmDelayDays: Number(document.getElementById("confirmDelayDays").value || 7),
    budgetKrw: Number(document.getElementById("budgetKrw").value || 1000000),
    commissionTiers: collectTiers(),
  };

  if (!payload.advertiser || !payload.product || !payload.price) {
    return toast("브랜드명, 상품명, 가격은 필수예요.");
  }
  if (payload.commissionTiers.length === 0) {
    return toast("리워드 구간을 최소 1개 이상 설정해주세요.");
  }

  btn.disabled = true;
  btn.textContent = "등록 중...";
  try {
    const data = await api("/api/campaigns", { method: "POST", body: JSON.stringify(payload) });
    toast("캠페인이 등록됐어요!");
    setTimeout(() => (location.href = `/advertiser-campaign-detail.html?id=${data.campaign.id}`), 600);
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "캠페인 등록하기";
  }
});
