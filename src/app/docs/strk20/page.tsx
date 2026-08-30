import type { Metadata } from 'next';
import Link from 'next/link';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout, Chip, Diagram } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — What is STRK20?',
  description: 'STRK20 is Starknet\u2019s native shielded-payment privacy pool for private transfers.',
};

const DISCOVERY = [
  'sender builds a shielded note',
  '│',
  '▼',
  'encrypted note → STRK20 pool (public ledger, encrypted payloads)',
  '│',
  '▼',
  'recipient\u2019s wallet runs discovery (viewing key)',
  '│',
  '▼',
  'wallet finds + decrypts the note → private balance updates',
];

export default function DocsStrk20Page() {
  return (
    <DocsLayout
      title="What is STRK20?"
      subtitle="Introduction"
      lead="Starknet\u2019s native, Umbra-style privacy pool for shielded private payments."
    >
      <p>
        STRK20 lets you hold and transfer assets on Starknet without revealing <em>who</em> paid{' '}
        <em>whom</em>, <em>how much</em>, or <em>which token</em>. A normal transfer on Starknet is
        public: anyone can read the sender, recipient, amount, and asset. STRK20 moves those
        details into an encrypted note inside a shared privacy pool.
      </p>

      <h2 id="how-it-works">How a private transfer works</h2>
      <Diagram lines={DISCOVERY} />
      <p>
        Instead of a public transfer, the sender creates a <strong>note</strong> — an encrypted
        payload committing to an amount and a token — and inserts it into the STRK20 pool. The
        recipient&rsquo;s wallet later performs <strong>discovery</strong>: using its viewing key,
        it finds and decrypts the notes addressed to it. No third party can connect a sender to a
        recipient or learn the amount.
      </p>

      <h2 id="key-concepts">Key concepts</h2>
      <ul>
        <li>
          <strong>Shielded balances</strong> — balances live as a set of encrypted notes in the
          pool, not as a public ERC-20 ledger entry.
        </li>
        <li>
          <strong>Private transfers</strong> — a shielded note is spent and one or more new notes
          are created for the recipient (and a self-remainder, if any).
        </li>
        <li>
          <strong>Encrypted notes</strong> — each note payload is encrypted so only the intended
          recipient can read the amount and token.
        </li>
        <li>
          <strong>Viewing keys</strong> — a key pair used to locate and decrypt notes. Registration
          is one-time and immutable per the protocol. The connected privacy wallet owns the viewing
          key; the dapp never sees it.
        </li>
        <li>
          <strong>Wallet-side discovery</strong> — the wallet scans the pool with the viewing key
          and reconstructs your private balance. The dapp reads balances from the wallet — it never
          reconstructs notes itself.
        </li>
        <li>
          <strong>Prover + discovery infrastructure</strong> — a proving service generates
          validity proofs for pool actions, and a discovery service indexes notes/channels so
          wallets can find them.
        </li>
      </ul>

      <h2 id="what-is-hidden">What is hidden vs. what remains observable</h2>
      <table>
        <thead>
          <tr>
            <th>Detail</th>
            <th>In a STRK20 pool transfer</th>
            <th>In a plain ERC-20 transfer</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Sender</td>
            <td>Hidden by the pool&rsquo;s shared anonymity set</td>
            <td>Public</td>
          </tr>
          <tr>
            <td>Recipient</td>
            <td>Hidden — notes are encrypted</td>
            <td>Public</td>
          </tr>
          <tr>
            <td>Amount</td>
            <td>Hidden inside the encrypted note</td>
            <td>Public</td>
          </tr>
          <tr>
            <td>Token</td>
            <td>Hidden inside the encrypted note</td>
            <td>Public</td>
          </tr>
          <tr>
            <td>Transaction timing</td>
            <td><Chip tone="live">Observable</Chip> — pool activity is on-chain</td>
            <td>Public</td>
          </tr>
        </tbody>
      </table>

      <Callout tone="warn">
        <strong>Honest limits.</strong> STRK20 provides pool-level privacy — sender, recipient,
        amount, and token stay hidden inside the shared anonymity set. It does <em>not</em> hide
        broader network activity such as transaction timing, and it does not make you
        &ldquo;100% anonymous&rdquo; or &ldquo;untraceable&rdquo;. ORRANGE never claims otherwise.
      </Callout>

      <h2 id="why-it-matters">Why it matters here</h2>
      <p>
        ORRANGE sits on top of this protocol. You interact with STRK20 through a privacy-enabled
        wallet and the Starknet Wallet API; the pool, prover, and discovery are provided by the
        existing STRK20 infrastructure. See <Link href="/docs/strk20-integration">STRK20
        Integration</Link> for exactly which pieces ORRANGE owns and which it composes.
      </p>
    </DocsLayout>
  );
}