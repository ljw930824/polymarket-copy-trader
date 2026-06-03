import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppState, CopyMode, RiskState, SimulationState } from "./types.js";

export const DEFAULT_STATE_PATH = "data/state.json";

export function emptyRisk(): RiskState {
  return {
    date: new Date().toISOString().slice(0, 10),
    orderCount: 0,
    notionalUsdc: 0,
    blocked: false,
    reasons: []
  };
}

export function createSimulationState(initialCash = 0): SimulationState {
  return {
    initialCash,
    cash: initialCash,
    positions: {},
    trades: [],
    totalEquity: initialCash,
    realizedPnl: 0,
    unrealizedPnl: 0,
    totalPnl: 0,
    roi: 0,
    winRate: 0,
    maxDrawdown: 0,
    equityHighWatermark: initialCash,
    updatedAt: Date.now()
  };
}

export function createEmptyState(mode: CopyMode): AppState {
  return {
    updatedAt: Date.now(),
    mode,
    walletScores: [],
    targetPositions: [],
    quotes: {},
    signals: [],
    orders: [],
    simulation: createSimulationState(),
    risk: emptyRisk()
  };
}

export class JsonStateStore {
  constructor(private readonly path = DEFAULT_STATE_PATH) {}

  async read(mode: CopyMode = "paper"): Promise<AppState> {
    try {
      const raw = await readFile(this.path, "utf8");
      return JSON.parse(raw) as AppState;
    } catch {
      return createEmptyState(mode);
    }
  }

  async write(state: AppState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const next = { ...state, updatedAt: Date.now() };
    await writeFile(this.path, JSON.stringify(next, null, 2));
  }
}
