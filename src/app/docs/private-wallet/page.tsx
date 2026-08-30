import type { Metadata } from 'next';
import { DocsLayout } from '@/components/docs/DocsLayout';
import { Callout, Chip, Steps } from '@/components/docs/primitives';

export const metadata: Metadata = {
  title: 'ORRANGE — Private Wallet',
  description:
    'Connect a privacy wallet, enable private receiving, shield, send privately, and unshield on STRK20.',
};

export default function DocsPrivateWalletPage() {
  return (
    <DocsLayout
      title="Private Wallet"
      subtitle="Product"
      lead="The consumer surface for STRK20: receive, shield, send, and unshield privately from one calm interface."
    >
      <p>
        The wallet keeps the STRK20 complexity underneath. You see <strong>Receive / Send /
        Balance / Activity</strong>. The connected privacy wallet handles viewing keys, encrypted
        notes, discovery, proofs, and signing. The dapp never touches cryptographic secrets and
        never falls back to public ERC-20 transfers.
      </p>

      <h2 id="supported-stack">Supported stack</h2>
      <table>
        <thead>
          <tr>
            <th>Layer</th>
            <th>Supported</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Privacy wallet</td>
            <td>
              <strong>Ready</strong> (privacy-enabled Starknet wallet, Wallet API ≥ 0.10), or an
              ORRANGE-embedded <strong>Privy</strong> wallet (SDK lane)
            </td>
          </tr>
          <tr>
            <td>Network</td>
            <td>
              <strong>Starknet Sepolia</strong> <Chip tone="live">validated</Chip> — private STRK20
              receiving/balances are auto-synced from the connected wallet
            </td>
          </tr>
          <tr>
            <td>Assets</td>
            <td>STRK, ETH, USDC (Sepolia pool tokens)</td>
          </tr>
        </tbody>
      </table>

      <h2 id="the-flows">The core flows</h2>

      <h3 id="connect-a-wallet">Connect a wallet</h3>
      <Steps
        items={[
          <>Install the Ready browser extension and open <code>/wallet</code>.</>,
          <>
            Connect via the wallet&rsquo;s approval prompt. The app auto-detects STRK20 Wallet API
            capability (<code>wallet_supportedWalletApi</code>) and the chain
            (<code>wallet_requestChainId</code>).
          </>,
          <>If the wallet is on the wrong network, the app surfaces a switch prompt.</>,
        ]}
      />

      <h3 id="enable-private-receiving">Enable private receiving</h3>
      <Steps
        items={[
          <>
            Open <strong>Enable private receiving</strong>. The app probes the wallet&rsquo;s
            registration state via <code>wallet_strk20Balances</code> (NOT_REGISTERED / ready).
          </>,
          <>
            If unregistered, the app submits a real STRK20 deposit; the wallet transparently adds
            viewing-key registration + channel setup in the same transaction
            (<code>autoRegister</code>/<code>autoSetup</code>).
          </>,
          <>
            Confirmation is only reported after on-chain acceptance is reconciled — never from the
            hash alone.
          </>,
        ]}
      />

      <h3 id="shield-assets">Shield assets (&ldquo;Make private&rdquo;)</h3>
      <Steps
        items={[
          <>
            In <strong>Send</strong>, choose <strong>Make private</strong> (deposit), a token, and
            an amount.
          </>,
          <>Review and confirm in your wallet. The wallet builds the note, generates the proof, and submits.</>,
          <>
            The app reconciles the real transaction state (<em>submitted → confirming →
            confirmed</em>). The deposit leg is public; the resulting note is private.
          </>,
        ]}
      />

      <h3 id="send-privately">Send privately</h3>
      <Steps
        items={[
          <>Choose <strong>Send privately</strong>, enter the recipient&rsquo;s Starknet address and amount.</>,
          <>
            The recipient must already have enabled STRK20 private receiving — a private note can
            only be created for a registered recipient. Otherwise the wallet returns a
            recipient-readiness error, surfaced honestly.
          </>,
          <>Confirm in your wallet; it spends your notes and creates the recipient&rsquo;s encrypted note.</>,
        ]}
      />

      <h3 id="receive-privately">Receive privately</h3>
      <p>
        Share your private address (your Starknet address) once — copy or QR. Anyone can send you a
        private STRK20 payment. Your wallet performs discovery and your private balance updates;
        the dapp polls the wallet and reconciles external incoming payments.
      </p>

      <h3 id="unshield">Unshield</h3>
      <p>
        Spend a private note back to a public address. Choose <strong>Unshield</strong>, pick the
        recipient and amount, and confirm. The wallet withdraws the note to the public recipient.
      </p>

      <h2 id="two-lanes">Two integration lanes</h2>
      <p>
        The wallet works with <strong>two</strong> ways of reaching STRK20, depending on how you
        connect:
      </p>
      <ul>
        <li>
          <Chip tone="private">Wallet API lane</Chip> — a privacy wallet (e.g. Ready) owns proving
          and submission via <code>wallet_strk20InvokeTransaction</code>.
        </li>
        <li>
          <Chip tone="ai">SDK lane</Chip> — an ORRANGE-embedded Privy wallet uses the vendored
          STRK20 SDK directly for note discovery, proving, and submission.
        </li>
      </ul>
      <p>
        Both lanes end at the same STRK20 pool. See <a href="/docs/strk20-integration">STRK20
        Integration</a> for the details.
      </p>

      <h2 id="known-limitations">Known limitations</h2>
      <ul>
        <li>
          <strong>Zero-balance registration:</strong> there is no register-only Wallet API RPC, so
          an unfunded account cannot be registered by the dapp alone — it must fund a small amount
          or complete setup in the wallet UI.
        </li>
        <li>
          <strong>Consent-gated readiness:</strong> <code>wallet_strk20Balances</code> sits behind
          the wallet&rsquo;s &ldquo;share private balances&rdquo; consent; a refused consent makes
          readiness unknown.
        </li>
        <li>
          <strong>No per-payment inbound history:</strong> the Wallet API exposes balances, not
          inbound payment history, so activity is a local cache of your own actions.
        </li>
        <li>
          <strong>Fee sponsorship not assumed:</strong> the network fee is paid by your wallet.
        </li>
      </ul>

      <Callout tone="warn">
        Live end-to-end transfers require a real privacy wallet, a funded Sepolia account, and the
        STRK20 operator proving/discovery stack. The app never shows mock balances or fake
        confirmations.
      </Callout>
    </DocsLayout>
  );
}