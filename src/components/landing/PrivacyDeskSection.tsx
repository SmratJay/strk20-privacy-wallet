'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  EyeOff,
  KeyRound,
  LockKeyhole,
  ScanLine,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';

type DeskTab = 'TRADE' | 'SHIELD' | 'STEALTH' | 'COLLECT';

const TABS: { id: DeskTab; label: string; Icon: typeof ShieldCheck }[] = [
  { id: 'TRADE', label: 'Trade', Icon: TrendingUp },
  { id: 'SHIELD', label: 'Shield', Icon: ShieldCheck },
  { id: 'STEALTH', label: 'Send', Icon: EyeOff },
  { id: 'COLLECT', label: 'Keys', Icon: KeyRound },
];

export const PrivacyDeskSection: React.FC = () => {
  const [activeTab, setActiveTab] = useState<DeskTab>('SHIELD');
  const [leverage, setLeverage] = useState(25);

  return (
    <section id="desk" className="relative overflow-hidden border-t border-white/[0.07] px-5 py-24 sm:px-8 sm:py-32 lg:px-10 lg:py-40">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_35%,rgba(184,76,27,0.24),transparent_34rem)]" />
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-25" />

      <div className="relative mx-auto grid max-w-6xl gap-14 lg:grid-cols-[0.72fr_1.28fr] lg:items-start lg:gap-24">
        <div className="lg:sticky lg:top-28">
          <div className="landing-kicker mb-6 flex items-center gap-3"><span className="h-px w-8 bg-[#ffb45c]/70" />03 / PRIVACY DESK</div>
          <h2 className="landing-display max-w-lg text-[clamp(4.8rem,10vw,8.8rem)] text-[#f8f1ea]">
            YOUR<br /><span className="text-[#ffb45c]">QUIET</span><br />DESK.
          </h2>
          <p className="mt-8 max-w-sm text-base leading-7 text-[#b8a59a] sm:text-lg">
            A single place to make funds private, send a shielded payment, and see the boundary between your wallet and the public chain.
          </p>
          <div className="mt-10 space-y-4 border-t border-white/10 pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#75645a]">
            <div className="flex items-center justify-between"><span>01 / Wallet</span><span className="text-[#ffb45c]">Owns the keys</span></div>
            <div className="flex items-center justify-between"><span>02 / STRK20</span><span className="text-[#ffb45c]">Private pool</span></div>
            <div className="flex items-center justify-between"><span>03 / Dapp</span><span className="text-[#ffb45c]">Never sees secrets</span></div>
          </div>
        </div>

        <div className="w-full">
          <div className="landing-window rounded-[1.8rem] p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-4 font-mono text-[9px] uppercase tracking-[0.14em] text-[#75645a]">
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />ORRANGE / INTERACTIVE PREVIEW</span>
              <span>NO SECRETS IN THE DAPP</span>
            </div>
            <div className="rounded-[1.35rem] border border-white/10 bg-[#0d0906] p-4 sm:p-6">
              <div className="flex flex-col gap-5 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-space text-xl font-semibold tracking-[-0.04em] text-[#f8f1ea]">Privacy Desk</div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#75645a]">Choose a surface to inspect</div>
                </div>
                <div className="flex items-center gap-2 rounded-full border border-[#ffb45c]/20 bg-[#f97316]/10 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-[#ffb45c]"><ScanLine className="h-3 w-3" /> Sepolia preview</div>
              </div>

              <div className="mt-5 grid grid-cols-4 gap-1 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-1" role="tablist" aria-label="Privacy desk modes">
                {TABS.map(({ id, label, Icon }) => (
                  <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)} className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 font-mono text-[9px] font-bold uppercase tracking-wider transition-all sm:gap-2 sm:text-[10px] ${activeTab === id ? 'bg-[#f8f1ea] text-[#1b0e08] shadow-lg' : 'text-[#8e7b70] hover:bg-white/[0.05] hover:text-[#f8f1ea]'}`}>
                    <Icon className="h-3.5 w-3.5" /> <span>{label}</span>
                  </button>
                ))}
              </div>

              <div className="mt-6 min-h-[23rem]">
                {activeTab === 'SHIELD' && (
                  <div className="animate-in fade-in duration-300">
                    <DeskHeader icon={<ShieldCheck className="h-5 w-5" />} title="Make funds private" status="LIVE FLOW" tone="orange" />
                    <div className="mt-7 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                      <DeskMetric label="FROM" value="Public balance" detail="Your connected wallet" />
                      <ArrowRight className="hidden h-5 w-5 text-[#ffb45c] sm:block" />
                      <DeskMetric label="TO" value="Private note" detail="STRK20 privacy pool" accent />
                    </div>
                    <div className="mt-7 rounded-2xl border border-[#ffb45c]/20 bg-[#f97316]/[0.07] p-4 font-mono text-xs text-[#c8b8ad]">
                      <div className="flex items-center justify-between"><span className="text-[#75645a]">What happens</span><LockKeyhole className="h-4 w-4 text-[#ffb45c]" /></div>
                      <p className="mt-3 max-w-xl leading-6">Your privacy wallet builds the note, generates the proof, and asks you to confirm. ORRANGE only requests the STRK20 action through the Wallet API.</p>
                    </div>
                    <Link href="/send?mode=deposit" className="landing-button mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#ffb45c] px-5 py-3.5 text-sm font-bold text-[#1b0e08] hover:bg-[#f8f1ea]">Make funds private <ArrowUpRight className="h-4 w-4" /></Link>
                  </div>
                )}

                {activeTab === 'STEALTH' && (
                  <div className="animate-in fade-in duration-300">
                    <DeskHeader icon={<EyeOff className="h-5 w-5" />} title="Private transfer" status="LIVE FLOW" tone="green" />
                    <div className="mt-7 space-y-3">
                      <DeskMetric label="RECIPIENT" value="Starknet address" detail="Registered for private receiving" />
                      <DeskMetric label="PAYMENT" value="Shielded STRK20" detail="Amount and token stay inside the private pool" accent />
                    </div>
                    <div className="mt-7 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300"><ArrowUpRight className="h-4 w-4" /></span><div><div className="font-space text-sm font-semibold text-[#f8f1ea]">Your wallet handles the sensitive work</div><div className="mt-1 font-mono text-[10px] text-[#75645a]">NOTES / DISCOVERY / PROOFS</div></div></div>
                    <Link href="/send" className="landing-button mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#f8f1ea] px-5 py-3.5 text-sm font-bold text-[#1b0e08] hover:bg-[#ffb45c]">Open private send <ArrowUpRight className="h-4 w-4" /></Link>
                  </div>
                )}

                {activeTab === 'TRADE' && (
                  <div className="animate-in fade-in duration-300">
                    <DeskHeader icon={<TrendingUp className="h-5 w-5" />} title="Private trading surface" status="COMING NEXT" tone="purple" />
                    <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-5">
                      <div className="flex items-end justify-between"><div><div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#75645a]">Concept preview</div><div className="mt-2 font-space text-3xl font-semibold text-[#f8f1ea]">STRK / USD</div></div><div className="font-mono text-sm text-[#ffb45c]">{leverage}x</div></div>
                      <div className="mt-6 h-28 rounded-xl bg-[linear-gradient(180deg,rgba(139,92,246,.13),transparent)] p-2"><svg viewBox="0 0 520 130" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true"><path d="M0 102 C42 96,48 76,80 84 S126 92,153 64 S194 76,222 48 S267 62,300 42 S340 49,370 23 S420 38,456 18 S490 26,520 9" fill="none" stroke="#c4b5fd" strokeWidth="3" /><path d="M0 102 C42 96,48 76,80 84 S126 92,153 64 S194 76,222 48 S267 62,300 42 S340 49,370 23 S420 38,456 18 S490 26,520 9 V130 H0Z" fill="#8b5cf6" opacity=".1" /></svg></div>
                      <div className="mt-5"><div className="flex justify-between font-mono text-[10px] uppercase tracking-wider text-[#75645a]"><span>Experimental leverage</span><span className="text-[#c4b5fd]">{leverage}x</span></div><input aria-label="Experimental leverage preview" type="range" min="1" max="50" value={leverage} onChange={(event) => setLeverage(Number(event.target.value))} className="mt-3 w-full accent-[#c4b5fd]" /></div>
                    </div>
                    <p className="mt-5 font-mono text-[10px] leading-5 text-[#75645a]">The trading surface is shown as an exploration of what comes next. The live product today is the STRK20 privacy wallet.</p>
                  </div>
                )}

                {activeTab === 'COLLECT' && (
                  <div className="animate-in fade-in duration-300">
                    <DeskHeader icon={<KeyRound className="h-5 w-5" />} title="Selective access" status="MODEL" tone="amber" />
                    <div className="mt-7 grid gap-3 sm:grid-cols-2">
                      <DeskMetric label="VIEWING KEYS" value="Held by wallet" detail="The dapp never stores secrets" />
                      <DeskMetric label="PROOFS" value="Generated on request" detail="Confirm in your privacy wallet" accent />
                    </div>
                    <div className="mt-7 border-l border-[#ffb45c]/50 pl-4 font-mono text-xs leading-6 text-[#b8a59a]">Privacy is not a promise to disappear. It is a boundary you can understand, operate, and selectively share when the product supports it.</div>
                    <Link href="/settings" className="landing-button mt-7 inline-flex items-center gap-2 rounded-full border border-[#ffb45c]/40 px-5 py-3 text-xs font-bold uppercase tracking-[0.1em] text-[#ffb45c] hover:bg-[#f97316]/10">Inspect wallet controls <ArrowUpRight className="h-4 w-4" /></Link>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between px-2 pt-3 font-mono text-[9px] uppercase tracking-[0.13em] text-[#75645a]"><span>Product preview / no fabricated balances</span><Link href="/wallet" className="text-[#ffb45c] hover:text-[#f8f1ea]">Launch wallet →</Link></div>
          </div>
        </div>
      </div>
    </section>
  );
};

const DeskHeader: React.FC<{ icon: React.ReactNode; title: string; status: string; tone: 'orange' | 'green' | 'purple' | 'amber' }> = ({ icon, title, status, tone }) => {
  const toneClasses = {
    orange: 'bg-[#f97316]/15 text-[#ffb45c] border-[#f97316]/30',
    green: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/25',
    purple: 'bg-violet-400/10 text-violet-300 border-violet-400/25',
    amber: 'bg-amber-300/10 text-amber-200 border-amber-300/25',
  }[tone];

  return <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-5"><div className="flex items-center gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${toneClasses}`}>{icon}</span><div><h3 className="font-space text-lg font-semibold text-[#f8f1ea]">{title}</h3><div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#75645a]">STRK20 / wallet api</div></div></div><span className={`rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider ${toneClasses}`}>{status}</span></div>;
};

const DeskMetric: React.FC<{ label: string; value: string; detail: string; accent?: boolean }> = ({ label, value, detail, accent }) => (
  <div className={`rounded-2xl border p-4 ${accent ? 'border-[#ffb45c]/25 bg-[#f97316]/[0.07]' : 'border-white/10 bg-white/[0.025]'}`}>
    <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-[#75645a]">{label}</div>
    <div className={`mt-3 font-space text-base font-semibold ${accent ? 'text-[#ffb45c]' : 'text-[#f8f1ea]'}`}>{value}</div>
    <div className="mt-1 text-xs leading-5 text-[#8e7b70]">{detail}</div>
  </div>
);
