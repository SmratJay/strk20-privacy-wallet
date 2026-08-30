import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout, Chip, Steps } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — Quickstart',
  description: 'Run the ORRANGE app locally in about ten minutes: install, configure, and open /treasury.',
};

export default function DocsQuickstartPage() {
  return (
    <DocsLayout
      title="Quickstart"
      subtitle="Guides"
      lead="Get a running local app in about ten minutes. This page is the shortest path from zero to /treasury."
    >
      <h2 id="prerequisites">Prerequisites</h2>
      <ul>
        <li><strong>Node.js 18.18+</strong> and <code>npm</code> (the repo is a Next.js 15 / React 19 app).</li>
        <li>
          A <strong>privacy-capable Starknet wallet</strong> — <strong>Ready</strong> (Wallet API ≥
          0.10), or use the ORRANGE-embedded Privy wallet lane. STRK20 private features require a
          wallet that supports the STRK20 Wallet API methods.
        </li>
        <li>
          A small amount of <strong>Sepolia ETH/STRK</strong> for fees (Starknet Sepolia is the
          validated network for the private flows). Use the Sepolia faucet if needed.
        </li>
        <li>
          <strong>STRK20 prover + discovery endpoints</strong> — end-to-end STRK20 actions need the
          operator&rsquo;s proving/discovery stack. Without them, the UI loads but real shielded
          transfers cannot complete.
        </li>
      </ul>

      <h2 id="install">1. Install</h2>
      <pre>
        <code>
          <span className="tok-c"># from the repository root</span>{'\n'}
          <span className="tok-o">npm</span> install
        </code>
      </pre>

      <h2 id="environment">2. Configure the environment</h2>
      <pre>
        <code>
          <span className="tok-o">cp</span> .env.example .env.local
        </code>
      </pre>
      <p>Fill in the values by category (never commit real secrets):</p>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Variables</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Wallet / Privy</td>
            <td>
              <code>PRIVY_APP_ID</code>, <code>PRIVY_APP_SECRET</code>,{' '}
              <code>NEXT_PUBLIC_PRIVY_APP_ID</code>, <code>NEXT_PUBLIC_READY_CLASSHASH</code>
            </td>
          </tr>
          <tr>
            <td>Starknet / STRK20</td>
            <td>
              <code>ALCHEMY_STARKNET_KEY</code>, <code>NEXT_PUBLIC_STARKNET_RPC</code>,{' '}
              <code>NEXT_PUBLIC_STRK20_POOL</code>,{' '}
              <code>NEXT_PUBLIC_STRK20_SEPOLIA_POOL</code>, <code>NEXT_PUBLIC_USDC_SEPOLIA</code>,{' '}
              <code>NEXT_PUBLIC_CHAIN_ID</code>
            </td>
          </tr>
          <tr>
            <td>Prover</td>
            <td><code>NEXT_PUBLIC_STRK20_PROVER_URL</code></td>
          </tr>
          <tr>
            <td>Discovery</td>
            <td><code>NEXT_PUBLIC_STRK20_DISCOVERY_URL</code></td>
          </tr>
          <tr>
            <td>AI provider</td>
            <td>
              <code>AI_API_KEY</code> <Chip tone="private">server-only</Chip>,{' '}
              <code>AI_BASE_URL</code>, <code>AI_MODEL</code>
            </td>
          </tr>
          <tr>
            <td>Treasury allowlists</td>
            <td>
              <code>AI_ALLOWED_ASSETS</code>, <code>AI_ALLOWED_DESTINATIONS</code>{' '}
              <Chip tone="private">server-only</Chip>
            </td>
          </tr>
        </tbody>
      </table>

      <Callout tone="note">
        <code>AI_API_KEY</code>, <code>AI_ALLOWED_ASSETS</code>, <code>AI_ALLOWED_DESTINATIONS</code>,
        and the Privy secret are <strong>server-only</strong> — never prefix them with{' '}
        <code>NEXT_PUBLIC_</code> or they ship to the browser. See{' '}
        <a href="/docs/environment">Environment</a> for the full reference.
      </Callout>

      <h2 id="run">3. Run</h2>
      <pre>
        <code>
          <span className="tok-o">npm</span> run dev
        </code>
      </pre>
      <p>Open <code>http://localhost:3000</code>.</p>

      <h2 id="shortest-path">Shortest path to the treasury</h2>
      <Steps
        items={[
          <>
            <strong>Connect</strong> a privacy wallet from <code>/wallet</code> (Ready extension,
            or the Privy lane).
          </>,
          <>
            <strong>Enable private receiving</strong> — the app submits a real STRK20 action; the
            wallet registers your viewing key and shields the first note in one transaction.
          </>,
          <>
            <strong>Inspect your private balance</strong> on <code>/wallet</code> — the balance
            comes from the wallet&rsquo;s discovery, never a local cache.
          </>,
          <>
            Open <strong><code>/treasury</code></strong> — the command center is live on page load
            with a proactive diagnosis. Select a guardrail, ask Hamster, or try a What-If
            simulation.
          </>,
        ]}
      />

      <Callout tone="warn">
        End-to-end execution requires a live privacy wallet, a funded Sepolia account, and the
        STRK20 operator proving/discovery stack. If the AI is not configured, <code>/treasury</code>{' '}
        still works for portfolio and health — diagnosis just uses the deterministic engine instead
        of the LLM.
      </Callout>
    </DocsLayout>
  );
}