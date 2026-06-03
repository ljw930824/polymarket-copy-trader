import type { ActivityEvent, LeaderboardTrader, Position } from "../shared/types.js";
import { fetchJson } from "../shared/http.js";

export interface LeaderboardParams {
  category?: string;
  timePeriod?: "DAY" | "WEEK" | "MONTH" | "ALL";
  orderBy?: "PNL" | "VOL";
  limit?: number;
  offset?: number;
}

export class DataApiClient {
  constructor(private readonly baseUrl: string) {}

  async leaderboard(params: LeaderboardParams = {}): Promise<LeaderboardTrader[]> {
    const url = this.url("/v1/leaderboard", {
      category: params.category ?? "OVERALL",
      timePeriod: params.timePeriod ?? "MONTH",
      orderBy: params.orderBy ?? "PNL",
      limit: String(params.limit ?? 50),
      offset: String(params.offset ?? 0)
    });
    return fetchJson<LeaderboardTrader[]>(url);
  }

  async positions(user: string, limit = 500, sizeThreshold = 0): Promise<Position[]> {
    const url = this.url("/positions", {
      user,
      limit: String(limit),
      sizeThreshold: String(sizeThreshold),
      sortBy: "CURRENT",
      sortDirection: "DESC"
    });
    return fetchJson<Position[]>(url);
  }

  async activity(user: string, limit: number): Promise<ActivityEvent[]> {
    const url = this.url("/activity", {
      user,
      limit: String(limit),
      type: "TRADE",
      sortBy: "TIMESTAMP",
      sortDirection: "DESC"
    });
    return fetchJson<ActivityEvent[]>(url);
  }

  async geoblock(): Promise<{ blocked: boolean; ip?: string; country?: string; region?: string }> {
    return fetchJson(new URL("https://polymarket.com/api/geoblock"));
  }

  private url(path: string, params: Record<string, string>): URL {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url;
  }
}
