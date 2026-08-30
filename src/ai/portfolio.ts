/**
 * @file src/ai/portfolio.ts
 * @description Privacy-minimized portfolio representation for the Hamster AI treasury.
 *
 * The AI NEVER sees raw private notes, viewing keys, or per-transaction metadata. It only
 * receives this derived summary: aggregate balances, USD values, allocation percentages and
 * liquidity. Everything here is computed from the existing STRK20 balance reads
 * (`getPrivateBalances` / `privy.getPrivateBalance`) which already return aggregate amounts.
 */
import { SEPOLIA_TOKENS, TokenInfo } from '@/config/networks';
import { isLiquidSymbol } from '@/ai/prices';

export interface PrivateBalanceRow {
  /** Token contract address (lowercase 0x). */
  token: string;
  /** Balance in the token's smallest unit. */
  balance: bigint;
}

export interface PortfolioAssetPosition {
  token: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Balance in the smallest unit (kept exact for the policy engine). */
  balanceBase: string;
  /** Balance in human-readable units. */
  balanceHuman: number;
  /** USD value of this position (price input — see prices.ts). */
  usdValue: number;
  priceUsd: number;
  priceSource: 'avnu' | 'static';
  /** Allocation percentage of total treasury USD. */
  pct: number;
  /** True for STRK/ETH/USDC/USDT (usable toward the liquidity policy). */
  liquid: boolean;
}

export interface PortfolioSummary {
  generatedAt: number;
  totalUsd: number;
  /** USD of liquid assets (usable toward "keep $X liquid"). */
  liquidityUsd: number;
  liquidPct: number;
  /** The largest single-asset position (concentration). */
  topAsset: { symbol: string; pct: number } | null;
  positions: PortfolioAssetPosition[];
}

const TOKENS_BY_ADDR = new Map<string, TokenInfo>(
  SEPOLIA_TOKENS.map((t) => [t.address.toLowerCase(), t]),
);

/**
 * Build the privacy-minimized portfolio summary from aggregate private balances.
 * `priceUsdByToken` and `priceSourceByToken` come from prices.ts (the caller resolves them).
 * Pure + deterministic — no network, no notes, no viewing keys.
 */
export function buildPortfolioSummary(
  rows: PrivateBalanceRow[],
  priceUsdByToken: Record<string, number>,
  priceSourceByToken: Record<string, 'avnu' | 'static'> = {},
  generatedAt = Date.now(),
): PortfolioSummary {
  const positions: PortfolioAssetPosition[] = [];

  for (const row of rows) {
    if (row.balance <= 0n) continue;
    const token = row.token.toLowerCase();
    const meta = TOKENS_BY_ADDR.get(token);
    const symbol = meta?.symbol ?? token.slice(0, 10);
    const decimals = meta?.decimals ?? 18;
    const priceUsd = priceUsdByToken[token] ?? 0;
    const balanceHuman = Number(row.balance) / 10 ** decimals;
    positions.push({
      token,
      symbol,
      name: meta?.name ?? symbol,
      decimals,
      balanceBase: row.balance.toString(),
      balanceHuman,
      usdValue: balanceHuman * priceUsd,
      priceUsd,
      priceSource: priceSourceByToken[token] ?? 'static',
      pct: 0, // filled below
      liquid: isLiquidSymbol(symbol),
    });
  }

  const totalUsd = positions.reduce((s, p) => s + p.usdValue, 0);
  const liquidityUsd = positions.filter((p) => p.liquid).reduce((s, p) => s + p.usdValue, 0);

  const sorted = [...positions].sort((a, b) => b.usdValue - a.usdValue);
  for (const p of positions) {
    p.pct = totalUsd > 0 ? (p.usdValue / totalUsd) * 100 : 0;
  }

  return {
    generatedAt,
    totalUsd,
    liquidityUsd,
    liquidPct: totalUsd > 0 ? (liquidityUsd / totalUsd) * 100 : 0,
    topAsset: sorted[0] ? { symbol: sorted[0].symbol, pct: sorted[0].pct } : null,
    positions,
  };
}