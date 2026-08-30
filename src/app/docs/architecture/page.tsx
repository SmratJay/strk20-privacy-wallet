import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Diagram } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — System Architecture',
  description: 'How the ORRANGE app is organized: UI, lanes, services, and where each concern lives.',
};

const OVERVIEW = [
  'Browser (Next.js / React)',
  '│',
  '├─ /wallet · /send · /receive · /treasury · /activity',
  '│',
  '├─ WalletContext ── balance, tx state, permissions',
  '│',
  '├─ Lane A: privacy wallet → Wallet API (wallet_strk20*)',
  '├─ Lane B: Privy embedded wallet → vendored STRK20 SDK',
  '│',
  '├─ /api/ai/analyze ── Hamster proposal + policy verdict',
  '│',
  '└─ services/ ── treasury gate, prices, swap, wallet API',
  '│',
  '▼',
  'STRK20 pool · prover · discovery · Starknet RPC',
];

export default function DocsArchitecturePage() {
  return (
    <DocsLayout
      title="System Architecture"
      subtitle="Architecture"
      lead="The app is a Next.js consumer layer over the existing STRK20 infrastructure. It composes — it does not re-implement — the privacy protocol."
    >
      <Diagram lines={OVERVIEW} />

      <h2 id="app-organization">App organization</h2>
      <table>
        <thead>
          <tr>
            <th>Directory</th>
            <th>Responsibility</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>src/app/</code></td>
            <td>App Router pages: wallet, send, receive, treasury, activity, launch, docs.</td>
          </tr>
          <tr>
            <td><code>src/ai/</code></td>
            <td>Hamster: provider, schema, proposal validation, portfolio, policy engine, health, prices.</td>
          </tr>
          <tr>
            <td><code>src/privacy/</code></td>
            <td>STRK20 privacy integration: Privy adapter, Ready account derivation, signing, viewing-key store.</td>
          </tr>
          <tr>
            <td><code>src/services/</code></td>
            <td>Wallet API service, STRK20 crypto, treasury execution gate, prices, swap, viewing-key service.</td>
          </tr>
          <tr>
            <td><code>src/context/</code></td>
            <td>Wallet / network / Privy-wallet React context and state.</td>
          </tr>
          <tr>
            <td><code>src/config/</code></td>
            <td>Networks, tokens, launchpad configuration.</td>
          </tr>
          <tr>
            <td><code>src/components/</code></td>
            <td>Wallet UI, app shell, landing, docs shell.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="lanes">Two STRK20 lanes</h2>
      <p>
        ORRANGE reaches the STRK20 pool through two lanes, selected by how you connect:
      </p>
      <ul>
        <li>
          <strong>Lane A — Wallet API.</strong> A privacy wallet (Ready) owns viewing keys, notes,
          discovery, proofs, and submission via <code>wallet_strk20InvokeTransaction</code> and{' '}
          <code>wallet_strk20Balances</code>. See{' '}
          <a href="/docs/strk20-integration">STRK20 Integration</a>.
        </li>
        <li>
          <strong>Lane B — Privy embedded wallet + SDK.</strong> ORRANGE provisions an embedded
          Privy wallet, derives the Ready account, and uses the vendored STRK20 SDK for discovery,
          proving, and submission. See <a href="/docs/private-identity">Private Identity</a>.
        </li>
      </ul>

      <h2 id="ai-treasury">The AI treasury path</h2>
      <p>
        <code>/treasury</code> reads balances through the active lane, then talks to{' '}
        <code>/api/ai/analyze</code>. The endpoint fetches fresh prices, builds a privacy-minimized
        portfolio, asks the AI for a structured proposal, and returns a deterministic policy
        verdict. Execution happens client-side through the existing private-transfer path, gated by
        <code>executeProposal</code>. See <a href="/docs/ai-policy">AI + Policy Architecture</a>.
      </p>

      <h2 id="what-we-do-not-implement">What the app does not implement</h2>
      <p>
        ORRANGE is not a new wallet, privacy pool, proof system, or cryptographic protocol. It does
        not run a prover or an indexer, and it does not integrate the SDK&rsquo;s
        <code>shadow_account_anonymizer</code>. Those live in the STRK20 infrastructure and the
        connected wallet.
      </p>

      <h2 id="deeper-reads">Deeper technical documents</h2>
      <ul>
        <li>
          <a href="https://github.com/SmratJay/strk20-privacy-wallet/blob/main/docs/PRIVY_STRK20_ARCHITECTURE.md" target="_blank" rel="noopener noreferrer">
            docs/PRIVY_STRK20_ARCHITECTURE.md
          </a>{' '}
          — component architecture, signing, proving, note lifecycle for the Privy lane.
        </li>
        <li>
          <a href="https://github.com/SmratJay/strk20-privacy-wallet/blob/main/docs/PRIVATE_RECEIVING_ARCHITECTURE.md" target="_blank" rel="noopener noreferrer">
            docs/PRIVATE_RECEIVING_ARCHITECTURE.md
          </a>{' '}
          — receive architecture and the registration model.
        </li>
        <li>
          <a href="https://github.com/SmratJay/strk20-privacy-wallet/blob/main/docs/PRIVY_STRK20_AUDIT.md" target="_blank" rel="noopener noreferrer">
            docs/PRIVY_STRK20_AUDIT.md
          </a>{' '}
          — security audit of the integration.
        </li>
      </ul>
    </DocsLayout>
  );
}