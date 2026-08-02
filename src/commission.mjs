/**
 * 성과 요율 계산 (모듈 6)
 * 특정 주문이 확정되는 시점, 그 크리에이터가 같은 캠페인에서 지금까지 확정한
 * 누적 판매 건수(이 주문 포함)를 기준으로 커미션 티어 테이블에서 요율을 찾는다.
 * 요율은 확정 시점에만 결정되고 소급 적용되지 않으며, 크리에이터별로 독립적으로 계산된다.
 */

/**
 * @param {{minSales:number, maxSales:number|null, rate:number}[]} tiers
 * @param {number} cumulativeConfirmedCount 이 주문을 포함한 누적 확정 건수
 * @returns {number} 적용 요율 (0~1)
 */
export function calculateTierRate(tiers, cumulativeConfirmedCount) {
  const sorted = [...tiers].sort((a, b) => a.minSales - b.minSales);
  for (const tier of sorted) {
    const withinMin = cumulativeConfirmedCount >= tier.minSales;
    const withinMax = tier.maxSales == null || cumulativeConfirmedCount <= tier.maxSales;
    if (withinMin && withinMax) return tier.rate;
  }
  // 어떤 구간에도 안 걸리면(설정 누락) 가장 낮은 티어로 안전하게 폴백
  return sorted[0]?.rate ?? 0;
}

/**
 * 원화 금액 → USDC 커미션 금액 계산
 * @param {number} amountKrw 주문 금액(원)
 * @param {number} rate 적용 요율 (0~1)
 * @param {number} krwPerUsdc 환율 (원/USDC), 데모에서는 고정값 사용
 * @returns {number} USDC 커미션 금액 (소수점 2자리 반올림)
 */
export function calculateCommissionUsdc(amountKrw, rate, krwPerUsdc = 1400) {
  const commissionKrw = amountKrw * rate;
  const usdc = commissionKrw / krwPerUsdc;
  return Math.round(usdc * 100) / 100;
}
