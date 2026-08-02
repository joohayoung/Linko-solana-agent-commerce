/**
 * 3. USDC ATA(Associated Token Account) 생성
 * 정산 지갑 + 크리에이터 지갑 2개, 총 3곳에 devnet USDC ATA를 만듭니다.
 * 이미 존재하면 건드리지 않고 주소만 출력합니다.
 */
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { connection, WALLETS_DIR, WALLET_IDS, USDC_DEVNET_MINT, solscanAddressUrl } from "../src/config.mjs";

function loadWallet(id) {
  const filePath = `${WALLETS_DIR}/${id}.json`;
  const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  console.log("=== USDC ATA 생성 (devnet) ===\n");
  const ataMap = {};

  for (const [role, id] of Object.entries(WALLET_IDS)) {
    const kp = loadWallet(id);
    console.log(`${role} (${id}) 지갑: ${kp.publicKey.toBase58()}`);
    try {
      // payer = kp 자신 (본인 SOL로 ATA 생성 수수료 지불)
      const ata = await getOrCreateAssociatedTokenAccount(
        connection,
        kp,
        USDC_DEVNET_MINT,
        kp.publicKey
      );
      ataMap[id] = ata.address.toBase58();
      console.log(`  → USDC ATA: ${ata.address.toBase58()}`);
      console.log(`  → ${solscanAddressUrl(ata.address.toBase58())}`);
    } catch (e) {
      console.error(`  → 실패: ${e.message}`);
    }
    console.log("");
  }

  const outPath = `${WALLETS_DIR}/atas.json`;
  fs.writeFileSync(outPath, JSON.stringify(ataMap, null, 2));
  console.log(`ATA 주소 목록 저장: ${outPath}`);
}

main();
