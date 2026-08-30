import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — Testing',
  description: 'How to run the test suite, typecheck, and build, and which test layers protect what.',
};

export default function DocsTestingPage() {
  return (
    <DocsLayout
      title="Testing"
      subtitle="Developer"
      lead="Three commands cover correctness: unit tests, a strict typecheck, and a production build."
    >
      <pre>
        <code>
          <span className="tok-k">npm</span> test{'\n'}
          <span className="tok-k">npx</span> tsc --noEmit{'\n'}
          <span className="tok-k">npm</span> run build
        </code>
      </pre>
      <ul>
        <li><strong><code>npm test</code></strong> — Vitest unit/integration suite (Node environment).</li>
        <li><strong><code>npx tsc --noEmit</code></strong> — strict TypeScript check. Run it after{' '}
          <code>npm run build</code> (the build regenerates <code>.next/types</code>, which the
          standalone check references).</li>
        <li><strong><code>npm run build</code></strong> — production build with prerendering.</li>
      </ul>

      <h2 id="layers">What the tests protect</h2>
      <table>
        <thead>
          <tr>
            <th>Layer</th>
            <th>Area</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>AI schema</td>
            <td>Structured proposal validation — including rejection of model-injected constraints and malformed <code>insight</code>.</td>
          </tr>
          <tr>
            <td>Policy</td>
            <td>Deterministic checks: destination allowlist, self-transfer rejection, concentration, liquidity, max-tx.</td>
          </tr>
          <tr>
            <td>Financial exactness</td>
            <td>Exact bigint amount parsing and boundary tests (one smallest unit over balance, cents-over-cap).</td>
          </tr>
          <tr>
            <td>Route boundary</td>
            <td><code>/api/ai/analyze</code> — request validation, unknown-token rejection, JSON-safe serialization, user policy selection.</td>
          </tr>
          <tr>
            <td>Treasury execution gate</td>
            <td><code>executeProposal</code> — expiry, state-change, fresh-price, and policy-rejection paths.</td>
          </tr>
          <tr>
            <td>Simulation</td>
            <td><code>simulateAction</code> before/after economics and the advisory/estimated flag.</td>
          </tr>
          <tr>
            <td>Health</td>
            <td>Health score, risk levels, request-vs-policy conflict detection.</td>
          </tr>
          <tr>
            <td>STRK20 identity</td>
            <td>The Ready-derived address is the SDK <code>user</code> — and is <em>not</em> the SDK Shadow Account.</td>
          </tr>
          <tr>
            <td>Docs navigation</td>
            <td>Every sidebar route points to a real page and is unique.</td>
          </tr>
        </tbody>
      </table>

      <Callout tone="note">
        No test count is printed here because it changes as the suite grows. Run{' '}
        <code>npm test</code> to see the current number; the suite must be green before a merge.
      </Callout>
    </DocsLayout>
  );
}