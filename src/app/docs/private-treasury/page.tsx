import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout, Chip, Diagram } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — Private Treasury',
  description:
    'Hamster Treasury Intelligence: portfolio aggregation, health, guardrails, diagnosis, simulation, and policy-gated execution.',
};

const EXEC = [
  'proposal',
  '│',
  '▼',
  'expiry check (120s)',
  '▼',
  'fresh state re-fetch',
  '▼',
  'exact bigint amount',
  '▼',
  'fresh prices',
  '▼',
  'deterministic policy re-run',
  '▼',
  'wallet confirmation',
  '▼',
  'existing STRK20 private transfer',
];

export default function DocsPrivateTreasuryPage() {
  return (
    <DocsLayout
      title="Private Treasury"
      subtitle="Product"
      lead="Hamster turns opaque shielded balances into one readable picture: what you own, what\u2019s risky, what to do about it, and what happens if you do."
    >
      <p>
        Treasury Intelligence lives at <code>/treasury</code>. It aggregates your private balances
        through the wallet, computes health and risk metrics, and — when you ask — produces a
        structured diagnosis and recommendation, all constrained by a deterministic policy you
        control.
      </p>

      <h2 id="what-you-own">What you own</h2>
      <p>
        The portfolio is built only from real aggregate balances returned by the wallet and fresh
        USD prices. No asset, balance, or price is fabricated. If your treasury holds only STRK,
        that is exactly what the page shows.
      </p>

      <h2 id="health-metrics">Health metrics</h2>
      <ul>
        <li><strong>Concentration</strong> — the share of your treasury in the largest position.</li>
        <li><strong>Liquidity</strong> — USD of liquid positions usable toward your guardrail floor.</li>
        <li><strong>Diversification</strong> — how many distinct assets you hold.</li>
      </ul>
      <p>
        These roll into a <strong>health score (0–100)</strong>. The score is{' '}
        <Chip tone="ai">advisory</Chip>: it helps you understand the treasury but never authorizes
        execution. Only the deterministic policy does that.
      </p>

      <h2 id="guardrails">Guardrails you control</h2>
      <p>
        A hardcoded $1,000 liquidity floor would make a small testnet treasury unusable, so ORRANGE
        instead uses <strong>user-selected guardrails</strong>. Three presets map to fixed
        deterministic policy values, and a <strong>Custom</strong> option lets you set explicit
        limits:
      </p>
      <table>
        <thead>
          <tr>
            <th>Preset</th>
            <th>Min liquid</th>
            <th>Position cap</th>
            <th>Max per action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Conservative</td>
            <td>$100</td>
            <td>60%</td>
            <td>$100</td>
          </tr>
          <tr>
            <td>Balanced</td>
            <td>$50</td>
            <td>80%</td>
            <td>$150</td>
          </tr>
          <tr>
            <td>Flexible <Chip tone="private">default</Chip></td>
            <td>$25</td>
            <td>100% (no cap)</td>
            <td>$250</td>
          </tr>
        </tbody>
      </table>
      <p>
        <strong>The AI can never modify your guardrail.</strong> The selection is validated
        server-side on every analysis and returned as the effective policy; execution always
        re-runs it against fresh state.
      </p>

      <h2 id="diagnosis-and-recommendation">Diagnosis and recommendation</h2>
      <p>
        On page load Hamster already gives you a deterministic diagnosis from your real portfolio —
        e.g. <em>&ldquo;Your treasury is concentrated in STRK.&rdquo;</em> When you ask, it produces
        a <strong>structured</strong> insight (never parsed from prose):
      </p>
      <ul>
        <li><strong>Diagnosis</strong> — one sentence on what is wrong.</li>
        <li><strong>Recommendation</strong> — one sentence on what to do.</li>
        <li><strong>Why</strong> — the expected effect.</li>
        <li><strong>Outcome</strong> — the expected consequence for liquidity/policy.</li>
      </ul>

      <h2 id="what-if">What-If simulation</h2>
      <p>
        Every recommendation is paired with a deterministic simulation that reuses the exact policy
        math. It shows <strong>before → after</strong> for concentration, liquidity, and policy
        status, plus alternative amounts (<em>Try $25 / $50 / $100</em>). Simulations are{' '}
        <strong>never executed</strong> — they only preview.
      </p>

      <h2 id="actionability">Actionability</h2>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><Chip tone="ai">ADVISORY</Chip></td>
            <td>Hamster diagnosed but proposed no state-changing action.</td>
          </tr>
          <tr>
            <td><Chip tone="warn">BLOCKED</Chip></td>
            <td>An action exists but your guardrail rejects it — nothing is executed.</td>
          </tr>
          <tr>
            <td><Chip tone="live">EXECUTABLE</Chip></td>
            <td>Every deterministic policy check passes; a review CTA is shown.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="execution-re-check">Execution re-check</h2>
      <p>
        The <strong>Review private transfer</strong> action is the only execution entry point, and
        it is shown only when the policy says <code>EXECUTABLE</code>. Confirming does not trust
        the earlier verdict — it re-runs the whole gate:
      </p>
      <Diagram lines={EXEC} />
      <p>
        If your balances changed, the proposal expired, or fresh prices no longer support the
        action, execution is refused and you re-analyze. Execution uses the existing STRK20
        private-transfer path — never arbitrary calldata.
      </p>

      <h2 id="concrete-example">Concrete example</h2>
      <p>
        Say your treasury is <strong>74% STRK</strong> and your selected guardrail caps a single
        position at <strong>60%</strong>:
      </p>
      <ul>
        <li>Hamster diagnoses the over-concentration.</li>
        <li>It proposes a rebalance: move STRK to your approved private reserve.</li>
        <li>The What-If previews the expected before/after concentration.</li>
        <li>You confirm; the policy is <strong>checked again</strong> against fresh state with
        fresh prices.</li>
        <li>Your wallet signs the STRK20 private transfer.</li>
      </ul>

      <Callout tone="note">
        If no approved private destination exists, the page shows <em>&ldquo;Analysis only — add
        an approved private destination to enable execution.&rdquo;</em> ORRANGE never pretends a
        transfer is executable when it is not.
      </Callout>
    </DocsLayout>
  );
}