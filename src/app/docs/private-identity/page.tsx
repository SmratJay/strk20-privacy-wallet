import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout, Diagram } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — Private Identity',
  description:
    'The STRK20 Private Identity: a Ready-derived address that owns notes and sources private transfers.',
};

const IDENTITY = [
  'Privy public key',
  '│',
  '▼',
  'computeReadyAccountAddress(publicKey, classHash)',
  '│',
  '▼',
  'Ready-derived account address  ← STRK20 user identity',
  '│',
  '▼',
  'owns private notes · registers viewing key · sources every private transfer',
];

export default function DocsPrivateIdentityPage() {
  return (
    <DocsLayout
      title="Private Identity"
      subtitle="Architecture"
      lead="In ORRANGE, your private identity is the STRK20 user identity — a deterministic, Ready-derived account address. It is not a Shadow Account."
    >
      <h2 id="terminology">Terminology</h2>
      <p>
        This implementation uses two interchangeable terms for the same thing:
      </p>
      <ul>
        <li>
          <strong>STRK20 Private Identity</strong> — used in the product UI.
        </li>
        <li>
          <strong>Private Treasury Identity</strong> — the same address in the treasury context
          (the source of every AI-executed private transfer).
        </li>
      </ul>

      <h2 id="how-it-is-derived">How it is derived</h2>
      <Diagram lines={IDENTITY} />
      <p>
        For the Privy lane, ORRANGE derives the counterfactual Ready account address from the
        Privy wallet&rsquo;s Starknet public key using <code>computeReadyAccountAddress</code>
        (salt = public key, Ready v0.4.0 class hash, deployer = 0). This derived address is the
        real on-chain account. It is <strong>not</strong> Privy&rsquo;s <code>wallet.address</code>,
        which differs.
      </p>

      <h2 id="strk20-user">It is the STRK20 <code>user</code></h2>
      <p>
        The integration passes this address as the STRK20 SDK <code>user</code>. That user:
      </p>
      <ul>
        <li>is the <strong>owner</strong> of private notes (<code>discoverNotes(user, viewingKey, …)</code>),</li>
        <li>registers the viewing key, and</li>
        <li>is the <strong>source account</strong> of every private transfer.</li>
      </ul>
      <p>
        In the treasury, this identity is recorded as the policy&rsquo;s{' '}
        <code>selfTransferAddress</code>: a proposal whose recipient equals it is rejected
        deterministically as a meaningless self-transfer.
      </p>

      <h2 id="ready-lane">The Ready/Wallet-API lane</h2>
      <p>
        When you connect an external privacy wallet (Ready) instead of the Privy lane, the
        connected account <em>is</em> the STRK20 identity — there is no separate derivation. The
        wallet owns the viewing key and performs discovery against the same identity.
      </p>

      <h2 id="what-we-do-not-use">What we do not use</h2>
      <Callout tone="warn">
        <strong>No Shadow Account.</strong> The STRK20 SDK includes a separate{' '}
        <code>shadow_account_anonymizer</code> — an on-chain anonymizer sub-account keyed by
        <code>compute_identity_key(user, viewingKey, anonymizerAddress)</code> plus a dapp name,
        exposed via <code>ShadowAccountsBuilder.invoke</code>. ORRANGE does{' '}
        <em>not</em> integrate it: the adapter never passes a{' '}
        <code>shadowAccountAnonymizerAddress</code>. The Ready-derived address above is the private
        identity — not the SDK&rsquo;s Shadow Account concept. This is verified by the
        <code>aiShadowAccount</code> test in the repository.
      </Callout>

      <p>
        For how this identity feeds the treasury copilot&rsquo;s policy, see{' '}
        <a href="/docs/ai-policy">AI + Policy Architecture</a>.
      </p>
    </DocsLayout>
  );
}