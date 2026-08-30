import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout, Steps } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — Contributing',
  description: 'How to contribute to ORRANGE without breaking the privacy and policy boundaries.',
};

export default function DocsContributingPage() {
  return (
    <DocsLayout
      title="Contributing"
      subtitle="Contributing"
      lead="ORRANGE is open source. Help with docs, tests, product, or the AI treasury — but never weaken the boundaries that make it safe."
    >
      <h2 id="setup">Set up</h2>
      <Steps
        items={[
          <>
            <strong>Fork and clone</strong>:{' '}
            <code>git clone https://github.com/SmratJay/strk20-privacy-wallet.git</code>
          </>,
          <><strong>Install:</strong> <code>npm install</code></>,
          <>
            <strong>Configure:</strong> <code>cp .env.example .env.local</code> and fill what you
            need (see <a href="/docs/environment">Environment</a>).
          </>,
          <>
            <strong>Verify your baseline:</strong> <code>npm test</code>, then{' '}
            <code>npm run build</code> and <code>npx tsc --noEmit</code>.
          </>,
        ]}
      />

      <h2 id="workflow">Branch and commit expectations</h2>
      <ul>
        <li>Work on a feature branch; keep it focused.</li>
        <li>
          One logical change per commit with a clear message (the project uses conventional-style
          prefixes, e.g. <code>feat(ai): …</code>, <code>docs: …</code>, <code>fix(treasury): …</code>).
        </li>
        <li>All tests green, typecheck clean, build passing before opening a PR.</li>
      </ul>

      <h2 id="where-things-live">Where things live</h2>
      <table>
        <thead>
          <tr>
            <th>Concern</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>AI logic (provider, schema, policy, health)</td>
            <td><code>src/ai/</code></td>
          </tr>
          <tr>
            <td>Treasury execution gate</td>
            <td><code>src/services/treasuryService.ts</code></td>
          </tr>
          <tr>
            <td>STRK20 privacy integration</td>
            <td><code>src/privacy/</code> + <code>src/services/strk20WalletApiService.ts</code></td>
          </tr>
          <tr>
            <td>AI API route</td>
            <td><code>src/app/api/ai/analyze/route.ts</code></td>
          </tr>
          <tr>
            <td>Docs site</td>
            <td><code>src/app/docs/</code> + <code>src/docs/navigation.ts</code></td>
          </tr>
        </tbody>
      </table>

      <h2 id="tests">Where to add tests</h2>
      <p>
        Tests live beside the domain logic under <code>src/__tests__/</code>. Add focused tests
        where you change behavior:
      </p>
      <ul>
        <li>Proposal schema → <code>aiSchema.test.ts</code></li>
        <li>Policy / presets → <code>aiPolicy.test.ts</code>, <code>aiPolicyPresets.test.ts</code></li>
        <li>Route → <code>aiAnalyzeRoute.test.ts</code></li>
        <li>Execution gate → <code>treasuryService.test.ts</code></li>
        <li>Simulation → <code>aiSimulate.test.ts</code>; health → <code>aiHealth.test.ts</code></li>
        <li>STRK20 identity → <code>aiShadowAccount.test.ts</code></li>
        <li>Docs routes → <code>docsNavigation.test.ts</code></li>
      </ul>

      <h2 id="boundaries">Never break these boundaries</h2>
      <ul>
        <li>
          The <strong>deterministic policy</strong> stays the only execution gate. The AI must
          remain advisory.
        </li>
        <li>
          <strong>Destination allowlists</strong> and the <strong>self-transfer rejection</strong>{' '}
          must never be bypassed or removed.
        </li>
        <li>
          Execution must keep re-checking <strong>expiry, fresh state, exact bigint amounts, fresh
          prices</strong>, and re-running the policy.
        </li>
        <li>
          The dapp and the AI must <strong>never touch viewing keys, notes, or private keys</strong>.
        </li>
        <li>
          Don&rsquo;t fabricate balances, prices, or execution results anywhere in the UI.
        </li>
      </ul>

      <Callout tone="warn">
        A change that &ldquo;simplifies&rdquo; one of the security gates is a regression, not an
        improvement — even if tests pass. If you think a gate is too strict, open an issue and
        discuss it first.
      </Callout>
    </DocsLayout>
  );
}