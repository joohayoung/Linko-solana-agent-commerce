/**
 * 2c. 플랫폼 지갑 → 다른 지갑으로 devnet USDC 전송
 * 광고주 지갑이 캠페인 예산으로 쓸 devnet USDC가 필요할 때,
 * 이미 USDC를 보유한 플랫폼 지갑에서 나눠줍니다.
 *
 * 사용법: node scripts/02c-fund-usdc-from-platform.mjs <wallet-id> <amount-usdc>
 * 예시:   node scripts/02c-fund-usdc-from-platform.mjs advertiser 50
 */
import fs from "node:fs";
import { Keypair, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { Transaction } from "@solana/web3.js";
import { connection, WALLETS_DIR, WALLET_IDS, USDC_DEVNET_MINT, solscanTxUrl } from "../src/config.mjs";

function loadWallet(id) {
  const filePath = `${WALLETS_DIR}/${id}.json`;
  const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const [, , targetId, amountArg] = process.argv;
  if (!targetId) {
    console.error("사용법: node scripts/02c-fund-usdc-from-platform.mjs <wallet-id> <amount-usdc>");
    console.error(`가능한 wallet-id: ${Object.values(WALLET_IDS).join(", ")}`);
    process.exit(1);
  }
  const amountUsdc = parseFloat(amountArg || "50");

  const platform = loadWallet(WALLET_IDS.platform);
  const target = loadWallet(targetId);

  console.log(`플랫폼 지갑: ${platform.publicKey.toBase58()}`);
  console.log(`전송: ${amountUsdc} USDC → ${targetId} (${target.publicKey.toBase58()})`);

  const platformAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, platform.publicKey);
  const targetAtaAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    platform, // payer (수수료는 플랫폼 지갑이 부담)
    USDC_DEVNET_MINT,
    target.publicKey
  );

  const rawAmount = BigInt(Math.round(amountUsdc * 1e6)); // USDC 6 decimals

  const tx = new Transaction().add(
    createTransferCheckedInstruction(
      platformAta,
      USDC_DEVNET_MINT,
      targetAtaAccount.address,
      platform.publicKey,
      rawAmount,
      6
    )
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [platform], {
    commitment: "confirmed",
  });

  console.log(`완료! tx: ${sig}`);
  console.log(solscanTxUrl(sig));
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
