/**
 * 10. 정산 로직 — 전체를 잇는 오케스트레이션
 * 흐름(데모 버전): 캠페인 등록 시 입력한 확정대기기간(confirmDelayDays)이 지났고,
 *      주문이 취소되지 않았다면 자동으로 확정된 것으로 간주 → 누적건수 조회 → 요율 계산
 *      → Solana Pay로 실제 USDC 정산 → orders.json 갱신
 *
 * 실제 쇼핑몰의 주문상태 API와 직접 연동해 확정/취소를 판별하는 방식(쇼핑몰별 스키마 파싱,
 * Gemini 기반 정규화 등)은 추후 과제로 남겨둔다. normalize.mjs / mockShop.mjs에 그 구현이
 * 남아있지만 현재 정산 경로에서는 사용하지 않는다 — 확정대기기간 경과 여부만으로 판단한다.
 */
import { readAll, update, findById, findWhere } from "./db.mjs";
import { calculateTierRate, calculateCommissionUsdc } from "./commission.mjs";
import { settleCommission, loadWallet } from "./solanaPay.mjs";
import { KRW_PER_USDC } from "./config.mjs";
import { PublicKey } from "@solana/web3.js";

/**
 * 캠페인의 실제 예산을 USDC로 환산. 캠페인 등록 시점(POST /api/campaigns)에 계산해둔
 * budgetUsdc가 있으면 그걸 쓰고, 그 전에 만들어진 예전 캠페인이면 budgetKrw로부터 환산.
 */
function resolveBudgetUsdc(campaign) {
  if (typeof campaign.budgetUsdc === "number" && campaign.budgetUsdc > 0) return campaign.budgetUsdc;
  return Number(campaign.budgetKrw || 1000000) / KRW_PER_USDC;
}

/**
 * 특정 크리에이터가 특정 캠페인에서 이미 확정 정산을 마친 건수.
 * (이 함수 호출 시점 기준 — 이번 주문은 포함하지 않음, 호출부에서 +1 해서 사용)
 */
function countAlreadySettled(promoterId, campaignId) {
  return findWhere(
    "orders",
    (o) => o.promoterId === promoterId && o.campaignId === campaignId && o.status === "settled"
  ).length;
}

/**
 * 주문 하나를 처리합니다. 이미 settled/cancelled면 건너뜁니다.
 * 취소는 별도 액션(주문의 status를 직접 "cancelled"로 바꾸는 취소 시뮬레이션 등)으로만 발생하고,
 * 여기서는 "취소되지 않은 채 확정대기기간이 지났는가"만 판단합니다.
 * @param {string} orderId
 * @returns {Promise<{action: "settled"|"waiting"|"already_final", detail: object}>}
 */
export async function processOrder(orderId) {
  const order = findById("orders", orderId);
  if (!order) throw new Error(`주문을 찾을 수 없음: ${orderId}`);
  if (order.status === "settled" || order.status === "cancelled") {
    return { action: "already_final", detail: order };
  }

  const campaign = findById("campaigns", order.campaignId);
  if (!campaign) throw new Error(`캠페인을 찾을 수 없음: ${order.campaignId}`);

  // 확정대기기간이 아직 안 지났으면 대기
  const now = new Date();
  const confirmDueAt = new Date(order.confirmDueAt);
  if (now < confirmDueAt) {
    if (order.status !== "pending_confirm") {
      update("orders", orderId, { status: "pending_confirm" });
    }
    return {
      action: "waiting",
      detail: { reason: `확정대기기간(${order.confirmDueAt})이 아직 안 지남 — 정산 보류` },
    };
  }

  // 확정대기기간이 지났고 취소되지 않았다면 자동 확정 → 누적 확정 건수 → 요율 결정 → 커미션 계산
  const cumulativeCount = countAlreadySettled(order.promoterId, order.campaignId) + 1;
  const rate = calculateTierRate(campaign.commissionTiers, cumulativeCount);
  const commissionUsdc = calculateCommissionUsdc(order.amount, rate, KRW_PER_USDC);

  // 5. 크리에이터 지갑 조회 후 Anchor 온체인 에스크로 정산 (또는 Solana Pay 정산) 실행
  const promoter = findById("promoters", order.promoterId);
  if (!promoter) throw new Error(`크리에이터를 찾을 수 없음: ${order.promoterId}`);

  let signature, solscanUrl;
  try {
    const { settleFromEscrow, ensureCampaignEscrow } = await import("./escrow.mjs");
    const { WALLET_IDS } = await import("./config.mjs");

    // Campaign PDA는 등록 당시 서명한 지갑 기준으로 도출되므로, 정산도 같은 지갑을 써야 한다.
    let advertiserPubkey;
    if (campaign.advertiserWallet) {
      // 패스키(광고주 실지갑)로 등록된 캠페인. finalize가 온체인 확정을 먼저 확인한 뒤에만
      // DB에 기록하므로 Campaign PDA는 이미 존재함이 보장됨 — 별도 안전망 호출 불필요.
      advertiserPubkey = campaign.advertiserWallet;
    } else {
      // [LEGACY] 패스키 이전에 커스터디얼 데모 지갑으로 등록된 구캠페인.
      const { loadWallet } = await import("./solanaPay.mjs");
      const legacyAdvertiserWallet = loadWallet(WALLET_IDS.advertiser);
      advertiserPubkey = legacyAdvertiserWallet.publicKey.toBase58();

      // 온체인 Campaign PDA / Vault PDA가 없으면 자동 입금 및 에스크로 계정 생성 보장.
      // (정상 경로에서는 캠페인 등록 시점에 이미 생성돼 있음 — 여기는 그 전에 만들어진
      //  구캠페인을 위한 안전망. 하드코딩된 값 대신 실제 캠페인 예산을 사용함)
      await ensureCampaignEscrow({
        advertiserWalletId: WALLET_IDS.advertiser,
        campaignId: campaign.id,
        budgetUsdc: resolveBudgetUsdc(campaign),
      });
    }

    // 진짜 온체인 에스크로 Vault에서 크리에이터 지갑으로 USDC 정산 해제 (Release)
    const res = await settleFromEscrow({
      advertiserPubkey,
      creatorPubkey: promoter.walletAddress,
      amountUsdc: commissionUsdc,
      orderId,
      campaignId: campaign.id
    });
    signature = res.signature;
    solscanUrl = res.solscanUrl;
    console.log(`[SettlementEngine] ✅ Anchor 온체인 에스크로 정산 성공: ${signature}`);
  } catch (escrowErr) {
    console.log(`[SettlementEngine] ⚠️ 에스크로 정산 예외 발생(Solana Pay 직송 정산으로 안전 폴백): ${escrowErr.message}`);
    const res = await settleCommission({
      toPublicKey: new PublicKey(promoter.walletAddress),
      amountUsdc: commissionUsdc,
      orderId,
    });
    signature = res.signature;
    solscanUrl = res.solscanUrl;
  }

  const updated = update("orders", orderId, {
    status: "settled",
    settledAt: now.toISOString(),
    settlementTx: signature,
    commissionRateApplied: rate,
    commissionAmountUsdc: commissionUsdc,
  });

  return {
    action: "settled",
    detail: { ...updated, cumulativeCount, solscanUrl },
  };
}

/**
 * purchased/pending_confirm 상태인 모든 주문을 순회하며 처리합니다.
 */
export async function processAllOpenOrders() {
  const orders = readAll("orders").filter(
    (o) => o.status === "purchased" || o.status === "pending_confirm"
  );
  const results = [];
  for (const o of orders) {
    try {
      const result = await processOrder(o.id);
      results.push({ orderId: o.id, ...result });
    } catch (e) {
      results.push({ orderId: o.id, action: "error", detail: { message: e.message } });
    }
  }
  return results;
}
