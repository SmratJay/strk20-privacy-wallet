import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

export function HeroNav() {
  return (
    <header className="orrange-hero-nav landing-enter landing-enter-nav">
      <Link href="/" className="orrange-wordmark" aria-label="ORRANGE home">
        <span className="orrange-logo-frame"><img src="/orrange.png" alt="" aria-hidden="true" /></span>
        <span>ORRANGE</span>
      </Link>

      <nav className="orrange-nav-links" aria-label="Primary navigation">
        <Link href="/own-wallet">Own wallet</Link>
        <Link href="/docs">Docs</Link>
        <a href="https://github.com/SmratJay/strk20-privacy-wallet" target="_blank" rel="noopener noreferrer">GitHub</a>
      </nav>

      <Link href="/wallet" className="orrange-nav-cta">
        Launch wallet <ArrowUpRight aria-hidden="true" />
      </Link>
    </header>
  );
}
