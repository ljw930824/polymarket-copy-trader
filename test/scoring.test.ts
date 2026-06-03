import { describe, expect, it } from "vitest";
import { flattenTargetPositions, scoreWallets } from "../src/services/scoring.js";
import type { AppConfig, LeaderboardTrader, Position } from "../src/shared/types.js";

const config = {
  mode: "paper",
  port: 8787,
  dataApiBase: "https://data-api.polymarket.com",
  clobHost: "https://clob.polymarket.com",
  marketWsUrl: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  topN: 2,
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

describe("scoring", () => {
  it("scores and keeps the configured top wallets", () => {
    const leaders: LeaderboardTrader[] = [
      leader("0x0000000000000000000000000000000000000001", 1, 100, 5000),
      leader("0x0000000000000000000000000000000000000002", 2, 300, 5000),
      leader("0x0000000000000000000000000000000000000003", 3, -5, 5000)
    ];
    const positions = new Map<string, Position[]>([
      [leaders[0].proxyWallet.toLowerCase(), [position(leaders[0].proxyWallet, "a", 20, 5)]],
      [leaders[1].proxyWallet.toLowerCase(), [position(leaders[1].proxyWallet, "b", 40, 8)]],
      [leaders[2].proxyWallet.toLowerCase(), [position(leaders[2].proxyWallet, "c", 40, -2)]]
    ]);
    const wallets = scoreWallets(config, leaders, positions);
    expect(wallets).toHaveLength(2);
    expect(wallets[0].wallet).toBe(leaders[1].proxyWallet);
  });

  it("normalizes target positions into the configured budget", () => {
    const wallets = [
      { wallet: "0x1", rank: 1, pnl: 10, volume: 1000, roi: 0.1, currentValue: 75, score: 1, positions: [position("0x1", "a", 75, 1)] },
      { wallet: "0x2", rank: 2, pnl: 10, volume: 1000, roi: 0.1, currentValue: 25, score: 1, positions: [position("0x2", "b", 25, 1)] }
    ];
    const target = flattenTargetPositions(config, wallets);
    expect(target.map((p) => p.currentValue)).toEqual([75, 25]);
  });
});

function leader(proxyWallet: string, rank: number, pnl: number, vol: number): LeaderboardTrader {
  return { proxyWallet, rank: String(rank), pnl, vol };
}

function position(wallet: string, asset: string, currentValue: number, cashPnl: number): Position {
  return {
    proxyWallet: wallet,
    asset,
    conditionId: "0xabc",
    size: currentValue,
    avgPrice: 0.5,
    initialValue: currentValue - cashPnl,
    currentValue,
    cashPnl,
    percentPnl: cashPnl / currentValue,
    totalBought: currentValue,
    realizedPnl: 0,
    percentRealizedPnl: 0,
    curPrice: 0.5
  };
}
