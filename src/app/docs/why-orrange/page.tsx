import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout, Diagram } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — Why ORRANGE?',
  description:
    'Private assets are difficult to reason about. ORRANGE pairs a consumer STRK20 wallet with an AI treasury copilot.',
};

const LOOP = [
  'observe     → read private balances through the wallet',
  'diagnose    → health, concentration, liquidity, diversification',
  'simulate    → deterministic What-If before anything moves',
  'policy-check→ your guardrail is re-run against fresh state',
  'user approval → you review and sign in your wallet',
  'private execution → existing STRK20 private transfer path',
];

export default function DocsWhyOrrangePage() {
  return (
    <DocsLayout
      title="Why ORRANGE?"
      subtitle="Introduction"
      lead="The problem is not cryptography — it\u2019s that private assets are difficult to reason about."
    >
      <p>
        Today&rsquo;s STRK20 tooling is a developer SDK. It expects you to understand encrypted
        notes, viewing keys, channel setup, discovery, and proofs before you can do anything
        useful. Most people just want to <em>receive a private payment</em> and <em>know what they
        hold</em>. ORRANGE turns that into a normal wallet.
      </p>

      <h2 id="two-products-one-experience">Two products, one experience</h2>
      <h3>Private Wallet</h3>
      <p>
        A calm, consumer wallet for STRK20: <strong>connect</strong> a privacy wallet,
        <strong>enable private receiving</strong> once, <strong>shield</strong> funds,
        <strong>send privately</strong>, <strong>receive privately</strong>, and{' '}
        <strong>unshield</strong>. Every balance is authoritative — it comes from the connected
        wallet, never from a local cache or a fake confirmation.
      </p>
      <h3>Treasury Intelligence</h3>
      <p>
        A private treasury can&rsquo;t be eyeballed the way a public wallet can. Hamster turns it
        into an always-readable picture: a portfolio summary, health metrics, a one-line
        diagnosis, and a recommendation with a What-If preview — all bounded by a deterministic
        policy you control.
      </p>

      <h2 id="the-copilot-loop">The copilot loop</h2>
      <Diagram lines={LOOP} />
      <p>
        This is an <em>assisted</em> loop, not autonomous custody. Hamster observes and proposes;
        you remain the final decision maker at every step.
      </p>

      <h2 id="what-hamster-cannot-do">What Hamster cannot do</h2>
      <ul>
        <li>
          <strong>It never receives your viewing keys</strong>, encrypted notes, decrypted notes,
          or private keys. The AI sees only the aggregate portfolio it needs for analysis.
        </li>
        <li>
          <strong>It never signs.</strong> Only your wallet signs, after your confirmation.
        </li>
        <li>
          <strong>It never emits arbitrary calldata.</strong> The only executable action is a
          STRK20 private transfer to an approved destination, through the existing integration.
        </li>
        <li>
          <strong>It cannot weaken policy.</strong> The deterministic guardrail is user-selected
          and server-validated; the AI cannot change it.
        </li>
        <li>
          <strong>It is advisory, not trusted.</strong> The deterministic policy engine is the
          financial gate, and execution re-checks fresh state before anything moves.
        </li>
      </ul>

      <Callout tone="ok">
        In one sentence: <strong>you bring the wallet and the decision; ORRANGE brings the
        interface; Hamster brings the reasoning; deterministic policy brings the safety.</strong>
      </Callout>
    </DocsLayout>
  );
}