import { describe, expect, it } from "vitest";
import { buildOpportunityCenter } from "../src/services/opportunityCenter.js";
import type { AppConfig, MakerCandidate } from "../src/shared/types.js";

const config = {
  mode: "paper",
  port: 8787,
  dataApiBase: "https://data-api.polymarket.com",
  clobHost: "https://clob.polymarket.com",
  marketWsUrl: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  topN: 3,
  totalBudgetUsdc: 100,
  pollIntervalMs: 2000,
  leaderboardRefreshMs: 60000,
  activityLimit: 100,
  minWalletPnl: 0,
  minWalletVolume: 0,
  minPositionValueUsdc: 1,
  maxPositionValueUsdc: 100,
  maxSingleOrderUsdc: 10,
  maxDailyOrderCount: 20,
  maxDailyNotionalUsdc: 100,
  maxSlippageBps: 100,
  signalStaleMs: 60000,
  maxSignalApiDelayMs: 30000,
  maxAssetExposureUsdc: 20,
  maxConditionExposureUsdc: 25,
  maxOpenCopyPositions: 12,
  minSourceTradeUsdc: 50,
  marketCooldownMs: 1000,
  minCopyPrice: 0.05,
  maxCopyPrice: 0.95,
  minSignalScore: 20,
  excludeSportsMarkets: true,
  makerEnabled: true,
  makerRefreshMs: 60000,
  makerTopN: 20,
  makerMinDailyReward: 1,
  makerMaxSpreadBps: 500,
  makerMinScore: 20,
  makerQuoteSizeUsdc: 10,
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

describe("opportunity center", () => {
  it("separates executable maker, watch maker, arbitrage, and avoided copy signals", () => {
    const opportunities = buildOpportunityCenter(
      config,
      [makerCandidate("eligible", true, 62, []), makerCandidate("watch", false, 52, ["strategy score 52 < 55"])],
      [
        {
          id: "condition:buy-basket",
          conditionId: "condition",
          title: "Binary arb",
          type: "buy-basket",
          yesAsset: "yes",
          noAsset: "no",
          yesPrice: 0.48,
          noPrice: 0.51,
          combinedPrice: 0.99,
          edge: 0.01,
          edgeBps: 100,
          executable: true,
          reason: "buy YES + NO below 1.00 before fees/slippage",
          updatedAt: 3
        }
      ],
      [
        {
          id: "copy-risk",
          sourceWallet: "wallet",
          detectedAt: 4,
          sourceTimestamp: 1,
          side: "BUY",
          asset: "asset",
          conditionId: "condition-copy",
          title: "Fast sports market",
          outcome: "Yes",
          sourceSize: 1,
          sourcePrice: 0.5,
          sourceUsdcSize: 1,
          targetUsdcAmount: 1,
          targetShareAmount: 2,
          walletWeight: 1,
          reason: "test",
          apiDelayMs: 1000,
          signalScore: 10,
          rejectReasons: ["sports market excluded"],
          tags: ["sports"]
        }
      ]
    );

    expect(opportunities.some((item) => item.source === "arbitrage" && item.tier === "execute")).toBe(true);
    expect(opportunities.some((item) => item.id === "maker:condition-eligible:asset-eligible" && item.tier === "execute")).toBe(true);
    expect(opportunities.some((item) => item.id === "watch:condition-watch:asset-watch" && item.tier === "watch")).toBe(true);
    expect(opportunities.some((item) => item.source === "copy" && item.tier === "avoid")).toBe(true);
  });
});

function makerCandidate(id: string, eligible: boolean, strategyScore: number, reasons: string[]): MakerCandidate {
  return {
    id: `condition-${id}:asset-${id}`,
    conditionId: `condition-${id}`,
    title: `Maker ${id}`,
    outcome: "Yes",
    asset: `asset-${id}`,
    dailyReward: 100,
    minSize: 3,
    maxSpread: 3.5,
    maxSpreadBps: 350,
    bid: 0.49,
    ask: 0.51,
    mid: 0.5,
    score: 70,
    strategyScore,
    strategy: {
      rewardYield: 20,
      spreadYield: 10,
      rebatePotential: 10,
      holdingRewardPotential: 8,
      inventoryRisk: 20,
      catalystRisk: 6,
      liquidityRisk: 10,
      competitionRisk: 8,
      total: strategyScore
    },
    decision: { eligible, reasons, tier: eligible ? "watch" : "avoid" },
    rewardEstimate: {
      captureRate: 0.02,
      estimatedDailyReward: 2,
      existingCompetitionScore: 100,
      proposedQuoteScore: 2,
      confidence: "high",
      model: "book-competition"
    },
    tags: [],
    rejectReasons: [],
    quotePlan: {
      asset: `asset-${id}`,
      outcome: "Yes",
      bidPrice: 0.48,
      askPrice: 0.52,
      minSize: 3,
      quoteSizeUsdc: 10,
      maxSpreadBps: 350,
      referenceMid: 0.5
    },
    updatedAt: 2
  };
}
