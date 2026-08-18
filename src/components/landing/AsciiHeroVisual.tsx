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
  isCore: boolean;
}

const RAW_ASCII_TEMPLATE = [
  "              .%#####%%*+=-.                  ",
  "          .*%@@@@@@@@@@@@@@@@%#=.             ",
  "       .=%@@@@@@@@@@@@@@@@@@@@@@@%+:          ",
  "     -#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#=.       ",
  "   =%@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%+.     ",
  " .#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#:    ",
  " =@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%:   ",
  "+@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#   ",
  "#@@@@@@@@@@@@@@@@@#+-...-+#@@@@@@@@@@@@@@@@=  ",
  "%@@@@@@@@@@@@@@%=.          .=%@@@@@@@@@@@@+  ",
  "@@@@@@@@@@@@@@+                =@@@@@@@@@@@#  ",
  "@@@@@@@@@@@@@:   [ ORRANGE ]    +@@@@@@@@@@%  ",
  "@@@@@@@@@@@@#    ZK  PRIVACY     %@@@@@@@@@%  ",
  "%@@@@@@@@@@@#    STARKNET L2     %@@@@@@@@@%  ",
  "#@@@@@@@@@@@%                    %@@@@@@@@@#  ",
  "+@@@@@@@@@@@@-                  =@@@@@@@@@@=  ",
  " =@@@@@@@@@@@@*.               *@@@@@@@@@@%:  ",
  " .#@@@@@@@@@@@@%+:          .=%@@@@@@@@@@#:   ",
  "   =%@@@@@@@@@@@@@%*+====+*#@@@@@@@@@@@%+.    ",
  "     -#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#=.      ",
  "       .=%@@@@@@@@@@@@@@@@@@@@@@@@%+:         ",
  "          .*%@@@@@@@@@@@@@@@@%#=.             ",
  "              .%#####%%*+=-.                  ",
];

export const AsciiHeroVisual: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const particlesRef = useRef<AsciiParticle[]>([]);
  const mouseRef = useRef<{ x: number; y: number; isHovering: boolean }>({
    x: -1000,
    y: -1000,
    isHovering: false,
  });
  const [activePreset, setActivePreset] = useState<'REPEL' | 'VORTEX' | 'WAVE'>('REPEL');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = 480;
    let height = 360;

    const setupParticles = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      width = rect.width || 480;
      height = rect.height || 360;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      const rows = RAW_ASCII_TEMPLATE.length;
      const cols = RAW_ASCII_TEMPLATE[0].length;

      const charWidth = width / (cols + 2);
      const charHeight = height / (rows + 2);

      const particles: AsciiParticle[] = [];

      for (let r = 0; r < rows; r++) {
        const line = RAW_ASCII_TEMPLATE[r];
        for (let c = 0; c < line.length; c++) {
          const char = line[c];
          if (char === ' ') continue;

          const originX = (c + 1.2) * charWidth;
          const originY = (r + 1.6) * charHeight;

          const isCore = ['@', '%', '#', 'O', 'R', 'A', 'N', 'G', 'E', 'Z', 'K', 'S', 'T', 'L', '2'].includes(char);
          const isHighlight = ['[', ']', 'O', 'R', 'A', 'N', 'G', 'E'].includes(char);

          let color = '#ea580c'; // default warm orange
          if (isHighlight) {
            color = '#FFA726'; // bright amber for ORRANGE text
          } else if (isCore) {
            color = '#FF6B00'; // electric neon orange for body
          } else {
            color = '#c2410c'; // deeper orange for outer contour
          }

          particles.push({
            char,
            originX,
            originY,
            x: originX + (Math.random() - 0.5) * 4,
            y: originY + (Math.random() - 0.5) * 4,
            vx: 0,
            vy: 0,
            color,
            isCore,
          });
        }
      }

      particlesRef.current = particles;
    };

    setupParticles();

    // Resize listener
    const handleResize = () => {
      setupParticles();
    };
    window.addEventListener('resize', handleResize);

    // Physics Animation Loop
    let time = 0;
    const render = () => {
      time += 0.03;
      ctx.clearRect(0, 0, width, height);

      const mouse = mouseRef.current;
      const repulsionRadius = 85;
      const repulsionStrength = 14;

      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';

      const particles = particlesRef.current;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // 1. Mouse Repulsion Force
        if (mouse.isHovering) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < repulsionRadius && dist > 0) {
            const force = ((repulsionRadius - dist) / repulsionRadius) * repulsionStrength;
            const angle = Math.atan2(dy, dx);

            p.vx += Math.cos(angle) * force;
            p.vy += Math.sin(angle) * force;
          }
        }

        // 2. Subtle Organic Idle Wave
        const idleWaveX = Math.sin(time + p.originY * 0.05) * 0.4;
        const idleWaveY = Math.cos(time + p.originX * 0.05) * 0.4;

        // 3. Spring back to Origin
        const springX = (p.originX + idleWaveX) - p.x;
        const springY = (p.originY + idleWaveY) - p.y;

        p.vx += springX * 0.09;
        p.vy += springY * 0.09;

        // 4. Friction Damping
        p.vx *= 0.82;
        p.vy *= 0.82;

        p.x += p.vx;
        p.y += p.vy;

        // 5. Dynamic Glow & Color Shift when repelled
        const displacement = Math.sqrt((p.x - p.originX) ** 2 + (p.y - p.originY) ** 2);
        
        if (displacement > 12) {
          ctx.fillStyle = '#FFE082'; // bright flash when scattered
          ctx.shadowColor = '#FF6B00';
          ctx.shadowBlur = 10;
        } else if (displacement > 4) {
          ctx.fillStyle = '#FFA726';
          ctx.shadowColor = '#FF6B00';
          ctx.shadowBlur = 6;
        } else {
          ctx.fillStyle = p.color;
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
        }

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
      className="relative flex flex-col items-center justify-center p-4 select-none overflow-hidden group cursor-crosshair w-full"
    >
      {/* Background Ambient Orange Aura */}
      <div className="absolute w-72 h-72 rounded-full bg-orrange-500/10 blur-3xl pointer-events-none transition-opacity duration-500 group-hover:opacity-100 opacity-60" />

      {/* Interactive ASCII Canvas */}
      <div className="relative z-10 w-full flex items-center justify-center">
        <canvas
          ref={canvasRef}
          className="w-full max-w-[460px] h-[340px] block"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>

      {/* Interactive Hint & Telemetry Footer */}
      <div className="w-full flex items-center justify-between pt-2 border-t border-zinc-900/80 text-[10px] font-mono text-zinc-600 mt-1">
        <div className="flex items-center gap-1.5 text-orrange-500 font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-orrange-500 animate-ping" />
          <span>CURSOR_PHYSICS: ACTIVE (REPEL)</span>
        </div>
        <div className="text-zinc-500 hover:text-zinc-400 transition-colors">
          [ HOVER TO DISPLACE PARTICLES ]
        </div>
      </div>
    </div>
  );
};
