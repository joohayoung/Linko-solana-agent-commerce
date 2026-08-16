/**
 * 2d. 플랫폼 지갑 → 다른 지갑으로 devnet SOL 전송
 * devnet 에어드롭 파우셋이 막혀있을 때, 이미 SOL을 보유한 플랫폼 지갑에서 나눠줍니다.
 * (02c-fund-usdc-from-platform.mjs의 SOL 버전 — 순수 SystemProgram 이체라 Anchor 프로그램과 무관)
 *
 * 사용법: node scripts/02d-fund-sol-from-platform.mjs <wallet-id> <amount-sol>
 * 예시:   node scripts/02d-fund-sol-from-platform.mjs advertiser 0.1
 */
import fs from "node:fs";
import { Keypair, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { connection, WALLETS_DIR, WALLET_IDS, solscanTxUrl } from "../src/config.mjs";

function loadWallet(id) {
  const filePath = `${WALLETS_DIR}/${id}.json`;
  const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const [, , targetId, amountArg] = process.argv;
  if (!targetId) {
    console.error("사용법: node scripts/02d-fund-sol-from-platform.mjs <wallet-id> <amount-sol>");
    console.error(`가능한 wallet-id: ${Object.values(WALLET_IDS).join(", ")}`);
    process.exit(1);
  }
  const amountSol = parseFloat(amountArg || "0.1");

  const platform = loadWallet(WALLET_IDS.platform);
  const targetSecretPath = `${WALLETS_DIR}/${targetId}.json`;
  const targetPubkey = fs.existsSync(targetSecretPath) ? loadWallet(targetId).publicKey : new PublicKey(targetId);

  console.log(`플랫폼 지갑: ${platform.publicKey.toBase58()}`);
  console.log(`전송: ${amountSol} SOL → ${targetId} (${targetPubkey.toBase58()})`);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: platform.publicKey,
      toPubkey: targetPubkey,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [platform], { commitment: "confirmed" });

  console.log(`완료! tx: ${sig}`);
  console.log(solscanTxUrl(sig));
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
