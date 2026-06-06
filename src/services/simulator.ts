import type {
  CopyOrder,
  CopySignal,
  MarketQuote,
  Position,
  SimulationPosition,
  SimulationState,
  SimulationTrade
} from "../shared/types.js";
import { createSimulationState } from "../shared/store.js";

export function ensureSimulation(simulation: SimulationState | undefined, initialCash: number): SimulationState {
  if (!simulation || simulation.initialCash <= 0) {
    return createSimulationState(initialCash);
  }
  return simulation;
}

export function applyPaperOrder(
  simulation: SimulationState,
  order: CopyOrder,
  signal: CopySignal
): SimulationState {
  if (order.mode !== "paper" || order.status !== "filled") return simulation;
  if (simulation.trades.some((trade) => trade.orderId === order.id)) return simulation;

  const price = order.worstPrice;
  if (!Number.isFinite(price) || price <= 0) {
    return appendSkippedTrade(simulation, order, signal, "missing execution price");
  }

  if (order.side === "BUY") {
    return applyBuy(simulation, order, signal, price);
  }
  return applySell(simulation, order, signal, price);
}

export function rebuildSimulationFromHistory(
  initialCash: number,
  orders: CopyOrder[],
  signals: CopySignal[],
  quotes: Record<string, MarketQuote>,
  targetPositions: Position[]
): SimulationState {
  const signalById = new Map(signals.map((signal) => [signal.id, signal]));
  let simulation = createSimulationState(initialCash);
  for (const order of [...orders].sort((a, b) => a.createdAt - b.createdAt)) {
    const signal = signalById.get(order.signalId);
    if (signal) {
      simulation = applyPaperOrder(simulation, order, signal);
    }
  }
  return markSimulation(simulation, quotes, targetPositions);
}

export function markSimulation(
  simulation: SimulationState,
  quotes: Record<string, MarketQuote>,
  targetPositions: Position[]
): SimulationState {
  const targetMarkByAsset = new Map(targetPositions.map((position) => [position.asset, position.curPrice]));
  const positions: Record<string, SimulationPosition> = {};
  let unrealizedPnl = 0;
  let marketValue = 0;

  for (const [asset, position] of Object.entries(simulation.positions)) {
    const quote = quotes[asset];
    const markPrice = bestMarkPrice(quote) ?? targetMarkByAsset.get(asset) ?? position.markPrice ?? position.avgCost;
    const nextMarketValue = position.shares * markPrice;
    const nextUnrealizedPnl = nextMarketValue - position.costBasis;
    positions[asset] = {
      ...position,
      markPrice,
      marketValue: nextMarketValue,
      unrealizedPnl: nextUnrealizedPnl
    };
    marketValue += nextMarketValue;
    unrealizedPnl += nextUnrealizedPnl;
  }

  return finalize({
    ...simulation,
    positions,
    unrealizedPnl,
    totalEquity: simulation.cash + marketValue
  });
}

function applyBuy(simulation: SimulationState, order: CopyOrder, signal: CopySignal, price: number): SimulationState {
  const notional = Math.min(order.amount, simulation.cash);
  if (notional <= 0) {
    return appendSkippedTrade(simulation, order, signal, "cash exhausted");
  }

  const shares = notional / price;
  const current = simulation.positions[order.asset] ?? emptyPosition(order.asset, signal, price);
  const nextCostBasis = current.costBasis + notional;
  const nextShares = current.shares + shares;
  const nextPosition: SimulationPosition = {
    ...current,
    conditionId: current.conditionId ?? signal.conditionId,
    title: current.title ?? signal.title,
    outcome: current.outcome ?? signal.outcome,
    shares: nextShares,
    avgCost: nextShares > 0 ? nextCostBasis / nextShares : 0,
    costBasis: nextCostBasis,
    markPrice: price,
    marketValue: nextShares * price,
    unrealizedPnl: nextShares * price - nextCostBasis
  };

  return finalize({
    ...simulation,
    cash: simulation.cash - notional,
    positions: { ...simulation.positions, [order.asset]: nextPosition },
    trades: [trade(order, signal, shares, price, notional, simulation.cash - notional, 0), ...simulation.trades].slice(0, 500)
  });
}

function applySell(simulation: SimulationState, order: CopyOrder, signal: CopySignal, price: number): SimulationState {
  const current = simulation.positions[order.asset];
  if (!current || current.shares <= 0) {
    return appendSkippedTrade(simulation, order, signal, "no simulated position to sell");
  }

  const shares = Math.min(order.amount, current.shares);
  if (shares <= 0) {
    return appendSkippedTrade(simulation, order, signal, "sell amount is zero");
  }

  const notional = shares * price;
  const costRemoved = shares * current.avgCost;
  const realizedPnl = notional - costRemoved;
  const remainingShares = current.shares - shares;
  const remainingCostBasis = Math.max(0, current.costBasis - costRemoved);
  const positions = { ...simulation.positions };

  if (remainingShares <= 1e-9) {
    delete positions[order.asset];
  } else {
    positions[order.asset] = {
      ...current,
      shares: remainingShares,
      costBasis: remainingCostBasis,
      avgCost: remainingCostBasis / remainingShares,
      markPrice: price,
      marketValue: remainingShares * price,
      realizedPnl: current.realizedPnl + realizedPnl,
      unrealizedPnl: remainingShares * price - remainingCostBasis
    };
  }

  return finalize({
    ...simulation,
    cash: simulation.cash + notional,
    positions,
    realizedPnl: simulation.realizedPnl + realizedPnl,
    trades: [
      trade(order, signal, shares, price, notional, simulation.cash + notional, realizedPnl),
      ...simulation.trades
    ].slice(0, 500)
  });
}

function appendSkippedTrade(
  simulation: SimulationState,
  order: CopyOrder,
  signal: CopySignal,
  reason: string
): SimulationState {
  const skipped = trade(order, signal, 0, order.worstPrice, 0, simulation.cash, 0, reason);
  return finalize({
    ...simulation,
    trades: [skipped, ...simulation.trades].slice(0, 500)
  });
}

function finalize(simulation: SimulationState): SimulationState {
  const marketValue = Object.values(simulation.positions).reduce((sum, position) => sum + position.marketValue, 0);
  const unrealizedPnl = Object.values(simulation.positions).reduce((sum, position) => sum + position.unrealizedPnl, 0);
  const totalEquity = simulation.cash + marketValue;
  const totalPnl = totalEquity - simulation.initialCash;
  const equityHighWatermark = Math.max(simulation.equityHighWatermark, totalEquity);
  const maxDrawdown =
    equityHighWatermark > 0
      ? Math.max(simulation.maxDrawdown, (equityHighWatermark - totalEquity) / equityHighWatermark)
      : 0;
  const closedTrades = simulation.trades.filter((tradeItem) => tradeItem.side === "SELL" && !tradeItem.skippedReason);
  const winningTrades = closedTrades.filter((tradeItem) => tradeItem.realizedPnl > 0);

  return {
    ...simulation,
    unrealizedPnl,
    totalEquity,
    totalPnl,
    roi: simulation.initialCash > 0 ? totalPnl / simulation.initialCash : 0,
    winRate: closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0,
    maxDrawdown,
    equityHighWatermark,
    updatedAt: Date.now()
  };
}

function emptyPosition(asset: string, signal: CopySignal, price: number): SimulationPosition {
  return {
    asset,
    conditionId: signal.conditionId,
    title: signal.title,
    outcome: signal.outcome,
    shares: 0,
    avgCost: 0,
    costBasis: 0,
    markPrice: price,
    marketValue: 0,
    realizedPnl: 0,
    unrealizedPnl: 0
  };
}

function trade(
  order: CopyOrder,
  signal: CopySignal,
  shares: number,
  price: number,
  notional: number,
  cashAfter: number,
  realizedPnl: number,
  skippedReason?: string
): SimulationTrade {
  return {
    id: `sim:${order.id}`,
    orderId: order.id,
    signalId: signal.id,
    timestamp: order.createdAt,
    side: order.side,
    asset: order.asset,
    title: signal.title,
    outcome: signal.outcome,
    shares,
    price,
    notional,
    cashAfter,
    realizedPnl,
    skippedReason
  };
}

function bestMarkPrice(quote?: MarketQuote): number | undefined {
  if (!quote) return undefined;
  if (quote.bid && quote.ask) return (quote.bid + quote.ask) / 2;
  return quote.last ?? quote.bid ?? quote.ask;
}
