/**
 * 캠페인 성과 분석 에이전트 (Agent Card: linko-campaign-analyst)
 * 광고주의 활성 캠페인을 조사해 캠페인별 성과 점수를 매기고, 예산분배 에이전트에게
 * A2A 메시지로 넘길 성과 리포트를 만든다. 판단만 하고 아무 것도 바꾸지 않는다.
 */
import { readAll, findById, findWhere } from "../db.mjs";
import { runAgentLoop } from "./geminiAgentRunner.mjs";

const AGENT_CARD = {
  name: "linko-campaign-analyst",
  displayName: "캠페인 성과 분석 에이전트",
  version: "1.0.0",
  capabilities: ["campaign_performance_analysis", "trend_detection"],
};

const CANCEL_EXCLUDE_THRESHOLD = 0.15;

const SYSTEM_PROMPT = `당신은 Linko의 캠페인 성과 분석 에이전트입니다.
도구를 사용해 광고주의 활성 캠페인을 하나씩 조사하고, 각 캠페인을 0~100점으로 평가하세요.

판단 기준(우선순위 순): 확정 전환율 > 예산소진율 > 모멘텀 > 취소율 > 참여 크리에이터 수
- 취소율이 ${Math.round(CANCEL_EXCLUDE_THRESHOLD * 100)}%를 초과하면 반드시 signal:"exclude"로 표시하세요.
- 예산소진율이 높으면서 전환율도 높은 캠페인은 우선순위를 높이세요(고갈 임박).
- 모든 활성 캠페인을 조사하기 전까지는 최종 답변을 내지 마세요.

최종 답변은 지정된 JSON 스키마로만 출력하되, summary 필드에 전체 캠페인을 종합한 총평을
2~3문장으로 반드시 남기세요(개별 캠페인 reasoning과 별개로, 이번 조사 전체에 대한 생각).`;

const TOOLS = [
  {
    name: "list_active_campaigns",
    description: "광고주의 활성 캠페인 기본 목록을 조회합니다.",
    parameters: {
      type: "object",
      properties: { advertiserId: { type: "string", description: "광고주 계정 id" } },
      required: ["advertiserId"],
    },
  },
  {
    name: "get_campaign_metrics",
    description: "캠페인의 확정 전환율/예산소진율/취소율/참여 크리에이터 수를 조회합니다(서버가 계산한 값).",
    parameters: {
      type: "object",
      properties: { campaignId: { type: "string" } },
      required: ["campaignId"],
    },
  },
  {
    name: "get_campaign_momentum",
    description: "최근 N일과 이전 N일의 확정 건수를 비교합니다(서버가 계산한 값).",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        days: { type: "number", description: "비교 기간(일), 기본 7" },
      },
      required: ["campaignId"],
    },
  },
];

async function listActiveCampaigns(advertiserId) {
  const campaigns = await findWhere("campaigns", (c) => c.advertiserId === advertiserId && c.status === "active");
  return Promise.all(
    campaigns.map(async (c) => ({
      id: c.id,
      product: c.product,
      budgetUsdc: c.budgetUsdc ?? 0,
      spentUsdc: await computeSpentUsdc(c.id),
    }))
  );
}

async function computeSpentUsdc(campaignId) {
  const settled = await findWhere("orders", (o) => o.campaignId === campaignId && o.status === "settled");
  return settled.reduce((s, o) => s + (o.commissionAmountUsdc || 0), 0);
}

async function getCampaignMetrics(campaignId) {
  const campaign = await findById("campaigns", campaignId);
  if (!campaign) return { error: "캠페인을 찾을 수 없습니다." };

  const orders = await findWhere("orders", (o) => o.campaignId === campaignId);
  const settled = orders.filter((o) => o.status === "settled");
  const cancelled = orders.filter((o) => o.status === "cancelled");
  const participations = await findWhere("participations", (p) => p.campaignId === campaignId);
  const clicks = participations.reduce((s, p) => s + (p.clicks || 0), 0);

  const spentUsdc = await computeSpentUsdc(campaignId);
  const budgetUsdc = campaign.budgetUsdc ?? 0;

  return {
    conversionRate: clicks > 0 ? round4(settled.length / clicks) : 0,
    budgetUsedRate: budgetUsdc > 0 ? round4(spentUsdc / budgetUsdc) : 0,
    cancelRate: orders.length > 0 ? round4(cancelled.length / orders.length) : 0,
    creatorCount: new Set(participations.map((p) => p.promoterId)).size,
    totalOrders: orders.length,
  };
}

async function getCampaignMomentum(campaignId, days = 7) {
  const campaign = await findById("campaigns", campaignId);
  if (!campaign) return { error: "캠페인을 찾을 수 없습니다." };

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const settled = await findWhere("orders", (o) => o.campaignId === campaignId && o.status === "settled" && o.settledAt);

  const recentCount = settled.filter((o) => now - new Date(o.settledAt).getTime() <= days * dayMs).length;
  const previousCount = settled.filter((o) => {
    const age = now - new Date(o.settledAt).getTime();
    return age > days * dayMs && age <= 2 * days * dayMs;
  }).length;

  // 이전 기간에 확정 건수가 0이면 나눗셈이 무의미해서, 최근 활동 유무로만 완만하게 판단
  const momentumRatio = previousCount > 0 ? round4(recentCount / previousCount) : recentCount > 0 ? 2 : 1;

  return { recentCount, previousCount, momentumRatio };
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

async function executeToolCall(name, args) {
  switch (name) {
    case "list_active_campaigns":
      return listActiveCampaigns(args.advertiserId);
    case "get_campaign_metrics":
      return getCampaignMetrics(args.campaignId);
    case "get_campaign_momentum":
      return getCampaignMomentum(args.campaignId, args.days || 7);
    default:
      return { error: `알 수 없는 도구: ${name}` };
  }
}

const JSON_INSTRUCTION = `이제 지금까지 조사한 내용을 바탕으로 최종 결과만 아래 스키마의 JSON으로 출력하세요.
설명 문장 없이 JSON 객체 하나만 출력하세요.
{
  "advertiserId": string,
  "summary": string,
  "campaigns": [
    {
      "campaignId": string,
      "product": string,
      "performanceScore": number,   // 0~100
      "signal": "strong" | "weak" | "exclude",
      "metrics": { "conversionRate": number, "budgetUsedRate": number, "momentum": number, "cancelRate": number },
      "reasoning": string
    }
  ]
}`;

/**
 * 로컬 폴백: Gemini API가 전부 실패했을 때(쿼터 소진 등) 서버가 직접 규칙 기반으로
 * 점수를 매김 — agent.mjs의 handleLocalFallback과 같은 철학.
 */
async function localFallback(advertiserId) {
  const activeCampaigns = await listActiveCampaigns(advertiserId);
  const campaigns = await Promise.all(
    activeCampaigns.map(async (c) => {
      const metrics = await getCampaignMetrics(c.id);
      const momentum = (await getCampaignMomentum(c.id)).momentumRatio;
      const score = Math.max(
        0,
        Math.min(100, Math.round(metrics.conversionRate * 300 + metrics.budgetUsedRate * 20 - metrics.cancelRate * 200 + (momentum - 1) * 10))
      );
      const signal = metrics.cancelRate > CANCEL_EXCLUDE_THRESHOLD ? "exclude" : score >= 60 ? "strong" : "weak";
      return {
        campaignId: c.id,
        product: c.product,
        performanceScore: score,
        signal,
        metrics: { conversionRate: metrics.conversionRate, budgetUsedRate: metrics.budgetUsedRate, momentum, cancelRate: metrics.cancelRate },
        reasoning: "Gemini API를 쓸 수 없어 서버 규칙 기반으로 계산한 점수입니다.",
      };
    })
  );
  return {
    advertiserId,
    summary: `Gemini 응답을 받지 못해 규칙 기반 폴백으로 ${campaigns.length}개 캠페인을 평가했습니다.`,
    campaigns,
    usedFallback: true,
  };
}

/**
 * @param {{advertiserId: string}} params
 * @returns {Promise<{output:object, transcript:object[]}>}
 */
export async function runAnalystAgent({ advertiserId }) {
  const initialMessage = JSON.stringify({
    advertiserId,
    instruction: "list_active_campaigns로 시작해서 이 광고주의 활성 캠페인을 전부 조사하세요.",
  });

  try {
    const { output, transcript } = await runAgentLoop({
      systemPrompt: SYSTEM_PROMPT,
      tools: TOOLS,
      initialMessage,
      executeToolCall,
      jsonInstruction: JSON_INSTRUCTION,
    });
    return { output, transcript, usedFallback: false };
  } catch (e) {
    console.log(`[analystAgent] Gemini 실패 → 로컬 폴백: ${e.message}`);
    return { output: await localFallback(advertiserId), transcript: [{ type: "fallback", reason: e.message }], usedFallback: true };
  }
}

export const analystAgentCard = AGENT_CARD;
