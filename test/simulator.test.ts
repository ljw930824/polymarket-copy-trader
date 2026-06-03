import { describe, expect, it } from "vitest";
import { createSimulationState } from "../src/shared/store.js";
import type { CopyOrder, CopySignal } from "../src/shared/types.js";
import { applyPaperOrder, markSimulation } from "../src/services/simulator.js";

describe("paper simulator", () => {
  it("tracks buys, partial sells, realized pnl, unrealized pnl, roi, and drawdown", () => {
    let simulation = createSimulationState(100);
    const buySignal = signal("s1", "BUY", "asset-a", 0.5, 20);
    const buyOrder = order("o1", "s1", "BUY", "asset-a", 20, 0.5);
    simulation = applyPaperOrder(simulation, buyOrder, buySignal);

    expect(simulation.cash).toBeCloseTo(80);
    expect(simulation.positions["asset-a"].shares).toBeCloseTo(40);
    expect(simulation.positions["asset-a"].avgCost).toBeCloseTo(0.5);

    simulation = markSimulation(simulation, { "asset-a": { assetId: "asset-a", bid: 0.6, ask: 0.6, updatedAt: 1 } }, []);
    expect(simulation.totalEquity).toBeCloseTo(104);
    expect(simulation.totalPnl).toBeCloseTo(4);
    expect(simulation.roi).toBeCloseTo(0.04);

    const sellSignal = signal("s2", "SELL", "asset-a", 0.7, 10);
    const sellOrder = order("o2", "s2", "SELL", "asset-a", 10, 0.7);
    simulation = applyPaperOrder(simulation, sellOrder, sellSignal);

    expect(simulation.cash).toBeCloseTo(87);
    expect(simulation.positions["asset-a"].shares).toBeCloseTo(30);
    expect(simulation.realizedPnl).toBeCloseTo(2);

    simulation = markSimulation(simulation, { "asset-a": { assetId: "asset-a", bid: 0.4, ask: 0.4, updatedAt: 1 } }, []);
    expect(simulation.totalEquity).toBeCloseTo(99);
    expect(simulation.totalPnl).toBeCloseTo(-1);
    expect(simulation.maxDrawdown).toBeGreaterThan(0);
  });

  it("does not create a negative position when selling without holdings", () => {
    let simulation = createSimulationState(100);
    const sellSignal = signal("s1", "SELL", "asset-a", 0.6, 10);
    const sellOrder = order("o1", "s1", "SELL", "asset-a", 10, 0.6);
    simulation = applyPaperOrder(simulation, sellOrder, sellSignal);

    expect(simulation.cash).toBeCloseTo(100);
    expect(simulation.positions["asset-a"]).toBeUndefined();
    expect(simulation.trades[0].skippedReason).toBe("no simulated position to sell");
  });
});

function signal(id: string, side: "BUY" | "SELL", asset: string, price: number, size: number): CopySignal {
  return {
    id,
    sourceWallet: "0xwallet",
    detectedAt: Date.now(),
    sourceTimestamp: Date.now(),
    side,
    asset,
    conditionId: "condition",
    title: "Test Market",
    outcome: "Yes",
    sourceSize: size,
    sourcePrice: price,
    sourceUsdcSize: size * price,
    targetUsdcAmount: size * price,
    targetShareAmount: size,
    walletWeight: 1,
    reason: "test"
  };
}

function order(
  id: string,
  signalId: string,
  side: "BUY" | "SELL",
  asset: string,
  amount: number,
  price: number
): CopyOrder {
  return {
    id,
    signalId,
    createdAt: Date.now(),
    side,
    asset,
    amount,
    worstPrice: price,
    mode: "paper",
    status: "filled"
  };
}
