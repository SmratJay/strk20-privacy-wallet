import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout, Chip, Steps } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — Use Treasury Intelligence',
  description:
    'Diagnose your private treasury, simulate a move, and execute a policy-approved private transfer.',
};

export default function DocsTreasuryGuidePage() {
  return (
    <DocsLayout
      title="Use Treasury Intelligence"
      subtitle="Guides"
      lead="Diagnose, simulate, and — when your guardrail allows — execute a private transfer. Everything happens through /treasury."
    >
      <h2 id="open-the-command-center">1. Open the command center</h2>
      <p>
        Go to <code>/treasury</code>. The page is useful immediately: it shows your total private
        value, the portfolio allocation, concentration/liquidity bars, and a{' '}
        <strong>proactive diagnosis</strong> derived from your real balances — no prompt required.
      </p>

      <h2 id="choose-a-guardrail">2. Choose a guardrail</h2>
      <p>
        Pick <strong>Conservative</strong>, <strong>Balanced</strong>, or{' '}
        <strong>Flexible</strong> (the demo default), or open <strong>Custom</strong> to set the
        liquidity floor, position cap, and max per-action size yourself. The selection is validated
        server-side on every analysis; <strong>the AI can never change it</strong>. Changing the
        guardrail invalidates any prior analysis.
      </p>

      <h2 id="read-the-diagnosis">3. Read the diagnosis</h2>
      <p>
        With no analysis, Hamster tells you the headline — e.g.{' '}
        <em>&ldquo;Your treasury is concentrated in STRK.&rdquo;</em> — plus concentration and
        liquidity lines. To get a full recommendation, use the secondary ask box.
      </p>

      <h2 id="ask-hamster">4. Ask Hamster</h2>
      <Steps
        items={[
          <>
            Type a goal like <em>&ldquo;Make my treasury safer.&rdquo;</em> (a one-tap <strong>Safer</strong>{' '}
            chip fills this in) and press <strong>Diagnose</strong>.
          </>,
          <>
            Hamster returns a structured insight: <strong>diagnosis → recommendation → why →
            outcome</strong>, together with the deterministic actionability status (ADVISORY /
            BLOCKED / EXECUTABLE).
          </>,
          <>
            If your prompt asks to keep an amount below your guardrail floor, Hamster explains it
            concisely instead of silently honoring it.
          </>,
        ]}
      />

      <h2 id="simulate">5. Simulate before you move</h2>
      <p>
        Every recommendation is paired with a <strong>What-If</strong> preview computed by the same
        deterministic policy math: <em>before → after</em> for concentration, liquidity, and policy
        status. Use the <em>Try $25 / $50 / $100</em> chips to explore alternatives. A simulation
        <strong>never executes</strong> anything.
      </p>

      <h2 id="review-and-execute">6. Review and execute a private transfer</h2>
      <p>
        When — and only when — the status is <strong>EXECUTABLE</strong>, the page shows a single
        primary action: <strong>Review private transfer</strong>. Confirming does <em>not</em> trust
        the earlier verdict. It runs the full gate again:
      </p>
      <Steps
        items={[
          <>Re-checks the proposal is unexpired (120&nbsp;s TTL).</>,
          <>Re-fetches your current STRK20 balances and confirms they match the analysis-time state.</>,
          <>Reconstructs the exact bigint amount from the asset&rsquo;s decimals.</>,
          <>Resolves fresh prices and rebuilds the portfolio.</>,
          <>
            Re-runs your <strong>selected guardrail</strong> deterministically against that fresh
            state (destination allowlist, self-transfer check, liquidity floor, concentration cap,
            max tx size, live-price requirement).
          </>,
          <>If every check passes, asks your wallet to sign the STRK20 private transfer.</>,
          <>Reconciles the real transaction and records it in Activity.</>,
        ]}
      />
      <p>
        If the proposal expired, your balances changed, or fresh prices no longer support the
        action, execution is refused and you re-analyze. Nothing is executed otherwise.
      </p>

      <h2 id="if-its-blocked">7. If it&rsquo;s BLOCKED</h2>
      <p>
        The action card explains the failing checks (e.g. liquidity floor, concentration cap, or a
        missing live price for a volatile asset). Adjust the amount, relax your guardrail, or
        re-analyze. If there is no approved private destination, the page shows{' '}
        <em>&ldquo;Analysis only — add an approved private destination to enable execution.&rdquo;</em>
      </p>

      <Callout tone="note">
        Privacy note: the AI receives only the aggregate portfolio. It never sees your viewing key
        or notes, and it never signs. Your wallet is the only signer.
      </Callout>
    </DocsLayout>
  );
}