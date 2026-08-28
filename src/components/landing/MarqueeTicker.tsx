'use client';

import React from 'react';

interface MarqueeTickerProps {
  customText?: string;
}

export const MarqueeTicker: React.FC<MarqueeTickerProps> = ({
  customText = 'ORRANGE / PRIVACY WALLET',
}) => {
  const items = [
    customText,
    'SHIELD / SEND / RECEIVE',
    'STRK20 PRIVATE PAYMENTS',
    'STARKNET NATIVE',
    'WALLET-OWNED KEYS',
    'TESTNET PREVIEW',
  ];

  return (
    <div className="relative z-50 w-full select-none overflow-hidden border-b border-[#ffb45c]/40 bg-gradient-to-r from-[#f15b33] via-[#ff9d55] to-[#d9467e] py-2.5 text-[#fff8f0] shadow-[0_8px_24px_rgba(231,74,83,.24)]">
      <div className="flex w-max animate-marquee space-x-8 whitespace-nowrap">
        {/* Double repeated sequence for smooth infinite scrolling */}
        {[...items, ...items, ...items].map((text, idx) => (
          <div key={idx} className="flex items-center space-x-6 font-space text-[10px] font-extrabold uppercase tracking-[0.18em] drop-shadow-[0_1px_1px_rgba(104,24,38,.3)] sm:text-xs">
            <span>{text}</span>
            <span className="inline-block h-1.5 w-1.5 rotate-45 bg-white/80" />
          </div>
        ))}
      </div>
    </div>
  );
};
