'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  ShieldCheck, 
  ArrowRight, 
  Terminal, 
  Lock, 
  Sparkles, 
  Layers, 
  TrendingUp, 
  FileText,
  FileCheck2,
  ExternalLink,
  Shield,
  Activity
} from 'lucide-react';
import { Header } from '@/components/Header';
import { LandingHero } from '@/components/landing/LandingHero';
import { ProblemSectorCards } from '@/components/landing/ProblemSectorCards';
import { MoatArchitectureSection } from '@/components/landing/MoatArchitectureSection';

// Compliance Modals
import { PublishAddressModal } from '@/components/PublishAddressModal';
import { AuditorExportModal } from '@/components/AuditorExportModal';
import { CompliancePassportModal } from '@/components/CompliancePassportModal';

import { useStarknetWallet } from '@/hooks/useStarknetWallet';
import { useRouter } from 'next/navigation';
import { constants } from 'starknet';
import { useNetwork } from '@/context/NetworkContext';

export default function Home() {
  const router = useRouter();
  const wallet = useStarknetWallet();
  const { setNetworkId } = useNetwork();

  // Auto-sync the app network to the connected wallet's chain so balances are
  // always queried against the network the user actually funded (the deployed
  // protocol is Sepolia-only).
  React.useEffect(() => {
    if (!wallet.isConnected || !wallet.chainId) return;
    const raw = String(wallet.chainId);
    try {
      const chainBig = typeof wallet.chainId === 'bigint'
        ? wallet.chainId
        : BigInt(raw.startsWith('0x') || raw.startsWith('0X') ? raw : '0x' + raw);
      setNetworkId(chainBig === BigInt(constants.StarknetChainId.SN_SEPOLIA) ? 'sepolia' : 'mainnet');
    } catch {
      // Ignore unparseable chainId; keep the current app network.
    }
  }, [wallet.isConnected, wallet.chainId, setNetworkId]);

  // Modal visibility states
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isAuditorModalOpen, setIsAuditorModalOpen] = useState(false);
  const [isPassportModalOpen, setIsPassportModalOpen] = useState(false);

  const handleLaunchTerminal = () => {
    router.push('/terminal');
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-orrange-500 selection:text-black">
      {/* 1. Global Navigation Header */}
      <Header
        wallet={wallet}
        onOpenPublishModal={() => setIsPublishModalOpen(true)}
        onOpenAuditorModal={() => setIsAuditorModalOpen(true)}
        onOpenPassportModal={() => setIsPassportModalOpen(true)}
        onLaunchTerminal={handleLaunchTerminal}
      />

      {/* 2. Hero Section (ASCII Art Visual + Big Bold Headline) */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 space-y-16">
        <LandingHero onLaunchTerminal={handleLaunchTerminal} />

        {/* 3. Problem / Friction Points (Why Transparent L2s Fail) */}
        <ProblemSectorCards onLaunchTerminal={handleLaunchTerminal} />

        {/* 4. Moat Manifesto & Architecture Matrix ("Confidentiality is the only moat left") */}
        <div id="architecture">
          <MoatArchitectureSection />
        </div>

        {/* 5. High-Impact Final Call-to-Action */}
        <section className="py-16 border-t border-zinc-800/80">
          <div className="p-8 sm:p-12 bg-zinc-950 border border-orrange-500/50 corner-box shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-orrange-500/5 rounded-full blur-3xl pointer-events-none" />
            
            <div className="relative z-10 max-w-2xl space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-orrange-500/10 border border-orrange-500/30 text-orrange-400 font-mono text-xs font-bold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-orrange-400 animate-pulse" />
                <span>CONFIDENTIAL BY DEFAULT. VERIFIABLE ON STARKNET.</span>
              </div>

              <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white uppercase tracking-tight font-sans">
                Experience the Next Generation <br />
                <span className="text-orrange-500 terminal-glow">of Private Finance</span>
              </h2>

              <p className="font-mono text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Launch the orrange Terminal workstation to execute confidential DEX swaps, trade 50x ZK perpetuals, 
                shield UTXO assets, and generate zero-knowledge selective compliance passports.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <Link
                  href="/terminal"
                  className="px-8 py-4 bg-orrange-500 hover:bg-orrange-400 text-black font-mono text-xs font-black uppercase tracking-widest transition-all shadow-xl shadow-orrange-950/60 hover:scale-[1.02] flex items-center gap-2.5 corner-box cursor-pointer"
                >
                  <Terminal className="w-4 h-4" />
                  <span>Enter Terminal Workstation</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>

                <button
                  onClick={() => setIsPassportModalOpen(true)}
                  className="px-5 py-4 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:text-white font-mono text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2"
                >
                  <FileCheck2 className="w-4 h-4 text-orrange-400" />
                  <span>Inspect ZK Passport</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* 6. Footer */}
      <footer className="border-t border-zinc-900 bg-zinc-950 py-10 mt-16 font-mono text-xs text-zinc-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 border border-orrange-500 bg-orrange-500/10 flex items-center justify-center text-orrange-400 font-bold">
              or
            </div>
            <div>
              <span className="font-bold text-white uppercase tracking-wider">orrange PEL</span>
              <span className="text-[10px] text-zinc-600 block">Starknet Private Execution Layer</span>
            </div>
          </div>

          <div className="flex items-center gap-6 text-zinc-400">
            <Link href="/terminal" className="hover:text-orrange-400 transition-colors uppercase">
              Terminal
            </Link>
            <a href="#architecture" className="hover:text-orrange-400 transition-colors uppercase">
              Architecture
            </a>
            <a
              href="https://github.com/SmratJay/strk20-privacy-wallet"
              target="_blank"
              rel="noreferrer"
              className="hover:text-orrange-400 transition-colors uppercase flex items-center gap-1"
            >
              <span>GitHub</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="text-[10px] text-zinc-600">
            STRK20 Hackathon 2026 • Verified on Starknet Cairo v2
          </div>
        </div>
      </footer>

      {/* Modals */}
      <PublishAddressModal
        isOpen={isPublishModalOpen}
        onClose={() => setIsPublishModalOpen(false)}
        accountAddress={wallet.address || ''}
      />

      <AuditorExportModal
        isOpen={isAuditorModalOpen}
        onClose={() => setIsAuditorModalOpen(false)}
        accountAddress={wallet.address || ''}
      />

      <CompliancePassportModal
        isOpen={isPassportModalOpen}
        onClose={() => setIsPassportModalOpen(false)}
        walletAddress={wallet.address || ''}
      />
    </div>
  );
}
