import type {
  AppConfig,
  MakerCandidate,
  MakerSimulationPosition,
  MakerSimulationState,
  MakerSimulationTrade,
  MarketQuote,
  Side
} from "../shared/types.js";
import { createMakerSimulationState, MAKER_REWARD_MODEL_VERSION } from "../shared/store.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REWARD_ACCRUAL_MS = 5 * 60 * 1000;

export function ensureMakerSimulation(
  simulation: MakerSimulationState | undefined,
  initialCash: number
): MakerSimulationState {
  if (!simulation || simulation.initialCash <= 0 || simulation.rewardModelVersion !== MAKER_REWARD_MODEL_VERSION) {
    return createMakerSimulationState(initialCash);
  }
  return {
    ...createMakerSimulationState(initialCash),
    ...simulation,
    positions: simulation.positions ?? {},
    trades: simulation.trades ?? [],
    snapshots: simulation.snapshots ?? [],
    lastMidByAsset: simulation.lastMidByAsset ?? {}
  };
}

export function updateMakerSimulation(
  config: AppConfig,
  simulation: MakerSimulationState,
  candidates: MakerCandidate[],
  quotes: Record<string, MarketQuote>,
  now = Date.now()
): MakerSimulationState {
  const selected = candidates.slice(0, config.makerSimTopN);
  const elapsedMs = Math.min(MAX_REWARD_ACCRUAL_MS, Math.max(0, now - (simulation.updatedAt || now)));
  const activeCandidates = selected.filter((candidate) => hasLiveBook(candidate, quotes));
  const rewardAccrual = estimateRewardAccrual(activeCandidates, elapsedMs);
  let next: MakerSimulationState = {
    ...simulation,
    positions: { ...simulation.positions },
    trades: [...simulation.trades],
    lastMidByAsset: { ...simulation.lastMidByAsset },
    accruedReward: simulation.accruedReward + rewardAccrual,
    updatedAt: now
  };

  for (const candidate of selected) {
    const quote = quotes[candidate.asset];
    const mid = bestMid(quote) ?? candidate.mid;
    if (!mid || !quote?.bid || !quote.ask) {
      if (mid) next.lastMidByAsset[candidate.asset] = mid;
      continue;
    }

    const previousMid = next.lastMidByAsset[candidate.asset] ?? mid;
    next = maybeSimulateMakerFill(config, next, candidate, previousMid, mid, now);
    next.lastMidByAsset[candidate.asset] = mid;
  }

  return finalizeMakerSimulation(config, next, candidates, quotes, now);
}

function maybeSimulateMakerFill(
  config: AppConfig,
  simulation: MakerSimulationState,
  candidate: MakerCandidate,
  previousMid: number,
  currentMid: number,
  now: number
): MakerSimulationState {
  const bidPrice = candidate.quotePlan.bidPrice;
  const askPrice = candidate.quotePlan.askPrice;
  const threshold = config.makerSimFillThresholdBps / 10_000;
  const position = simulation.positions[candidate.asset];
  const sellTriggered = Boolean(position?.shares) && previousMid < askPrice - threshold && currentMid >= askPrice - threshold;
  if (sellTriggered && position) {
    return applyMakerSell(simulation, candidate, askPrice, now, "mid crossed passive ask");
  }

  const buyTriggered = previousMid > bidPrice + threshold && currentMid <= bidPrice + threshold;
  if (!buyTriggered) return simulation;

  const currentExposure = position?.costBasis ?? 0;
  const remainingExposure = Math.max(0, config.makerSimMaxMarketExposureUsdc - currentExposure);
  const notional = Math.min(candidate.quotePlan.quoteSizeUsdc, remainingExposure, simulation.cash);
  if (notional <= 0) return simulation;
  return applyMakerBuy(simulation, candidate, bidPrice, notional, now, "mid crossed passive bid");
}

function applyMakerBuy(
  simulation: MakerSimulationState,
  candidate: MakerCandidate,
  price: number,
  notional: number,
  now: number,
  reason: string
): MakerSimulationState {
  const shares = notional / price;
  const current = simulation.positions[candidate.asset] ?? emptyMakerPosition(candidate, price, now);
  const nextShares = current.shares + shares;
  const nextCostBasis = current.costBasis + notional;
  const nextPosition: MakerSimulationPosition = {
    ...current,
    shares: nextShares,
    avgCost: nextCostBasis / nextShares,
    costBasis: nextCostBasis,
    markPrice: price,
    marketValue: nextShares * price,
    unrealizedPnl: nextShares * price - nextCostBasis,
    dailyReward: candidate.dailyReward,
    score: candidate.score,
    updatedAt: now
  };

  return {
    ...simulation,
    cash: simulation.cash - notional,
    positions: { ...simulation.positions, [candidate.asset]: nextPosition },
    trades: [makerTrade(candidate, "BUY", shares, price, notional, simulation.cash - notional, 0, now, reason), ...simulation.trades].slice(
      0,
      500
    )
  };
}

function applyMakerSell(
  simulation: MakerSimulationState,
  candidate: MakerCandidate,
  price: number,
  now: number,
  reason: string
): MakerSimulationState {
  const current = simulation.positions[candidate.asset];
  if (!current || current.shares <= 0) return simulation;

  const shares = Math.min(current.shares, candidate.quotePlan.quoteSizeUsdc / price);
  const notional = shares * price;
  const costRemoved = shares * current.avgCost;
  const realizedPnl = notional - costRemoved;
  const remainingShares = current.shares - shares;
  const remainingCostBasis = Math.max(0, current.costBasis - costRemoved);
  const positions = { ...simulation.positions };

  if (remainingShares <= 1e-9) {
    delete positions[candidate.asset];
  } else {
    positions[candidate.asset] = {
      ...current,
      shares: remainingShares,
      costBasis: remainingCostBasis,
      avgCost: remainingCostBasis / remainingShares,
      markPrice: price,
      marketValue: remainingShares * price,
      realizedPnl: current.realizedPnl + realizedPnl,
      unrealizedPnl: remainingShares * price - remainingCostBasis,
      dailyReward: candidate.dailyReward,
      score: candidate.score,
      updatedAt: now
    };
  }

  return {
    ...simulation,
    cash: simulation.cash + notional,
    positions,
    realizedPnl: simulation.realizedPnl + realizedPnl,
    trades: [
      makerTrade(candidate, "SELL", shares, price, notional, simulation.cash + notional, realizedPnl, now, reason),
      ...simulation.trades
    ].slice(0, 500)
  };
}

function finalizeMakerSimulation(
  config: AppConfig,
  simulation: MakerSimulationState,
  candidates: MakerCandidate[],
  quotes: Record<string, MarketQuote>,
  now: number
): MakerSimulationState {
  const positions: Record<string, MakerSimulationPosition> = {};
  let inventoryValue = 0;
  let unrealizedPnl = 0;

  for (const [asset, position] of Object.entries(simulation.positions)) {
    const markPrice = bestMid(quotes[asset]) ?? position.markPrice;
    const marketValue = position.shares * markPrice;
    const nextUnrealizedPnl = marketValue - position.costBasis;
    positions[asset] = {
      ...position,
      markPrice,
      marketValue,
      unrealizedPnl: nextUnrealizedPnl,
      updatedAt: now
    };
    inventoryValue += marketValue;
    unrealizedPnl += nextUnrealizedPnl;
  }

  const totalEquity = simulation.cash + inventoryValue + simulation.accruedReward;
  const totalPnl = totalEquity - simulation.initialCash;
  const equityHighWatermark = Math.max(simulation.equityHighWatermark, totalEquity);
  const maxDrawdown =
    equityHighWatermark > 0
      ? Math.max(simulation.maxDrawdown, (equityHighWatermark - totalEquity) / equityHighWatermark)
      : 0;
  const activeQuoteCount = candidates.filter((candidate) => quotes[candidate.asset]?.bid && quotes[candidate.asset]?.ask).length;
  const estimatedDailyReward = estimateDailyReward(
    candidates.slice(0, config.makerSimTopN).filter((candidate) => hasLiveBook(candidate, quotes))
  );

  return {
    ...simulation,
    positions,
    inventoryValue,
    unrealizedPnl,
    totalEquity,
    totalPnl,
    roi: simulation.initialCash > 0 ? totalPnl / simulation.initialCash : 0,
    equityHighWatermark,
    maxDrawdown,
    snapshots: [
      {
        timestamp: now,
        candidateCount: candidates.length,
        activeQuoteCount,
        topScore: candidates[0]?.score ?? 0,
        estimatedDailyReward,
        accruedReward: simulation.accruedReward,
        cash: simulation.cash,
        inventoryValue,
        totalEquity,
        totalPnl,
        roi: simulation.initialCash > 0 ? totalPnl / simulation.initialCash : 0,
        maxDrawdown
      },
      ...simulation.snapshots
    ].slice(0, 500),
    updatedAt: now
  };
}

function estimateRewardAccrual(candidates: MakerCandidate[], elapsedMs: number): number {
  return (estimateDailyReward(candidates) * elapsedMs) / DAY_MS;
}

function hasLiveBook(candidate: MakerCandidate, quotes: Record<string, MarketQuote>): boolean {
  const quote = quotes[candidate.asset];
  return Boolean(quote?.bid && quote.ask);
}

function estimateDailyReward(candidates: MakerCandidate[]): number {
  const byCondition = new Map<string, number>();
  for (const candidate of candidates) {
    byCondition.set(
      candidate.conditionId,
      Math.max(byCondition.get(candidate.conditionId) ?? 0, candidate.rewardEstimate.estimatedDailyReward)
    );
  }
  return [...byCondition.values()].reduce((sum, reward) => sum + reward, 0);
}

function emptyMakerPosition(candidate: MakerCandidate, price: number, now: number): MakerSimulationPosition {
  return {
    asset: candidate.asset,
    conditionId: candidate.conditionId,
    title: candidate.title,
    outcome: candidate.outcome,
    shares: 0,
    avgCost: 0,
    costBasis: 0,
    markPrice: price,
    marketValue: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    dailyReward: candidate.dailyReward,
    score: candidate.score,
    updatedAt: now
  };
}

function makerTrade(
  candidate: MakerCandidate,
  side: Side,
  shares: number,
  price: number,
  notional: number,
  cashAfter: number,
  realizedPnl: number,
  now: number,
  reason: string
): MakerSimulationTrade {
  return {
    id: `maker:${candidate.asset}:${side}:${now}`,
    timestamp: now,
    candidateId: candidate.id,
    side,
    asset: candidate.asset,
    conditionId: candidate.conditionId,
    title: candidate.title,
    outcome: candidate.outcome,
    price,
    shares,
    notional,
    cashAfter,
    realizedPnl,
    reason,
    score: candidate.score
  };
}

function bestMid(quote?: MarketQuote): number | undefined {
  if (!quote) return undefined;
  if (quote.bid && quote.ask) return (quote.bid + quote.ask) / 2;
  return quote.last ?? quote.bid ?? quote.ask;
}
