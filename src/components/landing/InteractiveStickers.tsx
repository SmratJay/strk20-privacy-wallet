'use client';

import React, { useState, useEffect, useRef } from 'react';

/**
 * Mouse-tracking interactive 3D Eyeball
 */
export const EyeballSticker: React.FC<{ className?: string; size?: number }> = ({ 
  className = '', 
  size = 72 
}) => {
  const eyeRef = useRef<HTMLDivElement>(null);
  const [pupilPos, setPupilPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!eyeRef.current) return;
      const rect = eyeRef.current.getBoundingClientRect();
      const eyeCenterX = rect.left + rect.width / 2;
      const eyeCenterY = rect.top + rect.height / 2;
      
      const dx = e.clientX - eyeCenterX;
      const dy = e.clientY - eyeCenterY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const maxRadius = size * 0.18;
      
      const angle = Math.atan2(dy, dx);
      const constrainedDist = Math.min(distance * 0.08, maxRadius);
      
      setPupilPos({
        x: Math.cos(angle) * constrainedDist,
        y: Math.sin(angle) * constrainedDist,
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [size]);

  return (
    <div 
      ref={eyeRef}
      className={`relative rounded-full cursor-pointer select-none sticker-shadow group ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Outer Sclera Sphere */}
      <div 
        className="w-full h-full rounded-full overflow-hidden relative shadow-2xl transition-transform duration-300 group-hover:scale-110"
        style={{
          background: 'radial-gradient(circle at 35% 35%, #ffffff 0%, #f4e8e1 45%, #d1b5a5 85%, #8f6e5e 100%)',
          boxShadow: 'inset -4px -6px 12px rgba(100, 40, 20, 0.4), inset 3px 3px 6px rgba(255, 255, 255, 0.9), 0 12px 28px rgba(0, 0, 0, 0.45)'
        }}
      >
        {/* Subtle Blood Vessels */}
        <div className="absolute inset-0 opacity-20 pointer-events-none"
             style={{
               backgroundImage: 'radial-gradient(circle at 75% 20%, rgba(220, 38, 38, 0.6) 0%, transparent 40%), radial-gradient(circle at 15% 80%, rgba(220, 38, 38, 0.5) 0%, transparent 35%)'
             }}
        />

        {/* Iris & Pupil Container (moves with mouse) */}
        <div 
          className="absolute rounded-full transition-transform duration-75 ease-out flex items-center justify-center"
          style={{
            width: size * 0.54,
            height: size * 0.54,
            top: '50%',
            left: '50%',
            transform: `translate(-50%, -50%) translate(${pupilPos.x}px, ${pupilPos.y}px)`,
            background: 'radial-gradient(circle at 38% 38%, #34d399 0%, #059669 35%, #064e3b 70%, #022c22 100%)',
            boxShadow: 'inset 0 0 8px rgba(0, 0, 0, 0.8), 0 0 6px rgba(52, 211, 153, 0.5)'
          }}
        >
          {/* Iris Strands Pattern */}
          <div className="absolute inset-0 rounded-full opacity-40 mix-blend-overlay"
               style={{
                 backgroundImage: 'conic-gradient(from 0deg, transparent 0deg, #a7f3d0 30deg, transparent 60deg, #34d399 120deg, transparent 180deg, #6ee7b7 240deg, transparent 300deg)'
               }}
          />

          {/* Deep Black Pupil */}
          <div 
            className="rounded-full bg-[#080504] relative shadow-inner"
            style={{ width: size * 0.24, height: size * 0.24 }}
          >
            {/* Primary Specular Light Glint */}
            <div 
              className="absolute rounded-full bg-white opacity-95 shadow-sm"
              style={{
                width: size * 0.09,
                height: size * 0.09,
                top: '15%',
                left: '18%',
              }}
            />
            {/* Secondary Tiny Glint */}
            <div 
              className="absolute rounded-full bg-white opacity-70"
              style={{
                width: size * 0.04,
                height: size * 0.04,
                bottom: '22%',
                right: '22%',
              }}
            />
          </div>
        </div>

        {/* Global Wet Lens Highlight */}
        <div 
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.65) 0%, rgba(255, 255, 255, 0) 50%)',
          }}
        />
      </div>
    </div>
  );
};

/**
 * Minted Metallic Silver / Titanium Coin
 */
export const MintedCoinSticker: React.FC<{ className?: string; size?: number }> = ({ 
  className = '', 
  size = 84 
}) => {
  return (
    <div 
      className={`relative select-none sticker-shadow cursor-pointer group ${className}`}
      style={{ width: size, height: size * 1.1 }}
    >
      <div className="w-full h-full relative transition-transform duration-300 group-hover:rotate-6 group-hover:scale-105">
        {/* Scalloped / Shield Medallion SVG */}
        <svg viewBox="0 0 100 110" className="w-full h-full filter drop-shadow-xl">
          <defs>
            <linearGradient id="silverRim" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="25%" stopColor="#cfd3dc" />
              <stop offset="50%" stopColor="#9aa0ad" />
              <stop offset="75%" stopColor="#e4e7eb" />
              <stop offset="100%" stopColor="#7a8190" />
            </linearGradient>
            <linearGradient id="silverPlate" x1="20%" y1="0%" x2="80%" y2="100%">
              <stop offset="0%" stopColor="#eef1f5" />
              <stop offset="40%" stopColor="#d5d9e0" />
              <stop offset="70%" stopColor="#b4b9c4" />
              <stop offset="100%" stopColor="#8d93a0" />
            </linearGradient>
            <radialGradient id="hologramCenter" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
              <stop offset="60%" stopColor="#d5d9e0" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#8d93a0" stopOpacity="0.9" />
            </radialGradient>
          </defs>

          {/* Outer Metal Polygon Shield */}
          <path 
            d="M 50 4 L 88 18 L 96 60 C 96 85, 75 102, 50 108 C 25 102, 4 85, 4 60 L 12 18 Z" 
            fill="url(#silverRim)" 
            stroke="#ffffff" 
            strokeWidth="1.5"
          />

          {/* Inset Plate */}
          <path 
            d="M 50 10 L 82 22 L 88 58 C 88 80, 70 95, 50 100 C 30 95, 12 80, 12 58 L 18 22 Z" 
            fill="url(#silverPlate)" 
            stroke="#9aa0ad" 
            strokeWidth="1"
          />

          {/* Top Inscribed Numbers */}
          <text x="18" y="24" fontSize="5.5" fontFamily="monospace" fill="#525763" fontWeight="bold">999.9</text>
          <text x="64" y="24" fontSize="5.5" fontFamily="monospace" fill="#525763" fontWeight="bold">58.319g</text>

          {/* Central Embossed Text */}
          <g transform="translate(50, 48) scale(0.9)" textAnchor="middle">
            <text x="0" y="0" fontSize="11" fontFamily="'Bebas Neue', 'Impact', sans-serif" fontWeight="900" fill="#2d313a" letterSpacing="1">THE</text>
            <text x="0" y="12" fontSize="14" fontFamily="'Bebas Neue', 'Impact', sans-serif" fontWeight="900" fill="#1e2127" letterSpacing="1.5">ORRANGE</text>
            <text x="0" y="23" fontSize="11" fontFamily="'Bebas Neue', 'Impact', sans-serif" fontWeight="900" fill="#2d313a" letterSpacing="1">CLUB</text>
          </g>

          {/* Subtle ZK Emblem Bottom */}
          <circle cx="50" cy="84" r="5" fill="none" stroke="#686e7c" strokeWidth="1" strokeDasharray="1.5,1.5" />
          <path d="M 48 84 L 52 84 M 50 82 L 50 86" stroke="#686e7c" strokeWidth="0.8" />
        </svg>
      </div>
    </div>
  );
};

/**
 * 3D Hot Chrome Metallic Flame Heart
 */
export const FlameHeartSticker: React.FC<{ className?: string; size?: number }> = ({ 
  className = '', 
  size = 80 
}) => {
  return (
    <div 
      className={`relative select-none sticker-shadow cursor-pointer group ${className}`}
      style={{ width: size, height: size * 1.15 }}
    >
      <div className="w-full h-full relative transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3">
        <svg viewBox="0 0 100 115" className="w-full h-full">
          <defs>
            {/* Fiery Pink & Orange Chrome Gradient */}
            <linearGradient id="chromeFlame" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#831843" />
              <stop offset="25%" stopColor="#db2777" />
              <stop offset="50%" stopColor="#f43f5e" />
              <stop offset="75%" stopColor="#f97316" />
              <stop offset="100%" stopColor="#fbbf24" />
            </linearGradient>

            <linearGradient id="heartSpecular" x1="20%" y1="0%" x2="80%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
              <stop offset="40%" stopColor="#fda4af" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#4c0519" stopOpacity="0.9" />
            </linearGradient>
          </defs>

          {/* Outer Flames Base */}
          <path 
            d="M 50 110 C 20 85, 2 60, 4 35 C 5 15, 25 8, 38 20 C 44 26, 48 32, 50 38 C 52 32, 56 26, 62 20 C 75 8, 95 15, 96 35 C 98 60, 80 85, 50 110 Z"
            fill="url(#chromeFlame)"
            stroke="#ffffff"
            strokeWidth="2"
          />

          {/* Raised Chrome Heart Center */}
          <path 
            d="M 50 98 C 28 78, 14 58, 16 38 C 17 22, 32 18, 42 28 C 47 33, 49 37, 50 40 C 51 37, 53 33, 58 28 C 68 18, 83 22, 84 38 C 86 58, 72 78, 50 98 Z"
            fill="url(#heartSpecular)"
            opacity="0.85"
          />

          {/* Flame Wisps Detail */}
          <path 
            d="M 46 65 C 44 55, 48 48, 50 42 C 52 48, 56 55, 54 65 C 52 72, 48 72, 46 65 Z"
            fill="#ffffff"
            opacity="0.6"
          />

          {/* Specular Glistening Highlights */}
          <ellipse cx="32" cy="32" rx="7" ry="12" transform="rotate(-30, 32, 32)" fill="#ffffff" opacity="0.6" />
          <ellipse cx="68" cy="32" rx="4" ry="8" transform="rotate(30, 68, 32)" fill="#ffffff" opacity="0.5" />
        </svg>
      </div>
    </div>
  );
};

/**
 * 8-Bit Pixel Cyber Shades
 */
export const PixelShadesSticker: React.FC<{ className?: string; size?: number }> = ({ 
  className = '', 
  size = 110 
}) => {
  return (
    <div 
      className={`relative select-none sticker-shadow cursor-pointer group ${className}`}
      style={{ width: size, height: size * 0.4 }}
    >
      <div className="w-full h-full relative transition-transform duration-300 group-hover:scale-105 group-hover:rotate-2">
        <svg viewBox="0 0 160 64" className="w-full h-full">
          {/* Black Pixel Frame */}
          <rect x="0" y="16" width="160" height="12" fill="#0F0A07" />
          <rect x="8" y="28" width="60" height="24" fill="#0F0A07" />
          <rect x="92" y="28" width="60" height="24" fill="#0F0A07" />
          <rect x="16" y="52" width="44" height="8" fill="#0F0A07" />
          <rect x="100" y="52" width="44" height="8" fill="#0F0A07" />

          {/* White Glint Pixels Left Lens */}
          <rect x="16" y="28" width="8" height="8" fill="#ffffff" />
          <rect x="24" y="36" width="8" height="8" fill="#ffffff" />
          <rect x="32" y="44" width="8" height="8" fill="#ffffff" />
          <rect x="24" y="28" width="8" height="8" fill="#F08A3C" opacity="0.8" />

          {/* White Glint Pixels Right Lens */}
          <rect x="100" y="28" width="8" height="8" fill="#ffffff" />
          <rect x="108" y="36" width="8" height="8" fill="#ffffff" />
          <rect x="116" y="44" width="8" height="8" fill="#ffffff" />
          <rect x="108" y="28" width="8" height="8" fill="#F08A3C" opacity="0.8" />
        </svg>
      </div>
    </div>
  );
};

/**
 * Neon Lime "NOCAP" Sticker
 */
export const NoCapSticker: React.FC<{ className?: string; size?: number }> = ({ 
  className = '', 
  size = 90 
}) => {
  return (
    <div 
      className={`relative select-none sticker-shadow cursor-pointer group ${className}`}
      style={{ width: size, height: size * 0.45 }}
    >
      <div 
        className="w-full h-full flex items-center justify-center font-black rounded-lg border-2 border-black transform -rotate-6 transition-all duration-300 group-hover:rotate-0 group-hover:scale-110 shadow-xl"
        style={{
          background: 'linear-gradient(135deg, #10b981 0%, #22c55e 50%, #4ade80 100%)',
          boxShadow: '0 8px 18px rgba(16, 185, 129, 0.45), inset 0 2px 0 rgba(255, 255, 255, 0.6)'
        }}
      >
        <span className="font-syne text-black text-sm tracking-tighter uppercase font-extrabold pr-1">
          NOCAP
        </span>
        <span className="w-2.5 h-2.5 rounded-full bg-black/80 ml-1 border border-white/40" />
      </div>
    </div>
  );
};

/**
 * Cyan Chrome "GOAT" 3D Sticker
 */
export const GoatSticker: React.FC<{ className?: string; size?: number }> = ({ 
  className = '', 
  size = 85 
}) => {
  return (
    <div 
      className={`relative select-none sticker-shadow cursor-pointer group ${className}`}
      style={{ width: size, height: size * 0.45 }}
    >
      <div 
        className="w-full h-full flex items-center justify-center rounded-xl border-2 border-cyan-300 transform rotate-12 transition-all duration-300 group-hover:rotate-0 group-hover:scale-110 shadow-xl"
        style={{
          background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 50%, #0e7490 100%)',
          boxShadow: '0 8px 20px rgba(6, 182, 212, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.8)'
        }}
      >
        <span className="font-bebas text-white text-base tracking-wider uppercase font-black drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
          GOAT
        </span>
      </div>
    </div>
  );
};

/**
 * Melting Rainbow/Orange Tongue Graphic
 */
export const MeltingTongueSticker: React.FC<{ className?: string; size?: number }> = ({ 
  className = '', 
  size = 85 
}) => {
  return (
    <div 
      className={`relative select-none sticker-shadow cursor-pointer group ${className}`}
      style={{ width: size, height: size * 1.25 }}
    >
      <div className="w-full h-full relative transition-transform duration-300 group-hover:scale-105 group-hover:rotate-3">
        <svg viewBox="0 0 100 125" className="w-full h-full">
          {/* Lips / Mouth outline */}
          <path 
            d="M 10 35 C 30 10, 70 10, 90 35 C 75 55, 25 55, 10 35 Z" 
            fill="#db2777" 
            stroke="#18100B" 
            strokeWidth="3"
          />
          {/* Teeth */}
          <rect x="35" y="24" width="12" height="10" rx="2" fill="#ffffff" stroke="#18100B" strokeWidth="1.5" />
          <rect x="52" y="24" width="12" height="10" rx="2" fill="#ffffff" stroke="#18100B" strokeWidth="1.5" />
          
          {/* Melting Gradient Tongue */}
          <path 
            d="M 28 42 C 28 70, 32 95, 36 115 C 42 120, 48 110, 52 95 C 56 122, 64 124, 68 105 C 72 88, 72 65, 72 42 Z" 
            fill="#D76A24" 
            stroke="#18100B" 
            strokeWidth="2.5"
          />
          
          {/* Color stripes on tongue */}
          <path d="M 38 48 C 38 75, 42 90, 44 112" stroke="#F08A3C" strokeWidth="4" strokeLinecap="round" />
          <path d="M 48 48 C 48 70, 50 85, 52 94" stroke="#eab308" strokeWidth="4" strokeLinecap="round" />
          <path d="M 58 48 C 58 75, 62 88, 64 102" stroke="#10b981" strokeWidth="4" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
};

/**
 * Golden Tarot / Strong Order Book Sticker
 */
export const TarotBookSticker: React.FC<{ className?: string; size?: number }> = ({ 
  className = '', 
  size = 85 
}) => {
  return (
    <div 
      className={`relative select-none sticker-shadow cursor-pointer group ${className}`}
      style={{ width: size, height: size * 1.35 }}
    >
      <div 
        className="w-full h-full rounded-xl border-2 border-amber-300/80 p-2 transform -rotate-6 transition-all duration-300 group-hover:rotate-0 group-hover:scale-105 shadow-2xl relative overflow-hidden flex flex-col justify-between"
        style={{
          background: 'linear-gradient(135deg, #78350f 0%, #b45309 40%, #d97706 70%, #f59e0b 100%)',
          boxShadow: '0 12px 28px rgba(180, 83, 9, 0.45), inset 0 1px 2px rgba(255, 255, 255, 0.7)'
        }}
      >
        <div className="text-[9px] font-mono uppercase tracking-widest text-amber-200 font-black text-center border-b border-amber-400/40 pb-1">
          SHIELDED LEDGER
        </div>
        
        <div className="my-auto flex flex-col items-center">
          <div className="w-9 h-9 rounded-full border border-amber-200/60 bg-amber-950/40 flex items-center justify-center text-amber-200 text-lg">
            ⚡
          </div>
          <span className="text-[10px] font-bebas text-white tracking-wider mt-1">
            CONFIDENTIAL
          </span>
        </div>

        <div className="text-[8px] font-mono text-amber-100 text-center uppercase tracking-tighter">
          PROOF VERIFIED
        </div>
      </div>
    </div>
  );
};

/**
 * 8-Bit Pixel Pointer Hand Sticker
 */
export const PixelPointerSticker: React.FC<{ className?: string; size?: number }> = ({ 
  className = '', 
  size = 54 
}) => {
  return (
    <div 
      className={`relative select-none sticker-shadow cursor-pointer group ${className}`}
      style={{ width: size, height: size * 1.15 }}
    >
      <div className="w-full h-full relative transition-transform duration-300 group-hover:-translate-y-2 group-hover:rotate-6">
        <svg viewBox="0 0 32 36" className="w-full h-full filter drop-shadow-md">
          {/* Black Frame */}
          <path 
            d="M 8 0 L 14 0 L 14 14 L 20 14 L 20 16 L 24 16 L 24 18 L 28 18 L 28 28 L 24 32 L 8 32 L 8 20 L 4 16 L 4 12 L 8 8 Z" 
            fill="#0F0A07" 
          />
          {/* White Hand Fill */}
          <path 
            d="M 10 2 L 12 2 L 12 16 L 18 16 L 18 18 L 22 18 L 22 20 L 26 20 L 26 26 L 22 30 L 10 30 L 10 20 L 6 16 L 6 14 L 10 10 Z" 
            fill="#ffffff" 
          />
          {/* Orange Detail Accent */}
          <rect x="10" y="4" width="2" height="10" fill="#F08A3C" opacity="0.6" />
        </svg>
      </div>
    </div>
  );
};
