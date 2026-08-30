import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout, Diagram } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — How Privacy Works',
  description: 'How ORRANGE keeps STRK20 private: key separation, encrypted notes, discovery, and what the dapp never handles.',
};

const KEYS = [
  'You (login / wallet)',
  '│',
  '├─ privacy wallet  ── viewing key, encrypted notes, discovery, proofs, signing',
  '│',
  '├─ ORRANGE dapp    ── UI, routing, portfolio aggregation (aggregates only)',
  '│',
  '└─ Hamster AI      ── sees only the aggregate portfolio needed for analysis',
];

export default function DocsPrivacyPage() {
  return (
    <DocsLayout
      title="How Privacy Works"
      subtitle="Product"
      lead="Privacy comes from a strict separation of who owns what. The pool hides the transfer; the wallet owns the secrets; the dapp and the AI stay out."
    >
      <p>
        STRK20&rsquo;s privacy properties — shielded balances, encrypted notes, wallet-side
        discovery — come from the protocol and the connected privacy wallet. ORRANGE preserves
        them by never inserting itself between you and your secrets.
      </p>

      <h2 id="who-owns-what">Who owns what</h2>
      <Diagram lines={KEYS} />
      <table>
        <thead>
          <tr>
            <th>Party</th>
            <th>Owns</th>
            <th>Never sees</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Privacy wallet</td>
            <td>Viewing key, encrypted notes, channel state, proofs, signing</td>
            <td>—</td>
          </tr>
          <tr>
            <td>ORRANGE dapp</td>
            <td>UI, routing, private-balance reads, portfolio aggregation</td>
            <td>Viewing keys, encrypted notes, decrypted notes, private keys, nullifiers, proofs</td>
          </tr>
          <tr>
            <td>Hamster AI</td>
            <td>—</td>
            <td>Everything except the aggregate portfolio summary sent for analysis</td>
          </tr>
        </tbody>
      </table>

      <h2 id="hidden-vs-observable">Hidden vs. observable</h2>
      <p>Within a STRK20 pool transfer:</p>
      <ul>
        <li>
          <strong>Hidden:</strong> sender, recipient, amount, and token — inside the shared
          anonymity set.
        </li>
        <li>
          <strong>Observable:</strong> that pool activity happened, and its timing. STRK20 is not
          &ldquo;100% anonymous&rdquo; and ORRANGE never claims it is.
        </li>
      </ul>

      <h2 id="the-dapp-boundary">The dapp boundary</h2>
      <ul>
        <li>
          Private balances come only from the wallet via <code>wallet_strk20Balances</code> (or the
          SDK lane&rsquo;s <code>discoverNotes</code>). They are never reconstructed from local
          history.
        </li>
        <li>
          The app has no mock balances, fake transactions, or fake confirmations. A transaction is
          only reported confirmed after on-chain reconciliation.
        </li>
        <li>
          The app never falls back to a public ERC-20 transfer when privacy tooling is missing.
        </li>
      </ul>

      <h2 id="one-key-registration">One-key registration</h2>
      <p>
        STRK20 uses a <strong>single viewing-key registration</strong>: set your viewing key once,
        and notes are created against it thereafter. The wallet transparently performs
        registration (viewing key + channel setup) on your first real STRK20 action — no separate
        dapp-facing register RPC exists.
      </p>

      <Callout tone="warn">
        <strong>What we do not use.</strong> The STRK20 SDK ships a separate{' '}
        <code>shadow_account_anonymizer</code> concept keyed by a dapp name. ORRANGE does{' '}
        <em>not</em> integrate it. Your private identity here is the STRK20 user identity (your
        derived account), not a Shadow Account. See{' '}
        <a href="/docs/private-identity">Private Identity</a>.
      </Callout>

      <p>
        For the developer-focused threat model — what the AI can and cannot do, and how each
        threat is mitigated — see <a href="/docs/security">Security Model</a>.
      </p>
    </DocsLayout>
  );
}