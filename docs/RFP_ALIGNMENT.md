# RFP Alignment — STRK20 Umbra-Style Privacy Wallet

Requirement-by-requirement mapping. **Statuses: `COMPLETE` / `PARTIAL` / `BLOCKED` /
`NOT APPLICABLE`.**

- `COMPLETE` = implemented and demonstrated working here.
- `PARTIAL` = implemented at the integration level but **not** verified end-to-end against a real
  wallet + real chain in this repository (wallet-side operations are `INFERRED` from the official
  spec/SDK, per `docs/RFP_PRODUCT_SPEC.md`).
- `BLOCKED` = cannot be satisfied through the available official API without a protocol change,
  a new contract, or unavailable live infrastructure.

---

| # | Requirement | Implementation | Files | Wallet API / SDK mechanism | Demo evidence | Status |
|---|-------------|----------------|-------|----------------------------|---------------|--------|
| 1 | Browser wallet | Consumer wallet app on `/` with Dashboard / Receive / Send / Activity / Settings | `src/app/*`, `src/components/wallet/*` | — | app runs, routes load | `COMPLETE` |
| 2 | Mobile-friendly experience | Responsive layout, bottom nav on mobile, touch targets, large QR | `src/components/wallet/AppShell.tsx` | — | responsive nav present | `COMPLETE` |
| 3 | Viewing-key onboarding | Dapp triggers setup; **wallet** generates/registers the viewing key transparently via a real action | `src/components/wallet/EnablePrivateReceiving.tsx`, `src/services/strk20WalletApiService.ts` | `wallet_strk20InvokeTransaction` (deposit) → transparent `SetViewingKey` | integration wired; wallet-side not verified here | `PARTIAL` |
| 4 | Private receiving identity | The connected wallet's Starknet address (the registered receive identity) | `src/components/wallet/ReceivePanel.tsx` | `wallet_requestAccounts` + `wallet_strk20Balances` readiness | address surfaced | `COMPLETE` |
| 5 | Publish / share receive address | QR + Copy + Share; honesty-gated on readiness | `src/components/wallet/ReceivePanel.tsx` | — | QR/copy/share present | `COMPLETE` |
| 6 | Incoming discovery | **Wallet-side** discovery; dapp consumes `wallet_strk20Balances` (balance only) | `src/context/WalletContext.tsx` | `wallet_strk20Balances` | balances from wallet; discovery itself not verified here | `PARTIAL` |
| 7 | Private balances | Per-token private/public split; zero vs unavailable distinguished | `src/components/wallet/BalanceCard.tsx` | `wallet_strk20Balances` | display logic | `COMPLETE` |
| 8 | Private send | Recipient, amount, asset, review, wallet confirm, reconcile | `src/components/wallet/SendForm.tsx`, `src/services/strk20WalletApiService.ts` | `wallet_strk20InvokeTransaction` (`transfer`) | integration wired; proof/send not verified here | `PARTIAL` |
| 9 | Withdraw / make public | Unshield flow via `withdraw` action | `src/components/wallet/SendForm.tsx` (mode WITHDRAW) | `wallet_strk20InvokeTransaction` (`withdraw`) | integration wired | `PARTIAL` |
| 10 | Paymaster / fee abstraction | Fee honesty — "Paid by your wallet", not assumed sponsorship | `src/components/wallet/SendForm.tsx` | wallet adds fee action | honest label | `COMPLETE` (label) / `BLOCKED` (sponsorship confirmation) |
| 11 | Consumer wallet UX | Calm, minimal, privacy-first design | `src/components/wallet/*`, `src/app/globals.css` | — | design present | `COMPLETE` |
| 12 | No protocol changes | No STRK20 contract or protocol modifications | — | — | — | `COMPLETE` |
| 13 | Existing STRK20 pool | Uses configured pool addresses | `src/config/networks.ts` | — | addresses centralized | `COMPLETE` |
| 14 | Existing SDK / Wallet API | Uses official Wallet API methods only | `src/services/strk20WalletApiService.ts` | listed Wallet API methods | — | `COMPLETE` |

---

## Two-wallet canonical demo (Phase 22)

| Step | Requirement | Status here |
|------|-------------|-------------|
| A enables private receiving | viewing-key registration via wallet | `PARTIAL` (not verified) |
| A obtains + shares receive identity | QR / copy / share | `COMPLETE` |
| B sends private payment to A | `transfer` action via Wallet API | `PARTIAL` (not verified) |
| Transaction reaches STRK20 | pool executes | requires live chain — `BLOCKED` here |
| A's wallet discovers payment | wallet-side discovery | `PARTIAL` (inferred) |
| A's private balance updates | `wallet_strk20Balances` | `PARTIAL` (not verified) |
| A sends privately to B | `transfer` action | `PARTIAL` (not verified) |
| B discovers + balance updates | wallet-side discovery | `PARTIAL` (inferred) |

**The live two-wallet scenario is the gate. It cannot be executed in this repository environment**
(no browser privacy wallet, no funded Sepolia account, operator proving/discovery stack required).
The integration path is complete; live verification is the remaining blocker.

---

## Notes on statuses

- **`PARTIAL`** reflects that the dapp side is implemented and wired to the official Wallet API,
  but the *wallet/protocol* side (registration, discovery, decryption, proof generation) is
  `INFERRED` from the official spec/SDK and **not** demonstrated end-to-end in this repo.
- Nothing is marked `COMPLETE` purely because a button exists. See the status taxonomy in
  `docs/RFP_PRODUCT_SPEC.md`.
