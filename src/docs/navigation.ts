/**
 * Documentation site navigation.
 *
 * Single source of truth for the /docs sidebar. Each item is a real App Router route
 * (`src/app/<href>/page.tsx`). Keep hrefs unique and stable — they are asserted in
 * `src/__tests__/docsNavigation.test.ts`.
 */
export interface DocsNavItem {
  href: string;
  label: string;
  /** Short sidebar description shown under the label. */
  description?: string;
}

export interface DocsNavGroup {
  label: string;
  items: DocsNavItem[];
}

export const GITHUB_URL = 'https://github.com/SmratJay/strk20-privacy-wallet';

export const docsNavigation: DocsNavGroup[] = [
  {
    label: 'Introduction',
    items: [
      { href: '/docs', label: 'Overview', description: 'What ORRANGE is and why it exists' },
      { href: '/docs/strk20', label: 'What is STRK20?', description: 'Shielded balances, notes, viewing keys' },
      { href: '/docs/why-orrange', label: 'Why ORRANGE?', description: 'The consumer problem and the product' },
    ],
  },
  {
    label: 'Product',
    items: [
      { href: '/docs/private-wallet', label: 'Private Wallet', description: 'Receive, shield, send, unshield' },
      { href: '/docs/private-treasury', label: 'Private Treasury', description: 'Hamster AI treasury copilot' },
      { href: '/docs/privacy', label: 'How Privacy Works', description: 'What is hidden and what is not' },
    ],
  },
  {
    label: 'Guides',
    items: [
      { href: '/docs/quickstart', label: 'Quickstart', description: 'Run the app in ~10 minutes' },
      { href: '/docs/guides/treasury', label: 'Use Treasury Intelligence', description: 'Diagnose, simulate, execute' },
      { href: '/docs/troubleshooting', label: 'Troubleshooting', description: 'Common issues and fixes' },
    ],
  },
  {
    label: 'Architecture',
    items: [
      { href: '/docs/architecture', label: 'System Architecture', description: 'How the pieces fit together' },
      { href: '/docs/strk20-integration', label: 'STRK20 Integration', description: 'Wallet API and SDK lanes' },
      { href: '/docs/private-identity', label: 'Private Identity', description: 'The STRK20 user identity' },
      { href: '/docs/ai-policy', label: 'AI + Policy Architecture', description: 'Proposals, policy, execution' },
      { href: '/docs/security', label: 'Security Model', description: 'Boundaries, threats, mitigations' },
    ],
  },
  {
    label: 'Developer',
    items: [
      { href: '/docs/development', label: 'Local Development', description: 'Project structure and subsystems' },
      { href: '/docs/environment', label: 'Environment', description: 'Every environment variable' },
      { href: '/docs/ai-provider', label: 'AI Provider', description: 'OpenAI-compatible inference' },
      { href: '/docs/api', label: 'API Reference', description: 'POST /api/ai/analyze' },
      { href: '/docs/testing', label: 'Testing', description: 'Tests, typecheck, build' },
    ],
  },
  {
    label: 'Contributing',
    items: [{ href: '/docs/contributing', label: 'Contributing', description: 'How to help without breaking boundaries' }],
  },
];

/** Flat list of every docs route for the smoke test. */
export const docsRoutes: string[] = docsNavigation.flatMap((g) => g.items.map((i) => i.href));