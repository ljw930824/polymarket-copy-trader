import type { ActivityEvent, AppConfig, CopyOrder, CopySignal, SimulationState } from "../shared/types.js";

export interface SignalQuality {
  score: number;
  rejectReasons: string[];
  tags: string[];
}

export function scoreSignal(config: AppConfig, event: ActivityEvent, apiDelayMs: number): SignalQuality {
  let score = 100;
  const rejectReasons: string[] = [];
  const tags: string[] = [];
  const title = `${event.title ?? ""} ${event.slug ?? ""} ${event.eventSlug ?? ""}`.toLowerCase();
  const isSports = isSportsMarket(title);
  const isFast = isFastMarket(title);
  const sourceUsdcSize = event.usdcSize ?? event.size * event.price;

  if (isSports) tags.push("sports");
  if (config.excludeSportsMarkets && isSports) {
    score -= 100;
    rejectReasons.push("sports market excluded");
  }
  if (isFast) {
    tags.push("fast-market");
    score -= 60;
    rejectReasons.push("fast or near-term market excluded");
  }
  if (event.side === "BUY" && sourceUsdcSize < config.minSourceTradeUsdc) {
    score -= 30;
    rejectReasons.push(`source trade ${sourceUsdcSize.toFixed(2)} < ${config.minSourceTradeUsdc} USDC`);
  }
  if (apiDelayMs > config.maxSignalApiDelayMs) {
    score -= 35;
    rejectReasons.push(`api delay ${Math.round(apiDelayMs / 1000)}s > ${Math.round(config.maxSignalApiDelayMs / 1000)}s`);
  }
  if (event.side === "BUY" && event.price > config.maxCopyPrice) {
    score -= 30;
    rejectReasons.push(`buy price ${event.price.toFixed(3)} > max ${config.maxCopyPrice}`);
  }
  if (event.side === "BUY" && event.price < config.minCopyPrice) {
    score -= 20;
    rejectReasons.push(`buy price ${event.price.toFixed(3)} < min ${config.minCopyPrice}`);
  }

  return { score: Math.max(0, score), rejectReasons, tags };
}

export function prepareOrderWithStrategyGuards(
  config: AppConfig,
  signal: CopySignal,
  order: CopyOrder,
  simulation: SimulationState
): CopyOrder {
  if (order.status === "skipped") return order;
  const existingSellPosition = signal.side === "SELL" ? simulation.positions[signal.asset] : undefined;
  const rejectReasons = existingSellPosition ? [] : [...signal.rejectReasons];

  if (!existingSellPosition && signal.signalScore < config.minSignalScore) {
    rejectReasons.push(`signal score ${signal.signalScore} < ${config.minSignalScore}`);
  }

  if (signal.side === "BUY") {
    const lastBuy = simulation.trades.find(
      (trade) => trade.asset === signal.asset && trade.side === "BUY" && !trade.skippedReason
    );
    if (lastBuy && signal.detectedAt - lastBuy.timestamp < config.marketCooldownMs) {
      rejectReasons.push(`market cooldown ${Math.round(config.marketCooldownMs / 1000)}s`);
    }

    const currentExposure = simulation.positions[signal.asset]?.costBasis ?? 0;
    const remainingExposure = Math.max(0, config.maxAssetExposureUsdc - currentExposure);
    if (remainingExposure <= 0) {
      rejectReasons.push(`asset exposure cap ${config.maxAssetExposureUsdc} USDC reached`);
    } else if (order.amount > remainingExposure) {
      order = {
        ...order,
        amount: remainingExposure,
        response: {
          ...(typeof order.response === "object" && order.response !== null ? order.response : {}),
          cappedByExposure: true
        }
      };
    }

    const conditionExposure = Object.values(simulation.positions)
      .filter((position) => position.conditionId === signal.conditionId)
      .reduce((sum, position) => sum + position.costBasis, 0);
    const remainingConditionExposure = Math.max(0, config.maxConditionExposureUsdc - conditionExposure);
    if (remainingConditionExposure <= 0) {
      rejectReasons.push(`condition exposure cap ${config.maxConditionExposureUsdc} USDC reached`);
    } else if (order.amount > remainingConditionExposure) {
      order = {
        ...order,
        amount: remainingConditionExposure,
        response: {
          ...(typeof order.response === "object" && order.response !== null ? order.response : {}),
          cappedByConditionExposure: true
        }
      };
    }

    if (!simulation.positions[signal.asset] && Object.keys(simulation.positions).length >= config.maxOpenCopyPositions) {
      rejectReasons.push(`open position cap ${config.maxOpenCopyPositions} reached`);
    }
  } else if (!existingSellPosition) {
    rejectReasons.push("no simulated position to exit");
  }

  if (rejectReasons.length > 0) {
    return { ...order, amount: 0, status: "skipped", error: rejectReasons.join("; ") };
  }
  return order;
}

export function isSportsMarket(value: string): boolean {
  return /\b(vs\.?|atp|wta|nba|nfl|nhl|mlb|ufc|mma|soccer|football|basketball|baseball|hockey|tennis|golf|f1|formula|world cup|finals?|halftime|league of legends|lol|cs2|dota|valorant|game handicap|spread|total games|o\/u)\b/i.test(
    value
  );
}

export function isFastMarket(value: string): boolean {
  return /\b(today|tomorrow|tonight|this week|halftime|first half|quarter|period|from june \d{1,2} to june \d{1,2}|on 20\d{2}-\d{2}-\d{2})\b/i.test(
    value
  );
}
