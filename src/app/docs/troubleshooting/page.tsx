import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — Troubleshooting',
  description: 'Common ORRANGE issues and fixes: wallet errors, network, AI provider, and treasury execution.',
};

export default function DocsTroubleshootingPage() {
  return (
    <DocsLayout
      title="Troubleshooting"
      subtitle="Guides"
      lead="Common issues, what they mean, and how to fix them."
    >
      <h2 id="wallet-api-errors">Wallet API errors</h2>
      <p>The wallet lane maps STRK20 Wallet API failures to honest messages. The common codes:</p>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Meaning</th>
            <th>Fix</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>118</code></td>
            <td>Not registered for private STRK20</td>
            <td>Enable private receiving; the wallet transparently registers your viewing key.</td>
          </tr>
          <tr>
            <td><code>119</code></td>
            <td>Insufficient private balance</td>
            <td>Shield more funds before sending.</td>
          </tr>
          <tr>
            <td><code>120</code></td>
            <td>Action could reveal private state</td>
            <td>The wallet rejected the request to protect privacy — adjust the request.</td>
          </tr>
          <tr>
            <td><code>113</code></td>
            <td>You rejected the operation</td>
            <td>Re-run the flow and approve in your wallet.</td>
          </tr>
          <tr>
            <td><code>114</code> / <code>163</code></td>
            <td>Asset not supported by the connected wallet/pool</td>
            <td>Use a supported token (STRK, ETH, USDC on Sepolia).</td>
          </tr>
          <tr>
            <td><code>162</code></td>
            <td>Wallet API version too old</td>
            <td>Update your privacy wallet to Wallet API ≥ 0.10.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="account-finalizing">Account finalizing</h2>
      <p>
        If a fresh Ready account cannot be proven against yet, the app waits for on-chain
        finality (~10 blocks) before registration/proving. The error message tells you whether the
        account is not yet deployed (send it a small amount of Sepolia ETH/STRK via the faucet to
        activate it) or simply still finalizing (wait a few blocks and retry).
      </p>

      <h2 id="wrong-network">Wrong network</h2>
      <p>
        Private STRK20 runs on <strong>Starknet Sepolia</strong>. If the wallet reports a different
        chain, the app asks you to switch networks in the wallet (<code>wallet_switchStarknetChain</code>).
      </p>

      <h2 id="recipient-not-registered">Recipient has not enabled private receiving</h2>
      <p>
        A private note can only be created for a recipient whose viewing key is registered. Ask
        the recipient to enable private receiving in a supported privacy wallet first.
      </p>

      <h2 id="treasury-execution">Treasury execution refusals</h2>
      <table>
        <thead>
          <tr>
            <th>Symptom</th>
            <th>Cause / fix</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><em>&ldquo;Analysis expired&rdquo;</em></td>
            <td>Proposal TTL (120&nbsp;s) elapsed. Re-run the analysis.</td>
          </tr>
          <tr>
            <td><em>&ldquo;Balances changed&rdquo;</em></td>
            <td>State moved since analysis. Re-analyze against current balances.</td>
          </tr>
          <tr>
            <td><em>&ldquo;Policy rejected against current state&rdquo;</em></td>
            <td>Your guardrail fails on fresh state/prices. Adjust the amount or guardrail, or re-analyze.</td>
          </tr>
          <tr>
            <td><em>&ldquo;Fresh live price required&rdquo;</em></td>
            <td>A volatile asset (STRK/ETH) needs a fresh live AVNU price to authorize execution. Retry when the market feed is available.</td>
          </tr>
          <tr>
            <td><em>&ldquo;Analysis only — no approved destination&rdquo;</em></td>
            <td>The treasury has no approved private destination. Add one (via your account or the server allowlist) to enable execution.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="ai-provider">AI provider not configured</h2>
      <p>
        <code>/api/ai/analyze</code> returns <code>502</code> when the AI is not configured
        (<code>AI_API_KEY</code>/<code>AI_MODEL</code> missing). The treasury still works: portfolio,
        health, and the deterministic diagnosis run without the LLM. Add the server-only
        <code>AI_API_KEY</code> to <code>.env.local</code> and restart.
      </p>

      <h2 id="prices">Prices unavailable</h2>
      <p>
        The analyze endpoint returns <code>502</code> if prices cannot be resolved at all. The UI
        shows an advisory tag when any volatile-asset price is a static fallback rather than a live
        market price.
      </p>

      <Callout tone="note">
        If you hit an error not listed here, open an issue on{' '}
        <a href="https://github.com/SmratJay/strk20-privacy-wallet" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>{' '}
        with the exact message. Do not paste real addresses, keys, or notes.
      </Callout>
    </DocsLayout>
  );
}