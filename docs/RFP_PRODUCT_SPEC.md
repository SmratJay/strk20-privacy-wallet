# RFP Product Specification — STRK20 Umbra-Style Privacy Wallet

> **Status taxonomy used throughout this document**
>
> | Term | Meaning |
> |------|---------|
> | `IMPLEMENTED` | Code exists in this repository and is wired into the flow. |
> | `VERIFIED` | Demonstrated to work end-to-end (real wallet + real chain) in this repository. |
> | `INFERRED` | Derived from the official Wallet API spec / SDK surface, but not directly observed running against a real wallet + real chain here. |
> | `UNKNOWN` | Cannot be determined from the current repository or available integration surface. |
> | `BLOCKED` | Cannot be satisfied through the available official API without a protocol change or a new contract. |
>
> **Do not treat `IMPLEMENTED` as `VERIFIED`.** A button existing in the UI is not proof that the underlying operation is correct. Each claim below is marked with its true status.

---

## 1. Product definition

**STRK20 Umbra-style Privacy Wallet** — a consumer privacy wallet on Starknet that lets a user:

> **Publish once. Receive privately. Spend freely.**

It is a **dapp**, not a standalone wallet. It composes the existing STRK20 privacy pool through the official **Starknet Wallet API** and a compatible privacy wallet (e.g. **Ready**). It does **not** implement the privacy protocol, cryptography, note storage, or discovery itself.

## 2. RFP objective

"An Umbra-style privacy wallet for Starknet" using the **existing STRK20 privacy pool and SDK**. Requirements:

1. Generate viewing keys. — *delegated to the privacy wallet*
2. Register viewing keys on first use. — *delegated to the privacy wallet (transparent)*
3. Give users a privacy-pool receive address. — *the user's Starknet address, once registered*
4. Allow that receive address to be shared. — *QR / copy / share*
5. Discover incoming encrypted notes. — *performed by the privacy wallet; dapp consumes balances*
6. Display discovered private balances.
7. Send privately through STRK20.
8. Support `Withdraw` / `CreateEncNote` flows as appropriate.
9. Use paymaster-sponsored gas where supported.
10. Hide cryptographic complexity from the user.
11. Look and behave like a normal consumer wallet.
12–15. Use the existing STRK20 protocol; **no new contracts; no protocol modifications**.

## 3. User journey (canonical)

```
Connect wallet
   ↓
Enable private receiving
   ↓
Private receiving becomes ready
   ↓
Private receive address is available
   ↓
User publishes/shares address once
   ↓
Another user sends a private STRK20 payment
   ↓
Privacy wallet performs discovery
   ↓
Private balance becomes available
   ↓
Dapp displays received payment
   ↓
User can send privately
```

Each of these steps is marked with its true status in `docs/PRIVATE_RECEIVING_ARCHITECTURE.md`. **Do not claim a step exists merely because the UI has a button for it.**

## 4. Dapp responsibilities

The dapp owns:

- consumer UI
- routing
- wallet connection UX
- wallet capability detection (`wallet_supportedWalletApi`, `wallet_supportedSpecs`)
- network detection (`wallet_requestChainId`)
- private receiving UX
- receive address presentation
- QR / copy / share UX
- send UX
- transaction UX
- activity presentation
- privacy education
- application state
- honest error states

## 5. Privacy-wallet responsibilities

The connected privacy wallet (e.g. Ready) owns:

- private / spending keys
- **viewing keys**
- **viewing-key lifecycle (generation, secure storage, registration)**
- **encrypted notes**
- **note discovery**
- **note decryption**
- **proof generation**
- privacy state
- signing
- wallet-side STRK20 operations not exposed to the dapp

## 6. STRK20 responsibilities

The STRK20 privacy infrastructure / pool owns:

- the on-chain privacy pool
- note encryption scheme
- note commitments and nullifiers
- the registration registry (address → viewing key)
- shielded-token balances
- the proving infrastructure used by wallets

## 7. Wallet API boundary

The dapp communicates with the privacy wallet **only through the official Starknet Wallet API**. Methods used by this dapp:

| Method | Purpose |
|--------|---------|
| `wallet_requestAccounts` / `enable` | Connect |
| `wallet_supportedWalletApi` / `wallet_supportedSpecs` | Capability detection |
| `wallet_requestChainId` | Network detection |
| `wallet_switchStarknetChain` | Network switching |
| `wallet_getPermissions` | Permissions (informational) |
| `wallet_strk20InvokeTransaction` | Submit a STRK20 action (deposit / withdraw / transfer) |
| `wallet_strk20Balances` | Read private balances (wallet-side discovery result) |

The STRK20 action set exposed to the dapp is exactly:

```
deposit | withdraw | transfer | invoke
```

There is **no standalone registration RPC** in the Wallet API. Registration is *transparent* (see §8).

## 8. Private receiving lifecycle

1. User connects a privacy wallet. — `IMPLEMENTED` / `VERIFIED` (in-browser)
2. Dapp detects STRK20 capability + chain. — `IMPLEMENTED` / `VERIFIED` (in-browser)
3. Dapp probes readiness via `wallet_strk20Balances` (empty token list). — `IMPLEMENTED`
   - success ⇒ registered & consent granted ⇒ **READY**
   - `NOT_REGISTERED` (118) ⇒ **NEEDS_REGISTRATION**
   - `USER_REFUSED_OP` (113) ⇒ consent blocked ⇒ **UNKNOWN**
4. If `NEEDS_REGISTRATION`, the dapp triggers setup by submitting a **real** `wallet_strk20InvokeTransaction` deposit. The wallet **transparently** adds `SetViewingKey` + `OpenChannel` + `OpenTokenChannel` in the same transaction (`autoRegister` / `autoSetup`). — `IMPLEMENTED` (dapp triggers); wallet-side registration `INFERRED` from spec/SDK surface, **not** verified end-to-end here.
5. Dapp waits for on-chain confirmation, then re-probes readiness. READY is only claimed after the re-probe succeeds. — `IMPLEMENTED`
6. When READY, the receive identity (the wallet's Starknet address) is presented with QR / copy / share. — `IMPLEMENTED`

> **Registration through the Wallet API requires a real STRK20 action.** There is no register-only RPC. A user with zero balance cannot be registered by the dapp alone; they must fund a small amount or complete setup inside the wallet's own UI. This is a documented limitation, not a fabricated workaround. See `docs/PRIVATE_RECEIVING_ARCHITECTURE.md` §13.

## 9. Private sending lifecycle

1. User selects a recipient Starknet address, token, amount. — `IMPLEMENTED`
2. Dapp submits `wallet_strk20InvokeTransaction` with a `transfer` action. The wallet builds the note, generates the SNIP-36 proof, and submits. — `IMPLEMENTED` (dapp submits; wallet proves). Proof generation by the wallet is `INFERRED` from the spec; not verified end-to-end here.
3. Dapp waits for on-chain confirmation and records the local activity entry. — `IMPLEMENTED`
4. Recipient's wallet performs discovery to find the incoming note. — wallet-side; not verified here.

## 10. What the dapp must never access

The dapp **MUST NOT** own, generate, persist, or receive:

- viewing keys
- spending keys
- private keys
- encrypted notes
- decrypted private notes
- proof witnesses
- proofs
- nullifiers
- cryptographic secrets

This repository currently holds **no** viewing keys, notes, or proofs in dapp-owned state. The only key-adjacent code is `src/services/viewingKeyService.ts` and `src/services/strk20SdkService.ts` (Lane B / legacy PEL), which are **not** on the consumer wallet (Lane A) path. See §11 and the `out-of-scope` note in §15.

## 11. What the dapp is allowed to request

Through the Wallet API, the dapp may request authorized operations:

- connect + address + chain + capability
- STRK20 actions (`deposit` / `withdraw` / `transfer`) — described, not executed by the dapp
- private **balances** (not notes) — via `wallet_strk20Balances`

## 12. Network assumptions

- Primary supported network for the deployed protocol: **Starknet Sepolia** (`SN_SEPOLIA`).
- STRK20 Sepolia privacy pool: `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91`
- Mainnet STRK20 pool is configured (`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`) but the wallet lane is validated on Sepolia. Network is auto-synced from the wallet's `wallet_requestChainId`.
- Centralized in `src/config/networks.ts`.

## 13. Current implementation status

| Item | Status |
|------|--------|
| Wallet connection (Ready) | `IMPLEMENTED` / `VERIFIED` (in-browser) |
| STRK20 capability detection | `IMPLEMENTED` / `VERIFIED` (in-browser) |
| Network detection + switch | `IMPLEMENTED` / `VERIFIED` (in-browser) |
| Private-receiving readiness probe | `IMPLEMENTED` (consent-gated — see note) |
| Enable private receiving (via real deposit) | `IMPLEMENTED` (dapp side) |
| Wallet-side registration | `INFERRED` (spec/SDK) — not verified end-to-end here |
| Receive identity (address) + QR/copy/share | `IMPLEMENTED` |
| Private balances | `IMPLEMENTED` (wallet-side discovery result) |
| Private send (transfer) | `IMPLEMENTED` |
| Wallet-side note discovery/decryption/proving | `INFERRED` (spec/SDK) — not verified here |
| Zero-balance registration | `BLOCKED` (no register-only RPC; requires funds or in-wallet setup) |

## 14. Known unresolved questions

1. Does Ready's `wallet_strk20Balances` return `NOT_REGISTERED` (118) *before* or *after* the "share private balances" consent gate? This determines whether the readiness probe can distinguish "not registered" from "consent not granted". — `UNKNOWN` (wallet-internal)
2. What are Ready's exact `autoRegister` / `autoSetup` defaults for `wallet_strk20InvokeTransaction`? — `INFERRED` from SDK surface
3. Is there any wallet-exposed way to register without a funded action? — `BLOCKED` per current Wallet API spec
4. Does a freshly-registered address require the ~10-block note-maturity / account-finalization rule before it can receive? — `INFERRED` from SDK docs; `UNKNOWN` for receive-readiness
5. Paymaster/fee sponsorship: is gas actually sponsored on Sepolia for `wallet_strk20InvokeTransaction`? — `UNKNOWN`

## 15. Explicit out-of-scope features

Not part of this product (later phases or never):

- a new standalone wallet
- custom viewing-key generation/storage/registration by the dapp
- custom discovery / note scanning by the dapp
- custom ECDH, proof generation, nullifier handling
- new smart contracts
- STRK20 protocol modifications
- legacy PEL perps terminal (kept on disk, not the consumer surface; may reference dapp-side viewing keys — not on the Lane A path)
- swaps, perps, earn, portfolio, compliance passports, session keys, privacy scoring, anonymity analysis, payment links
- mobile-native app
- tests / test suites

---

*Source of truth for the implementation. When a claim conflicts with observed behavior, the observed behavior wins and this document must be corrected.*
