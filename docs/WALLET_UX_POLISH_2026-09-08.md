# Wallet UX polish — September 8, 2026

Baseline: `823cf5667cc1af9604ea3911f6d75e33b0ce7bfc`.

## Implemented

- Existing wallet home, palette, typography and glass surfaces retained. Primary actions now sit beside the balance journey; duplicate execution panels and diagnostics moved out of the primary view.
- Mainnet remains the default. Visible Mainnet/Sepolia selector updates both existing network context and runtime, locks the previous session and clears account-bound forms. Unresolved transactions prevent accidental network switching.
- Create/import/unlock have clearer hierarchy, password confirmation, labeled fields, busy states and double-submission guards. Existing Ready/Braavos custody and encrypted storage are unchanged.
- Public Send selects a network-correct asset, validates the address and exact base-unit amount, estimates fees through the existing local account, then requires review before submission.
- Public Swap no longer uses Sepolia token addresses on Mainnet. The reviewed quote/calls are retained for confirmation with a 30-second freshness limit, minimum output protection and a wallet-side STRK fee estimate. Fee estimates must explicitly report FRI; unlabelled AVNU gas values are not presented as STRK.
- Shield, private send, unshield, private swap, cross-chain transfer and wallet activation now have explicit review steps. Private execution identity setup is automatic through existing runtime APIs; developer identity controls are secondary.
- Cross-chain retains the live destination registry, Solana search/mint identity, address checks and real settlement status. Another unresolved private operation blocks competing note spends.
- Receive has network-specific guidance, a mobile-safe QR/address layout and copy feedback.
- Session activity shows operation type, amount where known, status, time and network-scoped explorer links. A submitted hash is pending, not success. Late confirmations cannot repopulate another wallet/network; source acceptance alone does not prove successful execution or destination settlement.
- Mobile menu exposes every existing utility. Review rows wrap full addresses, controls have larger targets, feedback respects reduced motion, and wallet deletion requires explicit confirmation.

No contract, STRK20 SDK, TEE, NEAR adapter, perps, landing-page, dependency or deployment configuration changes.

## Verification

- 160 tests passed across 10 focused files: wallet runtime, stale-session guards, public transfer encoding, wallet privacy, private swap, NEAR Intents, PrivacyHub, destination registry, new amount/feedback and transaction-lifecycle checks.
- TypeScript and production build passed; whitespace diff check passed.
- Standalone lint is not configured: the existing `next lint` command prompts to initialize ESLint. No tooling migration was introduced.
- Read-only browser checks: mobile 320/375px, tablet 768px, desktop 1440px; light/dark surfaces, navigation, network switching, live Solana registry/search and invalid address feedback. No horizontal overflow on checked surfaces and no console errors on the checked routes. The live registry returned 17 Solana assets during this run (not a hardcoded count).
- No wallets were created/imported in browser QA and no live funds were moved. Authenticated financial execution remains unverified end-to-end. New runtime tests use isolated in-memory wallets and mocked receipts only in tests.
- Visual regression and full accessibility certification are inconclusive: no baseline screenshots, axe audit or complete screen-reader pass. Do not treat this as production/security certification.

## Demo limitations that remain real

1. The local Mainnet STRK20 service stack is not configured. Privacy/cross-chain execution stays unavailable until the existing prover/discovery/anonymizer and settlement configuration are ready. The UI does not bypass this gate.
2. The existing private-swap market is configured for Sepolia, not Mainnet. No Mainnet private swap is claimed or silently redirected to Sepolia. Sepolia cannot settle a Mainnet NEAR transfer.
3. Activity is session-only and clears on lock, wallet/network change or reload. Incoming transfers affect balances but are not indexed in this feed. Save transaction and deposit references before leaving.
4. Private operations do not expose a complete upfront fee-estimation API; the review states this and existing execution checks remain authoritative. No zero-fee promise is made.
5. Existing backup/export/recovery capabilities were not expanded. A full recovery ceremony and persistent incoming history are outside this time-boxed UX patch.

The interface-polish skill guided control sizing, restrained motion and progressive disclosure; the verification and browser-QA skills guided regression checks and read-only testing boundaries.
