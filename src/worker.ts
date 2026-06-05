import pino from "pino";
import { loadConfig } from "./shared/config.js";
import { sleep } from "./shared/http.js";
import { createEmptyState, JsonStateStore } from "./shared/store.js";
import type { ActivityEvent, AppState, MarketQuote, Position, RewardMarket } from "./shared/types.js";
import { DataApiClient } from "./polymarket/dataApi.js";
import { ClobApiClient } from "./polymarket/clobApi.js";
import { MarketWsCache } from "./polymarket/marketWs.js";
import { OrderExecutor } from "./polymarket/clob.js";
import { flattenTargetPositions, scoreWallets } from "./services/scoring.js";
import { canSubmitOrder, consumeRisk, CopyEngine } from "./services/copyEngine.js";
import {
  applyPaperOrder,
  ensureSimulation,
  markSimulation,
  rebuildSimulationFromHistory
} from "./services/simulator.js";
import { prepareOrderWithStrategyGuards } from "./services/strategyGuards.js";
import { findArbitrageOpportunities, scoreMakerCandidates, selectStrategyCandidates } from "./services/marketMaking.js";
import { ensureMakerSimulation, updateMakerSimulation } from "./services/makerSimulator.js";
import { buildOpportunityCenter } from "./services/opportunityCenter.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

async function main(): Promise<void> {
  const config = loadConfig();
  const dataApi = new DataApiClient(config.dataApiBase);
  const clobApi = new ClobApiClient(config.clobHost);
  const store = new JsonStateStore();
  const executor = new OrderExecutor(config);
  const marketWs = new MarketWsCache(config.marketWsUrl);
  let state: AppState = await store.read(config.mode);
  state = { ...createEmptyState(config.mode), ...state, mode: config.mode };
  state.cycleStartedAt = state.cycleStartedAt ?? Date.now();
  const engine = new CopyEngine(state.signals.map((signal) => signal.id));
  state.simulation = ensureSimulation(state.simulation, config.simInitialCashUsdc);
  state.makerSimulation = ensureMakerSimulation(state.makerSimulation, config.makerSimInitialCashUsdc);
  if (state.simulation.trades.length === 0 && state.orders.length > 0 && state.signals.length > 0) {
    state.simulation = rebuildSimulationFromHistory(
      config.simInitialCashUsdc,
      state.orders,
      state.signals,
      state.quotes,
      state.targetPositions
    );
  }
  let lastLeaderboardRefresh = 0;
  let lastMakerRefresh = 0;
  let rewardMarkets: RewardMarket[] = [];
  let seededQuotes: Record<string, MarketQuote> = {};

  if (config.mode === "live") {
    const geo = await dataApi.geoblock();
    if (geo.blocked) {
      state.risk = {
        ...state.risk,
        blocked: true,
        reasons: [`geoblocked country=${geo.country ?? "unknown"} region=${geo.region ?? "unknown"}`]
      };
      await store.write(state);
      throw new Error(state.risk.reasons[0]);
    }
  }

  logger.info({ mode: config.mode, topN: config.topN }, "copy worker started");

  while (true) {
    try {
      if (Date.now() - lastLeaderboardRefresh >= config.leaderboardRefreshMs || state.walletScores.length === 0) {
        const leaders = await dataApi.leaderboard({ timePeriod: "MONTH", orderBy: "PNL", limit: 50 });
        const positionsByWallet = await loadPositions(dataApi, leaders.map((leader) => leader.proxyWallet));
        state.walletScores = scoreWallets(config, leaders, positionsByWallet);
        state.targetPositions = flattenTargetPositions(config, state.walletScores);
        marketWs.subscribe(uniqueAssets(state.targetPositions));
        lastLeaderboardRefresh = Date.now();
        logger.info({ wallets: state.walletScores.map((wallet) => wallet.wallet) }, "wallet set refreshed");
      }

      if (config.makerEnabled && Date.now() - lastMakerRefresh >= config.makerRefreshMs) {
        rewardMarkets = await clobApi.samplingMarkets();
        const rewardAssets = rewardMarkets.flatMap((market) => market.tokens.map((token) => token.tokenId));
        marketWs.subscribe(rewardAssets);
        seededQuotes = {
          ...seededQuotes,
          ...quoteRecord(await clobApi.prices(rewardAssets))
        };
        lastMakerRefresh = Date.now();
        logger.info(
          { markets: rewardMarkets.length, assets: rewardAssets.length, seededQuotes: Object.keys(seededQuotes).length },
          "maker reward markets refreshed"
        );
      }

      const events = await loadActivity(dataApi, state.walletScores.map((wallet) => wallet.wallet), config.activityLimit);
      const signals = engine.signalsFromActivities(config, state.walletScores, events, state.cycleStartedAt);
      for (const signal of signals) {
        const quote = marketWs.getQuote(signal.asset);
        let planned = executor.toOrder(signal, quote);
        planned = prepareOrderWithStrategyGuards(config, signal, planned, state.simulation);
        const notional = signal.side === "BUY" ? planned.amount : planned.amount * planned.worstPrice;
        const risk = canSubmitOrder(state.risk, config, notional);
        const order = risk.ok ? await executor.executeOrder(planned) : { ...planned, status: "skipped" as const, error: risk.reason };
        state.signals = [signal, ...state.signals].slice(0, 200);
        state.orders = [order, ...state.orders].slice(0, 200);
        state.simulation = applyPaperOrder(state.simulation, order, signal);
        if (risk.ok && order.status !== "skipped" && order.status !== "failed") {
          state.risk = consumeRisk(state.risk, notional);
        }
        logger.info({ signal: signal.id, status: order.status, mode: config.mode }, "copy order processed");
      }
      state.quotes = mergeQuoteRecords(seededQuotes, marketWs.snapshot());
      state.makerCandidates = config.makerEnabled ? scoreMakerCandidates(config, rewardMarkets, state.quotes) : [];
      if (config.makerEnabled && state.makerCandidates.length > 0 && state.makerCandidates.every((candidate) => !candidate.decision.eligible)) {
        const missingBookAssets = state.makerCandidates
          .filter((candidate) => candidate.tags.includes("no-live-book"))
          .map((candidate) => candidate.asset);
        if (missingBookAssets.length > 0) {
          seededQuotes = { ...seededQuotes, ...quoteRecord(await clobApi.prices(missingBookAssets)) };
          state.quotes = mergeQuoteRecords(seededQuotes, marketWs.snapshot());
          state.makerCandidates = scoreMakerCandidates(config, rewardMarkets, state.quotes);
        }
      }
      state.arbitrageOpportunities = config.makerEnabled ? findArbitrageOpportunities(state.makerCandidates, state.quotes) : [];
      state.opportunityCenter = config.makerEnabled
        ? buildOpportunityCenter(config, state.makerCandidates, state.arbitrageOpportunities, state.signals)
        : [];
      state.makerSimulation = config.makerEnabled
        ? updateMakerSimulation(config, state.makerSimulation, selectStrategyCandidates(config, state.makerCandidates), state.quotes)
        : state.makerSimulation;
      state.simulation = markSimulation(state.simulation, state.quotes, state.targetPositions);
      state.lastError = undefined;
      await store.write(state);
      if (config.workerRunOnce) {
        marketWs.close();
        logger.info("worker run-once completed");
        return;
      }
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      await store.write(state);
      logger.error({ err: error }, "worker loop failed");
      if (config.workerRunOnce) {
        marketWs.close();
        return;
      }
    }
    await sleep(config.pollIntervalMs);
  }
}

async function loadPositions(dataApi: DataApiClient, wallets: string[]): Promise<Map<string, Position[]>> {
  const entries = await mapLimit(wallets, 8, async (wallet) => [wallet.toLowerCase(), await dataApi.positions(wallet)] as const);
  return new Map(entries);
}

async function loadActivity(dataApi: DataApiClient, wallets: string[], limit: number): Promise<ActivityEvent[]> {
  const nested = await mapLimit(wallets, 6, async (wallet) => dataApi.activity(wallet, limit));
  return nested.flat();
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

function uniqueAssets(positions: Position[]): string[] {
  return [...new Set(positions.map((position) => position.asset).filter(Boolean))];
}

function quoteRecord(quotes: MarketQuote[]): Record<string, MarketQuote> {
  return Object.fromEntries(quotes.map((quote) => [quote.assetId, quote]));
}

function mergeQuoteRecords(base: Record<string, MarketQuote>, overlay: Record<string, MarketQuote>): Record<string, MarketQuote> {
  const merged = { ...base };
  for (const [assetId, quote] of Object.entries(overlay)) {
    const current = merged[assetId];
    merged[assetId] = current
      ? {
          assetId,
          bid: quote.bid ?? current.bid,
          ask: quote.ask ?? current.ask,
          last: quote.last ?? current.last,
          updatedAt: Math.max(current.updatedAt, quote.updatedAt)
        }
      : quote;
  }
  return merged;
}

main().catch((error) => {
  logger.error({ err: error }, "worker crashed");
  process.exitCode = 1;
});
