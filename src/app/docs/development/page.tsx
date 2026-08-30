import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Diagram } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — Local Development',
  description: 'Repository structure and the subsystem map for the ORRANGE codebase.',
};

const TREE = [
  'src/',
  '├── ai/          Hamster: provider, schema, portfolio, policy, health, prices',
  '├── app/         App Router pages + API routes (/api/ai/analyze, /api/privy/*)',
  '├── components/  wallet UI, app shell, landing, docs shell',
  '├── config/      networks, tokens, launchpad',
  '├── context/     WalletContext, NetworkContext, PrivyWalletContext',
  '├── docs/        documentation navigation (this site)',
  '├── privacy/     STRK20 privacy: Privy adapter, Ready derivation, signing, viewing keys',
  '├── services/    wallet API, STRK20 crypto, treasury gate, prices, swap',
  '├── hooks/       wallet hooks',
  '├── providers/   Privy auth provider',
  '└── utils/       formatters, helpers',
];

export default function DocsDevelopmentPage() {
  return (
    <DocsLayout
      title="Local Development"
      subtitle="Developer"
      lead="Where everything lives, and how the pieces fit. Start with Quickstart to run the app; come back here to navigate the code."
    >
      <Diagram lines={TREE} />

      <h2 id="ai">src/ai — Hamster</h2>
      <p>The entire copilot, fully deterministic where it matters:</p>
      <ul>
        <li>
          <code>provider.ts</code> — the single LLM seam (OpenAI-compatible). See{' '}
          <a href="/docs/ai-provider">AI Provider</a>.
        </li>
        <li>
          <code>schema.ts</code> + <code>agent.ts</code> — structured proposal schema, validation,
          and the system prompt.
        </li>
        <li>
          <code>portfolio.ts</code> / <code>prices.ts</code> — privacy-minimized portfolio and the
          price feed (AVNU live + static fallback).
        </li>
        <li>
          <code>policy.ts</code> — the deterministic engine, guardrail presets, and
          <code>simulateAction</code>. See <a href="/docs/ai-policy">AI + Policy Architecture</a>.
        </li>
        <li>
          <code>health.ts</code> — advisory health/risk metrics and diagnosis copy.
        </li>
      </ul>

      <h2 id="privacy">src/privacy — STRK20 privacy integration</h2>
      <ul>
        <li>
          <code>adapter/PrivyStrk20Adapter.ts</code> — the only module that knows both Privy and
          STRK20 (SDK lane).
        </li>
        <li>
          <code>privy/ready.ts</code> — Ready account derivation and deployment. See{' '}
          <a href="/docs/private-identity">Private Identity</a>.
        </li>
        <li>
          <code>privy/signing.ts</code> / <code>server.ts</code> — server-side hash signing and the
          Privy server client.
        </li>
        <li>
          <code>privy/viewingKeyStore.ts</code> — encrypted-at-rest viewing-key storage (Privy lane).
        </li>
      </ul>

      <h2 id="services">src/services — infrastructure</h2>
      <ul>
        <li>
          <code>strk20WalletApiService.ts</code> — Lane A: Wallet API capability, balances, shield /
          private transfer / unshield, registration, reconcile. See{' '}
          <a href="/docs/strk20-integration">STRK20 Integration</a>.
        </li>
        <li>
          <code>treasuryService.ts</code> — the client-side execution gate (<code>executeProposal</code>).
        </li>
        <li>
          <code>strk20Crypto.ts</code> — protocol-domain-separation hashing helpers.
        </li>
        <li>
          <code>priceService.ts</code> / <code>avnuService.ts</code> — pricing and swap plumbing.
        </li>
      </ul>

      <h2 id="app">src/app — routes and API</h2>
      <p>
        Product routes live under <code>src/app/</code>: <code>/wallet</code>, <code>/send</code>,{' '}
        <code>/receive</code>, <code>/treasury</code>, <code>/activity</code>. API routes under{' '}
        <code>src/app/api/</code> handle the AI analyze endpoint and Privy signing.
      </p>

      <h2 id="config-context">src/config + src/context</h2>
      <p>
        <code>config/networks.ts</code> defines Mainnet and Sepolia networks, tokens, and pool
        addresses. <code>context/WalletContext.tsx</code> centralizes wallet state, private-balance
        authorization vs. refresh, and transaction reconciliation.
      </p>

      <h2 id="deeper-reads">Deeper documents</h2>
      <ul>
        <li>
          <a href="https://github.com/SmratJay/strk20-privacy-wallet/blob/main/docs/PRIVY_STRK20_ARCHITECTURE.md" target="_blank" rel="noopener noreferrer">
            docs/PRIVY_STRK20_ARCHITECTURE.md
          </a>
        </li>
        <li>
          <a href="https://github.com/SmratJay/strk20-privacy-wallet/blob/main/docs/PRIVATE_RECEIVING_ARCHITECTURE.md" target="_blank" rel="noopener noreferrer">
            docs/PRIVATE_RECEIVING_ARCHITECTURE.md
          </a>
        </li>
        <li>
          <a href="https://github.com/SmratJay/strk20-privacy-wallet/blob/main/docs/RFP_PRODUCT_SPEC.md" target="_blank" rel="noopener noreferrer">
            docs/RFP_PRODUCT_SPEC.md
          </a>{' '}
          (product contract) and{' '}
          <a href="https://github.com/SmratJay/strk20-privacy-wallet/blob/main/docs/RFP_ALIGNMENT.md" target="_blank" rel="noopener noreferrer">
            docs/RFP_ALIGNMENT.md
          </a>{' '}
          (requirement-by-requirement status).
        </li>
      </ul>
    </DocsLayout>
  );
}