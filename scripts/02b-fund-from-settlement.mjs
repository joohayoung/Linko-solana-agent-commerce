/**
 * 2b. 정산 지갑 → 다른 지갑으로 devnet SOL 직접 전송
 * 에어드롭 faucet이 rate-limit에 걸렸을 때, 이미 SOL을 받은 정산 지갑에서
 * 나눠주는 우회 방법입니다.
 *
 * 사용법: node scripts/02b-fund-from-settlement.mjs <wallet-id> <amount-sol>
 * 예시:   node scripts/02b-fund-from-settlement.mjs promoter-minsu 0.5
 */
import fs from "node:fs";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { connection, WALLETS_DIR, WALLET_IDS, solscanTxUrl } from "../src/config.mjs";

function loadWallet(id) {
  const filePath = `${WALLETS_DIR}/${id}.json`;
  const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const [, , targetId, amountArg] = process.argv;
  if (!targetId) {
    console.error("사용법: node scripts/02b-fund-from-settlement.mjs <wallet-id> <amount-sol>");
    console.error(`가능한 wallet-id: ${Object.values(WALLET_IDS).join(", ")}`);
    process.exit(1);
  }
  const amountSol = parseFloat(amountArg || "0.5");

  const settlement = loadWallet(WALLET_IDS.settlement);
  const target = loadWallet(targetId);

  const settlementBalance = await connection.getBalance(settlement.publicKey);
  console.log(`정산 지갑 잔고: ${(settlementBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`전송: ${amountSol} SOL → ${targetId} (${target.publicKey.toBase58()})`);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: settlement.publicKey,
      toPubkey: target.publicKey,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [settlement], {
    commitment: "confirmed",
  });

  console.log(`완료! tx: ${sig}`);
  console.log(solscanTxUrl(sig));

  const newBalance = await connection.getBalance(target.publicKey);
  console.log(`${targetId} 새 잔고: ${(newBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
