'use client';

import { useRef } from 'react';
import type { PointerEvent } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { HeroNav } from './HeroNav';
import { OrangeField } from './OrangeField';
import { ProductMockup } from './ProductMockup';

export function OrrangeHero() {
  const heroRef = useRef<HTMLElement>(null);

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / Math.max(bounds.width, 1);
    const y = (event.clientY - bounds.top) / Math.max(bounds.height, 1);
    heroRef.current?.style.setProperty('--hero-tilt-x', `${(0.5 - x) * 2}deg`);
    heroRef.current?.style.setProperty('--hero-tilt-y', `${(y - 0.5) * 1.5}deg`);
  };

  const handlePointerLeave = () => {
    heroRef.current?.style.setProperty('--hero-tilt-x', '0deg');
    heroRef.current?.style.setProperty('--hero-tilt-y', '0deg');
  };

  return (
    <main
      ref={heroRef}
      className="orrange-hero"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <OrangeField />
      <div className="orrange-hero-wash" aria-hidden="true" />
      <HeroNav />

      <div className="orrange-hero-content">
        <div className="orrange-hero-copy">
          <p className="orrange-kicker landing-enter landing-enter-kicker"><span /> Starknet privacy terminal</p>
          <h1 className="orrange-hero-title landing-enter landing-enter-title">Everything private,<br />in one terminal.</h1>
          <p className="orrange-hero-support landing-enter landing-enter-support">A private financial terminal for Starknet.</p>
          <p className="orrange-hero-meta landing-enter landing-enter-support">Shield. Send. Swap. Trade.</p>
          <div className="orrange-hero-actions landing-enter landing-enter-cta">
            <Link href="/wallet" className="orrange-primary-cta">Launch wallet <ArrowUpRight aria-hidden="true" /></Link>
            <a href="https://github.com/SmratJay/strk20-privacy-wallet" target="_blank" rel="noopener noreferrer" className="orrange-secondary-cta">GitHub <ArrowUpRight aria-hidden="true" /></a>
          </div>
        </div>

        <div className="orrange-product-wrap landing-enter landing-enter-product">
          <ProductMockup />
        </div>
      </div>

      <div className="orrange-hero-footer landing-enter landing-enter-footer"><span>STRK20 / STARKNET</span><span>PRIVATE BY DESIGN</span><span>© {new Date().getFullYear()} ORRANGE LABS</span></div>
    </main>
  );
}
