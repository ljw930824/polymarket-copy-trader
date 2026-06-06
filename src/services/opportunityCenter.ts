import type { AppConfig, ArbitrageOpportunity, CopySignal, MakerCandidate, OpportunityItem } from "../shared/types.js";

export function buildOpportunityCenter(
  config: AppConfig,
  makerCandidates: MakerCandidate[],
  arbitrageOpportunities: ArbitrageOpportunity[],
  signals: CopySignal[]
): OpportunityItem[] {
  const now = Date.now();
  const items: OpportunityItem[] = [];

  for (const item of arbitrageOpportunities) {
    items.push({
      id: `arb:${item.id}`,
      tier: item.executable ? "execute" : "watch",
      source: "arbitrage",
      title: item.title,
      score: Math.min(100, Math.max(0, item.edgeBps / 2)),
      action: item.executable ? "报警：YES + NO 合计低于 1，可人工复核" : "观察：需要已有完整 YES/NO 库存",
      rationale: item.reason,
      edgeBps: item.edgeBps,
      riskLevel: item.executable ? "medium" : "high",
      reasons: [`edge ${item.edgeBps} bps`, `combined ${item.combinedPrice}`],
      updatedAt: item.updatedAt
    });
  }

  for (const candidate of makerCandidates) {
    const riskLevel = makerRiskLevel(candidate);
    if (candidate.decision.eligible) {
      items.push({
        id: `maker:${candidate.id}`,
        tier: "execute",
        source: "maker",
        title: candidate.title,
        outcome: candidate.outcome,
        score: candidate.strategyScore,
        action: "进入做市模拟盘；实盘前先验证真实成交和奖励捕获率",
        rationale: "通过综合策略分、催化风险、库存风险和盘口可用性过滤",
        expectedDailyReward: candidate.rewardEstimate.estimatedDailyReward,
        bid: candidate.bid,
        ask: candidate.ask,
        riskLevel,
        reasons: [
          `strategy ${candidate.strategyScore}`,
          `daily reward ${candidate.dailyReward}`,
          `estimated capture ${(candidate.rewardEstimate.captureRate * 100).toFixed(2)}%`,
          `inventory risk ${candidate.strategy.inventoryRisk}`,
          `catalyst risk ${candidate.strategy.catalystRisk}`
        ],
        updatedAt: candidate.updatedAt
      });
      continue;
    }

    const nearThreshold =
      candidate.bid &&
      candidate.ask &&
      candidate.strategyScore >= Math.max(0, config.strategyMinScore - 7) &&
      !candidate.tags.includes("sports") &&
      !candidate.tags.includes("no-live-book");
    if (nearThreshold) {
      items.push({
        id: `watch:${candidate.id}`,
        tier: "watch",
        source: "maker",
        title: candidate.title,
        outcome: candidate.outcome,
        score: candidate.strategyScore,
        action: "观察名单；等待价差、奖励或风险改善后再进入模拟盘",
        rationale: "接近策略门槛但尚未通过，适合做参数网格回测",
        expectedDailyReward: candidate.rewardEstimate.estimatedDailyReward,
        bid: candidate.bid,
        ask: candidate.ask,
        riskLevel,
        reasons: candidate.decision.reasons,
        updatedAt: candidate.updatedAt
      });
    }
  }

  const riskyCopySignals = signals.filter((signal) => signal.tags.includes("sports") || signal.rejectReasons.length > 0).slice(0, 5);
  for (const signal of riskyCopySignals) {
    items.push({
      id: `copy:${signal.id}`,
      tier: "avoid",
      source: "copy",
      title: signal.title ?? signal.asset,
      outcome: signal.outcome,
      score: signal.signalScore,
      action: "禁止自动跟单；仅保留复盘样本",
      rationale: "跟单模拟仍在亏损，且短周期/体育/延迟信号容易被滑点吞噬",
      bid: undefined,
      ask: undefined,
      riskLevel: "high",
      reasons: [...signal.rejectReasons, ...signal.tags].filter(Boolean),
      updatedAt: signal.detectedAt
    });
  }

  return items.sort(compareOpportunity).slice(0, 80);
}

function compareOpportunity(left: OpportunityItem, right: OpportunityItem): number {
  return tierWeight(right.tier) - tierWeight(left.tier) || right.score - left.score || right.updatedAt - left.updatedAt;
}

function tierWeight(tier: OpportunityItem["tier"]): number {
  if (tier === "execute") return 3;
  if (tier === "watch") return 2;
  return 1;
}

function makerRiskLevel(candidate: MakerCandidate): OpportunityItem["riskLevel"] {
  const risk =
    candidate.strategy.inventoryRisk * 0.38 +
    candidate.strategy.catalystRisk * 0.32 +
    candidate.strategy.liquidityRisk * 0.2 +
    candidate.strategy.competitionRisk * 0.1;
  if (risk >= 55) return "high";
  if (risk >= 30) return "medium";
  return "low";
}
