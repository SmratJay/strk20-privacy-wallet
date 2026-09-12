# Orrange public cross-chain swaps

Implemented in the existing wallet, under Swap → Cross-chain (or /swap?mode=cross-chain).

Supported source: public STRK on Starknet Mainnet. Destinations come from the live NEAR Intents registry: canonical Base USDC and available Solana assets. Asset identifiers are shown to distinguish duplicate symbols. This is explicitly public funding, not a private-balance fallback.

Flow: dry quote → reserve deposit and estimate source fee → explicit final review → one STRK transfer → persisted receipt and read-only settlement polling. The source wallet is also the refund address. Quotes have minimum-output protection; the prepared review expires within 60 seconds. Provider fees affect output, and refunds can incur fees.

A submission journal is written and verified before sending. Unknown submissions, failed routes, incomplete deposits and incomplete delivery evidence block another deposit until reconciled. There is no automatic resend. Keep browser data; receipts are local to the wallet/browser. A provider-reported refund or successful destination transaction resolves the journal. A permanently failed/unknown operation needs manual reconciliation with the provider; the UI does not offer a blind reset.

The existing private cross-chain flow remains separate. It still requires Mainnet privacy proving, discovery, anonymizer and relay/paymaster configuration. Sepolia privacy endpoints must not be substituted for Mainnet services. Runtime Mainnet wallet support already exists; older references to a Sepolia-only runtime are outdated.

Validation: live registry and dry quote API checked; service tests cover network gating, quote binding, caller mutation, duplicate submissions, uncertain submission persistence, destination evidence, storage failure, changed wallets, fee changes and insufficient balances. No funded cross-chain settlement has been performed by the coding agent.
