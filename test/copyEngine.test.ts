import { describe, expect, it } from "vitest";
import { CopyEngine } from "../src/services/copyEngine.js";
import type { ActivityEvent, AppConfig, WalletScore } from "../src/shared/types.js";

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
  marketCooldownMs: 30000,
  minCopyPrice: 0.05,
  maxCopyPrice: 0.85,
  minSignalScore: 60,
  excludeSportsMarkets: true,
  makerEnabled: true,
  makerRefreshMs: 180000,
  makerTopN: 20,
  makerMinDailyReward: 1,
  makerMaxSpreadBps: 350,
  makerMinScore: 55,
  makerQuoteSizeUsdc: 5,
  makerSimInitialCashUsdc: 100,
  makerSimTopN: 8,
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

describe("copy engine", () => {
  it("emits one fresh signal and deduplicates repeats", () => {
    const engine = new CopyEngine();
    const wallet = "0x0000000000000000000000000000000000000001";
    const wallets: WalletScore[] = [
      { wallet, rank: 1, pnl: 10, volume: 1000, roi: 0.1, currentValue: 50, score: 1, positions: [] }
    ];
    const event: ActivityEvent = {
      proxyWallet: wallet,
      timestamp: Math.floor(Date.now() / 1000),
      conditionId: "0xabc",
      type: "TRADE",
      size: 20,
      usdcSize: 8,
      transactionHash: "0xhash",
      price: 0.4,
      asset: "asset",
      side: "BUY"
    };
    expect(engine.signalsFromActivities(config, wallets, [event])).toHaveLength(1);
    expect(engine.signalsFromActivities(config, wallets, [event])).toHaveLength(0);
  });

  it("marks small and sports/fast source trades as rejected", () => {
    const engine = new CopyEngine();
    const wallet = "0x0000000000000000000000000000000000000001";
    const wallets: WalletScore[] = [
      { wallet, rank: 1, pnl: 10, volume: 1000, roi: 0.1, currentValue: 50, score: 1, positions: [] }
    ];
    const signal = engine.signalsFromActivities(config, wallets, [
      {
        proxyWallet: wallet,
        timestamp: Math.floor(Date.now() / 1000),
        conditionId: "sports",
        type: "TRADE",
        size: 10,
        usdcSize: 5,
        transactionHash: "0xsports",
        price: 0.5,
        asset: "sports-asset",
        side: "BUY",
        title: "Will Scotland win the 2026 FIFA World Cup?"
      }
    ])[0];

    expect(signal.tags).toContain("sports");
    expect(signal.rejectReasons).toContain("sports market excluded");
    expect(signal.rejectReasons.some((reason) => reason.includes("source trade"))).toBe(true);
  });
});
