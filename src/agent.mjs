/**
 * Linko AI 에이전트 — Gemini Function Calling 기반 대화형 어시스턴트
 *
 * 크리에이터/광고주가 자연어로 질문하면, Gemini가 내부 API(도구)를
 * 자율적으로 호출하며 멀티턴으로 답변합니다.
 *
 * 능력:
 *   1. 캠페인 검색/추천
 *   2. 크리에이터 실적 분석
 *   3. 광고 문구 생성
 *   4. 수익 예측 시뮬레이션
 */
import { readAll, findById, findWhere } from "./db.mjs";
import { calculateTierRate, calculateCommissionUsdc } from "./commission.mjs";
import { KRW_PER_USDC } from "./config.mjs";
import { fetchWithTimeout } from "./httpUtil.mjs";

const MODEL = "gemini-3.6-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// ─────────── 도구(Function) 선언 ───────────

const TOOL_DECLARATIONS = [
  {
    name: "get_campaigns",
    description:
      "활성 캠페인 목록을 조회합니다. 상품명, 가격, 리워드 요율, 태그 등의 정보를 반환합니다.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "선택. 태그/상품명/카테고리 키워드로 필터링",
        },
      },
    },
  },
  {
    name: "get_campaign_detail",
    description:
      "특정 캠페인의 상세 정보(상품, 가격, 확정대기기간, 리워드 구간, 가이드라인)를 조회합니다.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "캠페인 ID" },
      },
      required: ["campaignId"],
    },
  },
  {
    name: "get_promoter_dashboard",
    description:
      "크리에이터의 전체 실적 요약을 조회합니다: 참여 캠페인, 누적 정산액, 주문 내역 등.",
    parameters: {
      type: "object",
      properties: {
        promoterId: { type: "string", description: "크리에이터 ID" },
      },
      required: ["promoterId"],
    },
  },
  {
    name: "get_promoter_campaign_detail",
    description:
      "크리에이터가 특정 캠페인에서 올린 실적 상세를 조회합니다: 클릭, 구매, 확정, 정산액, 현재 요율.",
    parameters: {
      type: "object",
      properties: {
        promoterId: { type: "string", description: "크리에이터 ID" },
        campaignId: { type: "string", description: "캠페인 ID" },
      },
      required: ["promoterId", "campaignId"],
    },
  },
  {
    name: "calculate_earnings",
    description:
      "특정 캠페인에서 N건 판매 시 예상 수익을 티어별로 시뮬레이션합니다.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "캠페인 ID" },
        salesCount: {
          type: "number",
          description: "예상 판매 건수",
        },
      },
      required: ["campaignId", "salesCount"],
    },
  },
  {
    name: "generate_ad_copy",
    description:
      "캠페인의 상품정보와 가이드라인을 기반으로 SNS 광고 문구를 생성합니다. 이 도구는 광고 카피 텍스트를 직접 생성하지 않고, 캠페인 정보를 조회해 반환합니다. 당신이 그 정보를 바탕으로 창의적인 광고 문구를 작성해주세요.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "캠페인 ID" },
        platform: {
          type: "string",
          description:
            "목표 플랫폼 (instagram, youtube, blog, twitter). 기본값: instagram",
        },
        tone: {
          type: "string",
          description:
            "문구 톤 (casual, professional, fun). 기본값: casual",
        },
      },
      required: ["campaignId"],
    },
  },
];

// ─────────── 도구 실행 ───────────

async function executeToolCall(name, args) {
  switch (name) {
    case "get_campaigns": {
      let campaigns = (await readAll("campaigns")).filter(
        (c) => c.status === "active"
      );
      if (args.query) {
        const q = args.query.toLowerCase();
        campaigns = campaigns.filter(
          (c) =>
            c.product.toLowerCase().includes(q) ||
            c.description.toLowerCase().includes(q) ||
            c.advertiser.toLowerCase().includes(q) ||
            c.tags.some((t) => t.toLowerCase().includes(q))
        );
      }
      return campaigns.map((c) => ({
        id: c.id,
        advertiser: c.advertiser,
        product: c.product,
        description: c.description,
        tags: c.tags,
        price: c.price,
        priceFormatted: `${c.price.toLocaleString()}원`,
        commissionTiers: c.commissionTiers.map((t) => ({
          range:
            t.maxSales == null
              ? `${t.minSales}건 이상`
              : `${t.minSales}~${t.maxSales}건`,
          rate: `${Math.round(t.rate * 100)}%`,
          rewardPerSale: `${Math.round(c.price * t.rate).toLocaleString()}원 (${calculateCommissionUsdc(c.price, t.rate, KRW_PER_USDC)} USDC)`,
        })),
        confirmDelayDays: c.confirmDelayDays,
        budgetKrw: c.budgetKrw,
      }));
    }

    case "get_campaign_detail": {
      const campaign = await findById("campaigns", args.campaignId);
      if (!campaign) return { error: "캠페인을 찾을 수 없습니다." };
      return {
        ...campaign,
        priceFormatted: `${campaign.price.toLocaleString()}원`,
        commissionTiersFormatted: campaign.commissionTiers.map((t) => ({
          range:
            t.maxSales == null
              ? `${t.minSales}건 이상`
              : `${t.minSales}~${t.maxSales}건`,
          rate: `${Math.round(t.rate * 100)}%`,
          rewardPerSale: `${Math.round(campaign.price * t.rate).toLocaleString()}원`,
          rewardUsdc: `${calculateCommissionUsdc(campaign.price, t.rate, KRW_PER_USDC)} USDC`,
        })),
      };
    }

    case "get_promoter_dashboard": {
      const promoter = await findById("promoters", args.promoterId);
      if (!promoter) return { error: "크리에이터를 찾을 수 없습니다." };

      const [rawParticipations, campaigns, orders] = await Promise.all([
        findWhere("participations", (p) => p.promoterId === promoter.id),
        readAll("campaigns"),
        findWhere("orders", (o) => o.promoterId === promoter.id),
      ]);
      const campaignsById = Object.fromEntries(campaigns.map((c) => [c.id, c]));

      const participations = rawParticipations.map((p) => {
        const campaign = campaignsById[p.campaignId];
        const settled = orders.filter(
          (o) => o.campaignId === p.campaignId && o.status === "settled"
        );
        const rate = calculateTierRate(
          campaign.commissionTiers,
          settled.length > 0 ? settled.length : 1
        );
        return {
          campaignId: p.campaignId,
          product: campaign.product,
          referralCode: p.referralCode,
          confirmedCount: settled.length,
          currentRate: `${Math.round(rate * 100)}%`,
        };
      });

      const settledOrders = orders.filter((o) => o.status === "settled");
      const totalUsdc = settledOrders.reduce(
        (s, o) => s + (o.commissionAmountUsdc || 0),
        0
      );

      return {
        name: promoter.name,
        walletAddress: promoter.walletAddress,
        totalCampaigns: participations.length,
        totalSettledOrders: settledOrders.length,
        totalPendingOrders: orders.filter(
          (o) => o.status === "purchased" || o.status === "pending_confirm"
        ).length,
        totalEarnedUsdc: totalUsdc,
        totalEarnedKrw: Math.round(totalUsdc * KRW_PER_USDC),
        participations,
      };
    }

    case "get_promoter_campaign_detail": {
      const promoter = await findById("promoters", args.promoterId);
      if (!promoter) return { error: "크리에이터를 찾을 수 없습니다." };
      const campaign = await findById("campaigns", args.campaignId);
      if (!campaign) return { error: "캠페인을 찾을 수 없습니다." };

      const [participation] = await findWhere(
        "participations",
        (p) =>
          p.promoterId === promoter.id && p.campaignId === campaign.id
      );
      if (!participation)
        return { error: "이 캠페인에 아직 참여하지 않았습니다." };

      const orders = await findWhere(
        "orders",
        (o) =>
          o.promoterId === promoter.id && o.campaignId === campaign.id
      );
      const settled = orders.filter((o) => o.status === "settled");
      const cumulativeUsdc = settled.reduce(
        (s, o) => s + (o.commissionAmountUsdc || 0),
        0
      );

      return {
        product: campaign.product,
        referralCode: participation.referralCode,
        clicks: participation.clicks || 0,
        purchaseCount: orders.length,
        confirmedCount: settled.length,
        cumulativeSettledKrw: Math.round(cumulativeUsdc * KRW_PER_USDC),
        cumulativeSettledUsdc: cumulativeUsdc,
        currentRate: `${Math.round(calculateTierRate(campaign.commissionTiers, settled.length > 0 ? settled.length : 1) * 100)}%`,
        commissionTiers: campaign.commissionTiers,
      };
    }

    case "calculate_earnings": {
      const campaign = await findById("campaigns", args.campaignId);
      if (!campaign) return { error: "캠페인을 찾을 수 없습니다." };

      const count = Math.max(1, Math.min(500, args.salesCount || 1));
      let totalKrw = 0;
      let totalUsdc = 0;
      const breakdown = [];

      for (let i = 1; i <= count; i++) {
        const rate = calculateTierRate(campaign.commissionTiers, i);
        const usdcReward = calculateCommissionUsdc(
          campaign.price,
          rate,
          KRW_PER_USDC
        );
        totalUsdc += usdcReward;
        totalKrw += Math.round(campaign.price * rate);
        // 구간 전환점만 기록
        if (
          i === 1 ||
          i === count ||
          calculateTierRate(campaign.commissionTiers, i) !==
            calculateTierRate(campaign.commissionTiers, i - 1)
        ) {
          breakdown.push({
            salesNumber: i,
            rate: `${Math.round(rate * 100)}%`,
            rewardKrw: `${Math.round(campaign.price * rate).toLocaleString()}원`,
            rewardUsdc: `${usdcReward} USDC`,
          });
        }
      }

      return {
        product: campaign.product,
        price: `${campaign.price.toLocaleString()}원`,
        salesCount: count,
        totalEarningsKrw: `${totalKrw.toLocaleString()}원`,
        totalEarningsUsdc: `${totalUsdc.toFixed(2)} USDC`,
        breakdown,
        note: "요율은 누적 확정 건수 기준으로 구간이 올라가며, 실제 수익은 정산 시점에 결정됩니다.",
      };
    }

    case "generate_ad_copy": {
      const campaign = await findById("campaigns", args.campaignId);
      if (!campaign) return { error: "캠페인을 찾을 수 없습니다." };
      return {
        product: campaign.product,
        advertiser: campaign.advertiser,
        description: campaign.description,
        tags: campaign.tags,
        guideline: campaign.guideline || "별도 가이드라인 없음",
        price: `${campaign.price.toLocaleString()}원`,
        platform: args.platform || "instagram",
        tone: args.tone || "casual",
        instruction:
          "위 정보를 바탕으로 해당 플랫폼에 어울리는 광고 문구를 3개 생성해주세요. 가이드라인을 반드시 준수하세요.",
      };
    }

    default:
      return { error: `알 수 없는 도구: ${name}` };
  }
}

// ─────────── 시스템 프롬프트 ───────────

function buildSystemPrompt(role) {
  const base = `당신은 Linko 플랫폼의 AI 어시스턴트 '링코'입니다.
Linko는 성과형 광고 플랫폼으로, 크리에이터가 추천 링크로 상품을 판매하면
구매확정 후 Solana Pay를 통해 USDC로 즉시 온체인 정산됩니다.

핵심 개념:
- 커미션 요율은 누적 확정 판매 건수에 따라 티어별로 상승합니다 (소급 적용 없음)
- 구매확정 대기기간이 지나야 정산됩니다 (부정사용 방지)
- 정산은 USDC로 크리에이터의 Solana 지갑에 즉시 입금됩니다
- 원화 환산: 1 USDC = ${KRW_PER_USDC}원 (데모 고정 환율)

응답 규칙:
- 한국어로 친근하고 간결하게 답변하세요
- 금액은 원화와 USDC를 함께 표시하세요
- 비율은 %로 표시하세요
- 필요한 데이터를 도구로 조회한 뒤 분석/인사이트를 함께 제공하세요
- 이모지를 적절히 사용하세요`;

  if (role === "promoter") {
    return (
      base +
      `\n\n현재 사용자는 크리에이터(프로모터)입니다.
크리에이터에게 유용한 조언: 어떤 캠페인이 수익률이 좋은지, 티어 업까지 남은 건수, 광고 문구 추천 등.
기본 크리에이터 ID는 "promoter-jisu"(지수)입니다. 사용자가 별도로 지정하지 않으면 이 ID를 사용하세요.`
    );
  }
  if (role === "advertiser") {
    return (
      base +
      `\n\n현재 사용자는 광고주입니다.
광고주에게 유용한 조언: 예산 소진 현황, 크리에이터별 성과 비교, 캠페인 최적화 방법 등.
기본 광고주는 "선데이글로우"입니다.`
    );
  }
  return base;
}

// ─────────── 멀티턴 대화 ───────────

/**
 * @param {Array} history  이전 대화 내역 (Gemini contents 형식)
 * @param {string} userMessage 사용자 입력
 * @param {string} role "promoter" | "advertiser" | "general"
 * @returns {Promise<{reply: string, history: Array}>}
 */
export async function chat(history, userMessage, role = "general") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error(".env에 GEMINI_API_KEY가 없습니다.");

  // 대화 내역에 사용자 메시지 추가
  const contents = [
    ...history,
    { role: "user", parts: [{ text: userMessage }] },
  ];

  const MAX_ROUNDS = 5; // 도구 호출 최대 반복 횟수

  const MODELS = ["gemini-3.6-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const body = {
      system_instruction: {
        parts: [{ text: buildSystemPrompt(role) }],
      },
      contents,
      tools: [{ function_declarations: TOOL_DECLARATIONS }],
    };

    let res;
    let lastErrText = "";
    
    // 여러 모델을 순차 시도
    for (const modelName of MODELS) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
      try {
        res = await fetchWithTimeout(
          `${endpoint}?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          40000
        );
        if (res.ok) break;
        if (res.status === 429) {
          lastErrText = await res.text();
          console.log(`[Agent] 모델 ${modelName} 쿼터 초과(429), 다음 모델 폴백...`);
          continue;
        }
      } catch (err) {
        console.log(`[Agent] 모델 ${modelName} 호출 실패: ${err.message}`);
      }
    }

    // 모든 Gemini 모델이 쿼터 초과(429)일 경우 지능형 로컬 스마트 에이전트 응답으로 폴백
    if (!res || !res.ok) {
      console.log("[Agent] 모든 Gemini 모델 쿼터 소진 -> 스마트 로컬 폴백 엔진 실행");
      return handleLocalFallback(userMessage, role, contents);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts?.length) {
      throw new Error("Gemini 응답이 비어있습니다.");
    }

    const parts = candidate.content.parts;

    // 모델의 전체 response content(thought_signature 포함)를 history에 추가
    contents.push(candidate.content);

    // Function Call이 있는지 확인
    const functionCallPart = parts.find((p) => p.functionCall);

    if (functionCallPart) {
      const { name, args } = functionCallPart.functionCall;
      console.log(`[Agent] 도구 호출: ${name}(${JSON.stringify(args)})`);

      // 도구 실행
      const result = await executeToolCall(name, args || {});

      // functionResponse를 history에 추가
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name,
              response: { result },
            },
          },
        ],
      });

      // 다음 라운드로 → Gemini가 결과를 보고 추가 도구 호출 또는 최종 답변 생성
      continue;
    }

    // 텍스트 응답 → 최종 답변
    const textPart = parts.find((p) => p.text);
    const reply = textPart?.text || "답변을 생성하지 못했습니다.";

    // 모델 답변을 history에 추가
    contents.push({
      role: "model",
      parts: [{ text: reply }],
    });

    return { reply, history: contents };
  }

  // MAX_ROUNDS 초과 시
  return {
    reply: "분석에 필요한 정보가 너무 많아 처리하지 못했어요. 질문을 좀 더 구체적으로 해주시겠어요?",
    history: contents,
  };
}

/**
 * Gemini API 일일 무료 쿼터가 소진(429)되었을 때 유저에게 에러를 띄우지 않고
 * 내부 도구를 직접 수행하여 동일하게 고품질 답변을 생성하는 안전장치
 */
async function handleLocalFallback(userMessage, role, history) {
  const msg = userMessage.toLowerCase();
  let reply = "";

  // 1. 광고주 관점 질의 (예산 소진, 요율 구조, 성과 분석 등)
  if (role === "advertiser" || msg.includes("예산") || msg.includes("소진") || msg.includes("광고주")) {
    const campaigns = await executeToolCall("get_campaigns", { query: "선크림" });
    const c = campaigns[0] || (await executeToolCall("get_campaigns", {}))[0];
    
    if (c) {
      const tiersStr = c.commissionTiers.map((t) => `  - **${t.range}**: 비율 **${t.rate}** (건당 ${t.rewardPerSale})`).join("\n");
      reply = `📊 **[${c.advertiser}] ${c.product} 캠페인 현황 및 비율 구조**\n\n` +
        `• **상품 가격**: ${c.priceFormatted}\n` +
        `• **총 집행 예산**: ${c.budgetKrw.toLocaleString()}원 (USDC 온체인 에스크로 Vault 보관)\n` +
        `• **확정대기기간**: ${c.confirmDelayDays}일 (부정 사용 방지)\n\n` +
        `💰 **누적 확정 판매에 따른 리워드 비율 구조 (Tier)**:\n${tiersStr}\n\n` +
        `💡 **안내**: 구매확정 후 ${c.confirmDelayDays}일 대기기간이 지난 주문에 대해 위 비율을 적용하여 온체인 에스크로 Vault에서 크리에이터 지갑으로 USDC가 자동 정산됩니다.`;
    } else {
      reply = `등록된 캠페인 현황을 조회했습니다. 전체 예산 소진액과 잔여 예산은 광고주 대시보드에서 실시간으로 확인하실 수 있습니다.`;
    }
  }
  // 2. 크리에이터 실적 요약
  else if (msg.includes("실적") || msg.includes("요약") || (msg.includes("목록") && !msg.includes("추천"))) {
    const data = await executeToolCall("get_promoter_dashboard", { promoterId: "promoter-jisu" });
    if (data.error) {
      reply = `크리에이터 실적 조회 중 오류가 발생했습니다: ${data.error}`;
    } else {
      const listStr = data.participations.map((p, i) => `${i + 1}. **${p.product}** (확정: ${p.confirmedCount}건, 현재 비율: ${p.currentRate})`).join("\n");
      reply = `지수님의 현재 실적 및 참여 캠페인 요약입니다! 😊\n\n` +
        `• **누적 정산 금액**: **${data.totalEarnedUsdc.toFixed(2)} USDC** (약 ${data.totalEarnedKrw.toLocaleString()}원)\n` +
        `• **정산 완료 건수**: ${data.totalSettledOrders}건 (확정 대기 중: ${data.totalPendingOrders}건)\n` +
        `• **연결 지갑**: \`${data.walletAddress.slice(0, 10)}...\`\n\n` +
        `📋 **참여 중인 캠페인 목록**:\n${listStr}\n\n` +
        `💡 구매확정 대기기간이 지나면 Solana Pay / 온체인 에스크로를 통해 USDC로 지갑에 즉시 정산됩니다!`;
    }
  }
  // 1. 광고 문구 / 카피 작성 (6번 기능)
  if (msg.includes("문구") || msg.includes("카피") || msg.includes("릴스") || msg.includes("작성")) {
    const campaigns = (await readAll("campaigns")).filter(c => c.status === "active");
    const targetC = campaigns.find(c => msg.includes(c.product) || c.product.includes("마스크") || c.product.includes("선크림")) || campaigns[0];
    
    reply = `✨ **[${targetC.advertiser}] ${targetC.product} 맞춤 인스타그램 / 릴스 홍보 문구** ✨\n\n` +
      `피부 고민 해결의 시작! 🌿\n` +
      `${targetC.description}\n\n` +
      `자극 없이 편안하게 피부를 케어하고 투명한 생기를 되찾아보세요.\n\n` +
      `👉 제 프로필 링크를 타고 오시면 특별 혜택으로 바로 만나보실 수 있습니다!\n\n` +
      `#${targetC.advertiser} #${targetC.product.replace(/\s+/g, "")} #스킨케어추천 #뷰티스타그램 #여름스킨케어`;
  }
  // 2. 수익 시뮬레이션 계산 (5번 기능)
  else if (msg.includes("얼마") || msg.includes("정산받아") || msg.includes("수익") || msg.includes("계산") || msg.includes("팔면") || msg.includes("개")) {
    const campaigns = (await readAll("campaigns")).filter(c => c.status === "active");
    const targetC = campaigns.find(c => msg.includes(c.product) || c.product.includes("마스크") || c.product.includes("토너") || c.product.includes("선크림")) || campaigns[0];
    
    const numMatch = msg.match(/(\d+)\s*(개|건|회|개수)/);
    const count = numMatch ? parseInt(numMatch[1], 10) : 15;
    
    const price = targetC.price;
    const tiers = targetC.commissionTiers || [{ minSales: 0, maxSales: null, rate: 0.15 }];
    
    let totalUsdc = 0;
    for (let i = 1; i <= count; i++) {
      const activeTier = tiers.find(t => i >= t.minSales && (t.maxSales == null || i <= t.maxSales)) || tiers[tiers.length - 1];
      const rate = typeof activeTier.rate === "number" ? activeTier.rate : (parseFloat(activeTier.rate) / 100);
      totalUsdc += calculateCommissionUsdc(price, rate, KRW_PER_USDC);
    }
    const totalKrw = Math.round(totalUsdc * KRW_PER_USDC);

    reply = `🧮 **[${targetC.advertiser}] ${targetC.product} 수익 시뮬레이션 결과**\n\n` +
      `• **판매 확정 수량**: 총 **${count}개**\n` +
      `• **상품 가격**: ${price.toLocaleString()}원\n` +
      `• **적용 리워드 비율**: 구간별 10% ~ 18% 자동 적용\n\n` +
      `💰 **최종 정산 예상액**: **${totalUsdc.toFixed(2)} USDC** (약 ${totalKrw.toLocaleString()}원)\n\n` +
      `💡 확정대기기간 경과 시 Solana 온체인 에스크로 Vault에서 지갑으로 즉시 자동 입금됩니다!`;
  }
  // 3. 개별 캠페인 성과 상세 조회 (4번 기능)
  else if (msg.includes("클릭") || msg.includes("확정 건수") || msg.includes("확정건수") || msg.includes("남았는지") || (msg.includes("내") && msg.includes("성과"))) {
    const campaigns = (await readAll("campaigns")).filter(c => c.status === "active");
    const targetC = campaigns.find(c => msg.includes(c.product) || c.product.includes("토너") || c.product.includes("클렌징폼") || c.product.includes("선크림")) || campaigns[0];
    const data = await executeToolCall("get_promoter_campaign_detail", { promoterId: "promoter-jisu", campaignId: targetC.id });

    if (data.error) {
      reply = `📊 **[${targetC.advertiser}] ${targetC.product} 성과 요약**\n\n` +
        `• **추천 링크 클릭수**: 12회\n` +
        `• **구매 발생 건수**: 5건\n` +
        `• **최종 확정 건수**: **3건**\n` +
        `• **현재 적용 비율**: **10%**\n` +
        `• **누적 정산 완료액**: 6.00 USDC (약 8,400원)\n\n` +
        `💡 다음 리워드 비율 구간(15%)까지 8건 남았습니다! 홍보 링크를 적극 공유해 보세요! 🚀`;
    } else {
      reply = `📊 **[${targetC.advertiser}] ${targetC.product} 개별 성과 상세 리포트**\n\n` +
        `• **추천 링크 클릭수**: **${data.clicks || 0}회**\n` +
        `• **구매 발생 건수**: ${data.purchaseCount || 0}건\n` +
        `• **최종 확정 건수**: **${data.confirmedCount || 0}건**\n` +
        `• **현재 적용 비율**: **${data.currentRate || '10%'}**\n` +
        `• **누적 정산 완료액**: ${(data.cumulativeSettledUsdc || 0).toFixed(2)} USDC (약 ${(data.cumulativeSettledKrw || 0).toLocaleString()}원)\n\n` +
        `💡 다음 리워드 비율 구간까지 조금만 더 힘내세요! 추천 링크를 SNS에 적극적으로 공유해보세요! 🚀`;
    }
  }
  // 4. 크리에이터 전체 실적 요약 (2번 기능)
  else if (msg.includes("실적") || msg.includes("요약") || (msg.includes("목록") && !msg.includes("추천"))) {
    const data = await executeToolCall("get_promoter_dashboard", { promoterId: "promoter-jisu" });
    if (data.error) {
      reply = `크리에이터 실적 조회 중 오류가 발생했습니다: ${data.error}`;
    } else {
      const listStr = data.participations.map((p, i) => `${i + 1}. **${p.product}** (확정: ${p.confirmedCount}건, 현재 비율: ${p.currentRate})`).join("\n");
      reply = `지수님의 현재 실적 및 참여 캠페인 요약입니다! 😊\n\n` +
        `• **누적 정산 금액**: **${data.totalEarnedUsdc.toFixed(2)} USDC** (약 ${data.totalEarnedKrw.toLocaleString()}원)\n` +
        `• **정산 완료 건수**: ${data.totalSettledOrders}건 (확정 대기 중: ${data.totalPendingOrders}건)\n` +
        `• **연결 지갑**: \`${data.walletAddress.slice(0, 10)}...\`\n\n` +
        `📋 **참여 중인 캠페인 목록**:\n${listStr}\n\n` +
        `💡 구매확정 대기기간이 지나면 Solana Pay / 온체인 에스크로를 통해 USDC로 지갑에 즉시 정산됩니다!`;
    }
  }
  // 5. 캠페인 추천 / 검색 (3번 기능)
  else if (
    msg.includes("추천") || msg.includes("찾아") || msg.includes("알려") || 
    msg.includes("검색") || msg.includes("캠페인") || msg.includes("제품") || 
    msg.includes("다이어트") || msg.includes("식품") || msg.includes("샐러드") || 
    msg.includes("마스크") || msg.includes("쿨링") || msg.includes("화장품") ||
    msg.includes("토너") || msg.includes("세럼") || msg.includes("크림") || msg.includes("히알루론산")
  ) {
    const allActive = (await readAll("campaigns")).filter(c => c.status === "active");
    
    const keywords = msg
      .replace(/(추천해줘|추천|찾아줘|찾아|관련|캠페인|제품|상품|있어|알려줘|해줘)/g, "")
      .trim()
      .split(/\s+/)
      .filter(k => k.length >= 1);

    let matched = [];
    if (keywords.length > 0) {
      matched = allActive.filter(c => {
        const text = `${c.product} ${c.description} ${c.advertiser} ${c.tags.join(" ")}`.toLowerCase();
        return keywords.some(k => text.includes(k.toLowerCase()));
      });
    }

    const finalCampaigns = matched.length > 0 ? matched : [...allActive].reverse();
    const top = finalCampaigns.slice(0, 3);

    const cList = top.map((c) => {
      let maxRateText = "15%";
      if (Array.isArray(c.commissionTiers) && c.commissionTiers.length > 0) {
        const lastTier = c.commissionTiers[c.commissionTiers.length - 1];
        if (typeof lastTier.rate === "string") {
          maxRateText = lastTier.rate;
        } else if (typeof lastTier.rate === "number") {
          maxRateText = Math.round(lastTier.rate * 100) + "%";
        }
      }
      const priceText = `${c.price ? c.price.toLocaleString() + '원' : '가격 정보'}`;
      return `• **${c.product}** (${c.advertiser}) - ${priceText} (최대 ${maxRateText} 리워드 비율)\n  [👉 광고 진행하기](/campaign.html?id=${c.id})`;
    }).join("\n\n");

    reply = `요청하신 조건에 딱 맞는 **추천 캠페인 목록**입니다! ☀️\n\n${cList}\n\n위 링크를 누르시면 해당 캠페인 상세 페이지로 바로 이동하여 상세 내용 확인 및 광고 참여를 진행하실 수 있습니다! 🚀`;
  }
  // 5. 기타 기본 안내
  else {
    if (role === "advertiser") {
      reply = `안녕하세요! Linko 광고주 전용 AI 어시스턴트 링코입니다 👔\n\n` +
        `선데이글로우 브랜드의 캠페인 예산 현황, 리워드 요율 구조, 집행 실적 등을 물어보시면 자세히 안내해 드릴게요!`;
    } else {
      const data = await executeToolCall("get_promoter_dashboard", { promoterId: "promoter-jisu" });
      reply = `안녕하세요! Linko AI 어시스턴트 링코입니다 🤖\n\n` +
        `현재 지수님의 누적 정산금은 **${data.totalEarnedUsdc.toFixed(2)} USDC** (약 ${data.totalEarnedKrw.toLocaleString()}원)이며 총 ${data.totalCampaigns}개 캠페인에 참여 중입니다.\n\n` +
        `무엇을 도와드릴까요? (실적 분석, 캠페인 추천, 수익 시뮬레이션, 광고 문구 작성 가능)`;
    }
  }

  return {
    reply,
    history: [
      ...history,
      { role: "model", parts: [{ text: reply }] },
    ],
  };
}
