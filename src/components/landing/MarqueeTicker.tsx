'use client';

import React from 'react';

interface MarqueeTickerProps {
  customText?: string;
}

export const MarqueeTicker: React.FC<MarqueeTickerProps> = ({
  customText = 'ORRANGE WAITLIST IS LIVE',
}) => {
  const items = [
    'ORRANGE WAITLIST IS LIVE',
    'CONFIDENTIAL CASH ON STARKNET',
    '1,000 FOUNDER PASSES CLAIMED',
    'ZERO KNOWLEDGE PRIVACY',
    'ORRANGE WAITLIST IS LIVE',
    'STEALTH TRANSFERS & PRIVATE PERPS',
    '50,000 OF 50,000 SEATS',
    'CLIMB THE LADDER NOW',
  ];

  return (
    <div className="w-full overflow-hidden bg-gradient-to-r from-[#8F3F1F] via-[#C45B2C] to-[#A94A22] text-white py-2 border-b border-[#F08A3C]/30 select-none shadow-lg relative z-50">
      <div className="flex w-max animate-marquee space-x-8 whitespace-nowrap">
        {/* Double repeated sequence for smooth infinite scrolling */}
        {[...items, ...items, ...items].map((text, idx) => (
          <div key={idx} className="flex items-center space-x-6 text-xs sm:text-[13px] font-syne font-extrabold tracking-wider uppercase text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
            <span>{text}</span>
            <span className="text-[#fed7aa] text-[10px] transform rotate-45 inline-block">✦</span>
          </div>
        ))}
      </div>
    </div>
  );
};
