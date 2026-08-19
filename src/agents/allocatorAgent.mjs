/**
 * 예산 배분 에이전트 (Agent Card: linko-budget-allocator)
 * 분석 에이전트의 A2A 메시지(성과 리포트 + suggestedWeight)를 받아 캠페인별 배분 비율을
 * 결정하고 실제로 반영하는, 유일하게 상태를 바꾸는 에이전트.
 *
 * apply_topup이 승인한 배분은 budgetCampaign()으로 Budget PDA -> 캠페인 Vault 실제 온체인
 * 트랜잭션을 보내고, 성공했을 때만 campaigns.json(budgetUsdc/budgetKrw)에 미러링한다.
 */
import { findById, update } from "../db.mjs";
import { KRW_PER_USDC } from "../config.mjs";
import { budgetCampaign } from "../escrow.mjs";
import { runAgentLoop } from "./geminiAgentRunner.mjs";

const AGENT_CARD = {
  name: "linko-budget-allocator",
  displayName: "예산 재분배 에이전트",
  version: "1.0.0",
  capabilities: ["budget_reallocation"],
};

const WEIGHT_CAP = 0.5;
const POOL_EPSILON_USDC = 1; // round() 누적 오차 허용치

// budgetRebalanceOrchestrator.mjs와 동일한 임시 스위치 — 켜져 있으면 실제 budgetCampaign() 온체인
// 호출 없이 campaigns.json만 갱신한다(devnet 배포 전 A2A 전체 흐름 테스트용).
const SIMULATE = process.env.BUDGET_AGENT_SIMULATE === "true";

const SYSTEM_PROMPT = `당신은 Linko의 예산 배분 에이전트입니다.
poolUsdc는 광고주의 예비 예산(Budget Vault)에 현재 들어있는 전체 잔액입니다 — 반드시 다
써야 하는 할당량이 아닙니다. 이번 라운드에 배분할 만큼 성과가 확실한 캠페인이 없다면 그만큼
(또는 전부) 남겨두세요. 남긴 금액은 Vault 밖으로 나가지 않고 그대로 남아 다음 실행 때 다시
검토됩니다 — 그러니 애매하면 보수적으로 판단해도 괜찮습니다.

suggestedWeight들의 합은 캠페인 전반의 성과 수준에 따라 이미 100%보다 낮게 계산돼 있을 수
있습니다(성과가 약할수록 baseline 총합 자체가 낮아짐). 어떤 캠페인을 제외하거나 낮게
평가했다고 해서, 그 여유분을 다른 캠페인 상한까지 끌어올려 "채워 넣을" 필요는 없습니다 —
각 캠페인은 그 캠페인 자체의 신호로만 판단하세요.

분석 에이전트가 제공한 캠페인별 성과 리포트를 보면 각 캠페인에 suggestedWeight(성과 점수 비례
배분 기준선, 서버가 미리 계산함)가 붙어있습니다.

이 기준선을 그대로 쓰거나, 아래 신호가 있을 때만 조정한 weight(비율, 0~1)를 최종 결정하세요.
금액(USDC)은 직접 계산하지 마세요 — apply_topup에는 weight만 넘기면 서버가 환산합니다.

조정 신호 (기준선 대비):
- budgetUsedRate >= 0.85 → 최대 +0.15 (예산 고갈 임박, 방치하면 기회손실)
- momentum >= 1.5 → 최대 +0.10 (추세 꺾이기 전에 밀어줘야 효율적)
- totalOrders < 5 또는 참여 크리에이터 < 2 → 최대 -0.15 (표본 부족, 보수적으로)
- cancelRate가 0.10~0.15 사이 → 최대 -0.10 (exclude 임계값에 근접, 주의)
같은 방향 신호는 더하되 총 조정폭은 기준선 대비 ±0.2를 넘기지 마세요. 신호가 반대 방향으로
충돌하면 더 최근 추세인 momentum을 우선하고, 그 상충 사실 자체를 reason에 남기세요.

규칙:
1. signal이 "exclude"인 캠페인은 weight 반드시 0 — 이 경우 apply_topup을 호출하지 마세요(불필요한 트랜잭션 방지)
2. 한 캠페인의 weight는 ${WEIGHT_CAP}를 초과할 수 없음
3. suggestedWeight에서 벗어나게 결정했다면, 어떤 신호 때문인지 reason에 반드시 남기세요

reason 작성 규칙 (매우 중요 — apply_topup의 reason은 광고주가 그대로 읽는 문구입니다):
- momentum, 기준선, weight, 수치 비교(예: "2.0 >= 1.5") 같은 내부 로직 용어는 절대 쓰지 마세요. 쉬운 말로, 그러나 전문적인 어투로 쓰세요.
- 반드시 두괄식으로 시작하세요: "[캠페인명]에 [금액] USDC를 추가로 배분했습니다." (감액/보류 시에는 "[캠페인명]은 이번에 배분을 줄였습니다." 처럼)
- 이어서 1~2문장으로 이유를 쉬운 말로 설명하고, "~하는 것이 효율적이라고 판단했습니다" 또는 "~하는 것이 안전하다고 판단했습니다"로 마무리하세요.
- 전체 3문장을 넘기지 마세요.
- 확신 있는 어투로 단정해서 쓰세요. "~것 같습니다", "~일 수도 있습니다", "아마" 같은 애매한 표현은 쓰지 마세요 — 이미 데이터를 분석해서 내린 결정이니, 그 판단을 확신 있게 전달하세요.

예시:
1. (판매 속도 상승) "테스트 캠페인 B에 1.21 USDC를 추가로 배분했습니다. 최근 판매 속도가 빨라지고 있어서, 이 흐름을 유지할 수 있도록 예산을 추가 배분하는 것이 효율적이라고 판단했습니다."
2. (예산 소진 임박) "무기자차 선크림에 3.5 USDC를 추가로 배분했습니다. 배정된 예산이 곧 소진될 예정이라, 판매 기회를 놓치지 않도록 예산을 미리 늘리는 것이 효율적이라고 판단했습니다."
3. (표본 부족) "테스트 캠페인 A는 이번에 예산을 배분하지 않았습니다. 아직 주문과 참여 크리에이터 수가 적어 성과를 판단하기엔 이르다고 보고, 좀 더 지켜본 뒤 다시 검토하는 것이 안전하다고 판단했습니다."
4. (취소율 상승 조짐) "OO 캠페인은 이번에 배분을 줄였습니다. 최근 주문 취소 비율이 조금씩 높아지고 있어서, 추이를 지켜보며 신중하게 접근하는 것이 안전하다고 판단했습니다."

weight>0인 캠페인마다 apply_topup 도구를 호출해 실제로 반영하세요.
모든 배분을 마친 뒤에는 이번 실행 전체를 종합한 총평만 최종 출력하세요(개별 금액은 다시 계산해서 적지 마세요).`;

const TOOLS = [
  {
    name: "get_campaign_budget_state",
    description: "캠페인의 현재 budgetUsdc/spentUsdc를 재조회합니다(필요할 때만).",
    parameters: {
      type: "object",
      properties: { campaignId: { type: "string" } },
      required: ["campaignId"],
    },
  },
  {
    name: "apply_topup",
    description: "결정한 weight(0~1 비율)로 캠페인에 실제 배분을 반영합니다. 금액은 서버가 계산합니다.",
    parameters: {
      type: "object",
      properties: {
        campaignId: { type: "string" },
        weight: { type: "number", description: "이 캠페인에 배분할 풀 대비 비율 (0~0.5)" },
        reason: { type: "string", description: "이 비율을 선택한 이유 (기준선과 다르면 어떤 신호 때문인지)" },
      },
      required: ["campaignId", "weight", "reason"],
    },
  },
];

const JSON_INSTRUCTION = `이번 실행 전체를 종합한 총평만 아래 스키마의 JSON으로 출력하세요.
개별 캠페인 금액은 이미 apply_topup 결과로 반영됐으니 다시 계산하지 마세요.
{ "summary": string }

summary 작성 규칙 (매우 중요 — 광고주가 이 화면에서 제일 먼저 읽는 문구입니다):
- momentum, 기준선, weight, 수치 비교(예: "0.20 -> 0.05") 같은 내부 로직 용어는 절대 쓰지 마세요. 쉬운 말로, 그러나 전문적인 어투로 쓰세요.
- 반드시 두괄식으로 시작하세요: "이번 판단에서는 [N]개 캠페인에 총 [금액] USDC를 배분했습니다."
- 이어서 1~2문장으로 전체적인 판단 기준(어떤 캠페인에 왜 늘리고 줄였는지)을 쉬운 말로 요약하세요.
- 전체 3문장을 넘기지 마세요.
- 확신 있는 어투로 단정해서 쓰세요. "~것 같습니다", "~일 수도 있습니다", "아마" 같은 애매한 표현은 쓰지 마세요.

예시: "이번 판단에서는 3개 캠페인에 총 12.86 USDC를 배분했습니다. 판매 속도가 빨라지고 있거나 이미 안정적인 성과를 내는 캠페인 위주로 예산을 늘렸고, 아직 참여 크리에이터와 주문 실적이 충분히 쌓이지 않은 캠페인은 이번엔 배분에서 제외했습니다."`;

async function getCampaignBudgetState(campaignId) {
  const campaign = await findById("campaigns", campaignId);
  if (!campaign) return { error: "캠페인을 찾을 수 없습니다." };
  const budgetUsdc = campaign.budgetUsdc ?? 0;
  const spentUsdc = campaign.spentUsdc ?? 0;
  return { budgetUsdc, spentUsdc, remainingUsdc: Math.max(0, budgetUsdc - spentUsdc) };
}

/**
 * Budget PDA -> 캠페인 Vault 실제 온체인 이체. 성공했을 때만 DB에 미러링한다
 * (§9 가드레일: 온체인 성공 후에만 반영 — 실패한 트랜잭션은 campaigns.json에 안 남김).
 */
async function executeOnChainTopup(campaignId, amountUsdc, advertiserWallet) {
  const campaign = await findById("campaigns", campaignId);
  const amountKrw = Math.round(amountUsdc * KRW_PER_USDC);

  if (SIMULATE) {
    await update("campaigns", campaignId, {
      budgetUsdc: Math.round(((campaign.budgetUsdc || 0) + amountUsdc) * 100) / 100,
      budgetKrw: (campaign.budgetKrw || 0) + amountKrw,
    });
    return { amountKrw, txSignature: null, solscanUrl: null };
  }

  if (!campaign?.onchain?.campaignPda) {
    throw new Error(`캠페인 ${campaignId}은(는) 온체인 에스크로가 없어 배분할 수 없습니다.`);
  }

  const { signature, solscanUrl } = await budgetCampaign({ campaignId, amountUsdc, advertiserWallet });
  await update("campaigns", campaignId, {
    budgetUsdc: Math.round(((campaign.budgetUsdc || 0) + amountUsdc) * 100) / 100,
    budgetKrw: (campaign.budgetKrw || 0) + amountKrw,
  });
  return { amountKrw, txSignature: signature, solscanUrl };
}

function makeExecuteToolCall({ campaignsById, poolUsdc, state, advertiserWallet }) {
  return async function executeToolCall(name, args) {
    switch (name) {
      case "get_campaign_budget_state":
        return getCampaignBudgetState(args.campaignId);

      case "apply_topup": {
        const { campaignId, weight, reason } = args;
        const entry = campaignsById[campaignId];
        if (!entry) return { success: false, error: `알 수 없는 campaignId: ${campaignId}` };
        if (entry.signal === "exclude") {
          return { success: false, error: "이 캠페인은 signal이 exclude라 배분할 수 없습니다." };
        }
        if (typeof weight !== "number" || weight <= 0) {
          return { success: false, error: "weight는 0보다 큰 숫자여야 합니다." };
        }
        if (weight > WEIGHT_CAP + 1e-6) {
          return { success: false, error: `weight는 ${WEIGHT_CAP}를 초과할 수 없습니다 (요청: ${weight}).` };
        }

        const amountUsdc = Math.round(weight * poolUsdc * 100) / 100;
        if (state.cumulativeUsdc + amountUsdc > poolUsdc + POOL_EPSILON_USDC) {
          const remaining = Math.max(0, Math.round((poolUsdc - state.cumulativeUsdc) * 100) / 100);
          return { success: false, error: `풀 총액을 초과합니다. 남은 여유분은 약 ${remaining} USDC입니다.` };
        }

        let onchain;
        try {
          onchain = await executeOnChainTopup(campaignId, amountUsdc, advertiserWallet);
        } catch (e) {
          return { success: false, error: `온체인 배분 실패: ${e.message}` };
        }

        state.cumulativeUsdc += amountUsdc;
        state.allocations.push({
          campaignId,
          product: entry.product,
          weight,
          amountUsdc,
          amountKrw: onchain.amountKrw,
          reason,
          txSignature: onchain.txSignature,
          solscanUrl: onchain.solscanUrl,
        });
        return { success: true, amountUsdc, txSignature: onchain.txSignature };
      }

      default:
        return { error: `알 수 없는 도구: ${name}` };
    }
  };
}

/**
 * @param {{a2aMessage: object, poolUsdc: number}} params
 * @returns {Promise<{output:object, transcript:object[]}>}
 */
export async function runAllocatorAgent({ a2aMessage, poolUsdc }) {
  const data = a2aMessage.message.parts[0].data;
  const campaigns = data.campaigns;
  const campaignsById = Object.fromEntries(campaigns.map((c) => [c.campaignId, c]));
  const state = { cumulativeUsdc: 0, allocations: [] };
  const executeToolCall = makeExecuteToolCall({ campaignsById, poolUsdc, state, advertiserWallet: data.advertiserWallet });

  const initialMessage = JSON.stringify({
    advertiserId: data.advertiserId,
    poolUsdc,
    campaigns,
    instruction: "각 캠페인의 suggestedWeight를 검토하고, 필요하면 조정한 weight로 apply_topup을 호출하세요.",
  });

  let summary;
  let transcript;
  let usedFallback = false;

  try {
    const result = await runAgentLoop({
      systemPrompt: SYSTEM_PROMPT,
      tools: TOOLS,
      initialMessage,
      executeToolCall,
      jsonInstruction: JSON_INSTRUCTION,
    });
    summary = result.output?.summary || "";
    transcript = result.transcript;
  } catch (e) {
    console.log(`[allocatorAgent] Gemini 실패 → 로컬 폴백(기준선 그대로 적용): ${e.message}`);
    usedFallback = true;
    // Gemini가 멀티라운드 중 일부 캠페인은 이미 실제로 apply_topup에 성공한 뒤에 실패했을 수 있음 —
    // state.allocations에 이미 반영된 캠페인은 폴백에서 다시 처리하면 안 됨(중복 배분 방지).
    const alreadyAllocatedIds = new Set(state.allocations.map((a) => a.campaignId));
    transcript =
      alreadyAllocatedIds.size > 0
        ? [
            { type: "note", text: `Gemini가 ${alreadyAllocatedIds.size}개 캠페인은 이미 실제로 배분한 뒤 실패했습니다 — 그 배분은 유지하고 나머지만 로컬 폴백으로 처리합니다.` },
            { type: "fallback", reason: e.message },
          ]
        : [{ type: "fallback", reason: e.message }];
    // 로컬 폴백: exclude 아니고, 아직 배분 안 된 캠페인만 suggestedWeight를 그대로 적용
    for (const c of campaigns) {
      if (c.signal === "exclude" || !c.suggestedWeight) continue;
      if (alreadyAllocatedIds.has(c.campaignId)) continue;
      const res = await executeToolCall("apply_topup", {
        campaignId: c.campaignId,
        weight: Math.min(c.suggestedWeight, WEIGHT_CAP),
        reason: "성과 점수 비례로 예산을 배분했습니다. 판매 실적을 기준으로 산정한 값입니다.",
      });
      transcript.push({ type: "tool_call", name: "apply_topup", args: { campaignId: c.campaignId }, result: res });
    }
    summary = `Gemini 응답을 받지 못해 성과 점수 비례 기준선을 그대로 적용했습니다. 총 ${state.cumulativeUsdc.toFixed(2)} USDC를 배분했습니다.`;
  }

  // 배분 안 된(제외/미호출) 캠페인도 0원으로 결과에 포함
  const allocatedIds = new Set(state.allocations.map((a) => a.campaignId));
  for (const c of campaigns) {
    if (allocatedIds.has(c.campaignId)) continue;
    state.allocations.push({
      campaignId: c.campaignId,
      product: c.product,
      weight: 0,
      amountUsdc: 0,
      amountKrw: 0,
      reason:
        c.signal === "exclude"
          ? "이번엔 예산을 배분하지 않았습니다. 아직 성과가 뚜렷하지 않아 지켜본 뒤 다시 검토하는 것이 안전하다고 판단했습니다."
          : "이번엔 예산을 배분하지 않았습니다. 다른 캠페인이 더 뚜렷한 성과를 보이고 있어 우선순위에서 밀렸습니다.",
      txSignature: null,
    });
  }

  const unallocatedUsdc = Math.max(0, Math.round((poolUsdc - state.cumulativeUsdc) * 100) / 100);

  return {
    output: {
      advertiserId: data.advertiserId,
      poolUsdc,
      summary,
      allocations: state.allocations,
      unallocatedUsdc,
    },
    transcript,
    usedFallback,
  };
}

export const allocatorAgentCard = AGENT_CARD;
