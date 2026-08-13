/**
 * 우리 지갑들끼리 devnet USDC를 자유롭게 옮기는 범용 스크립트.
 * (02c-fund-usdc-from-platform.mjs는 플랫폼→X 고정이라, 다른 지갑이 잔고를 들고 있을 때 못 씀)
 *
 * 사용법: node scripts/transfer-usdc.mjs <from-wallet-id> <to-wallet-id> <amount-usdc>
 * 예시:   node scripts/transfer-usdc.mjs promoter-jisu advertiser 20
 *
 * wallet-id는 wallets/ 폴더 안의 파일명(확장자 제외)이면 뭐든 가능:
 *   settlement(플랫폼), advertiser, promoter-jisu, promoter-minsu 등
 */
import fs from "node:fs";
import { Keypair, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { connection, WALLETS_DIR, USDC_DEVNET_MINT, solscanTxUrl } from "../src/config.mjs";

function loadWallet(id) {
  const filePath = `${WALLETS_DIR}/${id}.json`;
  const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const [, , fromId, toId, amountArg] = process.argv;
  if (!fromId || !toId) {
    console.error("사용법: node scripts/transfer-usdc.mjs <from-wallet-id> <to-wallet-id> <amount-usdc>");
    process.exit(1);
  }
  const amountUsdc = parseFloat(amountArg || "10");

  const from = loadWallet(fromId);
  const to = loadWallet(toId);

  console.log(`보내는 지갑(${fromId}): ${from.publicKey.toBase58()}`);
  console.log(`받는 지갑(${toId}): ${to.publicKey.toBase58()}`);
  console.log(`전송액: ${amountUsdc} USDC`);

  const fromAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, from.publicKey);
  const toAtaAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    from, // payer — 받는 쪽 ATA가 없으면 보내는 지갑이 생성 비용(SOL) 부담
    USDC_DEVNET_MINT,
    to.publicKey
  );

  const rawAmount = BigInt(Math.round(amountUsdc * 1e6)); // USDC 6 decimals

  const tx = new Transaction().add(
    createTransferCheckedInstruction(fromAta, USDC_DEVNET_MINT, toAtaAccount.address, from.publicKey, rawAmount, 6)
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [from], { commitment: "confirmed" });

  console.log(`완료! tx: ${sig}`);
  console.log(solscanTxUrl(sig));
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
