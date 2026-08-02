/**
 * 12(테스트용 최소 버전). 체크아웃 시뮬레이터
 * 실제 구매자 UI 대신, 커맨드라인으로 주문 하나를 만들어 orders.json + 가짜 쇼핑몰에
 * 동시에 기록합니다. 정산 로직(settlementEngine)을 테스트하기 위한 용도입니다.
 *
 * 사용법:
 *   node scripts/07-create-test-order.mjs <promoterId> <campaignId> [--backdate]
 * 예시:
 *   node scripts/07-create-test-order.mjs promoter-jisu c1 --backdate
 *   → --backdate를 주면 confirmDueAt이 이미 지난 것으로 만들어서 대기 없이 바로 확정 테스트 가능
 */
import { v4 as uuidv4 } from "uuid";
import { findById, findWhere, insert } from "../src/db.mjs";
import { MOCK_SHOP_BASE_URL } from "../src/config.mjs";

async function main() {
  const [, , promoterId, campaignId, flag] = process.argv;
  if (!promoterId || !campaignId) {
    console.error("사용법: node scripts/07-create-test-order.mjs <promoterId> <campaignId> [--backdate]");
    process.exit(1);
  }

  const campaign = findById("campaigns", campaignId);
  if (!campaign) throw new Error(`캠페인 없음: ${campaignId}`);

  const [participation] = findWhere(
    "participations",
    (p) => p.promoterId === promoterId && p.campaignId === campaignId
  );
  if (!participation) {
    throw new Error(`${promoterId}가 ${campaignId}에 참여한 기록이 없습니다 (data/participations.json 확인)`);
  }

  const backdate = flag === "--backdate";
  const purchasedAt = backdate
    ? new Date(Date.now() - (campaign.confirmDelayDays + 1) * 24 * 60 * 60 * 1000)
    : new Date();
  const confirmDueAt = new Date(purchasedAt.getTime() + campaign.confirmDelayDays * 24 * 60 * 60 * 1000);

  const orderId = uuidv4();

  // 가짜 쇼핑몰에 주문 생성 (초기 상태 = 결제완료)
  const res = await fetch(`${MOCK_SHOP_BASE_URL}/${campaign.shopId}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, amount: campaign.price }),
  });
  if (!res.ok) {
    throw new Error(`가짜 쇼핑몰 주문 생성 실패 (${res.status}). mock-shops 서버가 실행 중인지 확인하세요 (npm run mock-shops).`);
  }

  const order = insert("orders", {
    id: orderId,
    campaignId,
    referralCode: participation.referralCode,
    promoterId,
    amount: campaign.price,
    status: "purchased",
    purchasedAt: purchasedAt.toISOString(),
    confirmDueAt: confirmDueAt.toISOString(),
    settledAt: null,
    settlementTx: null,
    commissionRateApplied: null,
    commissionAmountUsdc: null,
  });

  console.log("주문 생성 완료:");
  console.log(JSON.stringify(order, null, 2));
  console.log(`\n쇼핑몰(${campaign.shopId})에도 동일 주문 생성됨 (초기 상태: 결제완료)`);
  console.log(`확정 트리거: curl -X POST ${MOCK_SHOP_BASE_URL}/${campaign.shopId}/orders/${orderId}/confirm`);
  console.log(`취소 트리거: curl -X POST ${MOCK_SHOP_BASE_URL}/${campaign.shopId}/orders/${orderId}/cancel`);
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
