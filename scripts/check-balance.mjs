/**
 * 임시 유틸: 지갑별 USDC 잔고 확인
 * 사용법: node scripts/check-balance.mjs <wallet-id>
 * 예시:   node scripts/check-balance.mjs settlement
 */
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { connection, WALLETS_DIR, WALLET_IDS, USDC_DEVNET_MINT } from "../src/config.mjs";

async function main() {
  const [, , walletId] = process.argv;
  const id = walletId || WALLET_IDS.platform;

  const secret = JSON.parse(fs.readFileSync(`${WALLETS_DIR}/${id}.json`, "utf-8"));
  const kp = Keypair.fromSecretKey(Uint8Array.from(secret));

  console.log(`지갑(${id}): ${kp.publicKey.toBase58()}`);

  const sol = await connection.getBalance(kp.publicKey);
  console.log(`SOL 잔고: ${sol / 1e9}`);

  try {
    const ata = await getAssociatedTokenAddress(USDC_DEVNET_MINT, kp.publicKey);
    const bal = await connection.getTokenAccountBalance(ata);
    console.log(`USDC 잔고: ${bal.value.uiAmountString}`);
  } catch (e) {
    console.log(`USDC ATA 없음 또는 잔고 조회 실패: ${e.message}`);
  }
}

main();
