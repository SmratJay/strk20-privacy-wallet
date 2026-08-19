'use client';

import React, { useState } from 'react';
import { 
  PieChart, 
  ArrowLeftRight, 
  TrendingUp, 
  Sparkles, 
  Shield, 
  ArrowUpRight, 
  ArrowDownLeft, 
  QrCode, 
  History, 
  FileCheck2, 
  FileText, 
  ShieldCheck, 
  ChevronRight, 
  ChevronLeft,
  Menu,
  X,
  Layers,
  Zap,
  Globe,
  Sliders
} from 'lucide-react';
import Link from 'next/link';

export type PELTabType = 
  | 'PORTFOLIO' 
  | 'SWAP' 
  | 'PERPS' 
  | 'EARN' 
  | 'SHIELD' 
  | 'SEND' 
  | 'UNSHIELD' 
  | 'REQUEST' 
  | 'SCANNER' 
  | 'HISTORY';

interface NavItem {
  id: PELTabType;
  label: string;
  shortLabel: string;
  icon: React.ElementType;
  badge?: string;
  badgeColor?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

interface JupiterSidebarProps {
  activeTab: PELTabType;
  onSelectTab: (tab: PELTabType) => void;
  onOpenPassportModal: () => void;
  onOpenAuditorModal: () => void;
  onOpenPublishModal: () => void;
}

export const JupiterSidebar: React.FC<JupiterSidebarProps> = ({
  activeTab,
  onSelectTab,
  onOpenPassportModal,
  onOpenAuditorModal,
  onOpenPublishModal,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  const isExpanded = isPinned || isHovered;

  const NAV_GROUPS: NavGroup[] = [
    {
      title: 'MANAGE',
      items: [
        {
          id: 'PORTFOLIO',
          label: 'Private Portfolio',
          shortLabel: 'Portfolio',
          icon: PieChart,
          badge: 'DEFAULT',
          badgeColor: 'bg-zinc-800 text-zinc-300 border-zinc-700',
        },
        {
          id: 'SCANNER',
          label: 'UTXO Note Scanner',
          shortLabel: 'Scanner',
          icon: Sparkles,
        },
        {
          id: 'HISTORY',
          label: 'Activity Ledger',
          shortLabel: 'Activity',
          icon: History,
        },
      ],
    },
    {
      title: 'TRADE',
      items: [
        {
          id: 'SWAP',
          label: 'Confidential Swap',
          shortLabel: 'Swap',
          icon: ArrowLeftRight,
          badge: 'AVNU DEX',
          badgeColor: 'bg-orrange-500/20 text-orrange-400 border-orrange-500/30',
        },
        {
          id: 'PERPS',
          label: 'ZK Perpetuals',
          shortLabel: 'Perps',
          icon: TrendingUp,
          badge: '50x ZK',
          badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
        },
      ],
    },
    {
      title: 'PRIVACY CORE',
      items: [
        {
          id: 'SHIELD',
          label: 'Shield (Deposit)',
          shortLabel: 'Shield',
          icon: Shield,
        },
        {
          id: 'SEND',
          label: 'Send Privately',
          shortLabel: 'Send',
          icon: ArrowUpRight,
        },
        {
          id: 'UNSHIELD',
          label: 'Unshield (Withdraw)',
          shortLabel: 'Unshield',
          icon: ArrowDownLeft,
        },
        {
          id: 'REQUEST',
          label: 'Stealth Invoice (QR)',
          shortLabel: 'Invoice',
          icon: QrCode,
        },
      ],
    },
    {
      title: 'EARN',
      items: [
        {
          id: 'EARN',
          label: 'Shielded Yield Vaults',
          shortLabel: 'Yield',
          icon: Layers,
          badge: 'VESU',
          badgeColor: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
        },
      ],
    },
  ];

  return (
    <>
      {/* ========================================================
          1. DESKTOP / PC SIDEBAR (Hover-Expandable + Pin Toggle)
         ======================================================== */}
      <aside
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`hidden md:flex flex-col justify-between fixed top-0 left-0 bottom-0 z-40 bg-zinc-950/95 backdrop-blur-xl border-r border-zinc-800 transition-all duration-300 ease-in-out font-mono select-none ${
          isExpanded ? 'w-64 shadow-2xl shadow-black/80' : 'w-16'
        }`}
      >
        {/* Top Header & Logo */}
        <div className="flex flex-col">
          <div className="h-16 flex items-center justify-between px-3.5 border-b border-zinc-900">
            <Link href="/" className="flex items-center gap-2.5 overflow-hidden group">
              <div className="w-9 h-9 rounded-none border border-orrange-500 bg-orrange-500/10 flex items-center justify-center text-orrange-400 shrink-0 group-hover:bg-orrange-500 group-hover:text-black transition-all">
                <span className="font-bold text-sm tracking-tighter">or</span>
              </div>
              {isExpanded && (
                <div className="flex flex-col transition-opacity duration-200">
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-sm text-white tracking-wider uppercase">orrange</span>
                    <span className="text-[9px] px-1 py-0.2 bg-orrange-500/20 text-orrange-400 font-bold border border-orrange-500/30">
                      PEL
                    </span>
                  </div>
                  <span className="text-[9px] text-zinc-500 tracking-tight uppercase">Starknet Privacy Terminal</span>
                </div>
              )}
            </Link>

            {isExpanded && (
              <button
                onClick={() => setIsPinned(!isPinned)}
                title={isPinned ? 'Unpin Sidebar' : 'Pin Sidebar'}
                className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-colors"
              >
                {isPinned ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            )}
          </div>

          {/* Navigation Groups List */}
          <div className="py-4 space-y-5 overflow-y-auto max-h-[calc(100vh-180px)] scrollbar-none px-2">
            {NAV_GROUPS.map((group) => (
              <div key={group.title} className="space-y-1">
                {isExpanded ? (
                  <div className="px-2.5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 flex items-center justify-between">
                    <span>{group.title}</span>
                  </div>
                ) : (
                  <div className="h-px bg-zinc-900 mx-2 my-2" />
                )}

                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onSelectTab(item.id)}
                      title={!isExpanded ? item.label : undefined}
                      className={`w-full flex items-center gap-3 px-2.5 py-2.5 transition-all text-xs font-bold uppercase rounded-none corner-box relative group cursor-pointer ${
                        isActive
                          ? 'border border-orrange-500 bg-orrange-500 text-black shadow-lg shadow-orrange-950/60 font-black'
                          : 'border border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900/80 hover:border-zinc-800'
                      }`}
                    >
                      <div className="shrink-0 flex items-center justify-center w-6 h-6">
                        <Icon className={`w-4 h-4 ${isActive ? 'text-black' : 'text-zinc-400 group-hover:text-orrange-400'}`} />
                      </div>

                      {isExpanded && (
                        <div className="flex-1 flex items-center justify-between text-left overflow-hidden">
                          <span className="truncate">{item.label}</span>
                          {item.badge && (
                            <span
                              className={`text-[9px] px-1.5 py-0.2 border shrink-0 font-bold ml-1 ${
                                isActive ? 'bg-black text-orrange-400 border-black' : item.badgeColor
                              }`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Active Left Indicator Bar */}
                      {isActive && !isExpanded && (
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-orrange-500 shadow-sm shadow-orrange-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Compliance & Utilities Buttons */}
        <div className="p-2 border-t border-zinc-900 space-y-1 bg-zinc-950/80">
          <button
            onClick={onOpenPassportModal}
            title={!isExpanded ? 'ZK Privacy Passport' : undefined}
            className="w-full flex items-center gap-3 px-2.5 py-2 text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-all uppercase"
          >
            <FileCheck2 className="w-4 h-4 text-orrange-400 shrink-0" />
            {isExpanded && <span className="truncate">ZK Passport</span>}
          </button>

          <button
            onClick={onOpenAuditorModal}
            title={!isExpanded ? 'Auditor Escrow' : undefined}
            className="w-full flex items-center gap-3 px-2.5 py-2 text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-all uppercase"
          >
            <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
            {isExpanded && <span className="truncate">Auditor Escrow</span>}
          </button>

          <button
            onClick={onOpenPublishModal}
            title={!isExpanded ? 'Stealth Address' : undefined}
            className="w-full flex items-center gap-3 px-2.5 py-2 text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-all uppercase"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            {isExpanded && <span className="truncate">Stealth Address</span>}
          </button>
        </div>
      </aside>

      {/* ========================================================
          2. MOBILE NAVIGATION BAR (Fixed Bottom Taskbar)
         ======================================================== */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-xl border-t border-zinc-800 font-mono px-2 py-1.5 flex items-center justify-around">
        <button
          onClick={() => onSelectTab('PORTFOLIO')}
          className={`flex flex-col items-center gap-1 p-2 text-[10px] font-bold uppercase transition-all ${
            activeTab === 'PORTFOLIO' ? 'text-orrange-400' : 'text-zinc-500'
          }`}
        >
          <PieChart className="w-4 h-4" />
          <span>Portfolio</span>
        </button>

        <button
          onClick={() => onSelectTab('SWAP')}
          className={`flex flex-col items-center gap-1 p-2 text-[10px] font-bold uppercase transition-all ${
            activeTab === 'SWAP' ? 'text-orrange-400' : 'text-zinc-500'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4" />
          <span>Swap</span>
        </button>

        <button
          onClick={() => onSelectTab('PERPS')}
          className={`flex flex-col items-center gap-1 p-2 text-[10px] font-bold uppercase transition-all ${
            activeTab === 'PERPS' ? 'text-orrange-400' : 'text-zinc-500'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>Perps</span>
        </button>

        <button
          onClick={() => onSelectTab('SHIELD')}
          className={`flex flex-col items-center gap-1 p-2 text-[10px] font-bold uppercase transition-all ${
            activeTab === 'SHIELD' ? 'text-orrange-400' : 'text-zinc-500'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Shield</span>
        </button>

        <button
          onClick={() => setIsMobileDrawerOpen(true)}
          className="flex flex-col items-center gap-1 p-2 text-[10px] font-bold uppercase text-zinc-400 hover:text-white"
        >
          <Menu className="w-4 h-4" />
          <span>More</span>
        </button>
      </div>

      {/* ========================================================
          3. MOBILE SLIDE-OVER DRAWER (All 10 Utilities + Modals)
         ======================================================== */}
      {isMobileDrawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/80 backdrop-blur-md font-mono">
          <div className="bg-zinc-950 border-t border-zinc-800 p-5 corner-box space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 border border-orrange-500 bg-orrange-500/10 flex items-center justify-center text-orrange-400 font-bold text-xs">
                  or
                </div>
                <span className="font-bold text-sm text-white uppercase">Terminal Utilities</span>
              </div>
              <button
                onClick={() => setIsMobileDrawerOpen(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {NAV_GROUPS.map((group) => (
                <div key={group.title} className="space-y-1.5">
                  <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                    {group.title}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            onSelectTab(item.id);
                            setIsMobileDrawerOpen(false);
                          }}
                          className={`flex items-center gap-2.5 p-2.5 border text-xs font-bold uppercase ${
                            isActive
                              ? 'border-orrange-500 bg-orrange-500 text-black'
                              : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white'
                          }`}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="truncate">{item.shortLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="pt-2 border-t border-zinc-900 space-y-2">
                <div className="text-[10px] font-bold text-zinc-500 uppercase">Compliance & Tools</div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => {
                      onOpenPassportModal();
                      setIsMobileDrawerOpen(false);
                    }}
                    className="p-2 bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-zinc-300 uppercase text-center"
                  >
                    ZK Passport
                  </button>
                  <button
                    onClick={() => {
                      onOpenAuditorModal();
                      setIsMobileDrawerOpen(false);
                    }}
                    className="p-2 bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-zinc-300 uppercase text-center"
                  >
                    Auditor
                  </button>
                  <button
                    onClick={() => {
                      onOpenPublishModal();
                      setIsMobileDrawerOpen(false);
                    }}
                    className="p-2 bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-zinc-300 uppercase text-center"
                  >
                    Stealth
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
