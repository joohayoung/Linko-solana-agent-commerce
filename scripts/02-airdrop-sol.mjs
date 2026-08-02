/**
 * 2. devnet SOL 확보
 * 트랜잭션 수수료 지불용으로 지갑마다 소량의 devnet SOL을 에어드롭받습니다.
 * devnet 에어드롭은 요청량이 많으면 rate-limit에 걸릴 수 있어, 지갑 사이에 약간의 텀을 둡니다.
 */
import fs from "node:fs";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { connection, WALLETS_DIR, WALLET_IDS, solscanAddressUrl } from "../src/config.mjs";

function loadWallet(id) {
  const filePath = `${WALLETS_DIR}/${id}.json`;
  const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function airdropIfNeeded(kp, label, minSol = 0.5, requestSol = 1) {
  const balance = await connection.getBalance(kp.publicKey);
  console.log(`${label}: 현재 ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  if (balance >= minSol * LAMPORTS_PER_SOL) {
    console.log(`  → 충분함, 건너뜀`);
    return;
  }

  try {
    console.log(`  → ${requestSol} SOL 에어드롭 요청 중...`);
    const sig = await connection.requestAirdrop(kp.publicKey, requestSol * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    const newBalance = await connection.getBalance(kp.publicKey);
    console.log(`  → 완료. 새 잔고: ${(newBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    console.log(`  → ${solscanAddressUrl(kp.publicKey.toBase58())}`);
  } catch (e) {
    console.error(`  → 실패: ${e.message}`);
    console.error(`  → devnet 에어드롭이 rate-limit에 걸렸을 수 있습니다. https://faucet.solana.com 에서 수동으로 받아주세요: ${kp.publicKey.toBase58()}`);
  }
}

async function main() {
  console.log("=== devnet SOL 확보 ===\n");
  for (const [role, id] of Object.entries(WALLET_IDS)) {
    const kp = loadWallet(id);
    await airdropIfNeeded(kp, `${role} (${id})`);
    await sleep(2000);
  }
}

main();
