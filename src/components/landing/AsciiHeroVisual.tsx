'use client';

import React, { useRef, useEffect, useState } from 'react';

interface AsciiParticle {
  char: string;
  originX: number;
  originY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  isFireOrGold: boolean;
}

// Ultra-fine micro glyphs categorized by density
const DENSITY_RAMP = ' .`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
const FLAME_RAMP = ' .:+*#@%O';

export const AsciiHeroVisual: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const particlesRef = useRef<AsciiParticle[]>([]);
  const mouseRef = useRef<{ x: number; y: number; isHovering: boolean }>({
    x: -1000,
    y: -1000,
    isHovering: false,
  });

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    let animationFrameId: number;
    let width = 560;
    let height = 620;

    const img = new Image();
    img.src = '/orrange-ascii-source.png';
    img.crossOrigin = 'anonymous';

    const processImageToAscii = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width || 560;
      height = rect.height || 620;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      // High-precision grid matching character aspect ratio (width: ~4.0px, height: ~6.2px)
      // This produces ~12,000 - 15,000 micro ASCII particles for hyper-detailed definition!
      const cols = Math.floor(width / 4.2);  // ~130-140 cols
      const rows = Math.floor(height / 6.4); // ~95-105 rows

      const offCanvas = document.createElement('canvas');
      offCanvas.width = cols;
      offCanvas.height = rows;
      const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
      if (!offCtx) return;

      offCtx.drawImage(img, 0, 0, cols, rows);
      const imgData = offCtx.getImageData(0, 0, cols, rows).data;

      const charWidth = width / cols;
      const charHeight = height / rows;

      const particles: AsciiParticle[] = [];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = (r * cols + c) * 4;
          const red = imgData[idx];
          const green = imgData[idx + 1];
          const blue = imgData[idx + 2];
          const alpha = imgData[idx + 3];

          // Strict background removal (transparent or near-white background)
          if (alpha < 30) continue;
          if (red > 230 && green > 230 && blue > 230) continue;

          const originX = (c + 0.5) * charWidth;
          const originY = (r + 0.5) * charHeight;

          // Luminance calculation
          const lum = 0.299 * red + 0.587 * green + 0.114 * blue;

          // Color classification
          const isOrangeFire = red > 135 && green > 40 && red > blue + 35 && blue < green * 0.95;
          const isGreenLeaf = green > red + 10 && green > blue + 10 && green > 40;
          const isGold = red > 160 && green > 120 && blue < 95;
          const isDeepShadow = lum < 45 && !isOrangeFire;

          let char = ' ';
          let color = `rgb(${red}, ${green}, ${blue})`;
          let isFireOrGold = false;

          if (isGreenLeaf) {
            // Emerald Leaf
            const leafIdx = Math.floor((lum / 255) * (DENSITY_RAMP.length - 1));
            char = DENSITY_RAMP[leafIdx] || '*';
            color = `rgb(${red}, ${green}, ${blue})`;
          } else if (isOrangeFire || isGold) {
            // Glowing Cosmic Orb, Orbiting Rings, Fire Tendrils & Eyes
            const flameIdx = Math.floor((lum / 255) * (FLAME_RAMP.length - 1));
            char = FLAME_RAMP[Math.max(1, Math.min(FLAME_RAMP.length - 1, flameIdx))];
            color = `rgb(${red}, ${green}, ${blue})`;
            isFireOrGold = true;
          } else if (isDeepShadow) {
            // Flowing Wizard Robes - give subtle carbon-slate boost so dark fabric weave is visible
            const darkRamp = '@%#WMB80Q';
            const shadowIdx = Math.floor((lum / 45) * (darkRamp.length - 1));
            char = darkRamp[Math.max(0, Math.min(darkRamp.length - 1, shadowIdx))];
            const rBoost = Math.max(35, Math.min(75, red + 26));
            const gBoost = Math.max(35, Math.min(75, green + 26));
            const bBoost = Math.max(45, Math.min(90, blue + 34));
            color = `rgb(${rBoost}, ${gBoost}, ${bBoost})`;
          } else {
            // Midtones, Robe Folds, Accents
            const rampIdx = Math.floor((lum / 255) * (DENSITY_RAMP.length - 1));
            char = DENSITY_RAMP[Math.max(1, Math.min(DENSITY_RAMP.length - 1, rampIdx))];
            color = `rgb(${red}, ${green}, ${blue})`;
          }

          if (char === ' ' || !char) continue;

          particles.push({
            char,
            originX,
            originY,
            x: originX,
            y: originY,
            vx: 0,
            vy: 0,
            color,
            isFireOrGold,
          });
        }
      }

      particlesRef.current = particles;
      setIsLoading(false);
    };

    img.onload = () => {
      processImageToAscii();
    };

    if (img.complete && img.naturalWidth > 0) {
      processImageToAscii();
    }

    const handleResize = () => {
      if (img.complete) {
        processImageToAscii();
      }
    };
    window.addEventListener('resize', handleResize);

    // 60 FPS Ultra-Smooth & Localized Fluid Physics Loop
    let time = 0;
    const render = () => {
      time += 0.02;
      ctx.clearRect(0, 0, width, height);

      const mouse = mouseRef.current;
      // Precise small repulsion radius (36px) with smooth cubic/cosine falloff
      const repulsionRadius = 38;
      const repulsionStrength = 3.2;

      // Micro font size for razor-sharp fidelity
      ctx.font = 'bold 5.8px "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      const particles = particlesRef.current;
      const len = particles.length;

      for (let i = 0; i < len; i++) {
        const p = particles[i];

        // 1. Fluid Localized Repulsion (Smooth Cosine Bell Curve)
        if (mouse.isHovering) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const distSq = dx * dx + dy * dy;
          const radiusSq = repulsionRadius * repulsionRadius;

          if (distSq < radiusSq && distSq > 0.01) {
            const dist = Math.sqrt(distSq);
            // Smooth bell curve: 1 at cursor center, smoothly 0 at edge
            const normDist = dist / repulsionRadius;
            const falloff = 0.5 * (1 + Math.cos(normDist * Math.PI));
            const force = falloff * repulsionStrength;
            const angle = Math.atan2(dy, dx);

            p.vx += Math.cos(angle) * force;
            p.vy += Math.sin(angle) * force;
          }
        }

        // 2. Subtle organic breathing of cosmic embers
        const idleWave = p.isFireOrGold ? Math.sin(time * 2 + p.originY * 0.1) * 0.35 : 0;

        // 3. Magnetic Spring Return to Exact Origin Anchor
        const springX = p.originX - p.x;
        const springY = (p.originY + idleWave) - p.y;

        p.vx += springX * 0.075;
        p.vy += springY * 0.075;

        // 4. Fluid Friction Damping (High viscosity for silky fluid feel)
        p.vx *= 0.85;
        p.vy *= 0.85;

        p.x += p.vx;
        p.y += p.vy;

        // 5. Render Particle in its Original Colors (No harsh color distortion)
        ctx.fillStyle = p.color;
        ctx.fillText(p.char, p.x, p.y);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    mouseRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      isHovering: true,
    };
  };

  const handleMouseEnter = () => {
    mouseRef.current.isHovering = true;
  };

  const handleMouseLeave = () => {
    mouseRef.current.isHovering = false;
    mouseRef.current.x = -1000;
    mouseRef.current.y = -1000;
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative flex flex-col items-center justify-center p-3 select-none overflow-hidden group cursor-crosshair w-full"
    >
      {/* Ambient Radial Dark Orange Atmosphere */}
      <div className="absolute w-[420px] h-[420px] rounded-full bg-orrange-500/10 blur-3xl pointer-events-none transition-opacity duration-700 opacity-60 group-hover:opacity-90" />

      {/* Interactive ASCII Canvas */}
      <div className="relative z-10 w-full flex items-center justify-center min-h-[500px] sm:min-h-[560px] md:min-h-[600px]">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-orrange-400">
            <span className="animate-pulse">RASTERIZING HIGH-DENSITY MATRIX...</span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="w-full h-[500px] sm:h-[560px] md:h-[600px] block"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
    </div>
  );
};
