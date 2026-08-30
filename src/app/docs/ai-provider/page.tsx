import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout, Chip, Diagram } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — AI Provider',
  description: 'The OpenAI-compatible provider seam behind Hamster, and how to configure it.',
};

const FLOW = [
  'UI (/treasury)',
  '│',
  '▼',
  'POST /api/ai/analyze',
  '│',
  '▼',
  'provider.ts (createDefaultProvider)',
  '│',
  '▼',
  'OpenAI-compatible /chat/completions',
  '│',
  '▼',
  'structured JSON proposal',
  '│',
  '▼',
  'schema validation (validateProposal)',
  '│',
  '▼',
  'deterministic policy verdict',
];

export default function DocsAiProviderPage() {
  return (
    <DocsLayout
      title="AI Provider"
      subtitle="Developer"
      lead="Hamster is an LLM invoked through a single, swappable OpenAI-compatible seam. The API key is server-only."
    >
      <p>
        Inference runs <strong>off-chain</strong>: the app calls an OpenAI-compatible{' '}
        <code>/chat/completions</code> endpoint from the server. It is not part of the Starknet
        transaction path and never signs anything.
      </p>

      <h2 id="flow">The provider flow</h2>
      <Diagram lines={FLOW} />

      <h2 id="configuration">Configuration</h2>
      <table>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Purpose</th>
            <th>Default</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>AI_API_KEY</code></td>
            <td>Bearer token for the endpoint</td>
            <td><Chip tone="private">server-only</Chip></td>
          </tr>
          <tr>
            <td><code>AI_BASE_URL</code></td>
            <td>Base URL of the endpoint</td>
            <td><code>https://api.openai.com/v1</code></td>
          </tr>
          <tr>
            <td><code>AI_MODEL</code></td>
            <td>Model identifier</td>
            <td><code>gpt-4o-mini</code></td>
          </tr>
        </tbody>
      </table>

      <Callout tone="warn">
        <strong><code>AI_API_KEY</code> must never be exposed to the browser.</strong> It is read on
        the server in <code>src/ai/provider.ts</code>. Prefixing it with{' '}
        <code>NEXT_PUBLIC_</code> would ship the key into the client bundle — never do that.
      </Callout>

      <h2 id="compatible-endpoints">Compatible endpoints</h2>
      <p>
        The provider speaks the OpenAI chat-completions JSON format with strict JSON output
        (<code>response_format.json_object</code>). Any compatible service works — the implementation
        is not locked to one vendor:
      </p>
      <ul>
        <li>OpenAI</li>
        <li>OpenRouter / Together / Groq</li>
        <li>A local llama.cpp / vLLM server</li>
        <li>Any OpenAI-compatible gateway used for the demo</li>
      </ul>
      <p>Example — point at OpenAI:</p>
      <pre>
        <code>
          <span className="tok-k">AI_BASE_URL</span>
          <span className="tok-o">=</span>
          <span className="tok-s">https://api.openai.com/v1</span>{'\n'}
          <span className="tok-k">AI_MODEL</span>
          <span className="tok-o">=</span>
          <span className="tok-s">gpt-4o-mini</span>
        </code>
      </pre>
      <p>Example — any OpenAI-compatible gateway:</p>
      <pre>
        <code>
          <span className="tok-k">AI_BASE_URL</span>
          <span className="tok-o">=</span>
          <span className="tok-s">https://your-gateway.example/v1</span>{'\n'}
          <span className="tok-k">AI_MODEL</span>
          <span className="tok-o">=</span>
          <span className="tok-s">your-model-id</span>
        </code>
      </pre>

      <h2 id="no-provider">Running without the AI</h2>
      <p>
        If no AI is configured, <code>/treasury</code> still works: portfolio, health, and the
        proactive diagnosis use the deterministic engine. Only the LLM-backed diagnosis and
        recommendation are unavailable.
      </p>
    </DocsLayout>
  );
}