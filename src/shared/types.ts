export type CopyMode = "paper" | "live";
export type Side = "BUY" | "SELL";

export interface AppConfig {
  mode: CopyMode;
  port: number;
  dataApiBase: string;
  clobHost: string;
  marketWsUrl: string;
  topN: number;
  totalBudgetUsdc: number;
  pollIntervalMs: number;
  leaderboardRefreshMs: number;
  activityLimit: number;
  minWalletPnl: number;
  minWalletVolume: number;
  minPositionValueUsdc: number;
  maxPositionValueUsdc: number;
  maxSingleOrderUsdc: number;
  maxDailyOrderCount: number;
  maxDailyNotionalUsdc: number;
  maxSlippageBps: number;
  signalStaleMs: number;
  maxSignalApiDelayMs: number;
  maxAssetExposureUsdc: number;
  marketCooldownMs: number;
  minCopyPrice: number;
  maxCopyPrice: number;
  minSignalScore: number;
  excludeSportsMarkets: boolean;
  makerEnabled: boolean;
  makerRefreshMs: number;
  makerTopN: number;
  makerMinDailyReward: number;
  makerMaxSpreadBps: number;
  makerMinScore: number;
  makerQuoteSizeUsdc: number;
  makerSimInitialCashUsdc: number;
  makerSimTopN: number;
  makerSimMaxMarketExposureUsdc: number;
  makerSimRewardCaptureRate: number;
  makerSimFillThresholdBps: number;
  simInitialCashUsdc: number;
  workerRunOnce: boolean;
  privateKey?: `0x${string}`;
  polyApiKey?: string;
  polyApiSecret?: string;
  polyPassphrase?: string;
  polySignatureType: number;
  polyFunderAddress?: `0x${string}`;
}

export interface LeaderboardTrader {
  rank: string;
  proxyWallet: string;
  userName?: string;
  vol: number;
  pnl: number;
  profileImage?: string;
  xUsername?: string;
  verifiedBadge?: boolean;
}

export interface Position {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  percentRealizedPnl: number;
  curPrice: number;
  redeemable?: boolean;
  mergeable?: boolean;
  title?: string;
  slug?: string;
  icon?: string;
  eventSlug?: string;
  outcome?: string;
  outcomeIndex?: number;
  oppositeOutcome?: string;
  oppositeAsset?: string;
  endDate?: string;
  negativeRisk?: boolean;
}

export interface WalletScore {
  wallet: string;
  userName?: string;
  rank: number;
  pnl: number;
  volume: number;
  roi: number;
  currentValue: number;
  score: number;
  positions: Position[];
}

export interface ActivityEvent {
  proxyWallet: string;
  timestamp: number;
  conditionId: string;
  type: string;
  size: number;
  usdcSize?: number;
  transactionHash?: string;
  price: number;
  asset: string;
  side?: Side;
  outcomeIndex?: number;
  title?: string;
  slug?: string;
  eventSlug?: string;
  outcome?: string;
}

export interface MarketQuote {
  assetId: string;
  bid?: number;
  ask?: number;
  last?: number;
  updatedAt: number;
}

export interface RewardRate {
  assetAddress: string;
  dailyReward: number;
}

export interface RewardMarket {
  conditionId: string;
  question: string;
  slug?: string;
  marketSlug?: string;
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
  minSize: number;
  maxSpread: number;
  rates: RewardRate[];
  tokens: Array<{
    tokenId: string;
    outcome: string;
  }>;
}

export interface MakerQuotePlan {
  asset: string;
  outcome: string;
  bidPrice: number;
  askPrice: number;
  minSize: number;
  quoteSizeUsdc: number;
  maxSpreadBps: number;
  referenceMid: number;
}

export interface MakerCandidate {
  id: string;
  conditionId: string;
  title: string;
  slug?: string;
  outcome: string;
  asset: string;
  dailyReward: number;
  minSize: number;
  maxSpread: number;
  maxSpreadBps: number;
  bid?: number;
  ask?: number;
  mid?: number;
  score: number;
  tags: string[];
  rejectReasons: string[];
  quotePlan: MakerQuotePlan;
  updatedAt: number;
}

export interface CopySignal {
  id: string;
  sourceWallet: string;
  detectedAt: number;
  sourceTimestamp: number;
  side: Side;
  asset: string;
  conditionId: string;
  title?: string;
  outcome?: string;
  sourceSize: number;
  sourcePrice: number;
  sourceUsdcSize: number;
  targetUsdcAmount: number;
  targetShareAmount: number;
  walletWeight: number;
  reason: string;
  apiDelayMs: number;
  signalScore: number;
  rejectReasons: string[];
  tags: string[];
}

export interface CopyOrder {
  id: string;
  signalId: string;
  createdAt: number;
  side: Side;
  asset: string;
  amount: number;
  worstPrice: number;
  mode: CopyMode;
  status: "planned" | "submitted" | "filled" | "partial" | "skipped" | "failed";
  response?: unknown;
  error?: string;
}

export interface SimulationTrade {
  id: string;
  orderId: string;
  signalId: string;
  timestamp: number;
  side: Side;
  asset: string;
  title?: string;
  outcome?: string;
  shares: number;
  price: number;
  notional: number;
  cashAfter: number;
  realizedPnl: number;
  skippedReason?: string;
}

export interface SimulationPosition {
  asset: string;
  title?: string;
  outcome?: string;
  shares: number;
  avgCost: number;
  costBasis: number;
  markPrice: number;
  marketValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

export interface SimulationState {
  initialCash: number;
  cash: number;
  positions: Record<string, SimulationPosition>;
  trades: SimulationTrade[];
  totalEquity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  roi: number;
  winRate: number;
  maxDrawdown: number;
  equityHighWatermark: number;
  updatedAt: number;
}

export interface MakerSimulationPosition {
  asset: string;
  conditionId: string;
  title: string;
  outcome: string;
  shares: number;
  avgCost: number;
  costBasis: number;
  markPrice: number;
  marketValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  dailyReward: number;
  score: number;
  updatedAt: number;
}

export interface MakerSimulationTrade {
  id: string;
  timestamp: number;
  candidateId: string;
  side: Side;
  asset: string;
  conditionId: string;
  title: string;
  outcome: string;
  price: number;
  shares: number;
  notional: number;
  cashAfter: number;
  realizedPnl: number;
  reason: string;
  score: number;
}

export interface MakerSimulationSnapshot {
  timestamp: number;
  candidateCount: number;
  activeQuoteCount: number;
  topScore: number;
  estimatedDailyReward: number;
  accruedReward: number;
  cash: number;
  inventoryValue: number;
  totalEquity: number;
  totalPnl: number;
  roi: number;
  maxDrawdown: number;
}

export interface MakerSimulationState {
  initialCash: number;
  cash: number;
  positions: Record<string, MakerSimulationPosition>;
  trades: MakerSimulationTrade[];
  snapshots: MakerSimulationSnapshot[];
  lastMidByAsset: Record<string, number>;
  accruedReward: number;
  inventoryValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalEquity: number;
  totalPnl: number;
  roi: number;
  maxDrawdown: number;
  equityHighWatermark: number;
  updatedAt: number;
}

export interface RiskState {
  date: string;
  orderCount: number;
  notionalUsdc: number;
  blocked: boolean;
  reasons: string[];
}

export interface AppState {
  updatedAt: number;
  cycleStartedAt: number;
  mode: CopyMode;
  walletScores: WalletScore[];
  targetPositions: Position[];
  makerCandidates: MakerCandidate[];
  quotes: Record<string, MarketQuote>;
  signals: CopySignal[];
  orders: CopyOrder[];
  simulation: SimulationState;
  makerSimulation: MakerSimulationState;
  risk: RiskState;
  lastError?: string;
}
