import type { Metadata } from 'next';
import Link from 'next/link';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout, Chip, Diagram } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — Overview',
  description: 'ORRANGE is a consumer STRK20 privacy wallet and AI treasury copilot on Starknet.',
};

const STACK = [
  'User',
  '│',
  '▼',
  'ORRANGE',
  '│',
  '▼',
  'Starknet Wallet API / compatible wallet',
  '│',
  '▼',
  'STRK20 (privacy pool)',
  '│',
  '▼',
  'prover + discovery',
  '│',
  '▼',
  'Starknet',
];

export default function DocsOverviewPage() {
  return (
    <DocsLayout
      title="ORRANGE"
      subtitle="Introduction"
      lead="Private finance for Starknet. A consumer privacy wallet and AI treasury copilot built on STRK20."
    >
      <p>
        ORRANGE is the consumer surface for <strong>STRK20</strong>, Starknet&rsquo;s shielded-payment
        privacy pool. It gives ordinary users a calm, wallet-like experience — <em>receive, shield,
        send, unshield</em> — while a privacy wallet handles the cryptography underneath. On top of
        that wallet sits <strong>Hamster</strong>, an AI copilot that helps you reason about and
        safely rebalance your private treasury.
      </p>

      <h2 id="what-orrange-solves">The problem ORRANGE solves</h2>
      <p>
        Private payments on Starknet exist, but using them today means understanding encrypted
        notes, viewing keys, ECDH, nullifiers, proof generation, and discovery infrastructure.
        That is a developer SDK, not a consumer product. ORRANGE turns it into three normal
        actions: <strong>connect a privacy wallet</strong>, <strong>enable private receiving
        once</strong>, and <strong>send or receive STRK20 privately</strong>.
      </p>
      <p>
        Private assets are also hard to reason about: you cannot see what you hold in the same way
        as a public wallet. Hamster solves that with a deterministic treasury dashboard and an AI
        that <em>proposes</em> — never decides — what to do.
      </p>

      <h2 id="how-it-fits-together">How the stack fits together</h2>
      <Diagram lines={STACK} />
      <p>
        ORRANGE does not implement a new wallet, privacy pool, proof system, or cryptographic
        protocol. It composes the existing STRK20 infrastructure through a privacy-enabled wallet
        and the Starknet Wallet API. The connected wallet owns viewing keys, encrypted notes,
        discovery, proofs, and signing.
      </p>

      <h2 id="hamster-treasury-intelligence">What Hamster adds</h2>
      <p>
        Hamster is <Chip tone="ai">AI copilot</Chip> layered on top of your private treasury. It
        turns opaque shielded balances into one readable, actionable picture: what you own, what is
        risky, what to do about it, and what would happen if you did.
      </p>
      <blockquote>
        <strong>AI proposes. Deterministic policy constrains. Your wallet signs. STRK20 settles
        privately.</strong>
      </blockquote>
      <p>
        Every recommendation is checked against a deterministic financial policy you control, and
        every transfer is executed only through the existing STRK20 private-transfer path after you
        confirm in your wallet.
      </p>

      <Callout tone="note">
        <strong>AI inference runs off-chain.</strong> Hamster is an LLM invoked over an
        OpenAI-compatible API. It does not run on Starknet, it does not sign, and it never touches
        your private keys, viewing keys, or encrypted notes.
      </Callout>

      <h2 id="next">Where to go next</h2>
      <div className="docs-card-grid">
        <Link className="docs-card" href="/docs/strk20">
          <strong>What is STRK20?</strong>
          <span>Shielded balances, encrypted notes, viewing keys, and what stays observable.</span>
        </Link>
        <Link className="docs-card" href="/docs/private-wallet">
          <strong>Private Wallet</strong>
          <span>Connect a privacy wallet and move funds privately — the product in practice.</span>
        </Link>
        <Link className="docs-card" href="/docs/private-treasury">
          <strong>Private Treasury</strong>
          <span>Hamster&rsquo;s diagnosis, guardrails, simulations, and policy-gated execution.</span>
        </Link>
        <Link className="docs-card" href="/docs/quickstart">
          <strong>Quickstart</strong>
          <span>Run the app locally in about ten minutes.</span>
        </Link>
      </div>
    </DocsLayout>
  );
}