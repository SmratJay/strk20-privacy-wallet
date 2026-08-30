import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout, Diagram } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — STRK20 Integration',
  description: 'How ORRANGE composes STRK20 through the Wallet API lane and the Privy/SDK lane.',
};

const FLOW = [
  'private identity (STRK20 user)',
  '│',
  '▼',
  'STRK20 privateTransfer',
  '│',
  '▼',
  'prover (validity proof)',
  '│',
  '▼',
  'discovery (indexer / wallet scan)',
  '│',
  '▼',
  'wallet signature',
  '│',
  '▼',
  'Starknet (STRK20 pool)',
];

export default function DocsStrk20IntegrationPage() {
  return (
    <DocsLayout
      title="STRK20 Integration"
      subtitle="Architecture"
      lead="ORRANGE reaches STRK20 through two supported lanes. Both end at the same pool; only who holds the secrets differs."
    >
      <p>
        This page documents the <em>actual</em> integration. ORRANGE does not implement its own
        privacy pool, prover, or cryptography — it composes the existing STRK20 infrastructure.
      </p>

      <h2 id="the-pipeline">The pipeline</h2>
      <Diagram lines={FLOW} />

      <h2 id="lane-a">Lane A — privacy wallet + Wallet API</h2>
      <p>
        The dapp connects a privacy-enabled Starknet wallet (e.g. <strong>Ready</strong>) and asks
        it to perform STRK20 actions. The wallet owns viewing keys, channels, encrypted notes,
        proof generation, and submission. The dapp never inspects or stores any of those.
      </p>
      <ul>
        <li>
          <code>wallet_strk20InvokeTransaction</code> — submit a STRK20 action (<code>deposit</code> /{' '}
          <code>withdraw</code> / <code>transfer</code>).
        </li>
        <li>
          <code>wallet_strk20Balances</code> — read private balances (the wallet&rsquo;s discovery
          output).
        </li>
      </ul>
      <p>
        There is no standalone registration RPC: the wallet adds the viewing-key registration +
        channel setup actions to your first real STRK20 action (<code>autoRegister</code> /
        <code>autoSetup</code>).
      </p>

      <h2 id="lane-b">Lane B — Privy embedded wallet + vendored SDK</h2>
      <p>
        ORRANGE can provision an embedded Privy wallet instead. It derives the counterfactual Ready
        account on-chain address from the public key (<code>computeReadyAccountAddress</code>),
        deploys it if needed, and uses the vendored <code>@starkware-libs/starknet-privacy-sdk</code>{' '}
        for note discovery, proving, and submission through a starknet.js <code>Account</code>.
        Signing is delegated to Privy&rsquo;s server-side <code>rawSign</code> via{' '}
        <code>/api/privy/sign</code> — the browser never holds the private key.
      </p>

      <h2 id="who-owns-what">Who owns what</h2>
      <table>
        <thead>
          <tr>
            <th>Concern</th>
            <th>ORRANGE</th>
            <th>Privacy wallet</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Viewing key</td>
            <td>Never sees it</td>
            <td>Owns + stores it</td>
          </tr>
          <tr>
            <td>Encrypted notes</td>
            <td>Never sees them</td>
            <td>Discovers + decrypts</td>
          </tr>
          <tr>
            <td>Proofs</td>
            <td>Never generates them</td>
            <td>Generates (or SDK/prover)</td>
          </tr>
          <tr>
            <td>Signing</td>
            <td>Never signs</td>
            <td>Signs (or Privy <code>rawSign</code>)</td>
          </tr>
          <tr>
            <td>Balances</td>
            <td>Reads from wallet, authoritative</td>
            <td>Source of truth</td>
          </tr>
        </tbody>
      </table>

      <Callout tone="ok">
        Every state-changing path — wallet send/receive <em>and</em> the treasury copilot — ends in
        the existing STRK20 private-transfer flow. The AI treasury never builds its own calldata;
        it reuses these exact integration paths.
      </Callout>

      <h2 id="references">References</h2>
      <ul>
        <li>
          <a href="https://github.com/SmratJay/strk20-privacy-wallet/blob/main/docs/PRIVY_STRK20_ARCHITECTURE.md" target="_blank" rel="noopener noreferrer">
            docs/PRIVY_STRK20_ARCHITECTURE.md
          </a>{' '}
          — signing, proving, note lifecycle, recovery for the Privy lane.
        </li>
        <li>
          <a href="https://github.com/SmratJay/strk20-privacy-wallet/blob/main/docs/PRIVATE_RECEIVING_ARCHITECTURE.md" target="_blank" rel="noopener noreferrer">
            docs/PRIVATE_RECEIVING_ARCHITECTURE.md
          </a>{' '}
          — the receive/registration architecture.
        </li>
        <li>
          <a href="https://github.com/SmratJay/strk20-privacy-wallet/blob/main/docs/PRIVY_STRK20_COMPATIBILITY_AUDIT.md" target="_blank" rel="noopener noreferrer">
            docs/PRIVY_STRK20_COMPATIBILITY_AUDIT.md
          </a>{' '}
          — on-chain compatibility verification.
        </li>
      </ul>
    </DocsLayout>
  );
}