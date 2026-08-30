import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout, Diagram } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — AI + Policy Architecture',
  description:
    'Hamster proposes; a deterministic policy decides. Exact bigint math, allowlists, freshness, and the execution gate.',
};

const PIPELINE = [
  'user prompt',
  '│',
  '▼',
  'AI proposal (structured JSON)',
  '│',
  '▼',
  'schema validation (no constraints accepted)',
  '│',
  '▼',
  'portfolio + fresh prices (server-side)',
  '│',
  '▼',
  'deterministic TreasuryPolicy verdict',
  '│',
  '▼',
  'ADVISORY / BLOCKED / EXECUTABLE',
  '│',
  '▼',
  'user confirmation',
  '│',
  '▼',
  'fresh state re-fetch + policy re-evaluation',
  '│',
  '▼',
  'existing STRK20 private transfer',
];

export default function DocsAiPolicyPage() {
  return (
    <DocsLayout
      title="AI + Policy Architecture"
      subtitle="Architecture"
      lead="Hamster proposes. The deterministic policy engine decides. This separation is the entire security story."
    >
      <Diagram lines={PIPELINE} />

      <h2 id="the-separation">The separation</h2>
      <p>
        The LLM is <strong>advisory and untrusted</strong>. Its output is a JSON proposal that is
        schema-validated and then evaluated by a pure, deterministic policy engine. The engine has
        no network access and no LLM — it is a function of <em>(proposal, portfolio, policy)</em>.
        The model can never change the policy, choose a destination outside the allowlist, or emit
        arbitrary calldata.
      </p>

      <h2 id="what-ai-controls">What the AI can control</h2>
      <ul>
        <li>Whether to propose an action or a report.</li>
        <li>Which <em>treasury asset</em> to move, and a human-readable amount string.</li>
        <li>Concise display copy (diagnosis, recommendation, why, outcome) — never used for decisions.</li>
      </ul>

      <h2 id="what-ai-cannot-control">What the AI can never control</h2>
      <ul>
        <li><strong>Policy values</strong> — user-selected, server-validated; model-injected <code>constraints</code> are rejected.</li>
        <li><strong>Destinations</strong> — an explicit allowlist; an empty allowlist denies everything.</li>
        <li><strong>Execution</strong> — only the existing STRK20 private-transfer path, only after re-validation.</li>
      </ul>

      <h2 id="deterministic-checks">Deterministic checks</h2>
      <table>
        <thead>
          <tr>
            <th>Check</th>
            <th>Rule</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Exact amount</td>
            <td>
              Amounts are parsed to exact bigint base units via the asset&rsquo;s decimals
              (<code>parseAmountExact</code>); over-precision is rejected, never rounded.
            </td>
          </tr>
          <tr>
            <td>Balance</td>
            <td>Proposed base units must not exceed the position&rsquo;s balance.</td>
          </tr>
          <tr>
            <td>Destination allowlist</td>
            <td>Recipient must be in the approved set. Empty set = deny all execution.</td>
          </tr>
          <tr>
            <td>Self-transfer rejection</td>
            <td>A recipient equal to the treasury identity is rejected deterministically.</td>
          </tr>
          <tr>
            <td>Live price for volatile assets</td>
            <td>
              STRK/ETH need a fresh (<code>&lt; 60s</code>) AVNU price to authorize execution; a
              static fallback only feeds advisory analysis.
            </td>
          </tr>
          <tr>
            <td>Stablecoins</td>
            <td>USDC/USDT are pinned at $1 (static is authoritative).</td>
          </tr>
          <tr>
            <td>Min liquidity</td>
            <td>USD liquidity after the action must stay ≥ your guardrail floor (conservative bigint cents).</td>
          </tr>
          <tr>
            <td>Max position</td>
            <td>No single position may exceed your cap after the action (integer bps, no float division).</td>
          </tr>
          <tr>
            <td>Max per action</td>
            <td>The action&rsquo;s conservative USD value must stay ≤ your cap.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="user-selected-policy">User-selected policy</h2>
      <p>
        The guardrail is chosen by the user (preset or custom) and sent with every analysis request.
        The server <strong>validates bounds</strong> (<code>resolveUserPolicy</code>) and returns
        the effective policy with the response. Values:
      </p>
      <ul>
        <li>Min liquid: <code>0 – $1,000,000</code></li>
        <li>Position cap: <code>1 – 100%</code></li>
        <li>Max per action: <code>$1 – $10,000,000</code></li>
      </ul>
      <p>Out-of-bounds or unknown presets are rejected with <code>400</code> — never silently clamped.</p>

      <h2 id="execution-gate">Execution gate</h2>
      <p>
        Confirming runs <code>executeProposal</code>, which re-checks in order: expiry (120&nbsp;s
        TTL) → current balances equal analysis-time state → exact bigint amount reconstruction →
        fresh prices → deterministic policy against fresh state → the injected STRK20
        private-transfer path. Any failure returns a specific reason (EXPIRED, STATE_CHANGED,
        AMOUNT_INVALID, POLICY_REJECTED, EXECUTION_FAILED) and no transfer occurs.
      </p>

      <Callout tone="ok">
        This is the same security posture end to end: <strong>proposal → expiry → fresh state →
        exact amounts → fresh prices → deterministic policy → wallet confirmation → existing
        privateTransfer.</strong> Nothing else can move funds.
      </Callout>
    </DocsLayout>
  );
}