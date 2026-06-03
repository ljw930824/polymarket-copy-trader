import WebSocket from "ws";
import type { MarketQuote } from "../shared/types.js";

type QuoteCallback = (quote: MarketQuote) => void;

export class MarketWsCache {
  private ws?: WebSocket;
  private heartbeat?: NodeJS.Timeout;
  private readonly quotes = new Map<string, MarketQuote>();
  private readonly subscribed = new Set<string>();

  constructor(
    private readonly wsUrl: string,
    private readonly onQuote?: QuoteCallback
  ) {}

  connect(assetIds: string[]): void {
    for (const assetId of assetIds) this.subscribed.add(assetId);
    if (this.subscribed.size === 0 || this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.wsUrl);
    this.ws.on("open", () => {
      this.sendSubscription([...this.subscribed]);
      this.heartbeat = setInterval(() => this.ws?.send("PING"), 10_000);
    });
    this.ws.on("message", (raw) => this.handleMessage(raw.toString()));
    this.ws.on("close", () => this.cleanup());
    this.ws.on("error", () => this.cleanup());
  }

  subscribe(assetIds: string[]): void {
    const fresh = assetIds.filter((assetId) => !this.subscribed.has(assetId));
    for (const assetId of fresh) this.subscribed.add(assetId);
    if (fresh.length === 0) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ operation: "subscribe", assets_ids: fresh, custom_feature_enabled: true }));
    } else {
      this.connect([...this.subscribed]);
    }
  }

  getQuote(assetId: string): MarketQuote | undefined {
    return this.quotes.get(assetId);
  }

  snapshot(): Record<string, MarketQuote> {
    return Object.fromEntries(this.quotes.entries());
  }

  close(): void {
    this.ws?.close();
    this.cleanup();
  }

  private sendSubscription(assetIds: string[]): void {
    this.ws?.send(JSON.stringify({ assets_ids: assetIds, type: "market", custom_feature_enabled: true }));
  }

  private handleMessage(raw: string): void {
    if (raw === "PONG") return;
    const messages = JSON.parse(raw) as unknown;
    const list = Array.isArray(messages) ? messages : [messages];
    for (const message of list) {
      if (!message || typeof message !== "object") continue;
      const event = message as Record<string, unknown>;
      const assetId = String(event.asset_id ?? event.assetId ?? "");
      if (!assetId) continue;
      const current = this.quotes.get(assetId) ?? { assetId, updatedAt: Date.now() };
      const quote: MarketQuote = {
        assetId,
        bid: numberOr(current.bid, event.best_bid, event.bid),
        ask: numberOr(current.ask, event.best_ask, event.ask),
        last: numberOr(current.last, event.price),
        updatedAt: Date.now()
      };
      this.quotes.set(assetId, quote);
      this.onQuote?.(quote);
    }
  }

  private cleanup(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.ws = undefined;
  }
}

function numberOr(fallback: number | undefined, ...values: unknown[]): number | undefined {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
  }
  return fallback;
}
