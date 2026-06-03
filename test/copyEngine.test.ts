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
});
