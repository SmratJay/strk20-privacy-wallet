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
    <div className="space-y-6 font-mono">
      {/* Top Banner: Total Deposited in Shielded Yield */}
      <div className="bg-zinc-950 border border-zinc-800 p-6 corner-box shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-orrange-400 uppercase tracking-wider mb-1">
              <Layers className="w-4 h-4" />
              <span>SHIELDED EARN & YIELD SUBSTRATE (VESU / MONEY MARKET)</span>
            </div>
            <div className="text-3xl font-black text-white">
              ${totalYieldValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              Earn institutional lending yields while your balance remains an encrypted UTXO note.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="p-3 bg-zinc-900 border border-zinc-800 text-right">
              <span className="text-[10px] text-zinc-500 uppercase block">Total Accrued Yield</span>
              <span className="text-sm font-bold text-emerald-400">
                +${totalAccruedUsd.toFixed(4)} USD
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Available Vaults Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {vaults.map((v) => {
          const isSelected = v.id === selectedVault.id;
          return (
            <div
              key={v.id}
              onClick={() => setSelectedVault(v)}
              className={`p-5 corner-box border transition-all cursor-pointer flex flex-col justify-between ${
                isSelected
                  ? 'bg-zinc-900 border-orrange-500 shadow-lg shadow-orrange-950/30'
                  : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-2xl">{v.icon}</span>
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    {v.protocol}
                  </span>
                </div>

                <h4 className="font-bold text-white text-sm">{v.name}</h4>
                <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{v.description}</p>
              </div>

              <div className="mt-6 pt-4 border-t border-zinc-900 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-zinc-500 block uppercase">Target APY</span>
                  <span className="text-lg font-black text-orrange-400">{v.apyPct.toFixed(2)}%</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-zinc-500 block uppercase">Pool TVL</span>
                  <span className="text-xs font-bold text-zinc-300">${(v.tvlUsd / 1e6).toFixed(1)}M</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Deposit & Active Positions Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Deposit Control */}
        <div className="lg:col-span-5 bg-zinc-950 border border-zinc-800 p-5 corner-box space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Supply to {selectedVault.name}
            </h3>
            <span className="text-[10px] text-orrange-400 font-bold">{selectedVault.apyPct}% APY</span>
          </div>

          <div>
            <div className="flex justify-between text-xs text-zinc-400 mb-1.5">
              <span>SUPPLY AMOUNT</span>
              <span className="text-[10px] text-zinc-500">Asset: {selectedVault.tokenSymbol}</span>
            </div>
            <div className="relative">
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 focus:border-orrange-500 text-white text-sm outline-none"
                placeholder="0.0"
              />
              <span className="absolute right-3.5 top-2.5 text-xs font-bold text-zinc-500">
                {selectedVault.tokenSymbol}
              </span>
            </div>
          </div>

          <div className="p-3 bg-zinc-900/60 border border-zinc-800 text-xs space-y-1.5 text-zinc-400">
            <div className="flex justify-between">
              <span>Est. Daily Yield:</span>
              <span className="font-bold text-emerald-400">
                +${((parseFloat(depositAmount) || 0) * (selectedVault.apyPct / 100) / 365).toFixed(4)} USD
              </span>
            </div>
            <div className="flex justify-between">
              <span>Privacy Guarantee:</span>
              <span className="text-orrange-400 font-semibold">Shielded Substrate</span>
            </div>
          </div>

          <button
            onClick={handleDeposit}
            disabled={isProcessing}
            className="w-full py-3 border border-orrange-500 bg-orrange-500 hover:bg-orrange-400 disabled:opacity-50 text-black text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
          >
            {isProcessing ? 'Supplying to Vault...' : `Deposit ${selectedVault.tokenSymbol}`}
          </button>
        </div>

        {/* User Deposited Positions */}
        <div className="lg:col-span-7 bg-zinc-950 border border-zinc-800 p-5 corner-box">
          <h3 className="text-xs font-bold text-white uppercase mb-4 pb-3 border-b border-zinc-900 flex items-center justify-between">
            <span>Your Shielded Vault Positions</span>
            <span className="text-[10px] text-zinc-500">[ POSEIDON_COMPOUNDING ]</span>
          </h3>

          {deposits.length === 0 ? (
            <div className="text-center py-10 text-zinc-500 text-xs">
              No active deposits. Select a vault on the left and supply funds to earn private yield!
            </div>
          ) : (
            <div className="space-y-3">
              {deposits.map((d) => (
                <div
                  key={d.id}
                  className="p-3.5 bg-zinc-900/60 border border-zinc-800 flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <span>{d.vaultName}</span>
                      <span className="text-[10px] text-emerald-400 font-bold border border-emerald-500/30 px-1.5 py-0.2 bg-emerald-500/10">
                        {d.apyPct}% APY
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-400 mt-1">
                      Supplied: {d.depositedAmount} {d.tokenSymbol} (${d.depositedAmountUsd.toFixed(2)})
                    </div>
                  </div>

                  <div className="text-right flex items-center gap-3">
                    <div>
                      <div className="text-xs font-bold text-emerald-400">
                        +${d.accruedYieldUsd.toFixed(4)} USD
                      </div>
                      <div className="text-[9px] text-zinc-500 uppercase">Accrued Yield</div>
                    </div>
                    <button
                      onClick={() => handleWithdraw(d.vaultId, d.depositedAmount)}
                      className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-bold border border-zinc-700"
                    >
                      WITHDRAW
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
