import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout, Chip } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — Environment',
  description: 'Every environment variable in .env.example, grouped by category, with server-only markers.',
};

function VarRow({ name, serverOnly, required, note }: { name: string; serverOnly?: boolean; required?: boolean; note: string }) {
  return (
    <tr>
      <td>
        <code>{name}</code>
        {serverOnly && <br />}
        {serverOnly && <Chip tone="private">server-only</Chip>}
        {required && !serverOnly && <Chip tone="live">required</Chip>}
      </td>
      <td>{note}</td>
    </tr>
  );
}

export default function DocsEnvironmentPage() {
  return (
    <DocsLayout
      title="Environment"
      subtitle="Developer"
      lead="The complete environment-variable reference. Copy .env.example to .env.local and fill only what you need for the flows you run."
    >
      <Callout tone="warn">
        Never commit <code>.env.local</code>. Any variable without a <code>NEXT_PUBLIC_</code>{' '}
        prefix is server-only — prefixing it exposes it to the browser.
      </Callout>

      <h2 id="starknet-rpc">Starknet RPC</h2>
      <table>
        <thead>
          <tr><th>Variable</th><th>Purpose</th></tr>
        </thead>
        <tbody>
          <VarRow name="ALCHEMY_STARKNET_KEY" serverOnly required note="Alchemy RPC key; used to build the derived RPC URL." />
          <VarRow name="NEXT_PUBLIC_STARKNET_RPC" required note="Public Starknet RPC URL (mainnet by default)." />
          <VarRow name="NEXT_PUBLIC_CHAIN_ID" note="Chain id (SN_MAIN / SN_SEPOLIA)." />
        </tbody>
      </table>

      <h2 id="strk20">STRK20 pool + collateral</h2>
      <table>
        <thead>
          <tr><th>Variable</th><th>Purpose</th></tr>
        </thead>
        <tbody>
          <VarRow name="NEXT_PUBLIC_STRK20_POOL" note="STRK20 privacy pool address (mainnet)." />
          <VarRow name="NEXT_PUBLIC_STRK20_SEPOLIA_POOL" note="STRK20 privacy pool address (Sepolia)." />
          <VarRow name="NEXT_PUBLIC_USDC_SEPOLIA" note="Circle USDC on Sepolia (collateral for shield/unshield)." />
        </tbody>
      </table>

      <h2 id="operator">Prover + discovery</h2>
      <table>
        <thead>
          <tr><th>Variable</th><th>Purpose</th></tr>
        </thead>
        <tbody>
          <VarRow name="NEXT_PUBLIC_STRK20_PROVER_URL" note="STRK20 operator proving service (Stwo transaction prover)." />
          <VarRow name="NEXT_PUBLIC_STRK20_DISCOVERY_URL" note="STRK20 operator discovery service (note/channel indexer)." />
        </tbody>
      </table>

      <h2 id="ai">Hamster AI</h2>
      <table>
        <thead>
          <tr><th>Variable</th><th>Purpose</th></tr>
        </thead>
        <tbody>
          <VarRow name="AI_API_KEY" serverOnly note="OpenAI-compatible API key. SERVER-ONLY." />
          <VarRow name="AI_BASE_URL" note="Base URL of the chat-completions endpoint (default https://api.openai.com/v1)." />
          <VarRow name="AI_MODEL" note="Model id (default gpt-4o-mini)." />
        </tbody>
      </table>
      <p>
        The AI provider is intentionally endpoint-agnostic. Point <code>AI_BASE_URL</code> at any
        OpenAI-compatible service (OpenAI, OpenRouter, Together, Groq, a local llama.cpp server,
        or the demo provider of your choice). See <a href="/docs/ai-provider">AI Provider</a>.
      </p>

      <h2 id="treasury-allowlists">Treasury allowlists</h2>
      <table>
        <thead>
          <tr><th>Variable</th><th>Purpose</th></tr>
        </thead>
        <tbody>
          <VarRow name="AI_ALLOWED_ASSETS" serverOnly note="Canonical 0x assets the treasury may move (comma-separated). Empty = any treasury position." />
          <VarRow name="AI_ALLOWED_DESTINATIONS" serverOnly note="Approved private destinations (canonical 0x, comma-separated). An EMPTY allowlist denies all execution." />
        </tbody>
      </table>
      <p>
        Execution destinations are always the user&rsquo;s primary account plus this allowlist.
        The AI can never add one.
      </p>

      <h2 id="privy-ready">Privy + Ready</h2>
      <table>
        <thead>
          <tr><th>Variable</th><th>Purpose</th></tr>
        </thead>
        <tbody>
          <VarRow name="PRIVY_APP_ID" serverOnly note="Privy server app id." />
          <VarRow name="PRIVY_APP_SECRET" serverOnly note="Privy app secret (server)." />
          <VarRow name="NEXT_PUBLIC_PRIVY_APP_ID" note="Public Privy app id for the embedded-wallet lane." />
          <VarRow name="NEXT_PUBLIC_READY_CLASSHASH" note="Ready (Argent v0.4.0) account class hash on Sepolia; the on-chain account address is derived from the public key + this hash." />
        </tbody>
      </table>

      <h2 id="paymaster">AVNU paymaster (private swaps)</h2>
      <table>
        <thead>
          <tr><th>Variable</th><th>Purpose</th></tr>
        </thead>
        <tbody>
          <VarRow name="AVNU_PAYMASTER_API_KEY" serverOnly note="Authenticates AVNU&rsquo;s gas-sponsoring paymaster for private swaps. SERVER-ONLY." />
        </tbody>
      </table>

      <h2 id="optional">Optional subsystems</h2>
      <p>
        The repository also ships a memecoin launchpad (<code>NEXT_PUBLIC_UMBRA_*</code>, Sepolia)
        and an extended exchange integration (<code>NEXT_PUBLIC_EXTENDED_*</code>, mainnet) with
        their own server-only credentials (<code>EXTENDED_API_KEY</code>,{' '}
        <code>EXTENDED_STARK_PRIVATE_KEY</code>, …). These are documented in{' '}
        <code>docs/UMBRA_LAUNCH.md</code> and are <em>not</em> required to run the core wallet or
        the treasury copilot.
      </p>
    </DocsLayout>
  );
}