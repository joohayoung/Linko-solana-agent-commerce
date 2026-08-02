/**
 * Solana Pay 정산 함수 (재사용 가능한 형태로 분리)
 * 04-test-settlement.mjs에서 검증된 최소 성공 사례를 함수화한 것입니다.
 * 실제 정산 로직(settlementEngine.mjs)이 이 함수를 호출합니다.
 */
import { Keypair } from "@solana/web3.js";
import { createTransfer } from "@solana/pay";
import { sendAndConfirmTransaction } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import fs from "node:fs";
import { connection, WALLETS_DIR, WALLET_IDS, USDC_DEVNET_MINT, solscanTxUrl } from "./config.mjs";

export function loadWallet(id) {
  const filePath = `${WALLETS_DIR}/${id}.json`;
  const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

/**
 * 정산 지갑 → 크리에이터 지갑으로 USDC 커미션을 전송합니다.
 * @param {object} params
 * @param {import("@solana/web3.js").PublicKey} params.toPublicKey 수신자(크리에이터) 지갑
 * @param {number} params.amountUsdc 전송할 USDC 금액
 * @param {string} params.orderId 정산 사유가 되는 주문 ID (memo에 기록)
 * @returns {Promise<{signature: string, reference: string, solscanUrl: string}>}
 */
export async function settleCommission({ toPublicKey, amountUsdc, orderId }) {
  const settlement = loadWallet(WALLET_IDS.settlement);
  const reference = new Keypair().publicKey; // Solana Pay reference (주문 추적용)

  const tx = await createTransfer(connection, settlement.publicKey, {
    recipient: toPublicKey,
    amount: new BigNumber(amountUsdc),
    splToken: USDC_DEVNET_MINT,
    reference,
    memo: `Linko settlement order=${orderId}`,
  });

  const signature = await sendAndConfirmTransaction(connection, tx, [settlement], {
    commitment: "confirmed",
  });

  return {
    signature,
    reference: reference.toBase58(),
    solscanUrl: solscanTxUrl(signature),
  };
}
