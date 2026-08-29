'use client';

import { useEffect, useRef } from 'react';

const GLYPHS = ['.', ':', '+', '×', '•', '—', '/', '\\'];

export function OrangeField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5, active: false };
    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let startedAt = performance.now();

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };

    const movePointer = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      const bounds = canvas.getBoundingClientRect();
      const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
        && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      pointer.active = inside;
      if (inside) {
        pointer.targetX = (event.clientX - bounds.left) / Math.max(bounds.width, 1);
        pointer.targetY = (event.clientY - bounds.top) / Math.max(bounds.height, 1);
      }
    };

    const render = (now: number) => {
      const elapsed = (now - startedAt) / 1000;
      const motion = reduceMotion ? 0 : elapsed;
      pointer.x += (pointer.targetX - pointer.x) * (reduceMotion ? 1 : 0.045);
      pointer.y += (pointer.targetY - pointer.y) * (reduceMotion ? 1 : 0.045);

      const centerX = width * (0.5 + (pointer.x - 0.5) * 0.15);
      const centerY = height * (0.42 + (pointer.y - 0.5) * 0.12);
      const base = context.createRadialGradient(centerX, centerY, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.78);
      base.addColorStop(0, '#c9622d');
      base.addColorStop(0.2, '#7c351c');
      base.addColorStop(0.52, '#24120d');
      base.addColorStop(1, '#090604');
      context.fillStyle = base;
      context.fillRect(0, 0, width, height);

      const warmGlow = context.createRadialGradient(width * (0.22 + pointer.x * 0.12), height * (0.82 - pointer.y * 0.12), 0, width * 0.22, height * 0.8, Math.max(width, height) * 0.6);
      warmGlow.addColorStop(0, 'rgba(255, 177, 92, 0.2)');
      warmGlow.addColorStop(0.45, 'rgba(200, 90, 37, 0.08)');
      warmGlow.addColorStop(1, 'rgba(200, 90, 37, 0)');
      context.fillStyle = warmGlow;
      context.fillRect(0, 0, width, height);

      const columns = Math.min(76, Math.max(34, Math.ceil(width / 22)));
      const rows = Math.min(44, Math.max(24, Math.ceil(height / 21)));
      const cellWidth = width / columns;
      const cellHeight = height / rows;
      const fontSize = Math.max(8, Math.min(12, cellWidth * 0.52));
      context.font = `${fontSize}px 'JetBrains Mono', monospace`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const normalizedX = column / Math.max(columns - 1, 1);
          const normalizedY = row / Math.max(rows - 1, 1);
          const wave = Math.sin(normalizedX * 7.5 + normalizedY * 4.2 + motion * 0.32) * 0.5 + 0.5;
          const flow = Math.sin(normalizedY * 9 + motion * 0.22 + normalizedX * 2) * 0.5 + 0.5;
          const distance = Math.hypot(normalizedX - pointer.x, normalizedY - pointer.y);
          const proximity = Math.max(0, 1 - distance * 1.65);
          const opacity = 0.055 + wave * 0.075 + flow * 0.035 + proximity * (pointer.active ? 0.1 : 0.02);
          const hue = 22 + Math.round(wave * 18 + proximity * 14);
          context.fillStyle = `hsla(${hue}, ${70 + Math.round(proximity * 20)}%, ${62 + Math.round(wave * 12)}%, ${opacity})`;
          const driftX = Math.sin(normalizedY * 5 + motion * 0.18) * cellWidth * 0.2;
          const driftY = Math.cos(normalizedX * 4 + motion * 0.14) * cellHeight * 0.15;
          const glyph = GLYPHS[(row * 3 + column + Math.floor(motion * 2)) % GLYPHS.length];
          context.fillText(glyph, column * cellWidth + cellWidth / 2 + driftX, row * cellHeight + cellHeight / 2 + driftY);
        }
      }

      const vignette = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.18, width / 2, height / 2, Math.max(width, height) * 0.76);
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(4, 2, 1, 0.46)');
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);

      if (!reduceMotion) animationFrame = requestAnimationFrame(render);
    };

    resize();
    render(startedAt);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('pointermove', movePointer, { passive: true });

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', movePointer);
    };
  }, []);

  return <canvas ref={canvasRef} className="orrange-field" aria-hidden="true" />;
}
