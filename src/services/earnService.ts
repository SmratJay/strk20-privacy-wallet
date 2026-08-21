/**
 * @file earnService.ts
 * @description PEL Shielded Earn & Lending Vaults
 *
 * ⚠️ SIMULATED / LOCAL PROTOTYPE — vaults, APY, TVL, and utilization are HARDCODED, and
 * deposits/yield are simulated in localStorage. There is NO on-chain vault or yield.
 * MUST NOT be presented as live/real yield.
 */

export interface EarnVault {
  id: string;
  tokenSymbol: string;
  name: string;
  protocolName: string;
  apyPct: number;
  tvlUsd: number;
  utilizationPct: number;
  strategyDescription: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'DYNAMIC';
  isShieldedYield: boolean;
}

export interface UserVaultDeposit {
  vaultId: string;
  depositedAmountTokens: number;
  depositedAmountUsd: number;
  accruedYieldTokens: number;
  accruedYieldUsd: number;
  lastUpdated: number;
}

const DEFAULT_VAULTS: EarnVault[] = [
  {
    id: 'vault_strk_vesu',
    tokenSymbol: 'STRK',
    name: 'STRK Shielded Yield Vault',
    protocolName: 'Vesu + PEL Anonymizer',
    apyPct: 8.45,
    tvlUsd: 14850000,
    utilizationPct: 76.5,
    strategyDescription: 'Supplies private STRK liquidity to overcollateralized lending markets with shielded interest compounding.',
    riskLevel: 'LOW',
    isShieldedYield: true,
  },
  {
    id: 'vault_usdc_money_market',
    tokenSymbol: 'USDC',
    name: 'USDC Private Money Market',
    protocolName: 'Starknet Prime Vaults',
    apyPct: 11.20,
    tvlUsd: 38900000,
    utilizationPct: 88.2,
    strategyDescription: 'Institutional delta-neutral basis capture and delta-hedged lending with zero counterparty visibility.',
    riskLevel: 'LOW',
    isShieldedYield: true,
  },
  {
    id: 'vault_eth_restaking',
    tokenSymbol: 'ETH',
    name: 'ETH Liquid Staking & Yield',
    protocolName: 'Endur + STRK20 Anonymizer',
    apyPct: 4.80,
    tvlUsd: 22400000,
    utilizationPct: 62.0,
    strategyDescription: 'Liquid staking rewards combined with MEV redistribution through privacy-preserving relayers.',
    riskLevel: 'MEDIUM',
    isShieldedYield: true,
  },
];

class EarnService {
  private vaults: EarnVault[] = DEFAULT_VAULTS;

  getVaults(): EarnVault[] {
    return this.vaults;
  }

  getVault(id: string): EarnVault | undefined {
    return this.vaults.find((v) => v.id === id);
  }

  getUserDeposits(walletAddress: string, tokenPrices: Record<string, number>): UserVaultDeposit[] {
    if (typeof window === 'undefined') return [];
    try {
      const key = `pel_earn_deposits_${walletAddress.toLowerCase()}`;
      const saved = localStorage.getItem(key);
      if (!saved) return [];
      const deposits: UserVaultDeposit[] = JSON.parse(saved);

      // Simulate live interest accrual based on APY
      const now = Date.now();
      return deposits.map((dep) => {
        const vault = this.getVault(dep.vaultId);
        if (!vault) return dep;
        const price = tokenPrices[vault.tokenSymbol] || 1;
        const elapsedYears = (now - dep.lastUpdated) / (1000 * 60 * 60 * 24 * 365);
        const incrementalYield = dep.depositedAmountTokens * (vault.apyPct / 100) * Math.max(0, elapsedYears);
        const totalYieldTokens = dep.accruedYieldTokens + incrementalYield;

        return {
          ...dep,
          depositedAmountUsd: Number((dep.depositedAmountTokens * price).toFixed(2)),
          accruedYieldTokens: Number(totalYieldTokens.toFixed(6)),
          accruedYieldUsd: Number((totalYieldTokens * price).toFixed(2)),
          lastUpdated: now,
        };
      });
    } catch {
      return [];
    }
  }

  depositToVault(
    walletAddress: string,
    vaultId: string,
    amountTokens: number,
    tokenPrices: Record<string, number>
  ): UserVaultDeposit {
    const vault = this.getVault(vaultId) || DEFAULT_VAULTS[0];
    const price = tokenPrices[vault.tokenSymbol] || 1;
    const key = `pel_earn_deposits_${walletAddress.toLowerCase()}`;

    const currentDeposits = this.getUserDeposits(walletAddress, tokenPrices);
    const existingIdx = currentDeposits.findIndex((d) => d.vaultId === vaultId);

    let updated: UserVaultDeposit;
    if (existingIdx !== -1) {
      currentDeposits[existingIdx].depositedAmountTokens += amountTokens;
      currentDeposits[existingIdx].depositedAmountUsd = Number(
        (currentDeposits[existingIdx].depositedAmountTokens * price).toFixed(2)
      );
      currentDeposits[existingIdx].lastUpdated = Date.now();
      updated = currentDeposits[existingIdx];
    } else {
      updated = {
        vaultId,
        depositedAmountTokens: amountTokens,
        depositedAmountUsd: Number((amountTokens * price).toFixed(2)),
        accruedYieldTokens: 0,
        accruedYieldUsd: 0,
        lastUpdated: Date.now(),
      };
      currentDeposits.push(updated);
    }

    if (typeof window !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(currentDeposits));
    }

    return updated;
  }

  withdrawFromVault(
    walletAddress: string,
    vaultId: string,
    amountTokens: number,
    tokenPrices: Record<string, number>
  ): boolean {
    const key = `pel_earn_deposits_${walletAddress.toLowerCase()}`;
    const currentDeposits = this.getUserDeposits(walletAddress, tokenPrices);
    const existingIdx = currentDeposits.findIndex((d) => d.vaultId === vaultId);
    if (existingIdx === -1) return false;

    if (currentDeposits[existingIdx].depositedAmountTokens < amountTokens) return false;
    currentDeposits[existingIdx].depositedAmountTokens -= amountTokens;
    currentDeposits[existingIdx].lastUpdated = Date.now();

    if (typeof window !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(currentDeposits));
    }
    return true;
  }
}

export const earnService = new EarnService();
