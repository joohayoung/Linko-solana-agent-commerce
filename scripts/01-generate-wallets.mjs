/**
 * 1. 지갑 생성
 * 정산 지갑 1개 + 크리에이터 지갑 2개(지수, 민수)를 devnet용 키페어로 생성해
 * wallets/ 폴더에 JSON으로 저장합니다. 이미 존재하는 지갑은 건드리지 않습니다.
 */
import { Keypair } from "@solana/web3.js";
import fs from "node:fs";
import { WALLETS_DIR, WALLET_IDS } from "../src/config.mjs";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadOrCreateWallet(id) {
  const filePath = `${WALLETS_DIR}/${id}.json`;
  if (fs.existsSync(filePath)) {
    const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

function main() {
  ensureDir(WALLETS_DIR);

  console.log("=== 지갑 생성 (devnet) ===\n");
  for (const [role, id] of Object.entries(WALLET_IDS)) {
    const kp = loadOrCreateWallet(id);
    console.log(`${role.padEnd(12)} (${id}): ${kp.publicKey.toBase58()}`);
  }
  console.log(`\n키페어 저장 위치: ${WALLETS_DIR}`);
  console.log("주의: wallets/*.json 은 .gitignore 처리되어 있습니다. 절대 커밋/공유하지 마세요.");
}

main();
