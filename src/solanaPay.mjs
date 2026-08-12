// /**
//  * Solana Pay 정산 함수 (재사용 가능한 형태로 분리)
//  * 04-test-settlement.mjs에서 검증된 최소 성공 사례를 함수화한 것입니다.
//  * 실제 정산 로직(settlementEngine.mjs)이 이 함수를 호출합니다.
//  */
// import { Keypair } from "@solana/web3.js";
// import { createTransfer } from "@solana/pay";
// import { sendAndConfirmTransaction } from "@solana/web3.js";
// import BigNumber from "bignumber.js";
// import fs from "node:fs";
// import { connection, WALLETS_DIR, WALLET_IDS, USDC_DEVNET_MINT, solscanTxUrl } from "./config.mjs";

// export function loadWallet(id) {
//   const filePath = `${WALLETS_DIR}/${id}.json`;
//   const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
//   return Keypair.fromSecretKey(Uint8Array.from(secret));
// }

// /**
//  * 정산 지갑 → 크리에이터 지갑으로 USDC 커미션을 전송합니다.
//  * @param {object} params
//  * @param {import("@solana/web3.js").PublicKey} params.toPublicKey 수신자(크리에이터) 지갑
//  * @param {number} params.amountUsdc 전송할 USDC 금액
//  * @param {string} params.orderId 정산 사유가 되는 주문 ID (memo에 기록)
//  * @returns {Promise<{signature: string, reference: string, solscanUrl: string}>}
//  */
// export async function settleCommission({ toPublicKey, amountUsdc, orderId }) {
//   const settlement = loadWallet(WALLET_IDS.platform);
//   const reference = new Keypair().publicKey; // Solana Pay reference (주문 추적용)

//   const tx = await createTransfer(connection, settlement.publicKey, {
//     recipient: toPublicKey,
//     amount: new BigNumber(amountUsdc),
//     splToken: USDC_DEVNET_MINT,
//     reference,
//     memo: `Linko settlement order=${orderId}`,
//   });

//   const signature = await sendAndConfirmTransaction(connection, tx, [settlement], {
//     commitment: "confirmed",
//   });

//   return {
//     signature,
//     reference: reference.toBase58(),
//     solscanUrl: solscanTxUrl(signature),
//   };
// }

/**
 * 정산 송금 함수 (재사용 가능한 형태로 분리)
 * 일반 키페어 지갑과 패스키 기반 스마트월렛(PDA, ed25519 curve 밖 주소) 수신자를 모두 지원합니다.
 * (@solana/pay의 createTransfer는 off-curve 수신자를 지원하지 않아서, 같은 일을 하는
 *  SPL 토큰 전송을 직접 구성합니다 — allowOwnerOffCurve: true로 ATA를 계산하는 게 핵심)
 */
import { Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import fs from "node:fs";
import { connection, WALLETS_DIR, WALLET_IDS, USDC_DEVNET_MINT, solscanTxUrl } from "./config.mjs";

export function loadWallet(id) {
  const filePath = `${WALLETS_DIR}/${id}.json`;
  const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

/**
 * 정산 지갑(플랫폼) → 크리에이터 지갑으로 USDC 커미션을 전송합니다.
 * @param {object} params
 * @param {import("@solana/web3.js").PublicKey} params.toPublicKey 수신자(크리에이터) 지갑 — 일반 지갑/패스키 스마트월렛 모두 가능
 * @param {number} params.amountUsdc 전송할 USDC 금액
 * @param {string} params.orderId 정산 사유가 되는 주문 ID (로그 추적용)
 * @returns {Promise<{signature: string, reference: string, solscanUrl: string}>}
 */
export async function settleCommission({ toPublicKey, amountUsdc, orderId }) {
  const settlement = loadWallet(WALLET_IDS.platform);
  const reference = new Keypair().publicKey; // 추적용 참조 키 (응답/로그용, 온체인 필수 아님)

  const senderAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, settlement.publicKey);
  // allowOwnerOffCurve: true — 수신자가 패스키 스마트월렛(PDA)이어도 ATA를 정상 계산하게 허용
  const recipientAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, toPublicKey, true);

  const tx = new Transaction();

  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        settlement.publicKey, // payer (계좌 생성 수수료 부담)
        recipientAta,
        toPublicKey, // owner — off-curve(스마트월렛)여도 허용됨
        USDC_DEVNET_MINT
      )
    );
  }

  const rawAmount = BigInt(Math.round(amountUsdc * 1e6)); // USDC 6 decimals
  tx.add(createTransferInstruction(senderAta, recipientAta, settlement.publicKey, rawAmount));

  const signature = await sendAndConfirmTransaction(connection, tx, [settlement], {
    commitment: "confirmed",
  });

  console.log(`[solanaPay] 정산 완료 (order=${orderId}): ${signature}`);

  return {
    signature,
    reference: reference.toBase58(),
    solscanUrl: solscanTxUrl(signature),
  };
}