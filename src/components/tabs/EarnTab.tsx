'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Layers, 
  ShieldCheck, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Sparkles, 
  TrendingUp, 
  CheckCircle2, 
  Lock,
  Zap,
  Info
} from 'lucide-react';
import { earnService, EarnVault, UserVaultDeposit } from '@/services/earnService';
import { ShieldedBalance } from '@/services/privacyService';
import { useToast } from '@/components/Toast';

interface EarnTabProps {
  walletAddress: string;
  balances: ShieldedBalance[];
}

export const EarnTab: React.FC<EarnTabProps> = ({ walletAddress, balances }) => {
  const { showToast } = useToast();
  const vaults = useMemo(() => earnService.getVaults(), []);
  const [deposits, setDeposits] = useState<UserVaultDeposit[]>([]);
  const [selectedVault, setSelectedVault] = useState<EarnVault>(vaults[0]);
  const [depositAmount, setDepositAmount] = useState<string>('50');
  const [isProcessing, setIsProcessing] = useState(false);

  const tokenPrices: Record<string, number> = {
    STRK: 0.584,
    ETH: 3418.75,
    USDC: 1.00,
    USDT: 1.00,
  };

  const loadDeposits = () => {
    if (!walletAddress) return;
    setDeposits(earnService.getUserDeposits(walletAddress, tokenPrices));
  };

  useEffect(() => {
    loadDeposits();
    const interval = setInterval(loadDeposits, 3000);
    return () => clearInterval(interval);
  }, [walletAddress]);

  const totalYieldValueUsd = useMemo(() => {
    return deposits.reduce((acc, d) => acc + d.depositedAmountUsd + d.accruedYieldUsd, 0);
  }, [deposits]);

  const totalAccruedUsd = useMemo(() => {
    return deposits.reduce((acc, d) => acc + d.accruedYieldUsd, 0);
  }, [deposits]);

  const handleDeposit = async () => {
    if (!walletAddress) {
      showToast({ type: 'error', title: 'Wallet Not Connected', description: 'Please connect your Starknet wallet.' });
      return;
    }
    const amt = parseFloat(depositAmount) || 0;
    if (amt <= 0) {
      showToast({ type: 'error', title: 'Invalid Amount', description: 'Enter an amount greater than 0.' });
      return;
    }

    setIsProcessing(true);
    try {
      await new Promise((r) => setTimeout(r, 600));
      earnService.depositToVault(walletAddress, selectedVault.id, amt, tokenPrices);
      loadDeposits();
      showToast({
        type: 'success',
        title: 'Shielded Deposit Successful!',
        description: `Supplied ${amt} ${selectedVault.tokenSymbol} into ${selectedVault.name}.`,
      });
      setDepositAmount('');
    } catch (err: any) {
      showToast({ type: 'error', title: 'Deposit Failed', description: err.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = (vaultId: string, amount: number) => {
    const success = earnService.withdrawFromVault(walletAddress, vaultId, amount, tokenPrices);
    if (success) {
      loadDeposits();
      showToast({
        type: 'info',
        title: 'Withdrawn to Shielded Note',
        description: `Returned principal + yield to your private STRK20 vault.`,
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Stat Overview */}
      <div className="bg-gradient-to-br from-zinc-900 via-zinc-900/90 to-zinc-950 border border-zinc-800/80 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Shielded Yield & Lending (PEL Earn)</span>
            </div>
            <div className="text-3xl font-extrabold text-white">
              ${totalYieldValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              Earn continuous DeFi yields on overcollateralized lending markets without unshielding assets.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800 flex items-center gap-3">
            <div>
              <div className="text-[11px] text-zinc-400">Total Accrued Yield</div>
              <div className="text-lg font-bold text-emerald-400 font-mono">+${totalAccruedUsd.toFixed(4)}</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 font-bold">
              %
            </div>
          </div>
        </div>
      </div>

      {/* Vault Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {vaults.map((v) => {
          const isSelected = selectedVault.id === v.id;
          const userDep = deposits.find((d) => d.vaultId === v.id);

          return (
            <div
              key={v.id}
              onClick={() => setSelectedVault(v)}
              className={`p-5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                isSelected
                  ? 'bg-zinc-900 border-purple-500/60 shadow-lg shadow-purple-950/20'
                  : 'bg-zinc-900/50 border-zinc-800/80 hover:border-zinc-700'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-zinc-800 flex items-center justify-center font-bold text-xs text-zinc-200">
                      {v.tokenSymbol}
                    </div>
                    <div>
                      <div className="font-bold text-sm text-zinc-100">{v.name}</div>
                      <div className="text-[10px] text-purple-400 font-medium">{v.protocolName}</div>
                    </div>
                  </div>
                </div>

                <div className="my-3 p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-zinc-400">Net APY:</span>
                    <span className="text-xl font-extrabold text-emerald-400 font-mono">{v.apyPct}%</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-zinc-500 mt-1">
                    <span>TVL: ${(v.tvlUsd / 1e6).toFixed(1)}M</span>
                    <span>Utilization: {v.utilizationPct}%</span>
                  </div>
                </div>

                <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                  {v.strategyDescription}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-xs">
                <span className="text-zinc-500">Your Deposit:</span>
                <span className="font-mono font-semibold text-zinc-200">
                  {userDep ? `${userDep.depositedAmountTokens.toFixed(2)} ${v.tokenSymbol}` : '0.00'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Deposit / Withdraw Action Box */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl">
        <h3 className="text-sm font-bold text-zinc-100 mb-4 flex items-center gap-2">
          <Lock className="w-4 h-4 text-purple-400" />
          Shielded Supply to {selectedVault.name}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
          <div className="sm:col-span-8">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
              <span>Amount ({selectedVault.tokenSymbol})</span>
              <span className="text-[11px] text-zinc-500">Source: STRK20 Shielded Note</span>
            </div>
            <div className="relative">
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="50"
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-purple-500 text-white font-mono text-sm outline-none"
              />
              <span className="absolute right-4 top-2.5 text-xs font-bold text-zinc-400">
                {selectedVault.tokenSymbol}
              </span>
            </div>
          </div>

          <div className="sm:col-span-4">
            <button
              onClick={handleDeposit}
              disabled={isProcessing}
              className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm shadow-lg shadow-purple-900/30 transition-all"
            >
              {isProcessing ? 'Supplying...' : `Deposit ${selectedVault.tokenSymbol} Privately`}
            </button>
          </div>
        </div>

        {/* Active Vault Positions */}
        {deposits.length > 0 && (
          <div className="mt-6 pt-6 border-t border-zinc-800">
            <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
              Your Active Yield Vaults
            </h4>
            <div className="space-y-2">
              {deposits.map((d) => {
                const vault = earnService.getVault(d.vaultId);
                if (!vault) return null;

                return (
                  <div
                    key={d.vaultId}
                    className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-zinc-200">{vault.name}</div>
                      <div className="text-[11px] text-zinc-500">
                        {d.depositedAmountTokens.toFixed(4)} {vault.tokenSymbol} (${d.depositedAmountUsd.toFixed(2)})
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-[10px] text-zinc-500">Accrued Yield</div>
                        <div className="font-mono font-bold text-emerald-400">
                          +{d.accruedYieldTokens.toFixed(6)} {vault.tokenSymbol}
                        </div>
                      </div>
                      <button
                        onClick={() => handleWithdraw(d.vaultId, d.depositedAmountTokens)}
                        className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold text-[11px] border border-zinc-700"
                      >
                        Withdraw
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
