'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { docsNavigation, GITHUB_URL } from '@/docs/navigation';

interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function collectHeadings(root: HTMLElement): TocEntry[] {
  const seen = new Map<string, number>();
  const out: TocEntry[] = [];
  for (const el of Array.from(root.querySelectorAll('h2, h3'))) {
    const raw = el.textContent?.trim() ?? '';
    if (!raw) continue;
    let id = el.id || slugify(raw);
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = `${id}-${count}`;
    el.id = id;
    out.push({ id, text: raw, level: el.tagName === 'H3' ? 3 : 2 });
  }
  return out;
}

export function DocsLayout({
  title,
  subtitle,
  lead,
  children,
}: {
  title: string;
  subtitle?: string;
  lead?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const articleRef = useRef<HTMLElement>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!articleRef.current) return;
    const headings = collectHeadings(articleRef.current);
    setToc(headings);
    setActiveId(headings[0]?.id ?? null);

    const onScroll = () => {
      let current: string | null = null;
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= 140) current = h.id;
      }
      setActiveId(current ?? headings[0]?.id ?? null);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="docs-root">
      <header className="docs-topbar">
        <div className="docs-topbar-inner">
          <button
            type="button"
            className="docs-burger"
            onClick={() => setMobileOpen((o) => !o)}
            aria-expanded={mobileOpen}
            aria-controls="docs-mobile-nav"
            aria-label="Toggle documentation navigation"
          >
            {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>

          <Link href="/" className="docs-wordmark" aria-label="ORRANGE home">
            <span className="docs-wordmark-mark">
              <img src="/orrange.png" alt="" aria-hidden="true" />
            </span>
            <span>ORRANGE</span>
          </Link>

          <nav className="docs-topnav" aria-label="Documentation">
            <Link href="/docs" className="docs-topnav-link is-active">
              Docs
            </Link>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="docs-topnav-link">
              GitHub
            </a>
          </nav>

          <div className="docs-topbar-right">
            <span className="docs-topbar-path">/docs</span>
            <Link href="/wallet" className="docs-launch">
              Launch wallet <ArrowUpRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <div className="docs-shell">
        {mobileOpen && (
          <div className="docs-mobile-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />
        )}
        <aside id="docs-mobile-nav" className={`docs-sidebar ${mobileOpen ? 'is-open' : ''}`}>
          <nav className="docs-sidenav" aria-label="Documentation sections">
            {docsNavigation.map((group) => (
              <div key={group.label} className="docs-sidenav-group">
                <div className="docs-sidenav-group-label">{group.label}</div>
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`docs-sidenav-link ${active ? 'is-active' : ''}`}
                    >
                      <span className="docs-sidenav-link-label">{item.label}</span>
                      {item.description && <span className="docs-sidenav-link-desc">{item.description}</span>}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <article ref={articleRef} className="docs-article">
          <div className="docs-eyebrow">ORRANGE / {subtitle ?? 'DOCUMENTATION'}</div>
          <h1 className="docs-title">{title}</h1>
          {lead && <p className="docs-lead">{lead}</p>}
          <div className="docs-content">{children}</div>
        </article>

        <aside className="docs-toc" aria-label="On this page">
          <div className="docs-toc-sticky">
            <div className="docs-toc-label">On this page</div>
            {toc.length === 0 ? (
              <div className="docs-toc-empty">—</div>
            ) : (
              <ul className="docs-toc-list">
                {toc.map((h) => (
                  <li key={h.id} className={h.level === 3 ? 'is-h3' : ''}>
                    <a
                      href={`#${h.id}`}
                      className={activeId === h.id ? 'is-active' : ''}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                    >
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <footer className="docs-footer">
        <span>ORRANGE — private finance for Starknet.</span>
        <span>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a href="/wallet">Launch wallet</a>
        </span>
      </footer>
    </div>
  );
}