import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Diagram } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — Local Development',
  description: 'Repository structure and the subsystem map for the ORRANGE codebase.',
};

const TREE = [
  'src/',
  '├── app/         App Router pages + API routes (/api/ai/analyze, /api/launch/metadata)',
  '├── components/  wallet UI, app shell, landing, docs shell',
  '├── config/      networks (one authoritative config), launchpad',
  '├── context/     WalletRuntimeContext, NetworkContext',
  '├── docs/        documentation navigation (this site)',
  '├── wallet/      Wallet Core: runtime, custody, keystore, account adapters, privacy session',
  '├── privacy/     STRK20 privacy: Strk20Adapter (official SDK), allowance, private-curve',
  '├── services/    chain/data + feature services (balances, prices, swap, treasury, launch)',
  '├── ai/          Hamster: provider, schema, portfolio, policy, health, prices',
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

      <h2 id="wallet">src/wallet — Wallet Core (the wallet)</h2>
      <ul>
        <li>
          <code>runtime.ts</code> — the ONE wallet runtime the UI talks to (WalletRuntime); safe
          UI state, generation/stale guards, deploy/send/privacy orchestration.
        </li>
        <li>
          <code>walletCore.ts</code> / <code>keystore.ts</code> / <code>crypto.ts</code> /
          <code>storage.ts</code> — custody: keygen, AES-GCM + PBKDF2 keystore, create/unlock/
          deploy/sign/send, public vs private storage.
        </li>
        <li>
          <code>account/</code> — Ready + Braavos account adapters (self-custodial) with on-chain
          ownership verification.
        </li>
        <li>
          <code>privacy.ts</code> — <code>WalletPrivacySession</code>: the wallet-native STRK20
          viewing key (<code>ORRANGE_WALLET_CORE_STRK20_VIEWING_KEY_V1</code>, in-memory only) and
          the privacy-operation serialization mutex.
        </li>
      </ul>

      <h2 id="privacy">src/privacy — STRK20 privacy protocol</h2>
      <ul>
        <li>
          <code>strk20/Strk20Adapter.ts</code> — the single generic adapter over the official
          vendored STRK20 SDK (register / shield / transfer / unshield / balances). No Privy, no
          Wallet API.
        </li>
        <li>
          <code>strk20/allowance.ts</code> — wallet-generic STRK allowance (STRK headroom;
          non-STRK tokens approved exactly).
        </li>
        <li>
          <code>strk20/privateCurve.ts</code> — launchpad private-curve trade composed on the
          generic adapter.
        </li>
        <li>
          <code>identity/</code> — <code>PrivateIdentity</code> (app-level namespace + SDK shadow
          commitments; never stores keys).
        </li>
      </ul>

      <h2 id="services">src/services — chain/data + feature services</h2>
      <ul>
        <li>
          <code>chains/publicBalances.ts</code> — neutral on-chain public-balance reads (RPC/ERC-20).
        </li>
        <li>
          <code>treasuryService.ts</code> — the AI treasury execution gate
          (<code>executeIntent</code> / <code>executeProposal</code>).
        </li>
        <li>
          <code>swapService.ts</code> / <code>priceService.ts</code> — AVNU public swaps and
          pricing.
        </li>
        <li>
          <code>launchService.ts</code> / <code>launchMetadata.ts</code> — launchpad browse data
          (create/trade gated pending Wallet Core migration).
        </li>
      </ul>

      <h2 id="app">src/app — routes and API</h2>
      <p>
        Product routes live under <code>src/app/</code>: <code>/wallet</code>, <code>/send</code>,{' '}
        <code>/receive</code>, <code>/treasury</code>, <code>/activity</code>, <code>/settings</code>,
        <code>/swap</code>. API routes handle the AI analyze endpoint and launchpad metadata.
        Launchpad trade and extended/perps trading are explicitly unavailable (gated) until they are
        migrated to Wallet Core.
      </p>

      <h2 id="config-context">src/config + src/context</h2>
      <p>
        <code>config/networks.ts</code> is the ONE authoritative network config (networks, tokens,
        pool, anonymizer per network). <code>context/WalletRuntimeContext.tsx</code> exposes the
        single wallet runtime to the UI via <code>useSyncExternalStore</code>.
      </p>

      <h2 id="deeper-reads">Deeper documents</h2>
      <ul>
        <li>
          <a href="/docs/architecture">Architecture</a> and{' '}
          <a href="/docs/private-wallet">Private Wallet</a> — current design.
        </li>
        <li>
          <a href="https://github.com/SmratJay/strk20-privacy-wallet/blob/main/docs/WALLET_CORE.md" target="_blank" rel="noopener noreferrer">
            docs/WALLET_CORE.md
          </a>{' '}
          — the authoritative Wallet Core + STRK20 architecture document.
        </li>
        <li>
          <a href="https://github.com/SmratJay/strk20-privacy-wallet/blob/main/docs/STRK20_COMPATIBILITY_MATRIX.md" target="_blank" rel="noopener noreferrer">
            docs/STRK20_COMPATIBILITY_MATRIX.md
          </a>{' '}
          — SDK/operator compatibility.
        </li>
        <li>
          Historical perps/privy/planning records live under{' '}
          <a href="https://github.com/SmratJay/strk20-privacy-wallet/tree/main/docs/archive" target="_blank" rel="noopener noreferrer">
            docs/archive/
          </a>.
        </li>
      </ul>
    </DocsLayout>
  );
}