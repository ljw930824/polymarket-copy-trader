import { describe, expect, it } from "vitest";
import { scoreMakerCandidates, spreadToBps } from "../src/services/marketMaking.js";
import type { AppConfig, RewardMarket } from "../src/shared/types.js";

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
  marketCooldownMs: 30000,
  minCopyPrice: 0.05,
  maxCopyPrice: 0.85,
  minSignalScore: 60,
  excludeSportsMarkets: true,
  makerEnabled: true,
  makerRefreshMs: 180000,
  makerTopN: 3,
  makerMinDailyReward: 1,
  makerMaxSpreadBps: 350,
  makerMinScore: 50,
  makerQuoteSizeUsdc: 5,
  makerSimInitialCashUsdc: 100,
  makerSimTopN: 8,
  makerSimMaxMarketExposureUsdc: 50,
  makerSimRewardCaptureRate: 0.02,
  makerSimFillThresholdBps: 25,
  simInitialCashUsdc: 100,
  workerRunOnce: false,
  polySignatureType: 3
} satisfies AppConfig;

describe("market making rewards", () => {
  it("scores reward markets and builds passive quote plans", () => {
    const candidates = scoreMakerCandidates(
      config,
      [rewardMarket("Will BTC hit 120k in June?", "asset-a", 120, 3.5), rewardMarket("Will ETH hit 10k in June?", "asset-b", 20, 3.5)],
      {
        "asset-a": { assetId: "asset-a", bid: 0.49, ask: 0.51, updatedAt: 1 },
        "asset-b": { assetId: "asset-b", bid: 0.48, ask: 0.52, updatedAt: 1 }
      }
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].asset).toBe("asset-a");
    expect(candidates[0].quotePlan.bidPrice).toBeLessThan(candidates[0].quotePlan.askPrice);
    expect(candidates[0].quotePlan.quoteSizeUsdc).toBeGreaterThanOrEqual(config.makerQuoteSizeUsdc);
  });

  it("filters excluded sports markets", () => {
    const candidates = scoreMakerCandidates(config, [rewardMarket("Lakers vs Celtics", "asset-sports", 500, 3.5)]);
    expect(candidates).toHaveLength(0);
  });

  it("normalizes spread formats to basis points", () => {
    expect(spreadToBps(0.035)).toBe(350);
    expect(spreadToBps(3.5)).toBe(350);
  });
});

function rewardMarket(question: string, asset: string, dailyReward: number, maxSpread: number): RewardMarket {
  return {
    conditionId: `condition-${asset}`,
    question,
    active: true,
    closed: false,
    acceptingOrders: true,
    minSize: 3,
    maxSpread,
    rates: [{ assetAddress: asset, dailyReward }],
    tokens: [{ tokenId: asset, outcome: "Yes" }]
  };
}
