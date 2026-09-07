'use client';

import { AppShell } from '@/components/wallet/AppShell';
import { WalletCoreGate } from '@/components/wallet/WalletCoreGate';
import { WalletActivity } from '@/components/wallet/WalletActivity';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';
import { networkLabel } from '@/utils/walletUx';

export default function ActivityPage() {
  const { state } = useWalletRuntime();
  return <AppShell><div className="product-page">
    <div className="product-page-intro"><div><div className="product-eyebrow">ORRANGE / ACTIVITY</div><h1 className="product-page-title">Activity</h1><p className="product-page-description">Your sends, swaps and private transactions · {networkLabel(state.network)}.</p></div></div>
    {!state.account ? <WalletCoreGate /> : <section className="product-card p-5 sm:p-6"><WalletActivity /></section>}
  </div></AppShell>;
}
