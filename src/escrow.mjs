/**
 * Linko 온체인 에스크로 연동 모듈 (escrow.mjs)
 * Anchor 프로그램(linko_escrow)과 통신하여 광고주 예산을 온체인 에스크로 PDA vault에 잠그고,
 * 확정된 주문에 대해 커미션을 자동 정산합니다.
 *
 * Program ID: 5xYscQnbXSCFJeW127rKeMN5ovd1watWjjpQjHASLj9U (Solana Devnet)
 */

import { PublicKey, Keypair, TransactionInstruction, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { connection, USDC_DEVNET_MINT, WALLETS_DIR, WALLET_IDS, solscanTxUrl } from "./config.mjs";
import { loadWallet } from "./solanaPay.mjs";
import fs from "node:fs";

export const ESCROW_PROGRAM_ID = new PublicKey("4KocVh769f9Z43717gsSW9Wp4863eQ7npKSWEbDbwLPP");

export const CAMPAIGN_SEED = Buffer.from("campaign");
export const VAULT_SEED = Buffer.from("vault");

/**
 * 캠페인 PDA 및 Vault PDA 주소 계산
 */
export function getCampaignPda(advertiserPubkey, campaignId) {
  const [campaignPda, campaignBump] = PublicKey.findProgramAddressSync(
    [CAMPAIGN_SEED, advertiserPubkey.toBuffer(), Buffer.from(campaignId)],
    ESCROW_PROGRAM_ID
  );

  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, campaignPda.toBuffer()],
    ESCROW_PROGRAM_ID
  );

  return { campaignPda, campaignBump, vaultPda, vaultBump };
}

/**
 * 헬퍼: 8바이트 Discriminator 생성 (Anchor 규격: sha256("global:<fn_name>")[..8])
 */
async function getDiscriminator(name) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`global:${name}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(hashBuffer.slice(0, 8));
}

/**
 * 1. create_campaign: 캠페인 생성 및 예산 USDC 에스크로(Vault) 입금
 */
export async function createCampaignEscrow({ advertiserWalletId = WALLET_IDS.settlement, campaignId, budgetUsdc }) {
  const advertiser = loadWallet(advertiserWalletId);
  const { campaignPda, vaultPda } = getCampaignPda(advertiser.publicKey, campaignId);
  const advertiserAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, advertiser.publicKey);

  const disc = await getDiscriminator("create_campaign");
  
  // Args 인코딩: campaign_id (String: 4bytes len + utf8) + budget_usdc (u64: 8bytes le)
  const campaignIdBuf = Buffer.from(campaignId, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(campaignIdBuf.length, 0);

  const rawAmount = BigInt(Math.round(budgetUsdc * 1e6)); // USDC 6 decimals
  const budgetBuf = Buffer.alloc(8);
  budgetBuf.writeBigUInt64LE(rawAmount, 0);

  const ixData = Buffer.concat([disc, lenBuf, campaignIdBuf, budgetBuf]);

  const keys = [
    { pubkey: advertiser.publicKey, isSigner: true, isWritable: true },
    { pubkey: campaignPda, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: USDC_DEVNET_MINT, isSigner: false, isWritable: false },
    { pubkey: advertiserAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys,
    data: ixData,
  });

  const tx = new Transaction().add(ix);
  const signature = await sendAndConfirmTransaction(connection, tx, [advertiser], { commitment: "confirmed" });

  return {
    signature,
    campaignPda: campaignPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    solscanUrl: solscanTxUrl(signature),
  };
}

/**
 * 헬퍼: 온체인에 해당 캠페인의 에스크로 PDA가 존재하는지 확인하고 없으면 자동 입금/생성
 */
export async function ensureCampaignEscrow({ advertiserWalletId = WALLET_IDS.settlement, campaignId, budgetUsdc = 1000 }) {
  const advertiser = loadWallet(advertiserWalletId);
  const { campaignPda } = getCampaignPda(advertiser.publicKey, campaignId);
  
  const info = await connection.getAccountInfo(campaignPda);
  if (info) {
    console.log(`[Escrow] 캠페인 ${campaignId} 온체인 에스크로 이미 존재함 (${campaignPda.toBase58()})`);
    return { campaignPda: campaignPda.toBase58(), existing: true };
  }

  console.log(`[Escrow] 캠페인 ${campaignId} 온체인 에스크로 PDA 신규 입금 및 생성 중...`);
  return await createCampaignEscrow({ advertiserWalletId, campaignId, budgetUsdc });
}

/**
 * 2. settle_commission: 온체인 에스크로 Vault에서 크리에이터 지갑으로 USDC 커미션 정산 해제
 */
export async function settleFromEscrow({ advertiserPubkey, creatorPubkey, amountUsdc, orderId, campaignId }) {
  const authority = loadWallet(WALLET_IDS.settlement); // 플랫폼 정산 권한 지갑
  const advertiserKey = new PublicKey(advertiserPubkey);
  const creatorKey = new PublicKey(creatorPubkey);

  const { campaignPda, vaultPda } = getCampaignPda(advertiserKey, campaignId);
  const creatorAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, creatorKey);

  // 크리에이터의 ATA가 존재하지 않으면 생성 트랜잭션 포함
  const tx = new Transaction();
  const creatorAtaInfo = await connection.getAccountInfo(creatorAta);
  if (!creatorAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        creatorAta,
        creatorKey,
        USDC_DEVNET_MINT
      )
    );
  }

  const disc = await getDiscriminator("settle_commission");

  const rawAmount = BigInt(Math.round(amountUsdc * 1e6));
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(rawAmount, 0);

  const orderIdBuf = Buffer.from(orderId, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(orderIdBuf.length, 0);

  const ixData = Buffer.concat([disc, amountBuf, lenBuf, orderIdBuf]);

  const keys = [
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: campaignPda, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: USDC_DEVNET_MINT, isSigner: false, isWritable: false },
    { pubkey: creatorAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  tx.add(
    new TransactionInstruction({
      programId: ESCROW_PROGRAM_ID,
      keys,
      data: ixData,
    })
  );

  const signature = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });

  return {
    signature,
    solscanUrl: solscanTxUrl(signature),
  };
}
