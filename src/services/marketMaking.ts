import type { AppConfig, MakerCandidate, MarketQuote, RewardMarket } from "../shared/types.js";
import { isSportsMarket } from "./strategyGuards.js";

export function scoreMakerCandidates(
  config: AppConfig,
  markets: RewardMarket[],
  quotes: Record<string, MarketQuote> = {}
): MakerCandidate[] {
  const maxReward = Math.max(1, ...markets.flatMap((market) => market.rates.map((rate) => rate.dailyReward)));

  return markets
    .flatMap((market) => market.tokens.map((token) => buildCandidate(config, market, token, quotes[token.tokenId], maxReward)))
    .filter((candidate) => candidate.dailyReward >= config.makerMinDailyReward)
    .filter((candidate) => candidate.maxSpreadBps <= config.makerMaxSpreadBps)
    .filter((candidate) => candidate.score >= config.makerMinScore)
    .sort((a, b) => b.score - a.score || b.dailyReward - a.dailyReward)
    .slice(0, config.makerTopN);
}

function buildCandidate(
  config: AppConfig,
  market: RewardMarket,
  token: RewardMarket["tokens"][number],
  quote: MarketQuote | undefined,
  maxReward: number
): MakerCandidate {
  const rewardRate = market.rates.find((rate) => sameAsset(rate.assetAddress, token.tokenId));
  const dailyReward = rewardRate?.dailyReward ?? Math.max(0, ...market.rates.map((rate) => rate.dailyReward));
  const maxSpreadBps = spreadToBps(market.maxSpread);
  const observedSpreadBps = quote?.bid && quote.ask ? Math.max(0, (quote.ask - quote.bid) * 10_000) : undefined;
  const referenceMid = midPrice(quote);
  const quotePlan = buildQuotePlan(config, token.tokenId, token.outcome, market.minSize, maxSpreadBps, referenceMid);
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
    score: clamp(score),
    tags,
    rejectReasons,
    quotePlan,
    updatedAt: Date.now()
  };
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

function roundPrice(value: number): number {
  return Math.min(0.99, Math.max(0.01, Math.round(value * 1000) / 1000));
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}
