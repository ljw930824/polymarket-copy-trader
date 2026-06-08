import { describe, expect, it } from "vitest";
import { prepareOrderWithStrategyGuards } from "../src/services/strategyGuards.js";
import { createSimulationState } from "../src/shared/store.js";
import type { AppConfig, CopyOrder, CopySignal } from "../src/shared/types.js";

const config = {
  mode: "paper",
  port: 8787,
  dataApiBase: "https://data-api.polymarket.com",
  clobHost: "https://clob.polymarket.com",
  marketWsUrl: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  topN: 1,
  totalBudgetUsdc: 100,
  pollIntervalMs: 1500,
  leaderboardRefreshMs: 300000,
  activityLimit: 25,
  minWalletPnl: 0,
  minWalletVolume: 1000,
  minPositionValueUsdc: 1,
  maxPositionValueUsdc: 80,
  maxSingleOrderUsdc: 10,
  maxDailyOrderCount: 100,
  maxDailyNotionalUsdc: 500,
  maxSlippageBps: 250,
  signalStaleMs: 120000,
  maxSignalApiDelayMs: 30000,
  maxAssetExposureUsdc: 20,
  maxConditionExposureUsdc: 25,
  maxOpenCopyPositions: 12,
  minSourceTradeUsdc: 50,
  marketCooldownMs: 300000,
  minCopyPrice: 0.05,
  maxCopyPrice: 0.85,
  minSignalScore: 60,
  excludeSportsMarkets: true,
  makerEnabled: true,
  makerRefreshMs: 180000,
  makerTopN: 20,
  makerMinDailyReward: 1,
  makerMaxSpreadBps: 500,
  makerMinScore: 30,
  makerQuoteSizeUsdc: 10,
  makerSimInitialCashUsdc: 100,
  makerSimTopN: 3,
  makerSimMaxMarketExposureUsdc: 50,
  makerSimRewardCaptureRate: 0.02,
  makerRewardEstimateHaircut: 0.5,
  makerRewardCaptureCap: 0.1,
  makerSimFillThresholdBps: 25,
  strategyMinScore: 55,
  strategyMaxCatalystRisk: 55,
  strategyMaxInventoryRisk: 70,
  simInitialCashUsdc: 100,
  workerRunOnce: false,
  polySignatureType: 3
} satisfies AppConfig;

describe("strategy guards", () => {
  it("skips sell signals before execution when there is no matching simulated position", () => {
    const signal = copySignal("SELL", "asset-without-position");
    const planned = copyOrder(signal, 10, 0.5);

    const guarded = prepareOrderWithStrategyGuards(config, signal, planned, createSimulationState(100));

    expect(guarded.status).toBe("skipped");
    expect(guarded.amount).toBe(0);
    expect(guarded.error).toContain("no simulated position to exit");
  });
});

function copySignal(side: "BUY" | "SELL", asset: string): CopySignal {
  return {
    id: `signal-${side}-${asset}`,
    sourceWallet: "0xwallet",
    detectedAt: Date.now(),
    sourceTimestamp: Date.now(),
    side,
    asset,
    conditionId: "condition-a",
    title: "Test Market",
    outcome: "Yes",
    sourceSize: 10,
    sourcePrice: 0.5,
    sourceUsdcSize: 5,
    targetUsdcAmount: 5,
    targetShareAmount: 10,
    walletWeight: 1,
    reason: "test",
    apiDelayMs: 0,
    signalScore: 100,
    rejectReasons: [],
    tags: []
  };
}

function copyOrder(signal: CopySignal, amount: number, worstPrice: number): CopyOrder {
  return {
    id: `order-${signal.id}`,
    signalId: signal.id,
    createdAt: Date.now(),
    side: signal.side,
    asset: signal.asset,
    amount,
    worstPrice,
    mode: "paper",
    status: "planned"
  };
}
