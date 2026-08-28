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
    <div className="relative z-50 w-full select-none overflow-hidden border-b border-[#ffb45c]/10 bg-[#0d0906]/90 py-2.5 text-[#a99589]">
      <div className="flex w-max animate-marquee space-x-8 whitespace-nowrap">
        {/* Double repeated sequence for smooth infinite scrolling */}
        {[...items, ...items, ...items].map((text, idx) => (
          <div key={idx} className="flex items-center space-x-6 font-mono text-[9px] font-bold uppercase tracking-[0.16em] sm:text-[10px]">
            <span>{text}</span>
            <span className="inline-block h-1 w-1 rotate-45 bg-[#ffb45c]" />
          </div>
        ))}
      </div>
    </div>
  );
};
