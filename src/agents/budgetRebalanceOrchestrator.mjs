/**
 * 분석 에이전트 → 예산분배 에이전트를 순서대로 호출하는 오케스트레이터.
 * 지금은 같은 프로세스 안 함수 호출이지만, Agent Card + Task/Message 형태로 감싸둬서
 * 나중에 정말 분리된 서비스로 쪼개도 이 함수의 시그니처는 안 바뀐다.
 *
 * poolUsdc는 사람이 입력하지 않는다 — Budget Vault의 실제 잔액을 오케스트레이터가 직접 조회해서
 * 그게 곧 이번 라운드의 풀이 된다. 그중 얼마를 실제로 쓸지(또는 전혀 안 쓸지)는 예산분배
 * 에이전트가 스스로 판단한다 — "지금 실행" 버튼은 사람이 금액을 정하는 게 아니라, 실제로는
 * 주기적으로(cron 등) 자동 실행될 것을 데모에서 수동으로 트리거하는 것뿐이다.
 */
import { v4 as uuidv4 } from "uuid";
import { insert } from "../db.mjs";
import { getAdvertiserBudgetInfo } from "../escrow.mjs";
import { runAnalystAgent, analystAgentCard } from "./analystAgent.mjs";
import { runAllocatorAgent, allocatorAgentCard } from "./allocatorAgent.mjs";

// 임시 스위치 — Budget PDA/budget_campaign이 아직 devnet에 배포되기 전, A2A 전체 흐름(분석 →
// A2A 메시지 → Gemini 배분 판단)을 실제 온체인 없이 테스트하기 위한 것. 배포 끝나면 .env에서
// BUDGET_AGENT_SIMULATE를 지우면 이 파일도 allocatorAgent.mjs도 자동으로 실제 온체인 경로로 돌아감.
const SIMULATE = process.env.BUDGET_AGENT_SIMULATE === "true";
const SIMULATE_POOL_USDC = Number(process.env.BUDGET_AGENT_SIMULATE_POOL_USDC || 20);

/**
 * 분석 결과의 performanceScore를, exclude 안 된 캠페인끼리 비례 배분한 기준선.
 * 순수 산수라 서버가 계산한다(Gemini에 맡기지 않음).
 *
 * "캠페인 간 비율"뿐 아니라 "이번 라운드에 풀을 총 얼마나 쓸지"도 성과 수준에 좌우되게
 * utilizationFactor(0~1, eligible 캠페인 평균 점수/100)를 곱한다 — 그래서 baseline 총합이
 * 항상 100%가 아니라, 캠페인들이 전반적으로 강할 때만 1에 가까워진다. 그래야 Gemini가
 * 개별 캠페인을 제외/감산해도 남은 캠페인 상한까지 끌어올려서 결과적으로 풀을 거의 다
 * 써버리는 쏠림을 줄일 수 있다(exclude된 캠페인 몫을 자동으로 나머지에 밀어주지 않음).
 */
function attachSuggestedWeights(campaigns) {
  const eligible = campaigns.filter((c) => c.signal !== "exclude");
  const totalScore = eligible.reduce((s, c) => s + (c.performanceScore || 0), 0);
  if (eligible.length === 0 || totalScore <= 0) {
    return campaigns.map((c) => ({ ...c, suggestedWeight: 0 }));
  }
  const avgScore = totalScore / eligible.length;
  const utilizationFactor = Math.max(0, Math.min(1, avgScore / 100));
  return campaigns.map((c) => {
    if (c.signal === "exclude") return { ...c, suggestedWeight: 0 };
    return { ...c, suggestedWeight: Math.round((c.performanceScore / totalScore) * utilizationFactor * 1000) / 1000 };
  });
}

function buildA2AMessage({ advertiserId, poolUsdc, campaigns }) {
  return {
    taskId: `a2a-${uuidv4().slice(0, 8)}`,
    from: analystAgentCard.name,
    to: allocatorAgentCard.name,
    createdAt: new Date().toISOString(),
    message: {
      role: "agent",
      parts: [{ type: "data", data: { advertiserId, poolUsdc, campaigns } }],
    },
  };
}

/**
 * @param {{advertiserId: string}} params
 */
export async function runBudgetRebalance({ advertiserId }) {
  const startedAt = new Date().toISOString();

  let poolUsdc;
  if (SIMULATE) {
    poolUsdc = SIMULATE_POOL_USDC;
    console.log(`[budgetRebalanceOrchestrator] ⚠ BUDGET_AGENT_SIMULATE=true — Budget Vault 실조회 없이 ${poolUsdc} USDC로 가정하고 진행합니다.`);
  } else {
    const budgetInfo = await getAdvertiserBudgetInfo();
    if (!budgetInfo.exists) {
      throw new Error("Budget PDA가 아직 생성되지 않았습니다. 먼저 예비 예산을 충전해주세요.");
    }
    poolUsdc = budgetInfo.vaultBalanceUsdc;
    if (!(poolUsdc > 0)) {
      throw new Error("Budget Vault 잔액이 없어서 이번 라운드에 배분할 예산이 없습니다.");
    }
  }

  const analystResult = await runAnalystAgent({ advertiserId });
  const campaignsWithWeight = attachSuggestedWeights(analystResult.output.campaigns || []);
  const a2aMessage = buildA2AMessage({ advertiserId, poolUsdc, campaigns: campaignsWithWeight });

  const allocatorResult = await runAllocatorAgent({ a2aMessage, poolUsdc });

  const record = insert("budgetRebalances", {
    id: uuidv4(),
    advertiserId,
    poolUsdc,
    startedAt,
    finishedAt: new Date().toISOString(),
    analyst: {
      summary: analystResult.output.summary,
      usedFallback: analystResult.usedFallback,
      transcript: analystResult.transcript,
    },
    a2aMessage,
    allocator: {
      summary: allocatorResult.output.summary,
      usedFallback: allocatorResult.usedFallback,
      transcript: allocatorResult.transcript,
      allocations: allocatorResult.output.allocations,
      unallocatedUsdc: allocatorResult.output.unallocatedUsdc,
    },
  });

  return {
    recordId: record.id,
    a2aMessage,
    analyst: { summary: analystResult.output.summary, usedFallback: analystResult.usedFallback, transcript: analystResult.transcript },
    allocator: allocatorResult.output,
    allocatorTranscript: allocatorResult.transcript,
    allocatorUsedFallback: allocatorResult.usedFallback,
  };
}
