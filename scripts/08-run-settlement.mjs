/**
 * 정산 로직 실행기 (CLI)
 * orders.json에서 purchased/pending_confirm 상태인 주문을 전부 순회하며
 * 쇼핑몰 조회 → Gemini 정규화 → (확정시) Solana Pay 정산까지 처리합니다.
 *
 * 실행: node --env-file=.env scripts/08-run-settlement.mjs
 * (mock-shops 서버가 먼저 떠있어야 합니다: npm run mock-shops)
 */
import { processAllOpenOrders } from "../src/settlementEngine.mjs";

async function main() {
  console.log("=== 정산 로직 실행 ===\n");
  const results = await processAllOpenOrders();

  if (results.length === 0) {
    console.log("처리할 미확정 주문이 없습니다.");
    return;
  }

  for (const r of results) {
    console.log(`주문 ${r.orderId}: ${r.action}`);
    if (r.action === "settled") {
      console.log(`  요율: ${(r.detail.commissionRateApplied * 100).toFixed(0)}% (누적 ${r.detail.cumulativeCount}건)`);
      console.log(`  커미션: ${r.detail.commissionAmountUsdc} USDC`);
      console.log(`  tx: ${r.detail.settlementTx}`);
      console.log(`  ${r.detail.solscanUrl}`);
    } else if (r.action === "cancelled") {
      console.log(`  사유: ${r.detail.reason}`);
    } else if (r.action === "waiting") {
      console.log(`  사유: ${r.detail.reason || "아직 확정 전"}`);
    } else if (r.action === "error") {
      console.log(`  에러: ${r.detail.message}`);
    }
    console.log("");
  }
}

main();
