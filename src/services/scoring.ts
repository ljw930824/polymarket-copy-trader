import type { AppConfig, LeaderboardTrader, Position, WalletScore } from "../shared/types.js";

export function scoreWallets(
  config: AppConfig,
  leaders: LeaderboardTrader[],
  positionsByWallet: Map<string, Position[]>
): WalletScore[] {
  return leaders
    .map((leader) => {
      const positions = (positionsByWallet.get(leader.proxyWallet.toLowerCase()) ?? []).filter(
        (position) => position.currentValue >= config.minPositionValueUsdc
      );
      const currentValue = sum(positions.map((position) => position.currentValue));
      const roi = currentValue > 0 ? sum(positions.map((position) => position.cashPnl)) / currentValue : 0;
      return {
        wallet: leader.proxyWallet,
        userName: leader.userName,
        rank: Number(leader.rank) || 0,
        pnl: leader.pnl,
        volume: leader.vol,
        roi,
        currentValue,
        positions,
        score: leader.pnl * 0.65 + roi * 10_000 * 0.25 + Math.log10(Math.max(leader.vol, 1)) * 100 * 0.1
      };
    })
    .filter((wallet) => wallet.pnl >= config.minWalletPnl)
    .filter((wallet) => wallet.volume >= config.minWalletVolume)
    .filter((wallet) => wallet.currentValue > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.topN);
}

export function flattenTargetPositions(config: AppConfig, wallets: WalletScore[]): Position[] {
  const totals = wallets.map((wallet) => wallet.currentValue);
  const grandTotal = sum(totals);
  if (grandTotal <= 0) return [];
  return wallets.flatMap((wallet) => {
    const walletBudget = (wallet.currentValue / grandTotal) * config.totalBudgetUsdc;
    const positionTotal = sum(wallet.positions.map((position) => position.currentValue));
    return wallet.positions
      .filter((position) => position.currentValue >= config.minPositionValueUsdc)
      .map((position) => ({
        ...position,
        currentValue: Math.min(
          config.maxPositionValueUsdc,
          positionTotal > 0 ? (position.currentValue / positionTotal) * walletBudget : 0
        )
      }));
  });
}

export function walletWeights(wallets: WalletScore[]): Map<string, number> {
  const total = sum(wallets.map((wallet) => wallet.currentValue));
  return new Map(wallets.map((wallet) => [wallet.wallet.toLowerCase(), total > 0 ? wallet.currentValue / total : 0]));
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
}
