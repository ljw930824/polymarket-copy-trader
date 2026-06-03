import type { AppConfig, CopyOrder, CopySignal, MarketQuote } from "../shared/types.js";

export class OrderExecutor {
  constructor(private readonly config: AppConfig) {}

  async execute(signal: CopySignal, quote?: MarketQuote): Promise<CopyOrder> {
    const order = this.toOrder(signal, quote);
    return this.executeOrder(order);
  }

  async executeOrder(order: CopyOrder): Promise<CopyOrder> {
    if (order.status === "skipped") return order;
    if (this.config.mode === "paper") {
      return { ...order, status: "filled", response: { paper: true } };
    }
    return this.executeLive(order);
  }

  toOrder(signal: CopySignal, quote?: MarketQuote): CopyOrder {
    const side = signal.side;
    const referencePrice = side === "BUY" ? quote?.ask : quote?.bid;
    const fallback = signal.sourcePrice;
    const px = referencePrice && referencePrice > 0 ? referencePrice : fallback;
    if (!px || px <= 0) {
      return this.skipped(signal, "missing usable price");
    }
    const slip = this.config.maxSlippageBps / 10_000;
    const worstPrice = side === "BUY" ? Math.min(0.99, px * (1 + slip)) : Math.max(0.01, px * (1 - slip));
    const amount =
      side === "BUY"
        ? Math.min(signal.targetUsdcAmount, this.config.maxSingleOrderUsdc)
        : Math.min(signal.targetShareAmount, this.config.maxSingleOrderUsdc / worstPrice);
    if (!Number.isFinite(amount) || amount <= 0) {
      return this.skipped(signal, "order amount is zero");
    }
    return {
      id: `order:${signal.id}`,
      signalId: signal.id,
      createdAt: Date.now(),
      side,
      asset: signal.asset,
      amount,
      worstPrice,
      mode: this.config.mode,
      status: "planned"
    };
  }

  private skipped(signal: CopySignal, reason: string): CopyOrder {
    return {
      id: `order:${signal.id}`,
      signalId: signal.id,
      createdAt: Date.now(),
      side: signal.side,
      asset: signal.asset,
      amount: 0,
      worstPrice: 0,
      mode: this.config.mode,
      status: "skipped",
      error: reason
    };
  }

  private async executeLive(order: CopyOrder): Promise<CopyOrder> {
    const { ClobClient, Side, OrderType } = await import("@polymarket/clob-client-v2");
    const { createWalletClient, http } = await import("viem");
    const { privateKeyToAccount } = await import("viem/accounts");

    if (!this.config.privateKey || !this.config.polyFunderAddress) {
      throw new Error("live mode requires PRIVATE_KEY and POLY_FUNDER_ADDRESS");
    }
    const account = privateKeyToAccount(this.config.privateKey);
    const signer = createWalletClient({ account, transport: http() });
    const client = new ClobClient({
      host: this.config.clobHost,
      chain: 137,
      signer,
      creds: {
        key: this.config.polyApiKey,
        secret: this.config.polyApiSecret,
        passphrase: this.config.polyPassphrase
      },
      signatureType: this.config.polySignatureType,
      funderAddress: this.config.polyFunderAddress
    } as never);

    try {
      const response = await client.createAndPostMarketOrder(
        {
          tokenID: order.asset,
          side: order.side === "BUY" ? Side.BUY : Side.SELL,
          amount: order.amount,
          price: order.worstPrice
        },
        { tickSize: "0.01", negRisk: false },
        OrderType.FAK
      );
      return { ...order, status: statusFromResponse(response), response };
    } catch (error) {
      return { ...order, status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }
}

function statusFromResponse(response: unknown): CopyOrder["status"] {
  const text = JSON.stringify(response).toLowerCase();
  if (text.includes("failed") || text.includes("error")) return "failed";
  if (text.includes("partial")) return "partial";
  return "submitted";
}
