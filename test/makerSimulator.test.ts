import { describe, expect, it } from "vitest";
import { createMakerSimulationState } from "../src/shared/store.js";
import { updateMakerSimulation } from "../src/services/makerSimulator.js";
import type { AppConfig, MakerCandidate } from "../src/shared/types.js";

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
  makerTopN: 20,
  makerMinDailyReward: 1,
  makerMaxSpreadBps: 500,
  makerMinScore: 30,
  makerQuoteSizeUsdc: 10,
  makerSimInitialCashUsdc: 100,
  makerSimTopN: 3,
  makerSimMaxMarketExposureUsdc: 50,
  makerSimRewardCaptureRate: 0.02,
  makerSimFillThresholdBps: 25,
  simInitialCashUsdc: 100,
  workerRunOnce: false,
  polySignatureType: 3
} satisfies AppConfig;

describe("maker simulator", () => {
  it("simulates passive bid and ask fills, marks inventory, and accrues estimated rewards", () => {
    const t0 = 1_000_000;
    const candidate = makerCandidate();
    let simulation = createMakerSimulationState(100);
    simulation.updatedAt = t0;
    simulation.lastMidByAsset[candidate.asset] = 0.5;

    simulation = updateMakerSimulation(
      config,
      simulation,
      [candidate],
      { [candidate.asset]: { assetId: candidate.asset, bid: 0.47, ask: 0.49, updatedAt: t0 + 60_000 } },
      t0 + 60_000
    );

    expect(simulation.trades[0].side).toBe("BUY");
    expect(simulation.cash).toBeCloseTo(90);
    expect(simulation.positions[candidate.asset].shares).toBeGreaterThan(0);
    expect(simulation.accruedReward).toBeGreaterThan(0);

    simulation = updateMakerSimulation(
      config,
      simulation,
      [candidate],
      { [candidate.asset]: { assetId: candidate.asset, bid: 0.52, ask: 0.54, updatedAt: t0 + 120_000 } },
      t0 + 120_000
    );

    expect(simulation.trades[0].side).toBe("SELL");
    expect(simulation.realizedPnl).toBeGreaterThan(0);
    expect(simulation.totalEquity).toBeGreaterThan(100);
    expect(simulation.snapshots).toHaveLength(2);
  });
});

function makerCandidate(): MakerCandidate {
  return {
    id: "condition-a:asset-a",
    conditionId: "condition-a",
    title: "Will test market resolve yes?",
    outcome: "Yes",
    asset: "asset-a",
    dailyReward: 100,
    minSize: 5,
    maxSpread: 3.5,
    maxSpreadBps: 350,
    bid: 0.49,
    ask: 0.51,
    mid: 0.5,
    score: 80,
    tags: [],
    rejectReasons: [],
    quotePlan: {
      asset: "asset-a",
      outcome: "Yes",
      bidPrice: 0.49,
      askPrice: 0.51,
      minSize: 5,
      quoteSizeUsdc: 10,
      maxSpreadBps: 350,
      referenceMid: 0.5
    },
    updatedAt: 1
  };
}
