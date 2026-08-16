/**
 * Linko 온체인 에스크로 연동 모듈 (escrow.mjs)
 * Anchor 프로그램(linko_escrow)과 통신하여 광고주 예산을 온체인 에스크로 PDA vault에 잠그고,
 * 확정된 주문에 대해 커미션을 자동 정산합니다.
 *
 * Program ID: 4KocVh769f9Z43717gsSW9Wp4863eQ7npKSWEbDbwLPP (Solana Devnet)
 */

import { PublicKey, Keypair, TransactionInstruction, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { connection, USDC_DEVNET_MINT, WALLETS_DIR, WALLET_IDS, PLATFORM_FEE_RATE, solscanTxUrl } from "./config.mjs";
import { loadWallet } from "./solanaPay.mjs";
import fs from "node:fs";

export const ESCROW_PROGRAM_ID = new PublicKey("4KocVh769f9Z43717gsSW9Wp4863eQ7npKSWEbDbwLPP");

export const CAMPAIGN_SEED = Buffer.from("campaign");
export const VAULT_SEED = Buffer.from("vault");
export const BUDGET_SEED = Buffer.from("budget");

/**
 * 광고주 계정(advertiserId)마다 온체인에서 완전히 독립된 Campaign/Budget PDA를 가지려면,
 * 서명하는 지갑 자체가 광고주별로 달라야 한다(Anchor가 PDA를 signer.key()로 시드하기 때문).
 * 그래서 advertiserId 하나당 지갑 파일 하나(wallets/advertiser-<id>.json)를 두고,
 * 처음 쓰일 때 자동으로 생성한다. advertiserId가 없으면(예: 과거 익명 캠페인) 기존 공유
 * 지갑(WALLET_IDS.advertiser)으로 폴백한다.
 */
export function advertiserWalletIdFor(advertiserId) {
  return advertiserId ? `advertiser-${advertiserId}` : WALLET_IDS.advertiser;
}

/**
 * loadWallet과 달리 파일이 없으면 새 Keypair를 만들어 저장하고 반환한다(01-generate-wallets.mjs와
 * 동일한 로직) — 광고주별 지갑은 최초 사용 시점에 존재를 보장할 수 없으므로 필요.
 */
function loadOrCreateWallet(id) {
  const filePath = `${WALLETS_DIR}/${id}.json`;
  if (fs.existsSync(filePath)) {
    const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }
  if (!fs.existsSync(WALLETS_DIR)) fs.mkdirSync(WALLETS_DIR, { recursive: true });
  const kp = Keypair.generate();
  fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`[Escrow] 새 광고주 지갑 생성: ${id} → ${kp.publicKey.toBase58()}`);
  return kp;
}

/**
 * 캠페인 PDA 및 Vault PDA 주소 계산
 */
export function getCampaignPda(advertiserPubkey, campaignId) {
  const safeId = String(campaignId).slice(0, 32);
  const [campaignPda, campaignBump] = PublicKey.findProgramAddressSync(
    [CAMPAIGN_SEED, advertiserPubkey.toBuffer(), Buffer.from(safeId)],
    ESCROW_PROGRAM_ID
  );

  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, campaignPda.toBuffer()],
    ESCROW_PROGRAM_ID
  );

  return { campaignPda, campaignBump, vaultPda, vaultBump };
}

/**
 * Budget PDA(광고주당 1개뿐인 예비 예산 풀) 및 그 Vault PDA 주소 계산
 */
export function getBudgetPda(advertiserPubkey) {
  const [budgetPda, budgetBump] = PublicKey.findProgramAddressSync(
    [BUDGET_SEED, advertiserPubkey.toBuffer()],
    ESCROW_PROGRAM_ID
  );

  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, budgetPda.toBuffer()],
    ESCROW_PROGRAM_ID
  );

  return { budgetPda, budgetBump, vaultPda, vaultBump };
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
 * platform_authority는 항상 플랫폼 지갑(WALLET_IDS.platform)으로 고정 — 이후 settle_commission을
 * 이 플랫폼 지갑이 광고주 대신 실행할 수 있게 하는 권한 위임.
 */
export async function createCampaignEscrow({ advertiserWalletId = WALLET_IDS.advertiser, campaignId, budgetUsdc }) {
  const advertiser = loadOrCreateWallet(advertiserWalletId);
  const platformAuthority = loadWallet(WALLET_IDS.platform);
  const { campaignPda, vaultPda } = getCampaignPda(advertiser.publicKey, campaignId);
  const advertiserAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, advertiser.publicKey);

  const disc = await getDiscriminator("create_campaign");

  const safeId = String(campaignId).slice(0, 32);
  const campaignIdBuf = Buffer.from(safeId, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(campaignIdBuf.length, 0);

  const rawAmount = BigInt(Math.round(budgetUsdc * 1e6)); // USDC 6 decimals
  const budgetBuf = Buffer.alloc(8);
  budgetBuf.writeBigUInt64LE(rawAmount, 0);

  const platformAuthorityBuf = platformAuthority.publicKey.toBuffer(); // 32바이트 Pubkey

  const ixData = Buffer.concat([disc, lenBuf, campaignIdBuf, budgetBuf, platformAuthorityBuf]);

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

  // 플랫폼 수수료 — 캠페인 예산과는 별도로, 같은 트랜잭션에서 (예산 × PLATFORM_FEE_RATE)만큼을
  // 광고주 ATA → 플랫폼 ATA로 이체. Anchor 프로그램은 건드리지 않고 순수 SPL Token 이체로 처리.
  const platformFeeUsdc = budgetUsdc * PLATFORM_FEE_RATE;
  let platformFeeRaw = 0n;
  if (platformFeeUsdc > 0) {
    const platformAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, platformAuthority.publicKey);
    const platformAtaInfo = await connection.getAccountInfo(platformAta);
    if (!platformAtaInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          platformAuthority.publicKey, // payer — 가스(SOL)는 항상 플랫폼이 부담
          platformAta,
          platformAuthority.publicKey,
          USDC_DEVNET_MINT
        )
      );
    }
    platformFeeRaw = BigInt(Math.round(platformFeeUsdc * 1e6));
    tx.add(
      createTransferCheckedInstruction(
        advertiserAta,
        USDC_DEVNET_MINT,
        platformAta,
        advertiser.publicKey,
        platformFeeRaw,
        6
      )
    );
  }

  // 가스비(SOL)는 항상 플랫폼 지갑이 부담(Gasless) — 광고주는 서명만 해서 자기 USDC 이체를
  // 승인할 뿐, 네트워크 수수료는 platformAuthority를 명시적 feePayer로 지정해 대신 냄.
  // (광고주가 낸 5% 플랫폼 수수료가 이 가스비를 충당한다는 설계와 일치)
  tx.feePayer = platformAuthority.publicKey;
  const signature = await sendAndConfirmTransaction(connection, tx, [advertiser, platformAuthority], {
    commitment: "confirmed",
  });

  return {
    signature,
    campaignPda: campaignPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    platformFeeUsdc,
    solscanUrl: solscanTxUrl(signature),
  };
}

/**
 * 헬퍼: 온체인에 해당 캠페인의 에스크로 PDA가 존재하는지 확인하고 없으면 자동 입금/생성
 */
export async function ensureCampaignEscrow({ advertiserWalletId = WALLET_IDS.advertiser, campaignId, budgetUsdc = 1000 }) {
  const advertiser = loadOrCreateWallet(advertiserWalletId);
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
  const authority = loadWallet(WALLET_IDS.platform); // 플랫폼 정산 권한 지갑
  const advertiserKey = new PublicKey(advertiserPubkey);
  const creatorKey = new PublicKey(creatorPubkey);

  const { campaignPda, vaultPda } = getCampaignPda(advertiserKey, campaignId);
  // const creatorAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, creatorKey);
  const creatorAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, creatorKey, true); // 스마트월렛(off-curve) 허용

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

/**
 * 3. create_budget: 광고주당 1개뿐인 예비 예산 풀(Budget PDA) 최초 생성 + 입금.
 * create_campaign의 입금 로직과 동일하되 campaign_id가 없음 — 광고주가 직접 서명하는 "충전" 액션.
 * Budget PDA 자체는 광고주당 1개만 생성 가능하지만(Anchor init 제약), 그 이후 추가 충전은
 * topUpBudget()으로 몇 번이든 계속할 수 있다.
 */
export async function createAdvertiserBudget({ advertiserWalletId = WALLET_IDS.advertiser, amountUsdc }) {
  const advertiser = loadOrCreateWallet(advertiserWalletId);
  const platformAuthority = loadWallet(WALLET_IDS.platform);
  const { budgetPda, vaultPda } = getBudgetPda(advertiser.publicKey);
  const advertiserAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, advertiser.publicKey);

  const disc = await getDiscriminator("create_budget");

  const rawAmount = BigInt(Math.round(amountUsdc * 1e6)); // USDC 6 decimals
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(rawAmount, 0);

  const platformAuthorityBuf = platformAuthority.publicKey.toBuffer(); // 32바이트 Pubkey

  const ixData = Buffer.concat([disc, amountBuf, platformAuthorityBuf]);

  const keys = [
    { pubkey: advertiser.publicKey, isSigner: true, isWritable: true },
    { pubkey: budgetPda, isSigner: false, isWritable: true },
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
  // 가스비는 플랫폼이 대납(기존 create_campaign과 동일한 gasless 정책) — 광고주는 USDC 이체 승인 서명만.
  tx.feePayer = platformAuthority.publicKey;
  const signature = await sendAndConfirmTransaction(connection, tx, [advertiser, platformAuthority], {
    commitment: "confirmed",
  });

  return {
    signature,
    budgetPda: budgetPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    solscanUrl: solscanTxUrl(signature),
  };
}

/**
 * 3b. top_up_budget: 이미 생성된 Budget PDA/Vault에 광고주가 추가로 입금.
 * create_budget과 계정 구성은 거의 같지만 init이 없어서(이미 존재하는 계정 재사용) 몇 번이든 호출 가능.
 */
export async function topUpBudget({ advertiserWalletId = WALLET_IDS.advertiser, amountUsdc }) {
  const advertiser = loadOrCreateWallet(advertiserWalletId);
  const platformAuthority = loadWallet(WALLET_IDS.platform);
  const { budgetPda, vaultPda } = getBudgetPda(advertiser.publicKey);
  const advertiserAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, advertiser.publicKey);

  const disc = await getDiscriminator("top_up_budget");

  const rawAmount = BigInt(Math.round(amountUsdc * 1e6));
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(rawAmount, 0);

  const ixData = Buffer.concat([disc, amountBuf]);

  const keys = [
    { pubkey: advertiser.publicKey, isSigner: true, isWritable: true },
    { pubkey: budgetPda, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: USDC_DEVNET_MINT, isSigner: false, isWritable: false },
    { pubkey: advertiserAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys,
    data: ixData,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = platformAuthority.publicKey;
  const signature = await sendAndConfirmTransaction(connection, tx, [advertiser, platformAuthority], {
    commitment: "confirmed",
  });

  return {
    signature,
    budgetPda: budgetPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    solscanUrl: solscanTxUrl(signature),
  };
}

/**
 * 현재 Budget PDA 상태 조회 — UI에서 잔액 표시용. Budget PDA가 아직 없으면 exists:false.
 */
export async function getAdvertiserBudgetInfo({ advertiserWalletId = WALLET_IDS.advertiser } = {}) {
  // 조회만 할 땐 지갑을 새로 만들 필요가 없음 — 지갑 파일이 아직 없다는 건 온체인 Budget PDA도
  // 당연히 없다는 뜻이라, 파일 존재 여부만으로 exists:false를 바로 판단할 수 있음.
  if (!fs.existsSync(`${WALLETS_DIR}/${advertiserWalletId}.json`)) {
    return { exists: false, budgetPda: null, vaultPda: null, vaultBalanceUsdc: 0 };
  }
  const advertiser = loadWallet(advertiserWalletId);
  const { budgetPda, vaultPda } = getBudgetPda(advertiser.publicKey);

  const info = await connection.getAccountInfo(budgetPda);
  if (!info) {
    return { exists: false, budgetPda: budgetPda.toBase58(), vaultPda: vaultPda.toBase58(), vaultBalanceUsdc: 0 };
  }

  let vaultBalanceUsdc = 0;
  try {
    const balance = await connection.getTokenAccountBalance(vaultPda);
    vaultBalanceUsdc = balance.value.uiAmount || 0;
  } catch {
    // Vault 계정이 아직 확정 안 됐거나 조회 실패 — 0으로 폴백
  }

  return { exists: true, budgetPda: budgetPda.toBase58(), vaultPda: vaultPda.toBase58(), vaultBalanceUsdc };
}

/**
 * 4. budget_campaign: Budget PDA의 Vault -> 기존 캠페인 Vault로 USDC 이체.
 * 두 Vault 모두 프로그램 소유 PDA라 플랫폼 지갑(platform_authority) 서명만으로 실행됨 — 광고주 지갑 불필요.
 * advertiserId로 그 광고주 전용 지갑을 찾아 Budget/Campaign PDA를 도출한다(광고주별 독립 보장) —
 * 이 함수 자체는 서명하지 않고 pubkey만 필요하므로, 지갑이 아직 없으면 자동 생성한다.
 */
export async function budgetCampaign({ campaignId, amountUsdc, advertiserId }) {
  const platformAuthority = loadWallet(WALLET_IDS.platform);
  const advertiser = loadOrCreateWallet(advertiserWalletIdFor(advertiserId));
  const { budgetPda, vaultPda: budgetVaultPda } = getBudgetPda(advertiser.publicKey);
  const { campaignPda, vaultPda: campaignVaultPda } = getCampaignPda(advertiser.publicKey, campaignId);

  const budgetInfo = await connection.getAccountInfo(budgetPda);
  if (!budgetInfo) {
    throw new Error("Budget PDA가 아직 생성되지 않았습니다. 먼저 예비 예산을 충전해주세요.");
  }
  const campaignInfo = await connection.getAccountInfo(campaignPda);
  if (!campaignInfo) {
    throw new Error(`캠페인 ${campaignId}은(는) 온체인 에스크로가 없어 배분할 수 없습니다.`);
  }

  const disc = await getDiscriminator("budget_campaign");

  const rawAmount = BigInt(Math.round(amountUsdc * 1e6));
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(rawAmount, 0);

  const ixData = Buffer.concat([disc, amountBuf]);

  const keys = [
    { pubkey: platformAuthority.publicKey, isSigner: true, isWritable: false },
    { pubkey: budgetPda, isSigner: false, isWritable: true },
    { pubkey: budgetVaultPda, isSigner: false, isWritable: true },
    { pubkey: campaignPda, isSigner: false, isWritable: true },
    { pubkey: campaignVaultPda, isSigner: false, isWritable: true },
    { pubkey: USDC_DEVNET_MINT, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: ESCROW_PROGRAM_ID,
      keys,
      data: ixData,
    })
  );
  tx.feePayer = platformAuthority.publicKey;

  const signature = await sendAndConfirmTransaction(connection, tx, [platformAuthority], { commitment: "confirmed" });

  return {
    signature,
    solscanUrl: solscanTxUrl(signature),
  };
}
