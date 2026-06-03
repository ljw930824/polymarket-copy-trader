import "dotenv/config";
import { z } from "zod";
import type { AppConfig } from "./types.js";

const envSchema = z.object({
  COPY_MODE: z.enum(["paper", "live"]).default("paper"),
  PORT: z.coerce.number().int().positive().default(8787),
  DATA_API_BASE: z.string().url().default("https://data-api.polymarket.com"),
  CLOB_HOST: z.string().url().default("https://clob.polymarket.com"),
  MARKET_WS_URL: z.string().url().default("wss://ws-subscriptions-clob.polymarket.com/ws/market"),
  COPY_TOP_N: z.coerce.number().int().min(1).max(25).default(3),
  COPY_TOTAL_BUDGET_USDC: z.coerce.number().positive().default(100),
  POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(1500),
  LEADERBOARD_REFRESH_MS: z.coerce.number().int().min(30000).default(300000),
  ACTIVITY_LIMIT: z.coerce.number().int().min(1).max(500).default(25),
  MIN_WALLET_PNL: z.coerce.number().default(0),
  MIN_WALLET_VOLUME: z.coerce.number().min(0).default(1000),
  MIN_POSITION_VALUE_USDC: z.coerce.number().min(0).default(1),
  MAX_POSITION_VALUE_USDC: z.coerce.number().positive().default(35),
  MAX_SINGLE_ORDER_USDC: z.coerce.number().positive().default(15),
  MAX_DAILY_ORDER_COUNT: z.coerce.number().int().positive().default(100),
  MAX_DAILY_NOTIONAL_USDC: z.coerce.number().positive().default(500),
  MAX_SLIPPAGE_BPS: z.coerce.number().int().min(0).max(2500).default(250),
  SIGNAL_STALE_MS: z.coerce.number().int().min(1000).default(120000),
  SIM_INITIAL_CASH_USDC: z.coerce.number().positive().optional(),
  WORKER_RUN_ONCE: z.coerce.boolean().default(false),
  PRIVATE_KEY: z.string().optional(),
  POLY_API_KEY: z.string().optional(),
  POLY_API_SECRET: z.string().optional(),
  POLY_PASSPHRASE: z.string().optional(),
  POLY_SIGNATURE_TYPE: z.coerce.number().int().min(0).max(3).default(3),
  POLY_FUNDER_ADDRESS: z.string().optional()
});

export function loadConfig(): AppConfig {
  const env = envSchema.parse(process.env);
  if (env.COPY_MODE === "live") {
    const missing = [
      ["PRIVATE_KEY", env.PRIVATE_KEY],
      ["POLY_API_KEY", env.POLY_API_KEY],
      ["POLY_API_SECRET", env.POLY_API_SECRET],
      ["POLY_PASSPHRASE", env.POLY_PASSPHRASE],
      ["POLY_FUNDER_ADDRESS", env.POLY_FUNDER_ADDRESS]
    ].filter(([, value]) => !value);
    if (missing.length > 0) {
      throw new Error(`COPY_MODE=live is missing ${missing.map(([key]) => key).join(", ")}`);
    }
  }

  return {
    mode: env.COPY_MODE,
    port: env.PORT,
    dataApiBase: env.DATA_API_BASE,
    clobHost: env.CLOB_HOST,
    marketWsUrl: env.MARKET_WS_URL,
    topN: env.COPY_TOP_N,
    totalBudgetUsdc: env.COPY_TOTAL_BUDGET_USDC,
    pollIntervalMs: env.POLL_INTERVAL_MS,
    leaderboardRefreshMs: env.LEADERBOARD_REFRESH_MS,
    activityLimit: env.ACTIVITY_LIMIT,
    minWalletPnl: env.MIN_WALLET_PNL,
    minWalletVolume: env.MIN_WALLET_VOLUME,
    minPositionValueUsdc: env.MIN_POSITION_VALUE_USDC,
    maxPositionValueUsdc: env.MAX_POSITION_VALUE_USDC,
    maxSingleOrderUsdc: env.MAX_SINGLE_ORDER_USDC,
    maxDailyOrderCount: env.MAX_DAILY_ORDER_COUNT,
    maxDailyNotionalUsdc: env.MAX_DAILY_NOTIONAL_USDC,
    maxSlippageBps: env.MAX_SLIPPAGE_BPS,
    signalStaleMs: env.SIGNAL_STALE_MS,
    simInitialCashUsdc: env.SIM_INITIAL_CASH_USDC ?? env.COPY_TOTAL_BUDGET_USDC,
    workerRunOnce: env.WORKER_RUN_ONCE,
    privateKey: env.PRIVATE_KEY as `0x${string}` | undefined,
    polyApiKey: env.POLY_API_KEY,
    polyApiSecret: env.POLY_API_SECRET,
    polyPassphrase: env.POLY_PASSPHRASE,
    polySignatureType: env.POLY_SIGNATURE_TYPE,
    polyFunderAddress: env.POLY_FUNDER_ADDRESS as `0x${string}` | undefined
  };
}
