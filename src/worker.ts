import pino from "pino";
import { loadConfig } from "./shared/config.js";
import { sleep } from "./shared/http.js";
import { createEmptyState, JsonStateStore } from "./shared/store.js";
import type { ActivityEvent, AppState, Position } from "./shared/types.js";
import { DataApiClient } from "./polymarket/dataApi.js";
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

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

async function main(): Promise<void> {
  const config = loadConfig();
  const dataApi = new DataApiClient(config.dataApiBase);
  const store = new JsonStateStore();
  const executor = new OrderExecutor(config);
  const marketWs = new MarketWsCache(config.marketWsUrl);
  let state: AppState = await store.read(config.mode);
  state = { ...createEmptyState(config.mode), ...state, mode: config.mode };
  const engine = new CopyEngine(state.signals.map((signal) => signal.id));
  state.simulation = ensureSimulation(state.simulation, config.simInitialCashUsdc);
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

      const events = await loadActivity(dataApi, state.walletScores.map((wallet) => wallet.wallet), config.activityLimit);
      const signals = engine.signalsFromActivities(config, state.walletScores, events);
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
      state.quotes = marketWs.snapshot();
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
  const entries = await Promise.all(
    wallets.map(async (wallet) => [wallet.toLowerCase(), await dataApi.positions(wallet)] as const)
  );
  return new Map(entries);
}

async function loadActivity(dataApi: DataApiClient, wallets: string[], limit: number): Promise<ActivityEvent[]> {
  const nested = await Promise.all(wallets.map((wallet) => dataApi.activity(wallet, limit)));
  return nested.flat();
}

function uniqueAssets(positions: Position[]): string[] {
  return [...new Set(positions.map((position) => position.asset).filter(Boolean))];
}

main().catch((error) => {
  logger.error({ err: error }, "worker crashed");
  process.exitCode = 1;
});
