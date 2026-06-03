import type { ActivityEvent, AppConfig, CopySignal, RiskState, WalletScore } from "../shared/types.js";
import { walletWeights } from "./scoring.js";

export class CopyEngine {
  private readonly seen: Set<string>;

  constructor(seenIds: string[] = []) {
    this.seen = new Set(seenIds);
  }

  remember(signalIds: string[]): void {
    for (const id of signalIds) this.seen.add(id);
  }

  signalsFromActivities(config: AppConfig, wallets: WalletScore[], events: ActivityEvent[]): CopySignal[] {
    const weights = walletWeights(wallets);
    const now = Date.now();
    const signals: CopySignal[] = [];
    for (const event of events) {
      if (event.type !== "TRADE" || (event.side !== "BUY" && event.side !== "SELL")) continue;
      const id = eventId(event);
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      const sourceTimestamp = normalizeTimestamp(event.timestamp);
      if (now - sourceTimestamp > config.signalStaleMs) continue;
      const walletWeight = weights.get(event.proxyWallet.toLowerCase()) ?? 0;
      if (walletWeight <= 0) continue;
      const sourceUsdcSize = event.usdcSize ?? event.size * event.price;
      const targetUsdcAmount = Math.min(config.maxSingleOrderUsdc, sourceUsdcSize * walletWeight);
      const targetShareAmount = event.price > 0 ? targetUsdcAmount / event.price : 0;
      signals.push({
        id,
        sourceWallet: event.proxyWallet,
        detectedAt: now,
        sourceTimestamp,
        side: event.side,
        asset: event.asset,
        conditionId: event.conditionId,
        title: event.title,
        outcome: event.outcome,
        sourceSize: event.size,
        sourcePrice: event.price,
        sourceUsdcSize,
        targetUsdcAmount,
        targetShareAmount,
        walletWeight,
        reason: "target wallet trade"
      });
    }
    return signals.sort((a, b) => a.sourceTimestamp - b.sourceTimestamp);
  }
}

export function canSubmitOrder(risk: RiskState, config: AppConfig, notionalUsdc: number): { ok: boolean; reason?: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (risk.date !== today) {
    risk.date = today;
    risk.orderCount = 0;
    risk.notionalUsdc = 0;
    risk.reasons = [];
  }
  if (risk.blocked) return { ok: false, reason: risk.reasons.join("; ") || "risk blocked" };
  if (risk.orderCount >= config.maxDailyOrderCount) return { ok: false, reason: "daily order count reached" };
  if (risk.notionalUsdc + notionalUsdc > config.maxDailyNotionalUsdc) {
    return { ok: false, reason: "daily notional limit reached" };
  }
  return { ok: true };
}

export function consumeRisk(risk: RiskState, notionalUsdc: number): RiskState {
  return {
    ...risk,
    orderCount: risk.orderCount + 1,
    notionalUsdc: risk.notionalUsdc + notionalUsdc
  };
}

function eventId(event: ActivityEvent): string {
  return [
    event.transactionHash ?? "nohash",
    event.proxyWallet.toLowerCase(),
    event.asset,
    event.side ?? "NA",
    event.timestamp,
    event.size,
    event.price
  ].join(":");
}

function normalizeTimestamp(timestamp: number): number {
  return timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
}
