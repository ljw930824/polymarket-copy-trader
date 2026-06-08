import { fetchJson } from "../shared/http.js";
import type { MarketQuote, OrderBookLevel, OrderBookSummary, RewardMarket, RewardRate } from "../shared/types.js";

interface RawSamplingMarket {
  condition_id?: unknown;
  conditionId?: unknown;
  question?: unknown;
  title?: unknown;
  slug?: unknown;
  market_slug?: unknown;
  end_date?: unknown;
  end_date_iso?: unknown;
  endDate?: unknown;
  endDateIso?: unknown;
  active?: unknown;
  closed?: unknown;
  accepting_orders?: unknown;
  acceptingOrders?: unknown;
  tokens?: unknown;
  clobTokenIds?: unknown;
  outcomes?: unknown;
  rewards?: unknown;
}

interface RawRewardPayload {
  data?: unknown;
  markets?: unknown;
}

export class ClobApiClient {
  constructor(private readonly host: string) {}

  async samplingMarkets(): Promise<RewardMarket[]> {
    const payload = await fetchJson<RawRewardPayload | RawSamplingMarket[]>(new URL("/sampling-markets", this.host));
    const rawMarkets = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload.markets)
          ? payload.markets
          : [];
    return rawMarkets.map(normalizeMarket).filter((market): market is RewardMarket => Boolean(market));
  }

  async prices(assetIds: string[]): Promise<MarketQuote[]> {
    const uniqueAssets = [...new Set(assetIds.filter(Boolean))];
    const quotes: MarketQuote[] = [];
    for (const chunk of chunks(uniqueAssets, 200)) {
      const body = chunk.flatMap((tokenId) => [
        { token_id: tokenId, side: "BUY" },
        { token_id: tokenId, side: "SELL" }
      ]);
      const payload = await fetchJson<Record<string, Record<string, string | number>>>(
        new URL("/prices", this.host),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        }
      );
      const now = Date.now();
      for (const [assetId, sides] of Object.entries(payload)) {
        const buy = numberValue(sides.BUY);
        const sell = numberValue(sides.SELL);
        const bid = buy && sell ? Math.min(buy, sell) : sell || undefined;
        const ask = buy && sell ? Math.max(buy, sell) : buy || undefined;
        quotes.push({ assetId, bid, ask, updatedAt: now });
      }
    }
    return quotes;
  }

  async books(assetIds: string[]): Promise<OrderBookSummary[]> {
    const uniqueAssets = [...new Set(assetIds.filter(Boolean))];
    return mapLimit(uniqueAssets, 6, async (assetId) => {
      const payload = await fetchJson<Record<string, unknown>>(
        new URL(`/book?token_id=${encodeURIComponent(assetId)}`, this.host)
      );
      return {
        assetId,
        bids: normalizeBookLevels(payload.bids),
        asks: normalizeBookLevels(payload.asks),
        updatedAt: numberValue(payload.timestamp) || Date.now()
      };
    });
  }
}

function normalizeBookLevels(raw: unknown): OrderBookLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const level = item as Record<string, unknown>;
      const price = numberValue(level.price);
      const size = numberValue(level.size);
      return price > 0 && size > 0 ? { price, size } : undefined;
    })
    .filter((level): level is OrderBookLevel => Boolean(level));
}

function normalizeMarket(raw: unknown): RewardMarket | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const market = raw as RawSamplingMarket;
  const rewards = typeof market.rewards === "object" && market.rewards !== null ? (market.rewards as Record<string, unknown>) : {};
  const conditionId = stringValue(market.condition_id, market.conditionId);
  const question = stringValue(market.question, market.title);
  const rates = normalizeRates(rewards.rates);
  const tokens = normalizeTokens(market.tokens, market.clobTokenIds, market.outcomes);

  if (!conditionId || !question || tokens.length === 0 || rates.length === 0) return undefined;

  return {
    conditionId,
    question,
    slug: stringValue(market.slug),
    marketSlug: stringValue(market.market_slug),
    endDate: stringValue(market.end_date_iso, market.endDateIso, market.end_date, market.endDate),
    active: boolValue(market.active),
    closed: boolValue(market.closed),
    acceptingOrders: boolValue(market.accepting_orders, market.acceptingOrders),
    minSize: numberValue(rewards.min_size, rewards.minSize),
    maxSpread: numberValue(rewards.max_spread, rewards.maxSpread),
    rates,
    tokens
  };
}

function normalizeRates(raw: unknown): RewardRate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const rate = item as Record<string, unknown>;
      const assetAddress = stringValue(rate.asset_address, rate.assetAddress, rate.token_id, rate.tokenId);
      const dailyReward = numberValue(rate.rewards_daily_rate, rate.rewardsDailyRate, rate.dailyReward);
      if (!assetAddress || dailyReward <= 0) return undefined;
      return { assetAddress, dailyReward };
    })
    .filter((rate): rate is RewardRate => Boolean(rate));
}

function normalizeTokens(tokens: unknown, clobTokenIds: unknown, outcomes: unknown): RewardMarket["tokens"] {
  if (Array.isArray(tokens)) {
    return tokens
      .map((item, index) => {
        if (!item || typeof item !== "object") return undefined;
        const token = item as Record<string, unknown>;
        const tokenId = stringValue(token.token_id, token.tokenId, token.id);
        if (!tokenId) return undefined;
        return { tokenId, outcome: stringValue(token.outcome, token.name) || `Outcome ${index + 1}` };
      })
      .filter((token): token is RewardMarket["tokens"][number] => Boolean(token));
  }

  if (!Array.isArray(clobTokenIds)) return [];
  const outcomeNames = Array.isArray(outcomes) ? outcomes.map((value) => String(value)) : [];
  return clobTokenIds
    .map((tokenId, index) => {
      const value = String(tokenId);
      return value ? { tokenId: value, outcome: outcomeNames[index] ?? `Outcome ${index + 1}` } : undefined;
    })
    .filter((token): token is RewardMarket["tokens"][number] => Boolean(token));
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function numberValue(...values: unknown[]): number {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function boolValue(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value.toLowerCase() === "true") return true;
      if (value.toLowerCase() === "false") return false;
    }
  }
  return undefined;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function mapLimit<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
