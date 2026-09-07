'use client';

import { AppShell } from '@/components/wallet/AppShell';
import { WalletCoreGate } from '@/components/wallet/WalletCoreGate';
import { PrivateCrossChainPanel } from '@/components/wallet/PrivateCrossChainPanel';
import { useWalletRuntime } from '@/context/WalletRuntimeContext';

export default function CrossChainPage() {
  const { state } = useWalletRuntime();
  return <AppShell><div className="product-page !max-w-3xl">
    <div className="product-page-intro"><div>
      <div className="product-eyebrow">ORRANGE / CROSS-CHAIN</div>
      <h1 className="product-page-title">Choose where your money goes.</h1>
      <p className="product-page-description">Private STRK on Starknet. Live routes to Base and Solana.</p>
    </div></div>
    {!state.account && <div className="mb-6"><WalletCoreGate /></div>}
    <PrivateCrossChainPanel />
  </div></AppShell>;
}
