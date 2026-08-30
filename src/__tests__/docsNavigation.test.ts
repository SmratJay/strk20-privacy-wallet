import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { docsNavigation, docsRoutes, GITHUB_URL } from '@/docs/navigation';

const APP_ROOT = resolve(__dirname, '../app');

describe('docs navigation — sidebar integrity', () => {
  it('has the expected groups in order', () => {
    expect(docsNavigation.map((g) => g.label)).toEqual([
      'Introduction',
      'Product',
      'Guides',
      'Architecture',
      'Developer',
      'Contributing',
    ]);
    expect(docsNavigation.every((g) => g.items.length > 0)).toBe(true);
  });

  it('uses unique hrefs that all start with /docs', () => {
    expect(new Set(docsRoutes).size).toBe(docsRoutes.length);
    for (const href of docsRoutes) {
      expect(href.startsWith('/docs'), href).toBe(true);
    }
  });

  it('points every route at a real page file (link-check)', () => {
    for (const href of docsRoutes) {
      const pageFile = resolve(APP_ROOT, href.slice(1), 'page.tsx');
      expect(existsSync(pageFile), `missing page for ${href}`).toBe(true);
    }
  });

  it('labels every item and exposes the GitHub URL', () => {
    for (const group of docsNavigation) {
      for (const item of group.items) {
        expect(item.label.trim().length).toBeGreaterThan(0);
      }
    }
    expect(GITHUB_URL).toMatch(/^https:\/\/github\.com\//);
  });
});