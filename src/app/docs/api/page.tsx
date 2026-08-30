import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — API Reference',
  description: 'POST /api/ai/analyze — request, response, validation, errors, rate limits, security.',
};

export default function DocsApiPage() {
  return (
    <DocsLayout
      title="API Reference"
      subtitle="Developer"
      lead="The treasury analysis endpoint. It is the only AI-facing API in the core product."
    >
      <h2 id="endpoint">POST /api/ai/analyze</h2>
      <p>
        Analyzes a treasury prompt against the user&rsquo;s private balances, returns a structured
        proposal and a deterministic policy verdict. Authorization is optional: a valid Privy
        session JWT (Bearer) enables server-verified addresses; without it, addresses are treated as
        client-claimed and non-authoritative.
      </p>

      <h3 id="request">Request</h3>
      <pre>
        <code>
          <span className="tok-o">POST</span> /api/ai/analyze{'\n'}
          <span className="tok-k">Content-Type</span>
          <span className="tok-o">:</span> application/json{'\n'}
          {'\n'}
          {'{'}{'\n'}
          {'  '}
          <span className="tok-s">"prompt"</span>
          <span className="tok-o">:</span> <span className="tok-s">"Make my treasury safer."</span>,{'\n'}
          {'  '}
          <span className="tok-s">"balances"</span>
          <span className="tok-o">:</span> [{' '}
          {'{'} <span className="tok-s">"token"</span>
          <span className="tok-o">:</span> <span className="tok-s">"0x…"</span>,{' '}
          <span className="tok-s">"balance"</span>
          <span className="tok-o">:</span> <span className="tok-s">"500000000000000000000"</span> {'}'} ],{'\n'}
          {'  '}
          <span className="tok-s">"context"</span>
          <span className="tok-o">:</span> {'{'}{'\n'}
          {'    '}
          <span className="tok-s">"userAddress"</span>
          <span className="tok-o">:</span> <span className="tok-s">"0x…"</span>,{'\n'}
          {'    '}
          <span className="tok-s">"privateTreasuryAddress"</span>
          <span className="tok-o">:</span> <span className="tok-s">"0x…"</span>{'\n'}
          {'  '}
          {'}'},{'\n'}
          {'  '}
          <span className="tok-s">"policy"</span>
          <span className="tok-o">:</span> {'{'}{' '}
          <span className="tok-s">"preset"</span>
          <span className="tok-o">:</span> <span className="tok-s">"balanced"</span> {'}'}{'\n'}
          {'}'}
        </code>
      </pre>
      <table>
        <thead>
          <tr><th>Field</th><th>Type</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>prompt</code></td>
            <td>string</td>
            <td>Required, ≤ 2000 chars.</td>
          </tr>
          <tr>
            <td><code>balances</code></td>
            <td>array</td>
            <td>
              Required, 1–50 rows of <code>{'{ token, balance }'}</code>. <code>balance</code> is a
              decimal string (bigint-safe at the HTTP boundary). Unknown tokens → 400.
            </td>
          </tr>
          <tr>
            <td><code>context</code></td>
            <td>object</td>
            <td><code>userAddress</code> + <code>privateTreasuryAddress</code>.</td>
          </tr>
          <tr>
            <td><code>policy</code></td>
            <td>object</td>
            <td>
              <code>{'{ preset, custom? }'}</code>. Preset: <code>conservative | balanced | flexible | custom</code>.
              Custom limits are bounds-validated server-side.
            </td>
          </tr>
        </tbody>
      </table>

      <h3 id="response">Response</h3>
      <pre>
        <code>
          {'{'}{'\n'}
          {'  '}
          <span className="tok-s">"summary"</span>
          <span className="tok-o">:</span> {'{'} <span className="tok-s">"totalUsd"</span>
          <span className="tok-o">:</span> <span className="tok-n">183.16</span>,{' '}
          <span className="tok-s">"positions"</span>
          <span className="tok-o">:</span> [ … ] {'}'},{'\n'}
          {'  '}
          <span className="tok-s">"proposal"</span>
          <span className="tok-o">:</span> {'{'}{'\n'}
          {'    '}
          <span className="tok-s">"intent"</span>
          <span className="tok-o">:</span> <span className="tok-s">"rebalance"</span>,{'\n'}
          {'    '}
          <span className="tok-s">"reason"</span>
          <span className="tok-o">:</span> <span className="tok-s">"Reduce concentration."</span>,{'\n'}
          {'    '}
          <span className="tok-s">"action"</span>
          <span className="tok-o">:</span> {'{'} <span className="tok-s">"type"</span>
          <span className="tok-o">:</span> <span className="tok-s">"private_transfer"</span>, … {'}'},{'\n'}
          {'    '}
          <span className="tok-s">"insight"</span>
          <span className="tok-o">:</span> {'{'} <span className="tok-s">"diagnosis"</span>
          <span className="tok-o">:</span> <span className="tok-s">"…"</span>, … {'}'}{'\n'}
          {'  '}
          {'}'},{'\n'}
          {'  '}
          <span className="tok-s">"verdict"</span>
          <span className="tok-o">:</span> {'{'} <span className="tok-s">"allowed"</span>
          <span className="tok-o">:</span> <span className="tok-n">true</span>,{' '}
          <span className="tok-s">"checks"</span>
          <span className="tok-o">:</span> [ … ],{' '}
          <span className="tok-s">"amountBaseUnits"</span>
          <span className="tok-o">:</span> <span className="tok-s">"100000000000000000000"</span> {'}'},{'\n'}
          {'  '}
          <span className="tok-s">"policy"</span>
          <span className="tok-o">:</span> {'{'} … effective guardrail … {'}'},{'\n'}
          {'  '}
          <span className="tok-s">"addresses"</span>
          <span className="tok-o">:</span> {'{'} <span className="tok-s">"verification"</span>
          <span className="tok-o">:</span> <span className="tok-s">"privy"</span> {'}'},{'\n'}
          {'  '}
          <span className="tok-s">"trust"</span>
          <span className="tok-o">:</span> {'{'} … {'}'},{'\n'}
          {'  '}
          <span className="tok-s">"proposalExpiresAt"</span>
          <span className="tok-o">:</span> <span className="tok-n">…</span>{'\n'}
          {'}'}
        </code>
      </pre>
      <table>
        <thead>
          <tr><th>Field</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr><td><code>summary</code></td><td>Privacy-minimized portfolio (aggregates only).</td></tr>
          <tr><td><code>proposal</code></td><td>Validated structured proposal incl. optional <code>insight</code>.</td></tr>
          <tr><td><code>verdict</code></td><td>Deterministic policy result; <code>amountBaseUnits</code> is a decimal string.</td></tr>
          <tr><td><code>policy</code></td><td>Effective guardrail to re-run client-side before execution.</td></tr>
          <tr><td><code>addresses.verification</code></td><td><code>privy</code> (server-verified) or <code>client-claimed</code>.</td></tr>
          <tr><td><code>proposalExpiresAt</code></td><td>ms epoch; proposals expire after 120&nbsp;s.</td></tr>
        </tbody>
      </table>

      <h2 id="validation">Validation rules</h2>
      <ul>
        <li>Prompt required, ≤ 2000 chars.</li>
        <li>Balances 1–50; every token must be a configured supported token; balances must be non-negative decimal strings.</li>
        <li>Policy presets must be known; custom limits must be within bounds (floor 0–$1M, cap 1–100%, tx $1–$10M).</li>
        <li>Model output is schema-validated; model-injected <code>constraints</code> are rejected.</li>
      </ul>

      <h2 id="errors">Error states</h2>
      <table>
        <thead>
          <tr><th>Status</th><th>Cause</th></tr>
        </thead>
        <tbody>
          <tr><td><code>400</code></td><td>Invalid body, prompt, balances, unsupported token, or out-of-bounds policy.</td></tr>
          <tr><td><code>422</code></td><td>The AI produced an invalid/unsupported proposal.</td></tr>
          <tr><td><code>502</code></td><td>AI provider not configured, analysis failed, or prices could not be resolved.</td></tr>
          <tr><td><code>429</code></td><td>Rate limit exceeded.</td></tr>
        </tbody>
      </table>

      <h2 id="rate-limits">Rate limits</h2>
      <p>An in-memory sliding window allows <strong>20 requests / 60s</strong> per IP (best-effort; not a security boundary).</p>

      <h2 id="security">Security considerations</h2>
      <ul>
        <li>The server fetches <strong>fresh prices</strong> and rebuilds the portfolio itself.</li>
        <li>Destinations come only from the verified user + server allowlist; the AI cannot add one.</li>
        <li>Addresses are server-verified when a valid Privy session is presented.</li>
        <li>The response verdict is <strong>advisory</strong>; real execution re-checks state client-side.</li>
      </ul>

      <Callout tone="note">
        This is the only AI-facing API in the core product. There is no OpenAPI spec — the request
        and response above match the implementation exactly (<code>src/app/api/ai/analyze/route.ts</code>).
      </Callout>
    </DocsLayout>
  );
}