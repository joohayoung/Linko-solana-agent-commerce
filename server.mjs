/**
 * Linko 메인 서버
 * 프레임워크 없이 순수 Node http 모듈로 구현 (빌드 단계 없음).
 *   - 정적 프론트엔드 서빙 (public/)
 *   - REST API (/api/*)
 *   - 가짜 쇼핑몰 시뮬레이터 (/mock-shop/*)
 *
 * 실행: node --env-file=.env server.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { PublicKey } from "@solana/web3.js";

import { readAll, findById, findWhere, insert, update } from "./src/db.mjs";
import { processOrder } from "./src/settlementEngine.mjs";
import { calculateTierRate } from "./src/commission.mjs";
import { searchCampaigns } from "./src/search.mjs";
import { SHOP_IDS, createOrder as createShopOrder, getOrder as getShopOrder, setState as setShopState } from "./src/mockShop.mjs"; // 정산 로직에는 더 이상 쓰이지 않음(확정대기기간 경과로 자동정산). /mock-shop 데모 라우트에서만 사용.
import { APP_PORT, KRW_PER_USDC } from "./src/config.mjs";
import { chat as agentChat } from "./src/agent.mjs";
import { handlePaymasterRpc } from "./src/paymaster.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

// ---------------- 공통 HTTP 유틸 ----------------

function sendJson(res, statusCode, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("잘못된 JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, pathname) {
  // pathname은 URL에서 온 값이라 항상 "/" 구분자(POSIX 스타일)임.
  // Windows에서 path.normalize("/")가 "\\"로 바뀌어버려서 비교가 깨지는 문제가 있어,
  // "/" 특수 케이스를 먼저 처리한 뒤에 normalize로 경로 탈출만 방지한다.
  const relPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

// ---------------- 도메인 헬퍼 ----------------

function slugify(text) {
  return String(text)
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣]/g, "")
    .slice(0, 10) || "USER";
}

function ensureParticipation(promoterId, campaignId) {
  const [existing] = findWhere(
    "participations",
    (p) => p.promoterId === promoterId && p.campaignId === campaignId
  );
  if (existing) return existing;

  const promoter = findById("promoters", promoterId);
  const campaign = findById("campaigns", campaignId);
  let code = `${slugify(promoter.name)}-${slugify(campaign.product)}`;
  // 중복이면 접미사 추가
  const codes = new Set(readAll("participations").map((p) => p.referralCode));
  let suffix = 1;
  let finalCode = code;
  while (codes.has(finalCode)) {
    finalCode = `${code}-${suffix++}`;
  }

  return insert("participations", {
    id: uuidv4(),
    promoterId,
    campaignId,
    referralCode: finalCode,
    clicks: 0,
    joinedAt: new Date().toISOString(),
  });
}

function tierInfo(tiers, cumulativeConfirmedCount) {
  const sorted = [...tiers].sort((a, b) => a.minSales - b.minSales);
  const nextCount = cumulativeConfirmedCount + 1;
  let idx = sorted.findIndex((t) => nextCount >= t.minSales && (t.maxSales == null || nextCount <= t.maxSales));
  if (idx === -1) idx = sorted.length - 1;
  return { currentRate: sorted[idx].rate, nextTier: sorted[idx + 1] || null };
}

function countSettled(promoterId, campaignId) {
  return findWhere(
    "orders",
    (o) => o.promoterId === promoterId && o.campaignId === campaignId && o.status === "settled"
  ).length;
}

// ---------------- API 핸들러 ----------------

async function handleApi(req, res, url, parts) {
  const method = req.method;

  // GET /api/config — 프론트엔드에서 쓰는 공개 설정값
  if (method === "GET" && parts.length === 1 && parts[0] === "config") {
    return sendJson(res, 200, { krwPerUsdc: KRW_PER_USDC });
  }

  // GET /api/campaigns?q=...
  if (method === "GET" && parts.length === 1 && parts[0] === "campaigns") {
    const q = url.searchParams.get("q");
    let campaigns = readAll("campaigns");
    if (q) {
      campaigns = await searchCampaigns(campaigns, q);
    } else {
      campaigns = [...campaigns].reverse(); // 최신 등록 캠페인이 상단에 위치하도록 역순 정렬
    }
    return sendJson(res, 200, { campaigns });
  }

  // POST /api/campaigns
  if (method === "POST" && parts.length === 1 && parts[0] === "campaigns") {
    const body = await readBody(req);
    if (!body.advertiser || !body.product || !body.price || !Array.isArray(body.commissionTiers) || body.commissionTiers.length === 0) {
      return sendJson(res, 400, { error: "advertiser, product, price, commissionTiers는 필수입니다." });
    }
    const campaign = insert("campaigns", {
      id: `c-${uuidv4().replace(/-/g, "").slice(0, 16)}`,
      advertiser: body.advertiser,
      advertiserId: body.advertiserId || null, // 패스키로 로그인한 광고주 계정 id (2단계: 온보딩)
      advertiserWallet: body.advertiserWallet || null, // 위 계정의 실제 지갑 주소
      product: body.product,
      description: body.description || "",
      productUrl: body.productUrl || "",
      guideline: body.guideline || "",
      tags: body.tags || [],
      price: Number(body.price),
      currency: "KRW",
      commissionTiers: body.commissionTiers,
      confirmDelayDays: Number(body.confirmDelayDays || 7),
      budgetKrw: Number(body.budgetKrw || 1000000),
      // 광고주에게는 노출하지 않고, 등록 순서에 따라 내부적으로 쇼핑몰 스키마를 자동 배정
      // (Gemini가 여러 쇼핑몰의 서로 다른 주문상태 스키마를 정규화하는 동작은 그대로 유지됨)
      thumbnail: body.thumbnail || "/images/campaigns/moisturizer.svg",
      shopId: SHOP_IDS[readAll("campaigns").length % SHOP_IDS.length],
      status: "active",
    });
    return sendJson(res, 201, { campaign });
  }

  // GET /api/campaigns/:id
  if (method === "GET" && parts.length === 2 && parts[0] === "campaigns") {
    const campaign = findById("campaigns", parts[1]);
    if (!campaign) return sendJson(res, 404, { error: "캠페인을 찾을 수 없습니다." });
    return sendJson(res, 200, { campaign });
  }

  // POST /api/campaigns/:id/participate
  if (method === "POST" && parts.length === 3 && parts[0] === "campaigns" && parts[2] === "participate") {
    const campaignId = parts[1];
    const campaign = findById("campaigns", campaignId);
    if (!campaign) return sendJson(res, 404, { error: "캠페인을 찾을 수 없습니다." });

    const body = await readBody(req);
    let promoterId = body.promoterId;

    if (!promoterId) {
      if (!body.name || !body.walletAddress) {
        return sendJson(res, 400, { error: "promoterId 또는 (name, walletAddress)가 필요합니다." });
      }
      const promoter = insert("promoters", {
        id: uuidv4(),
        name: body.name,
        followers: 0,
        walletAddress: body.walletAddress,
      });
      promoterId = promoter.id;
    } else if (!findById("promoters", promoterId)) {
      return sendJson(res, 404, { error: "크리에이터를 찾을 수 없습니다." });
    }

    const participation = ensureParticipation(promoterId, campaignId);
    return sendJson(res, 201, { participation });
  }

  // GET /api/campaigns/:id/advertiser-detail — 광고주 캠페인 상세(집행현황 + 크리에이터별 실적)
  if (method === "GET" && parts.length === 3 && parts[0] === "campaigns" && parts[2] === "advertiser-detail") {
    const campaign = findById("campaigns", parts[1]);
    if (!campaign) return sendJson(res, 404, { error: "캠페인을 찾을 수 없습니다." });

    const orders = findWhere("orders", (o) => o.campaignId === campaign.id);
    const settled = orders.filter((o) => o.status === "settled");
    const promoters = readAll("promoters");

    const byPromoter = {};
    for (const o of orders) {
      if (!byPromoter[o.promoterId]) {
        byPromoter[o.promoterId] = {
          promoterId: o.promoterId,
          name: promoters.find((p) => p.id === o.promoterId)?.name || "-",
          purchaseCount: 0,
          confirmedCount: 0,
          settledUsdc: 0,
        };
      }
      byPromoter[o.promoterId].purchaseCount++;
      if (o.status === "settled") {
        byPromoter[o.promoterId].confirmedCount++;
        byPromoter[o.promoterId].settledUsdc += o.commissionAmountUsdc || 0;
      }
    }
    for (const p of Object.values(byPromoter)) {
      p.settledKrw = Math.round(p.settledUsdc * KRW_PER_USDC);
    }

    const spentUsdc = settled.reduce((s, o) => s + (o.commissionAmountUsdc || 0), 0);
    return sendJson(res, 200, {
      campaign,
      stats: {
        budgetKrw: campaign.budgetKrw,
        spentUsdc,
        spentKrw: Math.round(spentUsdc * KRW_PER_USDC),
        totalOrders: orders.length,
        settledCount: settled.length,
        pendingCount: orders.filter((o) => o.status === "purchased" || o.status === "pending_confirm").length,
        cancelledCount: orders.filter((o) => o.status === "cancelled").length,
      },
      creators: Object.values(byPromoter),
    });
  }

  // POST /api/campaigns/:id/simulate-confirm  { count } — 데모용: 오래된 미정산 주문부터 N개 확정+정산
  if (method === "POST" && parts.length === 3 && parts[0] === "campaigns" && parts[2] === "simulate-confirm") {
    const campaign = findById("campaigns", parts[1]);
    if (!campaign) return sendJson(res, 404, { error: "캠페인을 찾을 수 없습니다." });

    const body = await readBody(req);
    const count = Math.max(1, Math.min(50, Number(body.count) || 1));

    const openOrders = findWhere(
      "orders",
      (o) => o.campaignId === campaign.id && (o.status === "purchased" || o.status === "pending_confirm")
    )
      .sort((a, b) => new Date(a.purchasedAt) - new Date(b.purchasedAt))
      .slice(0, count);

    const results = [];
    for (const o of openOrders) {
      // 데모 편의를 위해 confirmDueAt을 "지금"으로 당긴다 (쇼핑몰 상태조회 없이
      // 확정대기기간 경과 여부만으로 자동정산되므로, 이렇게 하면 즉시 정산 대상이 된다).
      if (new Date(o.confirmDueAt) > new Date()) {
        update("orders", o.id, { confirmDueAt: new Date().toISOString() });
      }
      try {
        const result = await processOrder(o.id);
        results.push({ orderId: o.id, action: result.action, detail: result.detail?.reason });
      } catch (e) {
        console.error(`[simulate-confirm] 주문 ${o.id} 정산 실패:`, e);
        results.push({ orderId: o.id, action: "error", detail: e.message });
      }
    }

    // "처리 시도한 개수"와 "실제로 정산 완료된 개수"는 다르다 — Gemini 타임아웃 등으로
    // 개별 주문이 실패해도 이전에는 무조건 "N건 완료"로 보여서 실패가 감춰졌음
    const settledCount = results.filter((r) => r.action === "settled").length;
    const errorCount = results.filter((r) => r.action === "error").length;
    const waitingCount = results.filter((r) => r.action === "waiting").length;

    return sendJson(res, 200, { processed: results.length, settledCount, errorCount, waitingCount, results });
  }

  // GET /api/promoters
  if (method === "GET" && parts.length === 1 && parts[0] === "promoters") {
    return sendJson(res, 200, { promoters: readAll("promoters") });
  }

  // POST /api/promoters/by-wallet — LazorKit 패스키로 연결된 지갑 주소로 프로모터를 찾거나 신규 생성
  // (2단계: 수동 지갑주소 입력 대신 프론트에서 지갑 연결 직후 이 API를 호출해서 세션을 만듭니다)
  if (method === "POST" && parts.length === 2 && parts[0] === "promoters" && parts[1] === "by-wallet") {
    const body = await readBody(req);
    const walletAddress = (body.walletAddress || "").trim();
    if (!walletAddress) {
      return sendJson(res, 400, { error: "walletAddress가 필요합니다." });
    }
    try {
      // eslint-disable-next-line no-new
      new PublicKey(walletAddress);
    } catch {
      return sendJson(res, 400, { error: "유효한 솔라나 지갑 주소가 아니에요." });
    }

    const [existing] = findWhere("promoters", (p) => p.walletAddress === walletAddress);
    if (existing) {
      return sendJson(res, 200, { promoter: existing, created: false });
    }

    const name = (body.name || "").trim() || `크리에이터-${walletAddress.slice(0, 4)}`;
    const promoter = insert("promoters", {
      id: uuidv4(),
      name,
      followers: 0,
      walletAddress,
    });
    return sendJson(res, 201, { promoter, created: true });
  }

  // POST /api/advertisers/by-wallet — 광고주용 패스키 로그인. 프로모터 쪽과 동일한 패턴.
  // (2단계 범위: 로그인/신원 확인까지만 — 캠페인 예산 예치 서명은 아직 플랫폼이 대신 처리)
  if (method === "POST" && parts.length === 2 && parts[0] === "advertisers" && parts[1] === "by-wallet") {
    const body = await readBody(req);
    const walletAddress = (body.walletAddress || "").trim();
    if (!walletAddress) {
      return sendJson(res, 400, { error: "walletAddress가 필요합니다." });
    }
    try {
      // eslint-disable-next-line no-new
      new PublicKey(walletAddress);
    } catch {
      return sendJson(res, 400, { error: "유효한 솔라나 지갑 주소가 아니에요." });
    }

    const [existing] = findWhere("advertisers", (a) => a.walletAddress === walletAddress);
    if (existing) {
      return sendJson(res, 200, { advertiser: existing, created: false });
    }

    const name = (body.name || "").trim() || `브랜드-${walletAddress.slice(0, 4)}`;
    const advertiser = insert("advertisers", {
      id: uuidv4(),
      name,
      walletAddress,
    });
    return sendJson(res, 201, { advertiser, created: true });
  }

  // GET /api/advertisers/:id
  if (method === "GET" && parts.length === 2 && parts[0] === "advertisers") {
    const advertiser = findById("advertisers", parts[1]);
    if (!advertiser) return sendJson(res, 404, { error: "광고주를 찾을 수 없습니다." });
    return sendJson(res, 200, { advertiser });
  }

  // GET /api/promoters/:id
  if (method === "GET" && parts.length === 2 && parts[0] === "promoters") {
    const promoter = findById("promoters", parts[1]);
    if (!promoter) return sendJson(res, 404, { error: "크리에이터를 찾을 수 없습니다." });
    return sendJson(res, 200, { promoter });
  }

  // GET /api/promoters/:id/dashboard
  if (method === "GET" && parts.length === 3 && parts[0] === "promoters" && parts[2] === "dashboard") {
    const promoter = findById("promoters", parts[1]);
    if (!promoter) return sendJson(res, 404, { error: "크리에이터를 찾을 수 없습니다." });

    const participations = findWhere("participations", (p) => p.promoterId === promoter.id).map((p) => {
      const campaign = findById("campaigns", p.campaignId);
      const cumulative = countSettled(promoter.id, p.campaignId);
      const { currentRate, nextTier } = tierInfo(campaign.commissionTiers, cumulative);
      return {
        campaignId: p.campaignId,
        product: campaign.product,
        referralCode: p.referralCode,
        cumulativeConfirmedCount: cumulative,
        currentRate,
        nextTier,
      };
    });

    const orders = findWhere("orders", (o) => o.promoterId === promoter.id)
      .map((o) => ({
        ...o,
        product: findById("campaigns", o.campaignId)?.product || "-",
        commissionAmountKrw: o.commissionAmountUsdc != null ? Math.round(o.commissionAmountUsdc * KRW_PER_USDC) : null,
      }))
      .sort((a, b) => new Date(b.purchasedAt) - new Date(a.purchasedAt));

    const totalEarnedUsdc = orders
      .filter((o) => o.status === "settled")
      .reduce((s, o) => s + (o.commissionAmountUsdc || 0), 0);
    const totalEarnedKrw = Math.round(totalEarnedUsdc * KRW_PER_USDC);

    return sendJson(res, 200, { promoter, participations, orders, totalEarnedUsdc, totalEarnedKrw });
  }

  // GET /api/promoters/:id/campaigns/:campaignId — 크리에이터 캠페인 상세(추천URL + 내 실적)
  if (method === "GET" && parts.length === 4 && parts[0] === "promoters" && parts[2] === "campaigns") {
    const promoter = findById("promoters", parts[1]);
    if (!promoter) return sendJson(res, 404, { error: "크리에이터를 찾을 수 없습니다." });
    const campaign = findById("campaigns", parts[3]);
    if (!campaign) return sendJson(res, 404, { error: "캠페인을 찾을 수 없습니다." });

    const [participation] = findWhere(
      "participations",
      (p) => p.promoterId === promoter.id && p.campaignId === campaign.id
    );
    if (!participation) return sendJson(res, 404, { error: "아직 참여하지 않은 캠페인입니다." });

    const orders = findWhere("orders", (o) => o.promoterId === promoter.id && o.campaignId === campaign.id)
      .map((o) => ({
        ...o,
        commissionAmountKrw: o.commissionAmountUsdc != null ? Math.round(o.commissionAmountUsdc * KRW_PER_USDC) : null,
      }))
      .sort((a, b) => new Date(b.purchasedAt) - new Date(a.purchasedAt));
    const settled = orders.filter((o) => o.status === "settled");
    const { currentRate, nextTier } = tierInfo(campaign.commissionTiers, settled.length);
    const cumulativeSettledUsdc = settled.reduce((s, o) => s + (o.commissionAmountUsdc || 0), 0);

    return sendJson(res, 200, {
      campaign,
      promoter,
      participation,
      stats: {
        clicks: participation.clicks || 0,
        purchaseCount: orders.length,
        confirmedCount: settled.length,
        cumulativeSettledUsdc,
        cumulativeSettledKrw: Math.round(cumulativeSettledUsdc * KRW_PER_USDC),
        currentRate,
        nextTier,
      },
      orders,
    });
  }

  // GET /api/advertiser/dashboard?advertiser=브랜드명 또는 ?advertiserId=... — 넘기면 해당 광고주 캠페인만 필터링
  // (advertiserId가 있으면 우선 사용 — 패스키 로그인한 광고주 계정 기준. 브랜드명 필터는 과거 데모 데이터 호환용)
  if (method === "GET" && parts.length === 2 && parts[0] === "advertiser" && parts[1] === "dashboard") {
    const advertiserFilter = url.searchParams.get("advertiser");
    const advertiserIdFilter = url.searchParams.get("advertiserId");
    const campaigns = readAll("campaigns")
      .filter((c) => {
        if (advertiserIdFilter) return c.advertiserId === advertiserIdFilter;
        return !advertiserFilter || c.advertiser === advertiserFilter;
      })
      .reverse();
    const allOrders = readAll("orders");
    const promoters = readAll("promoters");

    const campaignStats = campaigns.map((c) => {
      const orders = allOrders.filter((o) => o.campaignId === c.id);
      const settled = orders.filter((o) => o.status === "settled");
      const spentUsdc = settled.reduce((s, o) => s + (o.commissionAmountUsdc || 0), 0);
      return {
        id: c.id,
        product: c.product,
        advertiser: c.advertiser,
        budgetKrw: c.budgetKrw,
        spentUsdc,
        spentKrw: Math.round(spentUsdc * KRW_PER_USDC),
        totalOrders: orders.length,
        settledCount: settled.length,
        pendingCount: orders.filter((o) => o.status === "purchased" || o.status === "pending_confirm").length,
        cancelledCount: orders.filter((o) => o.status === "cancelled").length,
      };
    });

    const recentOrders = [...allOrders]
      .sort((a, b) => new Date(b.purchasedAt) - new Date(a.purchasedAt))
      .slice(0, 30)
      .map((o) => ({
        ...o,
        product: findById("campaigns", o.campaignId)?.product || "-",
        promoterName: promoters.find((p) => p.id === o.promoterId)?.name || "-",
      }));

    return sendJson(res, 200, { campaigns: campaignStats, recentOrders });
  }

  // GET /api/participations/by-code/:code
  if (method === "GET" && parts.length === 3 && parts[0] === "participations" && parts[1] === "by-code") {
    const [participation] = findWhere("participations", (p) => p.referralCode === parts[2]);
    if (!participation) return sendJson(res, 404, { error: "유효하지 않은 추천 링크입니다." });
    const campaign = findById("campaigns", participation.campaignId);
    const promoter = findById("promoters", participation.promoterId);
    return sendJson(res, 200, { participation, campaign, promoter });
  }

  // POST /api/participations/:code/simulate-purchase  { count } — 데모용: 내 추천링크로 N건 구매 발생
  if (method === "POST" && parts.length === 3 && parts[0] === "participations" && parts[2] === "simulate-purchase") {
    const [participation] = findWhere("participations", (p) => p.referralCode === parts[1]);
    if (!participation) return sendJson(res, 404, { error: "유효하지 않은 추천 링크입니다." });
    const campaign = findById("campaigns", participation.campaignId);

    const body = await readBody(req);
    const count = Math.max(1, Math.min(50, Number(body.count) || 1));

    const created = [];
    for (let i = 0; i < count; i++) {
      const orderId = uuidv4();
      const purchasedAt = new Date();
      const confirmDueAt = new Date(purchasedAt.getTime() + campaign.confirmDelayDays * 24 * 60 * 60 * 1000);

      createShopOrder(campaign.shopId, orderId, campaign.price);

      const order = insert("orders", {
        id: orderId,
        campaignId: campaign.id,
        referralCode: participation.referralCode,
        promoterId: participation.promoterId,
        amount: campaign.price,
        status: "purchased",
        purchasedAt: purchasedAt.toISOString(),
        confirmDueAt: confirmDueAt.toISOString(),
        settledAt: null,
        settlementTx: null,
        commissionRateApplied: null,
        commissionAmountUsdc: null,
      });
      created.push(order);
    }

    return sendJson(res, 201, { orders: created, count: created.length });
  }

  // // POST /api/checkout  { referralCode }
  // if (method === "POST" && parts.length === 1 && parts[0] === "checkout") {
  //   const body = await readBody(req);
  //   const [participation] = findWhere("participations", (p) => p.referralCode === body.referralCode);
  //   if (!participation) return sendJson(res, 404, { error: "유효하지 않은 추천 링크입니다." });
  //   const campaign = findById("campaigns", participation.campaignId);

  //   const orderId = uuidv4();
  //   const purchasedAt = new Date();
  //   const confirmDueAt = new Date(purchasedAt.getTime() + campaign.confirmDelayDays * 24 * 60 * 60 * 1000);

  //   createShopOrder(campaign.shopId, orderId, campaign.price);

  //   const order = insert("orders", {
  //     id: orderId,
  //     campaignId: campaign.id,
  //     referralCode: participation.referralCode,
  //     promoterId: participation.promoterId,
  //     amount: campaign.price,
  //     status: "purchased",
  //     purchasedAt: purchasedAt.toISOString(),
  //     confirmDueAt: confirmDueAt.toISOString(),
  //     settledAt: null,
  //     settlementTx: null,
  //     commissionRateApplied: null,
  //     commissionAmountUsdc: null,
  //   });

  //   return sendJson(res, 201, { order });
  // }

  // POST /api/checkout  { referralCode, quantity }
  if (method === "POST" && parts.length === 1 && parts[0] === "checkout") {
    const body = await readBody(req);
    const [participation] = findWhere("participations", (p) => p.referralCode === body.referralCode);
    if (!participation) return sendJson(res, 404, { error: "유효하지 않은 추천 링크입니다." });
    const campaign = findById("campaigns", participation.campaignId);
    const quantity = Math.max(1, Math.min(20, Number(body.quantity) || 1));
    const amount = campaign.price * quantity;
    const orderId = uuidv4();
    const purchasedAt = new Date();
    const confirmDueAt = new Date(purchasedAt.getTime() + campaign.confirmDelayDays * 24 * 60 * 60 * 1000);
    createShopOrder(campaign.shopId, orderId, amount);
    const order = insert("orders", {
      id: orderId,
      campaignId: campaign.id,
      referralCode: participation.referralCode,
      promoterId: participation.promoterId,
      quantity,
      amount,
      status: "purchased",
      purchasedAt: purchasedAt.toISOString(),
      confirmDueAt: confirmDueAt.toISOString(),
      settledAt: null,
      settlementTx: null,
      commissionRateApplied: null,
      commissionAmountUsdc: null,
    });
    return sendJson(res, 201, { order });
  }
  
  // POST /api/pixel/conversion  { referralCode, storeId, orderId, amount }
  // 광고주 스토어에 설치된 구매확정 픽셀(pixel.js)이 결제완료 페이지에서 호출하는 엔드포인트.
  // referralCode만으로 campaignId/promoterId를 서버가 역으로 찾기 때문에, 픽셀 자체는
  // 캠페인마다 다시 설치할 필요 없이 광고주 계정(storeId)당 한 번만 설치하면 된다.
  if (method === "POST" && parts.length === 2 && parts[0] === "pixel" && parts[1] === "conversion") {
    const body = await readBody(req);
    const referralCode = (body.referralCode || "").trim();
    const orderId = (body.orderId || "").trim();
    const amount = Number(body.amount);
    if (!referralCode || !orderId || !amount || amount <= 0) {
      return sendJson(res, 400, { error: "referralCode, orderId, amount는 필수입니다." });
    }

    const [participation] = findWhere("participations", (p) => p.referralCode === referralCode);
    if (!participation) return sendJson(res, 404, { error: "유효하지 않은 추천 링크입니다." });
    const campaign = findById("campaigns", participation.campaignId);

    if (body.storeId && campaign.advertiserId && body.storeId !== campaign.advertiserId) {
      return sendJson(res, 403, { error: "storeId가 이 추천 링크의 캠페인과 일치하지 않습니다." });
    }

    // 같은 주문번호로 중복 호출되어도(새로고침 등) 두 번 집계되지 않도록 멱등 처리
    const [existing] = findWhere(
      "orders",
      (o) => o.campaignId === campaign.id && o.externalOrderId === orderId
    );
    if (existing) {
      return sendJson(res, 200, { order: existing, action: "duplicate" });
    }

    const purchasedAt = new Date();
    const confirmDueAt = new Date(purchasedAt.getTime() + campaign.confirmDelayDays * 24 * 60 * 60 * 1000);
    const order = insert("orders", {
      id: uuidv4(),
      campaignId: campaign.id,
      referralCode: participation.referralCode,
      promoterId: participation.promoterId,
      externalOrderId: orderId,
      amount,
      status: "purchased",
      purchasedAt: purchasedAt.toISOString(),
      confirmDueAt: confirmDueAt.toISOString(),
      settledAt: null,
      settlementTx: null,
      commissionRateApplied: null,
      commissionAmountUsdc: null,
      source: "pixel",
    });
    return sendJson(res, 201, { order, action: "created" });
  }

  // GET /api/orders/:id
  if (method === "GET" && parts.length === 2 && parts[0] === "orders") {
    const order = findById("orders", parts[1]);
    if (!order) return sendJson(res, 404, { error: "주문을 찾을 수 없습니다." });
    return sendJson(res, 200, { order });
  }

  // POST /api/orders/:id/confirm-simulate | /cancel-simulate
  // 데모 버전: 쇼핑몰 상태 조회 없이, 확정대기기간(confirmDelayDays) 경과 여부만으로 정산을 결정한다.
  if (method === "POST" && parts.length === 3 && parts[0] === "orders" && (parts[2] === "confirm-simulate" || parts[2] === "cancel-simulate")) {
    const order = findById("orders", parts[1]);
    if (!order) return sendJson(res, 404, { error: "주문을 찾을 수 없습니다." });
    if (order.status === "settled" || order.status === "cancelled") {
      return sendJson(res, 200, { order, action: "already_final" });
    }

    if (parts[2] === "cancel-simulate") {
      // 취소는 주문 자체의 status를 바로 취소로 확정한다 (정산 대상에서 제외).
      const updated = update("orders", order.id, { status: "cancelled" });
      return sendJson(res, 200, { order: updated, action: "cancelled" });
    }

    // confirm-simulate: 데모 편의를 위해 confirmDueAt을 "지금"으로 당겨서,
    // 실제 확정대기기간을 기다리지 않고도 자동정산 로직(대기기간 경과 여부 판단)을 그대로 통과시킨다.
    if (new Date(order.confirmDueAt) > new Date()) {
      update("orders", order.id, { confirmDueAt: new Date().toISOString() });
    }

    try {
      const result = await processOrder(order.id);
      const updated = findById("orders", order.id);
      const commissionAmountKrw =
        updated.commissionAmountUsdc != null ? Math.round(updated.commissionAmountUsdc * KRW_PER_USDC) : null;
      return sendJson(res, 200, { order: { ...updated, commissionAmountKrw }, action: result.action });
    } catch (e) {
      console.error(`[confirm-simulate] 주문 ${order.id} 정산 실패:`, e);
      return sendJson(res, 502, { error: `정산 처리 실패: ${e.message}` });
    }
  }

  // POST /api/agent/chat — AI 에이전트 대화
  if (method === "POST" && parts.length === 2 && parts[0] === "agent" && parts[1] === "chat") {
    const body = await readBody(req);
    const role = body.role || "general";
    const history = Array.isArray(body.history) ? body.history : [];
    const userMessage = body.message || "";
    if (!userMessage.trim()) return sendJson(res, 400, { error: "message는 필수입니다." });

    try {
      const result = await agentChat(history, userMessage, role);
      return sendJson(res, 200, { reply: result.reply, history: result.history });
    } catch (e) {
      console.error("[Agent] 에러:", e);
      return sendJson(res, 502, { error: `AI 에이전트 오류: ${e.message}` });
    }
  }

  return sendJson(res, 404, { error: "알 수 없는 API 경로입니다." });
}

// ---------------- 가짜 쇼핑몰 라우트 ----------------

async function handleMockShop(req, res, parts) {
  const shopId = parts[0];
  if (!SHOP_IDS.includes(shopId)) return sendJson(res, 404, { error: `알 수 없는 shopId: ${shopId}` });
  if (parts[1] !== "orders") return sendJson(res, 404, { error: "not found" });

  if (req.method === "POST" && parts.length === 2) {
    const body = await readBody(req);
    if (!body.orderId || body.amount == null) return sendJson(res, 400, { error: "orderId, amount 필수" });
    return sendJson(res, 201, createShopOrder(shopId, body.orderId, body.amount));
  }
  if (req.method === "GET" && parts.length === 3) {
    const rec = getShopOrder(shopId, parts[2]);
    if (!rec) return sendJson(res, 404, { error: "주문 없음" });
    return sendJson(res, 200, rec);
  }
  if (req.method === "POST" && parts.length === 4) {
    const action = parts[3];
    if (!["confirm", "cancel"].includes(action)) return sendJson(res, 400, { error: `알 수 없는 action: ${action}` });
    const rec = setShopState(shopId, parts[2], action === "confirm" ? "confirmed" : "cancelled");
    if (!rec) return sendJson(res, 404, { error: "주문 없음" });
    return sendJson(res, 200, rec);
  }
  return sendJson(res, 404, { error: "not found" });
}

// ---------------- 클릭 추적 리다이렉트 (/go/:code) ----------------
// 실제 서비스라면 여기서 클릭을 로그로 남긴 뒤 광고주의 진짜 상품 URL(productUrl)로 리다이렉트해요.
// 데모에서는 실제로 연동된 쇼핑몰이 없어서, 클릭은 똑같이 로그를 남기고
// 우리 체크아웃 시뮬레이터(checkout.html)로 대신 리다이렉트합니다.

async function handleGoRedirect(req, res, code) {
  const [participation] = findWhere("participations", (p) => p.referralCode === code);
  if (!participation) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("유효하지 않은 추천 링크입니다.");
  }
  update("participations", participation.id, { clicks: (participation.clicks || 0) + 1 });
  // 변경 전
  // res.writeHead(302, { Location: `/checkout.html?ref=${encodeURIComponent(code)}` });

  // 변경 후
  res.writeHead(302, { Location: `/mock-storefront.html?ref=${encodeURIComponent(code)}` });

  res.end();
}

// POST /paymaster — LazorKit 지갑 SDK가 호출하는 JSON-RPC 스타일 paymaster 엔드포인트.
// 프론트와 같은 오리진(이 서버)에서 서빙되므로 CORS 문제 자체가 생기지 않음.
async function handlePaymasterRoute(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    });
    return res.end();
  }
  if (req.method !== "POST") {
    res.writeHead(405, { "Access-Control-Allow-Origin": "*" });
    return res.end();
  }
  const body = await readBody(req);
  const result = await handlePaymasterRpc(body);
  const json = JSON.stringify(result);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  return res.end(json);
}

// ---------------- 서버 ----------------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${APP_PORT}`);
    // 한글이 포함된 추천코드 등을 위해 각 경로 조각을 디코딩 (url.pathname은 퍼센트인코딩된 상태로 남아있음)
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    if (parts[0] === "api") return await handleApi(req, res, url, parts.slice(1));
    if (parts[0] === "mock-shop") return await handleMockShop(req, res, parts.slice(1));
    if (parts[0] === "go" && parts.length === 2) return await handleGoRedirect(req, res, parts[1]);
    if (parts[0] === "paymaster" && parts.length === 1) return await handlePaymasterRoute(req, res);
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    return sendJson(res, 500, { error: e.message });
  }
});

server.listen(APP_PORT, () => {
  console.log(`=== Linko 서버 실행 중 ===`);
  console.log(`http://localhost:${APP_PORT}`);
});
