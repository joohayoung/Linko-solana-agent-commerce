/**
 * Linko 온체인 에스크로 연동 모듈 (escrow.mjs)
 * Anchor 프로그램(linko_escrow)과 통신하여 광고주 예산을 온체인 에스크로 PDA vault에 잠그고,
 * 확정된 주문에 대해 커미션을 자동 정산합니다.
 *
 * Program ID: 4KocVh769f9Z43717gsSW9Wp4863eQ7npKSWEbDbwLPP (Solana Devnet)
 */

import {
  PublicKey,
  Keypair,
  TransactionInstruction,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  connection,
  USDC_DEVNET_MINT,
  WALLETS_DIR,
  WALLET_IDS,
  PLATFORM_FEE_RATE,
  LINKO_ALT_ADDRESS,
  solscanTxUrl,
} from "./config.mjs";
import { loadWallet } from "./solanaPay.mjs";
import fs from "node:fs";

export const ESCROW_PROGRAM_ID = new PublicKey("4KocVh769f9Z43717gsSW9Wp4863eQ7npKSWEbDbwLPP");

export const CAMPAIGN_SEED = Buffer.from("campaign");
export const VAULT_SEED = Buffer.from("vault");
export const BUDGET_SEED = Buffer.from("budget");

// [LEGACY] 패스키 이전에는 advertiserId마다 서버가 커스터디얼 지갑(wallets/advertiser-<id>.json)을
// 자동 생성해서 PDA를 그 지갑 기준으로 도출했다. 지금은 budgetCampaign()이 광고주의 실제 패스키
// 지갑 주소(advertiserWallet)를 직접 받아서 쓰므로 더 이상 필요 없음 — 코드는 남겨두되 비활성화.
// export function advertiserWalletIdFor(advertiserId) {
//   return advertiserId ? `advertiser-${advertiserId}` : WALLET_IDS.advertiser;
// }

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
 * create_campaign + 플랫폼 수수료 이체 인스트럭션을 "서명/전송 없이" 조립만 해서 반환.
 * 광고주 실제 지갑(LazorKit 스마트월렛)으로 브라우저에서 직접 서명하게 할 때 사용 —
 * 서버는 여기서 아무 키도 쥐고 서명하지 않고, advertiserPubkey는 그냥 값으로만 들어감.
 * LazorKit 스마트월렛은 off-curve PDA라 ATA 조회 시 allowOwnerOffCurve=true가 필요함.
 *
 * SOL 충전/ATA 생성 같은 "플랫폼 전용 서명" 준비 작업은 미리 별도 트랜잭션으로 끝내두고,
 * 자주 반복되는 고정 계정(USDC 민트, 토큰 프로그램, 에스크로 프로그램, 시스템 프로그램,
 * 플랫폼 ATA)은 주소 룩업 테이블(ALT)에 담아서 반환한다 — LazorKit의 CPI 서명 래핑
 * 오버헤드가 커서 ALT 없이는 인스트럭션 하나만으로도 Solana 트랜잭션 크기 한도(1232바이트)를
 * 넘겨버리기 때문. ALT 덕분에 create_campaign + 수수료 이체를 한 트랜잭션에 같이 담을 수 있다.
 */
export async function buildCampaignInstructions({ advertiserPubkey, campaignId, budgetUsdc }) {
  const platformAuthority = loadWallet(WALLET_IDS.platform);
  const { campaignPda, vaultPda } = getCampaignPda(advertiserPubkey, campaignId);
  const advertiserAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, advertiserPubkey, true);
  const platformAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, platformAuthority.publicKey);

  // 광고주 서명이 필요 없는 준비 작업(SOL 충전 + 광고주 ATA 생성)은 미리 끝내둠
  await ensureAdvertiserPrereqAccounts({ advertiserPubkey, needsSolTopUp: true });
  const platformAtaInfo = await connection.getAccountInfo(platformAta);
  if (!platformAtaInfo) {
    const prereqTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(platformAuthority.publicKey, platformAta, platformAuthority.publicKey, USDC_DEVNET_MINT)
    );
    prereqTx.feePayer = platformAuthority.publicKey;
    await sendAndConfirmTransaction(connection, prereqTx, [platformAuthority], { commitment: "confirmed" });
  }

  const disc = await getDiscriminator("create_campaign");
  const safeId = String(campaignId).slice(0, 32);
  const campaignIdBuf = Buffer.from(safeId, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(campaignIdBuf.length, 0);
  const rawAmount = BigInt(Math.round(budgetUsdc * 1e6)); // USDC 6 decimals
  const budgetBuf = Buffer.alloc(8);
  budgetBuf.writeBigUInt64LE(rawAmount, 0);
  // platform_authority는 이제 인스트럭션 인자가 아니라 온체인 프로그램 상수(PLATFORM_AUTHORITY) —
  // LazorKit CPI 래핑 오버헤드까지 더해지면 가끔 트랜잭션 크기 한도를 넘기던 문제를 해결함.
  const ixData = Buffer.concat([disc, lenBuf, campaignIdBuf, budgetBuf]);

  const keys = [
    { pubkey: advertiserPubkey, isSigner: true, isWritable: true },
    { pubkey: campaignPda, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: USDC_DEVNET_MINT, isSigner: false, isWritable: false },
    { pubkey: advertiserAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const instructions = [new TransactionInstruction({ programId: ESCROW_PROGRAM_ID, keys, data: ixData })];

  // 플랫폼 수수료 — 예산과는 별도로 (예산 × PLATFORM_FEE_RATE)만큼 광고주 ATA → 플랫폼 ATA 이체
  const platformFeeUsdc = budgetUsdc * PLATFORM_FEE_RATE;
  if (platformFeeUsdc > 0) {
    const platformFeeRaw = BigInt(Math.round(platformFeeUsdc * 1e6));
    instructions.push(
      createTransferCheckedInstruction(advertiserAta, USDC_DEVNET_MINT, platformAta, advertiserPubkey, platformFeeRaw, 6)
    );
  }

  // ALT 덕분에 대부분 한 트랜잭션(그룹 1개)에 다 들어가지만, 혹시 여전히 너무 크면 나중에
  // 그룹을 나눌 수 있게 instructionGroups(배열의 배열) 형태로 반환해둔다.
  const instructionGroups = [instructions];

  return {
    instructionGroups,
    campaignPda: campaignPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    platformFeeUsdc,
    altAddresses: LINKO_ALT_ADDRESS ? [LINKO_ALT_ADDRESS.toBase58()] : [],
  };
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

  // platform_authority는 이제 인스트럭션 인자가 아니라 온체인 프로그램 상수(PLATFORM_AUTHORITY).
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

// [LEGACY] create_budget/top_up_budget을 서버가 커스터디얼 지갑으로 직접 서명해 실행하던 구버전.
// 지금은 buildAdvertiserBudgetInstructions()로 인스트럭션만 조립해서 광고주 실제 패스키 지갑이
// 브라우저에서 직접 서명하므로(POST /api/advertiser/:id/budget/prepare + /finalize) 더 이상
// 호출되지 않음 — 코드는 참고용으로 남겨두되 비활성화.
//
// export async function createAdvertiserBudget({ advertiserWalletId = WALLET_IDS.advertiser, amountUsdc }) {
//   const advertiser = loadOrCreateWallet(advertiserWalletId);
//   const platformAuthority = loadWallet(WALLET_IDS.platform);
//   const { budgetPda, vaultPda } = getBudgetPda(advertiser.publicKey);
//   const advertiserAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, advertiser.publicKey);
//
//   const disc = await getDiscriminator("create_budget");
//
//   const rawAmount = BigInt(Math.round(amountUsdc * 1e6)); // USDC 6 decimals
//   const amountBuf = Buffer.alloc(8);
//   amountBuf.writeBigUInt64LE(rawAmount, 0);
//
//   const platformAuthorityBuf = platformAuthority.publicKey.toBuffer(); // 32바이트 Pubkey
//
//   const ixData = Buffer.concat([disc, amountBuf, platformAuthorityBuf]);
//
//   const keys = [
//     { pubkey: advertiser.publicKey, isSigner: true, isWritable: true },
//     { pubkey: budgetPda, isSigner: false, isWritable: true },
//     { pubkey: vaultPda, isSigner: false, isWritable: true },
//     { pubkey: USDC_DEVNET_MINT, isSigner: false, isWritable: false },
//     { pubkey: advertiserAta, isSigner: false, isWritable: true },
//     { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
//     { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
//   ];
//
//   const ix = new TransactionInstruction({
//     programId: ESCROW_PROGRAM_ID,
//     keys,
//     data: ixData,
//   });
//
//   const tx = new Transaction().add(ix);
//   // 가스비는 플랫폼이 대납(기존 create_campaign과 동일한 gasless 정책) — 광고주는 USDC 이체 승인 서명만.
//   tx.feePayer = platformAuthority.publicKey;
//   const signature = await sendAndConfirmTransaction(connection, tx, [advertiser, platformAuthority], {
//     commitment: "confirmed",
//   });
//
//   return {
//     signature,
//     budgetPda: budgetPda.toBase58(),
//     vaultPda: vaultPda.toBase58(),
//     solscanUrl: solscanTxUrl(signature),
//   };
// }
//
// export async function topUpBudget({ advertiserWalletId = WALLET_IDS.advertiser, amountUsdc }) {
//   const advertiser = loadOrCreateWallet(advertiserWalletId);
//   const platformAuthority = loadWallet(WALLET_IDS.platform);
//   const { budgetPda, vaultPda } = getBudgetPda(advertiser.publicKey);
//   const advertiserAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, advertiser.publicKey);
//
//   const disc = await getDiscriminator("top_up_budget");
//
//   const rawAmount = BigInt(Math.round(amountUsdc * 1e6));
//   const amountBuf = Buffer.alloc(8);
//   amountBuf.writeBigUInt64LE(rawAmount, 0);
//
//   const ixData = Buffer.concat([disc, amountBuf]);
//
//   const keys = [
//     { pubkey: advertiser.publicKey, isSigner: true, isWritable: true },
//     { pubkey: budgetPda, isSigner: false, isWritable: true },
//     { pubkey: vaultPda, isSigner: false, isWritable: true },
//     { pubkey: USDC_DEVNET_MINT, isSigner: false, isWritable: false },
//     { pubkey: advertiserAta, isSigner: false, isWritable: true },
//     { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
//   ];
//
//   const ix = new TransactionInstruction({
//     programId: ESCROW_PROGRAM_ID,
//     keys,
//     data: ixData,
//   });
//
//   const tx = new Transaction().add(ix);
//   tx.feePayer = platformAuthority.publicKey;
//   const signature = await sendAndConfirmTransaction(connection, tx, [advertiser, platformAuthority], {
//     commitment: "confirmed",
//   });
//
//   return {
//     signature,
//     budgetPda: budgetPda.toBase58(),
//     vaultPda: vaultPda.toBase58(),
//     solscanUrl: solscanTxUrl(signature),
//   };
// }

/**
 * 현재 Budget PDA 상태 조회 — UI/A2A 리밸런싱 사전조회용. Budget PDA가 아직 없으면 exists:false.
 * advertiserWallet(광고주의 실제 패스키 지갑 주소, base58)을 반드시 받아서 그 지갑 기준으로
 * PDA를 도출한다 — Budget PDA는 create_budget 때 광고주 실지갑으로 서명해 만들어지므로,
 * 조회도 같은 지갑 기준이어야 한다.
 */
export async function getAdvertiserBudgetInfo({ advertiserWallet } = {}) {
  if (!advertiserWallet) {
    // [LEGACY] 커스터디얼 데모 지갑(WALLET_IDS.advertiser) 기준 폴백 — 패스키 실지갑 주소가
    // 없던 시절 코드. 광고주 계정은 이제 항상 실지갑 주소를 갖고 있어야 하므로 비활성화.
    // if (!fs.existsSync(`${WALLETS_DIR}/${WALLET_IDS.advertiser}.json`)) {
    //   return { exists: false, budgetPda: null, vaultPda: null, vaultBalanceUsdc: 0 };
    // }
    // const advertiser = loadWallet(WALLET_IDS.advertiser);
    // const { budgetPda, vaultPda } = getBudgetPda(advertiser.publicKey);
    throw new Error("advertiserWallet(광고주 실지갑 주소)이 필요합니다.");
  }
  const advertiserPubkey = new PublicKey(advertiserWallet);
  const { budgetPda, vaultPda } = getBudgetPda(advertiserPubkey);

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
 * SOL 충전 / ATA 생성처럼 "광고주 서명이 필요 없는(플랫폼 지갑만으로 되는)" 준비 작업을
 * 광고주가 서명할 트랜잭션과 분리된 별도 트랜잭션으로 먼저 끝내둔다 — 광고주 서명 트랜잭션의
 * 크기를 최대한 줄이기 위함. create_budget처럼 새 계정(PDA)을 init할 때만 SOL 충전이 필요함.
 */
async function ensureAdvertiserPrereqAccounts({ advertiserPubkey, needsSolTopUp }) {
  const platformAuthority = loadWallet(WALLET_IDS.platform);
  const advertiserAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, advertiserPubkey, true);

  const tx = new Transaction();

  if (needsSolTopUp) {
    // Anchor의 `init` 제약(payer = advertiser)이 PDA/Vault 계정 렌트를 광고주 SOL 잔고에서
    // 차감함 — 네트워크 수수료(페이마스터 대납)와는 별개. 패스키 지갑은 보통 SOL이 거의 없어서
    // 부족한 만큼 플랫폼이 미리 채워줌.
    const MIN_ADVERTISER_SOL_LAMPORTS = 8_000_000; // 0.008 SOL
    const advertiserSolBalance = await connection.getBalance(advertiserPubkey);
    if (advertiserSolBalance < MIN_ADVERTISER_SOL_LAMPORTS) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: platformAuthority.publicKey,
          toPubkey: advertiserPubkey,
          lamports: MIN_ADVERTISER_SOL_LAMPORTS - advertiserSolBalance,
        })
      );
    }
  }

  const advertiserAtaInfo = await connection.getAccountInfo(advertiserAta);
  if (!advertiserAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(platformAuthority.publicKey, advertiserAta, advertiserPubkey, USDC_DEVNET_MINT)
    );
  }

  if (tx.instructions.length === 0) return { ran: false };

  tx.feePayer = platformAuthority.publicKey;
  const signature = await sendAndConfirmTransaction(connection, tx, [platformAuthority], { commitment: "confirmed" });
  return { ran: true, signature };
}

/**
 * 광고주 예비 예산 풀(Budget PDA) 충전 인스트럭션을 "서명/전송 없이" 조립만 해서 반환.
 * 광고주의 실제 LazorKit 패스키 스마트월렛으로 브라우저에서 직접 서명하게 할 때 사용.
 * Budget PDA가 아직 없으면 create_budget(신규 생성+입금), 있으면 top_up_budget(추가 입금).
 *
 * create_budget/top_up_budget 둘 다 계정 6~7개를 쓰는데, LazorKit의 CPI 서명 래핑
 * 오버헤드(secp256r1 서명 검증 등)까지 더해지면 단 하나의 인스트럭션만으로도 Solana 트랜잭션
 * 크기 한도(1232바이트)를 넘겨버린다. 그래서 자주 반복되는 고정 계정(USDC 민트, 토큰 프로그램,
 * 에스크로 프로그램, 시스템 프로그램)을 주소 룩업 테이블(ALT)에 담아 함께 반환한다 —
 * scripts/create-lookup-table.mjs로 미리 만들어둔 LINKO_ALT_ADDRESS를 재사용.
 */
export async function buildAdvertiserBudgetInstructions({ advertiserPubkey, amountUsdc }) {
  const { budgetPda, vaultPda } = getBudgetPda(advertiserPubkey);
  const advertiserAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, advertiserPubkey, true);

  const budgetInfo = await connection.getAccountInfo(budgetPda);
  const isNew = !budgetInfo;

  // create_budget만 새 계정을 init하므로 SOL 렌트가 필요함 — top_up_budget은 불필요.
  await ensureAdvertiserPrereqAccounts({ advertiserPubkey, needsSolTopUp: isNew });

  const disc = await getDiscriminator(isNew ? "create_budget" : "top_up_budget");
  const rawAmount = BigInt(Math.round(amountUsdc * 1e6));
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(rawAmount, 0);

  // platform_authority는 이제 인스트럭션 인자도 계정도 아니라 온체인 프로그램에 상수로 박혀있음
  // (anchor_program/.../constants.rs의 PLATFORM_AUTHORITY) — LazorKit CPI 래핑 오버헤드까지
  // 더해지면 트랜잭션 크기 한도를 넘기던 문제라 아예 인스트럭션에서 제거해서 해결함.
  // create_budget/top_up_budget 계정 구성이 동일해짐.
  const ixData = Buffer.concat([disc, amountBuf]);
  const keys = [
    { pubkey: advertiserPubkey, isSigner: true, isWritable: true },
    { pubkey: budgetPda, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: USDC_DEVNET_MINT, isSigner: false, isWritable: false },
    { pubkey: advertiserAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  if (isNew) keys.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });

  const instructions = [new TransactionInstruction({ programId: ESCROW_PROGRAM_ID, keys, data: ixData })];

  // ALT는 필수(없으면 "Transaction too large"). create_budget이 platform_authority를
  // 32바이트 인스트럭션 인자로 넘기던 시절엔 ALT를 켜도 LazorKit CPI 래핑 오버헤드까지
  // 더해지면 한도(1232바이트)를 근소하게 넘겨서, LazorKit이 CPI 실행 자체를 거부하고도
  // 트랜잭션은 성공으로 처리해버려 Budget PDA가 조용히 안 만들어지는 문제가 있었음 —
  // platform_authority를 계정 참조로 바꾸고 온체인 프로그램을 업그레이드해서 해결.
  return {
    instructions,
    isNew,
    budgetPda: budgetPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    altAddresses: LINKO_ALT_ADDRESS ? [LINKO_ALT_ADDRESS.toBase58()] : [],
  };
}

/**
 * 4. budget_campaign: Budget PDA의 Vault -> 기존 캠페인 Vault로 USDC 이체.
 * 두 Vault 모두 프로그램 소유 PDA라 플랫폼 지갑(platform_authority) 서명만으로 실행됨 — 광고주 지갑 불필요.
 * advertiserWallet(광고주의 실제 패스키 지갑 주소, base58)로 Budget/Campaign PDA를 도출한다 —
 * Budget PDA는 create_budget 때, Campaign PDA는 create_campaign 때 각각 광고주 실지갑으로
 * 서명해 만들어지므로, A2A 리밸런싱도 같은 지갑 기준으로 PDA를 찾아야 실제 자금이 이동한다.
 * platform_authority만 서명하면 되므로 A2A 에이전트는 매번 광고주 패스키 승인 없이 자동 실행된다.
 */
export async function budgetCampaign({ campaignId, amountUsdc, advertiserWallet }) {
  const platformAuthority = loadWallet(WALLET_IDS.platform);
  if (!advertiserWallet) {
    // [LEGACY] advertiserId 기준으로 서버가 커스터디얼 지갑을 자동 생성/조회하던 폴백.
    // const advertiser = loadOrCreateWallet(advertiserWalletIdFor(advertiserId));
    // advertiserWallet = advertiser.publicKey.toBase58();
    throw new Error("advertiserWallet(광고주 실지갑 주소)이 필요합니다.");
  }
  const advertiserPubkey = new PublicKey(advertiserWallet);
  const { budgetPda, vaultPda: budgetVaultPda } = getBudgetPda(advertiserPubkey);
  const { campaignPda, vaultPda: campaignVaultPda } = getCampaignPda(advertiserPubkey, campaignId);

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
