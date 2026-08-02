/**
 * 5. Solana Pay 정산 트랜잭션 최소 성공 사례
 * 정산 지갑 → 크리에이터(지수) 지갑으로 소액 USDC를 reference 태그와 함께 전송합니다.
 * 실제 커미션 정산 로직(요율 계산 등)은 이 함수를 재사용해서 나중에 붙입니다.
 */
import { v4 as uuidv4 } from "uuid";
import { WALLET_IDS } from "../src/config.mjs";
import { loadWallet, settleCommission } from "../src/solanaPay.mjs";

async function main() {
  console.log("=== Solana Pay 정산 테스트 (devnet) ===\n");

  const settlement = loadWallet(WALLET_IDS.settlement);
  const jisu = loadWallet(WALLET_IDS.promoter1);

  const orderId = uuidv4();
  console.log(`정산 지갑: ${settlement.publicKey.toBase58()}`);
  console.log(`수신 지갑(지수): ${jisu.publicKey.toBase58()}`);
  console.log(`테스트 주문 ID: ${orderId}`);
  console.log(`정산 금액: 1 USDC\n`);

  try {
    const { signature, reference, solscanUrl } = await settleCommission({
      toPublicKey: jisu.publicKey,
      amountUsdc: 1,
      orderId,
    });
    console.log("정산 성공!");
    console.log(`  tx: ${signature}`);
    console.log(`  reference: ${reference}`);
    console.log(`  Solscan: ${solscanUrl}`);
  } catch (e) {
    console.error("정산 실패:", e.message);
    if (e.logs) console.error(e.logs);
  }
}

main();
