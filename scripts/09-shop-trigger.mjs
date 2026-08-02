/**
 * 가짜 쇼핑몰 상태 수동 트리거 (데모/테스트용)
 * PowerShell의 curl(Invoke-WebRequest 별칭)은 -X 옵션이 달라서 헷갈리므로,
 * 대신 이 스크립트로 확정/취소를 트리거합니다.
 *
 * 사용법: node scripts/09-shop-trigger.mjs <shopId> <orderId> <confirm|cancel>
 * 예시:   node scripts/09-shop-trigger.mjs sundayglow-mall abc123 confirm
 */
import { MOCK_SHOP_BASE_URL } from "../src/config.mjs";

async function main() {
  const [, , shopId, orderId, action] = process.argv;
  if (!shopId || !orderId || !["confirm", "cancel"].includes(action)) {
    console.error("사용법: node scripts/09-shop-trigger.mjs <shopId> <orderId> <confirm|cancel>");
    process.exit(1);
  }

  const res = await fetch(`${MOCK_SHOP_BASE_URL}/${shopId}/orders/${orderId}/${action}`, {
    method: "POST",
  });
  const body = await res.json();
  console.log(`상태: ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
