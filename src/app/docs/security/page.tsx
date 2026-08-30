import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — Security Model',
  description:
    'Security and privacy boundaries: what ORRANGE never handles, what the AI can and cannot do, and how threats are mitigated.',
};

export default function DocsSecurityPage() {
  return (
    <DocsLayout
      title="Security Model"
      subtitle="Architecture"
      lead="Short and serious: the boundaries that make the copilot safe to use on real money."
    >
      <h2 id="never-handles">What ORRANGE never handles</h2>
      <p>The dapp never receives or stores:</p>
      <ul>
        <li><strong>Viewing keys</strong> — they live in the connected privacy wallet.</li>
        <li><strong>Encrypted notes</strong> or <strong>decrypted notes</strong>.</li>
        <li><strong>Private keys</strong> — the browser never holds them (Privy signs server-side; Ready signs in-wallet).</li>
        <li><strong>Nullifiers</strong> and <strong>proofs</strong>.</li>
      </ul>
      <p>
        Private balances come only from the wallet (<code>wallet_strk20Balances</code> / SDK
        discovery), never from a local cache.
      </p>

      <h2 id="ai-receives">What the AI receives</h2>
      <p>
        Hamster receives only the <strong>aggregate portfolio summary</strong> necessary for
        analysis: balances, USD values, allocations, and liquidity — plus the active policy. It
        never receives notes, viewing keys, or per-transaction metadata.
      </p>

      <h2 id="ai-cannot">What the AI cannot do</h2>
      <ul>
        <li><strong>Sign</strong> — only your wallet signs.</li>
        <li><strong>Choose arbitrary calldata</strong> — the only action is a STRK20 private transfer to an approved destination.</li>
        <li><strong>Weaken policy</strong> — user-selected, server-validated; model constraints are rejected.</li>
        <li><strong>Bypass destination controls</strong> — an explicit allowlist gates every recipient.</li>
      </ul>

      <h2 id="threats">Threats and mitigations</h2>
      <table>
        <thead>
          <tr>
            <th>Threat</th>
            <th>Mitigation</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Stale state</td>
            <td>Execution re-fetches current balances and aborts if they differ from analysis-time state (<code>STATE_CHANGED</code>).</td>
          </tr>
          <tr>
            <td>Prompt injection</td>
            <td>Model output is schema-validated, cannot add constraints or destinations, and is advisory-only. The policy engine never trusts the model.</td>
          </tr>
          <tr>
            <td>Malicious destination</td>
            <td>Recipient must be in the approved allowlist; the treasury identity itself is rejected as a self-transfer.</td>
          </tr>
          <tr>
            <td>Stale price</td>
            <td>Volatile assets require a fresh live AVNU price (<code>&lt; 60s</code>) to authorize execution.</td>
          </tr>
          <tr>
            <td>Client-modified balances</td>
            <td>Balances are analysis input, but execution re-checks against the wallet and re-runs the policy; prices are resolved fresh on the server.</td>
          </tr>
          <tr>
            <td>Expired proposals</td>
            <td>A 120&nbsp;s TTL invalidates analysis; execution refuses an expired proposal.</td>
          </tr>
          <tr>
            <td>Arbitrary calldata</td>
            <td>No generic invoke exists from the copilot — only the existing private-transfer path.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="signing-boundary">Signing boundary</h2>
      <ul>
        <li>
          <strong>Ready lane:</strong> the wallet signs after you approve in its UI; the app only
          requests authorized Wallet API operations.
        </li>
        <li>
          <strong>Privy lane:</strong> <code>/api/privy/sign</code> requires an authenticated Privy
          JWT and signs only the pre-computed transaction hash — no blind or arbitrary transactions.
        </li>
      </ul>

      <Callout tone="note">
        The full integration audit lives in{' '}
        <a
          href="https://github.com/SmratJay/strk20-privacy-wallet/blob/main/docs/PRIVY_STRK20_AUDIT.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          docs/PRIVY_STRK20_AUDIT.md
        </a>
        . If you find a way to weaken these boundaries, please report it responsibly via GitHub.
      </Callout>
    </DocsLayout>
  );
}