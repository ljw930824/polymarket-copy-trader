import type {
  AppConfig,
  ArbitrageOpportunity,
  MakerCandidate,
  MarketQuote,
  OrderBookSummary,
  RewardEstimate,
  RewardMarket,
  StrategyBreakdown,
  StrategyDecision
} from "../shared/types.js";
import { isSportsMarket } from "./strategyGuards.js";

export function scoreMakerCandidates(
  config: AppConfig,
  markets: RewardMarket[],
  quotes: Record<string, MarketQuote> = {},
  books: Record<string, OrderBookSummary> = {}
): MakerCandidate[] {
  const maxReward = Math.max(1, ...markets.flatMap((market) => market.rates.map((rate) => rate.dailyReward)));

  return markets
    .flatMap((market) =>
      market.tokens.map((token) => buildCandidate(config, market, token, quotes[token.tokenId], books[token.tokenId], maxReward))
    )
    .filter((candidate) => candidate.dailyReward >= config.makerMinDailyReward)
    .filter((candidate) => candidate.maxSpreadBps <= config.makerMaxSpreadBps)
    .filter((candidate) => candidate.score >= config.makerMinScore)
    .sort(
      (a, b) =>
        Number(b.decision.eligible) - Number(a.decision.eligible) ||
        b.strategyScore - a.strategyScore ||
        b.score - a.score ||
        b.dailyReward - a.dailyReward
    )
    .slice(0, config.makerTopN);
}

function buildCandidate(
  config: AppConfig,
  market: RewardMarket,
  token: RewardMarket["tokens"][number],
  quote: MarketQuote | undefined,
  book: OrderBookSummary | undefined,
  maxReward: number
): MakerCandidate {
  const rewardRate = market.rates.find((rate) => sameAsset(rate.assetAddress, token.tokenId));
  const dailyReward = rewardRate?.dailyReward ?? Math.max(0, ...market.rates.map((rate) => rate.dailyReward));
  const maxSpreadBps = spreadToBps(market.maxSpread);
  const observedSpreadBps = quote?.bid && quote.ask ? Math.max(0, (quote.ask - quote.bid) * 10_000) : undefined;
  const referenceMid = midPrice(quote);
  const quotePlan = buildQuotePlan(config, token.tokenId, token.outcome, market.minSize, maxSpreadBps, referenceMid);
  const rewardEstimate = estimateReward(config, market, dailyReward, quotePlan, referenceMid, book);
  const tags: string[] = [];
  const rejectReasons: string[] = [];
  let score = 0;

  const title = `${market.question} ${market.slug ?? ""} ${market.marketSlug ?? ""}`;
  if (isSportsMarket(title)) {
    tags.push("sports");
    score -= config.excludeSportsMarkets ? 80 : 20;
    if (config.excludeSportsMarkets) rejectReasons.push("sports market excluded");
  }
  if (market.active === false || market.closed === true) {
    score -= 80;
    rejectReasons.push("market not active");
  }
  if (isExpiredMarket(market.endDate)) {
    score -= 80;
    rejectReasons.push("market expired");
  }
  if (market.acceptingOrders === false) {
    score -= 60;
    rejectReasons.push("not accepting orders");
  }
  if (!quote?.bid || !quote.ask) {
    tags.push("no-live-book");
    score -= 12;
  }
  if (observedSpreadBps !== undefined && observedSpreadBps > maxSpreadBps) {
    tags.push("wide-book");
    score -= 20;
  }
  if (market.minSize > config.makerQuoteSizeUsdc) {
    tags.push("size-above-config");
    score -= Math.min(25, (market.minSize / config.makerQuoteSizeUsdc - 1) * 8);
  }

  score += 42 * rewardWeight(dailyReward, maxReward);
  score += 8 + 18 * Math.max(0, 1 - maxSpreadBps / Math.max(config.makerMaxSpreadBps, 1));
  score += 16 * (quote?.bid && quote.ask ? 1 : 0.35);
  score += 10 * Math.max(0, 1 - Math.abs(referenceMid - 0.5) * 1.7);
  score += 6 * Math.max(0, 1 - Math.max(0, market.minSize - config.makerQuoteSizeUsdc) / Math.max(market.minSize, 1));
  const normalizedScore = clamp(score);
  const strategy = buildStrategyBreakdown(config, market, rewardEstimate, quote, referenceMid, observedSpreadBps);
  const strategyScore = clamp(strategy.total);
  const decision = buildDecision(config, strategyScore, strategy, tags, rejectReasons);

  return {
    id: `${market.conditionId}:${token.tokenId}`,
    conditionId: market.conditionId,
    title: market.question,
    slug: market.slug ?? market.marketSlug,
    outcome: token.outcome,
    asset: token.tokenId,
    dailyReward,
    minSize: market.minSize,
    maxSpread: market.maxSpread,
    maxSpreadBps,
    bid: quote?.bid,
    ask: quote?.ask,
    mid: referenceMid,
    score: normalizedScore,
    strategyScore,
    strategy,
    decision,
    rewardEstimate,
    tags,
    rejectReasons,
    quotePlan,
    updatedAt: Date.now()
  };
}

export function selectStrategyCandidates(config: AppConfig, candidates: MakerCandidate[]): MakerCandidate[] {
  return candidates
    .filter((candidate) => candidate.decision.eligible)
    .sort((a, b) => b.strategyScore - a.strategyScore || b.score - a.score)
    .slice(0, config.makerSimTopN);
}

export function findArbitrageOpportunities(
  candidates: MakerCandidate[],
  quotes: Record<string, MarketQuote>,
  minEdgeBps = 20
): ArbitrageOpportunity[] {
  const byCondition = new Map<string, MakerCandidate[]>();
  for (const candidate of candidates) {
    byCondition.set(candidate.conditionId, [...(byCondition.get(candidate.conditionId) ?? []), candidate]);
  }
  const opportunities: ArbitrageOpportunity[] = [];
  const now = Date.now();

  for (const [conditionId, group] of byCondition.entries()) {
    const yes = group.find((candidate) => /^yes$/i.test(candidate.outcome));
    const no = group.find((candidate) => /^no$/i.test(candidate.outcome));
    if (!yes || !no) continue;
    const yesQuote = quotes[yes.asset];
    const noQuote = quotes[no.asset];
    if (!yesQuote?.ask || !noQuote?.ask || !yesQuote.bid || !noQuote.bid) continue;

    const buyCost = yesQuote.ask + noQuote.ask;
    const buyEdge = 1 - buyCost;
    if (buyEdge * 10_000 >= minEdgeBps) {
      opportunities.push({
        id: `${conditionId}:buy-basket`,
        conditionId,
        title: yes.title,
        type: "buy-basket",
        yesAsset: yes.asset,
        noAsset: no.asset,
        yesPrice: yesQuote.ask,
        noPrice: noQuote.ask,
        combinedPrice: round(buyCost),
        edge: round(buyEdge),
        edgeBps: Math.round(buyEdge * 10_000),
        executable: true,
        reason: "buy YES + NO below 1.00 before fees/slippage",
        updatedAt: now
      });
    }

    const sellCredit = yesQuote.bid + noQuote.bid;
    const sellEdge = sellCredit - 1;
    if (sellEdge * 10_000 >= minEdgeBps) {
      opportunities.push({
        id: `${conditionId}:sell-basket`,
        conditionId,
        title: yes.title,
        type: "sell-basket",
        yesAsset: yes.asset,
        noAsset: no.asset,
        yesPrice: yesQuote.bid,
        noPrice: noQuote.bid,
        combinedPrice: round(sellCredit),
        edge: round(sellEdge),
        edgeBps: Math.round(sellEdge * 10_000),
        executable: false,
        reason: "sell basket requires existing complete YES/NO inventory",
        updatedAt: now
      });
    }
  }

  return opportunities.sort((a, b) => b.edgeBps - a.edgeBps).slice(0, 50);
}

function buildStrategyBreakdown(
  config: AppConfig,
  market: RewardMarket,
  rewardEstimate: RewardEstimate,
  quote: MarketQuote | undefined,
  referenceMid: number,
  observedSpreadBps: number | undefined
): StrategyBreakdown {
  const minCapital = Math.max(config.makerQuoteSizeUsdc * 2, market.minSize * 2, 1);
  const rewardYield = clamp(Math.log1p((rewardEstimate.estimatedDailyReward * 100) / minCapital) * 28);
  const spreadBps = observedSpreadBps ?? spreadToBps(market.maxSpread);
  const spreadYield = clamp(Math.min(28, Math.max(0, spreadBps) / 18));
  const rebatePotential = clamp((quote?.bid && quote.ask ? 8 : 2) + Math.min(12, rewardEstimate.estimatedDailyReward / 2));
  const holdingRewardPotential = clamp(isSlowCarryMarket(market.question) && referenceMid > 0.12 && referenceMid < 0.88 ? 8 : 1);
  const inventoryRisk = clamp(Math.abs(referenceMid - 0.5) * 95 + Math.max(0, market.minSize - config.makerQuoteSizeUsdc) * 0.45);
  const catalystRisk = clamp(catalystRiskFor(market.question));
  const liquidityRisk = clamp((quote?.bid && quote.ask ? 10 : 55) + Math.max(0, market.minSize - config.makerQuoteSizeUsdc) * 0.2);
  const competitionRisk = clamp(
    (spreadBps <= 2 ? 28 : 0) +
      Math.min(36, Math.log1p(rewardEstimate.existingCompetitionScore) * 4) +
      (rewardEstimate.confidence === "low" ? 12 : 0)
  );
  const total =
    18 +
    rewardYield * 0.95 +
    spreadYield * 0.85 +
    rebatePotential * 0.7 +
    holdingRewardPotential * 0.55 -
    inventoryRisk * 0.32 -
    catalystRisk * 0.42 -
    liquidityRisk * 0.28 -
    competitionRisk * 0.2;

  return {
    rewardYield: round(rewardYield),
    spreadYield: round(spreadYield),
    rebatePotential: round(rebatePotential),
    holdingRewardPotential: round(holdingRewardPotential),
    inventoryRisk: round(inventoryRisk),
    catalystRisk: round(catalystRisk),
    liquidityRisk: round(liquidityRisk),
    competitionRisk: round(competitionRisk),
    total: round(total)
  };
}

function buildDecision(
  config: AppConfig,
  strategyScore: number,
  strategy: StrategyBreakdown,
  tags: string[],
  rejectReasons: string[]
): StrategyDecision {
  const reasons = [...rejectReasons];
  if (tags.includes("sports")) reasons.push("sports or fast market");
  if (tags.includes("no-live-book")) reasons.push("missing live book");
  if (strategyScore < config.strategyMinScore) reasons.push(`strategy score ${strategyScore} < ${config.strategyMinScore}`);
  if (strategy.catalystRisk > config.strategyMaxCatalystRisk) {
    reasons.push(`catalyst risk ${strategy.catalystRisk} > ${config.strategyMaxCatalystRisk}`);
  }
  if (strategy.inventoryRisk > config.strategyMaxInventoryRisk) {
    reasons.push(`inventory risk ${strategy.inventoryRisk} > ${config.strategyMaxInventoryRisk}`);
  }
  const eligible = reasons.length === 0;
  const tier = eligible ? (strategyScore >= 72 ? "prime" : "watch") : "avoid";
  return { eligible, reasons, tier };
}

function estimateReward(
  config: AppConfig,
  market: RewardMarket,
  dailyReward: number,
  quotePlan: MakerCandidate["quotePlan"],
  referenceMid: number,
  book: OrderBookSummary | undefined
): RewardEstimate {
  if (!book || book.bids.length === 0 || book.asks.length === 0) {
    const captureRate = Math.min(config.makerRewardCaptureCap, config.makerSimRewardCaptureRate);
    return {
      captureRate: roundRate(captureRate),
      estimatedDailyReward: roundReward(dailyReward * captureRate),
      existingCompetitionScore: 0,
      proposedQuoteScore: 0,
      confidence: "low",
      model: "fixed-fallback"
    };
  }

  const maxDistance = rewardSpreadToPrice(market.maxSpread);
  const existingBidScore = scoreBookSide(book.bids, referenceMid, maxDistance);
  const existingAskScore = scoreBookSide(book.asks, referenceMid, maxDistance);
  const existingCompetitionScore = Math.min(existingBidScore, existingAskScore);
  const proposedBidShares = quotePlan.quoteSizeUsdc / Math.max(quotePlan.bidPrice, 0.01);
  const proposedAskShares = quotePlan.quoteSizeUsdc / Math.max(quotePlan.askPrice, 0.01);
  const proposedBidScore = scoreLevel(quotePlan.bidPrice, proposedBidShares, referenceMid, maxDistance);
  const proposedAskScore = scoreLevel(quotePlan.askPrice, proposedAskShares, referenceMid, maxDistance);
  const proposedQuoteScore = Math.min(proposedBidScore, proposedAskScore);
  const rawShare =
    proposedQuoteScore > 0 ? proposedQuoteScore / Math.max(proposedQuoteScore + existingCompetitionScore, proposedQuoteScore) : 0;
  const captureRate = Math.min(config.makerRewardCaptureCap, rawShare * config.makerRewardEstimateHaircut);

  return {
    captureRate: roundRate(captureRate),
    estimatedDailyReward: roundReward(dailyReward * captureRate),
    existingCompetitionScore: round(existingCompetitionScore),
    proposedQuoteScore: round(proposedQuoteScore),
    confidence: book.bids.length >= 10 && book.asks.length >= 10 ? "high" : "medium",
    model: "book-competition"
  };
}

function scoreBookSide(levels: OrderBookSummary["bids"], midpoint: number, maxDistance: number): number {
  return levels.reduce((sum, level) => sum + scoreLevel(level.price, level.size, midpoint, maxDistance), 0);
}

function scoreLevel(price: number, size: number, midpoint: number, maxDistance: number): number {
  const distance = Math.abs(price - midpoint);
  if (distance >= maxDistance || maxDistance <= 0) return 0;
  return ((maxDistance - distance) / maxDistance) ** 2 * size;
}

function rewardSpreadToPrice(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0.01;
  if (value <= 1) return value;
  if (value <= 100) return value / 100;
  return value / 10_000;
}

function buildQuotePlan(
  config: AppConfig,
  asset: string,
  outcome: string,
  minSize: number,
  maxSpreadBps: number,
  referenceMid: number
) {
  const quoteSpreadBps = Math.max(10, Math.min(config.makerMaxSpreadBps, maxSpreadBps));
  const halfSpread = quoteSpreadBps / 20_000;
  return {
    asset,
    outcome,
    bidPrice: roundPrice(referenceMid - halfSpread),
    askPrice: roundPrice(referenceMid + halfSpread),
    minSize,
    quoteSizeUsdc: Math.max(config.makerQuoteSizeUsdc, minSize),
    maxSpreadBps: quoteSpreadBps,
    referenceMid: roundPrice(referenceMid)
  };
}

function midPrice(quote?: MarketQuote): number {
  if (quote?.bid && quote.ask) return roundPrice((quote.bid + quote.ask) / 2);
  if (quote?.last) return roundPrice(quote.last);
  if (quote?.bid) return roundPrice(quote.bid);
  if (quote?.ask) return roundPrice(quote.ask);
  return 0.5;
}

function catalystRiskFor(title: string): number {
  const value = title.toLowerCase();
  let risk = 18;
  if (/\b(today|tomorrow|tonight|this week|june 4|june 5|june 6|by friday|halftime|quarter|period)\b/i.test(value)) risk += 48;
  if (/\b(before|by) (june|july|august|september|october|november|december) \d{1,2}\b/i.test(value)) risk += 18;
  if (/\b(charged|released|strike|war|resign|announce|tweet|temperature|settle at)\b/i.test(value)) risk += 16;
  if (isSportsMarket(value)) risk += 60;
  if (/\b(2027|2028|2029|2030|governor|senate|election|fed|rate cuts|market cap)\b/i.test(value)) risk -= 12;
  return Math.max(0, risk);
}

function isSlowCarryMarket(title: string): boolean {
  return /\b2026|2027|2028|election|governor|senate|fed|rate cuts|market cap|before 2027\b/i.test(title);
}

export function spreadToBps(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return Number.POSITIVE_INFINITY;
  if (value <= 1) return Math.round(value * 10_000);
  if (value <= 100) return Math.round(value * 100);
  return Math.round(value);
}

function sameAsset(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function rewardWeight(dailyReward: number, maxReward: number): number {
  return Math.min(1, Math.log1p(Math.max(0, dailyReward)) / Math.log1p(Math.max(1, maxReward)));
}

function isExpiredMarket(endDate?: string): boolean {
  if (!endDate) return false;
  const timestamp = Date.parse(endDate);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function roundPrice(value: number): number {
  return Math.min(0.99, Math.max(0.01, Math.round(value * 1000) / 1000));
}

function round(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

function roundRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100_000) / 100_000;
}

function roundReward(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100_000) / 100_000;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}
