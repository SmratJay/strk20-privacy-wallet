# Private Receiving Architecture — STRK20 Umbra-Style Privacy Wallet

> Phase 2 deliverable. This traces the **actual** implementation against the **actual**
> Starknet Wallet API and STRK20 SDK, and resolves the private-receiving architecture.
>
> **The single most important conclusion:**
> `wallet_strk20Balances()` is **not** "our discovery implementation". It is the result of
> **wallet-side discovery** performed inside the connected privacy wallet. Our dapp does not
> implement discovery, note decryption, viewing-key handling, or proof generation. It only
> consumes the wallet's discovery output (a balance per token) through the Wallet API. Claims
> below are marked `IMPLEMENTED` / `VERIFIED` / `INFERRED` / `UNKNOWN` / `BLOCKED` exactly as in
> `docs/RFP_PRODUCT_SPEC.md`.

---

## 0. Architecture (confirmed)

```
USER
  ↓
OUR DAPP
  ↓
STARKNET WALLET API
  ↓
COMPATIBLE PRIVACY WALLET (e.g. Ready)
  ↓
STRK20 PRIVACY INFRASTRUCTURE (proving / discovery services)
  ↓
STRK20 PRIVACY POOL
  ↓
STARKNET
```

**Ownership boundary (non-negotiable):**

| Owns | Owns |
|------|------|
| **Our Dapp** | UI, routing, connect UX, capability + network detection, private-receiving UX, receive address presentation, QR/copy/share, send UX, tx UX, activity, privacy education, app state, honest errors. |
| **Privacy Wallet** | private/spending keys, **viewing keys**, viewing-key lifecycle, encrypted notes, note discovery, note decryption, proof generation, privacy state, signing, wallet-side STRK20 ops. |

The dapp must never own/persist: viewing keys, spending keys, private keys, encrypted notes,
decrypted notes, proof witnesses, proofs, nullifiers, or any cryptographic secret.

---

## 1. Call graph (real)

```
UI  (EnablePrivateReceiving / ReceivePanel / SendForm)
  ↓  React/context
WalletContext (state, readiness, permission)
  ↓
strk20WalletApiService (service)
  ↓
Wallet API request:  wallet_supportedWalletApi / wallet_requestChainId /
                     wallet_strk20InvokeTransaction / wallet_strk20Balances
  ↓
Privacy Wallet (Ready)
  ↓  (internally, via the STRK20 privacy SDK the wallet embeds)
viewing key → discoverNotes(viewingKey) → decrypt → balance
  ↓
STRK20 pool (on-chain notes / registry)
```

Every dapp→wallet call crosses the Wallet API. Every privacy operation happens inside the wallet.

---

## 2. Sequence diagram with per-arrow status

```
  User         Our Dapp        Wallet API       Privacy Wallet     STRK20 Pool
   │               │                │                  │                │
   │ ① connect     │                │                  │                │
   │──────────────▶│                │                  │                │
   │               │ ② wallet_requestAccounts / supportedWalletApi / chainId
   │               │───────────────▶│                  │                │
   │               │                │ ③ resolve address, viewing key, private state
   │               │                │─────────────────▶│                │
   │               │◀───────────────│ (address, chain, capability)
   │               │                │                  │                │
   │ ④ enable      │                │                  │                │
   │──(setup)─────▶│                │                  │                │
   │               │ ⑤ wallet_strk20Balances (tokens:[])  ← readiness probe
   │               │───────────────▶│─────────────────▶│   (discover)    │
   │               │◀── 118 NOT_REGISTERED  or  success │                │
   │               │                │                  │                │
   │               │ ⑥ wallet_strk20InvokeTransaction (deposit) → transparent SetViewingKey + OpenChannel + Deposit
   │               │───────────────▶│─────────────────▶│────────────────▶│  tx
   │               │◀── tx hash ────│                  │                │
   │               │                │                  │                │
   │               │ ⑦ re-probe wallet_strk20Balances → success ⇒ READY
   │               │───────────────▶│─────────────────▶│                │
   │               │◀── READY ──────│                  │                │
   │               │                │                  │                │
   │ ⑧ receive addr│ ⑨ QR/copy/share (address)         │                │
   │◀──────────────│                │                  │                │
   │               │                │                  │                │
   │               │                │                  │ ⑩ (incoming)   │
   │               │                │                  │   discover note │
   │               │ ⑪ wallet_strk20Balances           │                │
   │               │───────────────▶│─────────────────▶│◀───────────────│
   │               │◀── balance ────│                  │                │
   │               │                │                  │                │
```

### Per-arrow details

| Arrow | Who initiates | What data crosses | Can dapp see it? | Implemented | Verified |
|-------|---------------|-------------------|------------------|-------------|----------|
| ① connect | User clicks | intent | — | `IMPLEMENTED` | `VERIFIED` (in-browser) |
| ② capability+chain | Dapp | `wallet_requestAccounts`, `wallet_supportedWalletApi`, `wallet_requestChainId` | address, chain, supported versions (yes) | `IMPLEMENTED` | `VERIFIED` (in-browser) |
| ③ wallet internal | Wallet | address → viewing key / private state | **no** (inside wallet) | `IMPLEMENTED` (in wallet) | not verified here |
| ④ enable setup | User clicks | intent | — | `IMPLEMENTED` | `VERIFIED` (in-browser) |
| ⑤ readiness probe | Dapp | `wallet_strk20Balances` (tokens: []) | result only (READY / 118 / 113) | `IMPLEMENTED` | in-browser; registration semantics `INFERRED` (spec) |
| ⑥ registration+deposit | Dapp submits real deposit; **wallet performs registration** | `wallet_strk20InvokeTransaction`; wallet adds `SetViewingKey`+`OpenChannel`+`OpenTokenChannel` | dapp sees only **tx hash**, never the viewing key | `IMPLEMENTED` (dapp); wallet-side `INFERRED` (spec/SDK) | **not** verified end-to-end here |
| ⑦ re-probe → READY | Dapp | same as ⑤ | result only | `IMPLEMENTED` | `INFERRED` |
| ⑧ receive address | Dapp | wallet Starknet address | yes (public address) | `IMPLEMENTED` | `VERIFIED` (in-browser) |
| ⑨ QR/copy/share | Dapp | address string | yes | `IMPLEMENTED` | `VERIFIED` (in-browser) |
| ⑩ incoming discovery | **Wallet** (on sender action / refresh) | viewing key → scan pool → decrypt | **no** (notes stay in wallet) | wallet-side; not implemented by dapp | not verified here |
| ⑪ private balance | Dapp triggers read | `wallet_strk20Balances` (tokens) | balance per token only (no notes) | `IMPLEMENTED` | wallet-side discovery `INFERRED` |

> **Note on ⑤/⑦/⑪:** A successful `wallet_strk20Balances` call implies registration **because the
> spec defines NOT_REGISTERED (118) as its "unregistered" error**. So "balance query succeeded"
> ⟺ "viewing key registered" is **spec-guaranteed**, not merely assumed. It is still consent-gated
> (see §5) and has not been verified end-to-end against a real Ready + real chain in this repo.

---

## 3. Answers to the Phase 2 questions

1. **How does a compatible privacy wallet generate the viewing key?** Inside the wallet. The
   Wallet API exposes no key-generation RPC. — `INFERRED` (SDK/spec), wallet-internal.
2. **Who owns the viewing key?** The privacy wallet. — confirmed.
3. **Where is it stored?** In the wallet's secure storage. Not in this repo. — `UNKNOWN` (wallet-internal).
4. **Does the dapp ever receive the viewing key?** **No.** This dapp never receives or persists it. — confirmed.
5. **How is the viewing key registered?** Transparently: the wallet adds a `SetViewingKey` action to a real STRK20 action when the user is unregistered (`autoRegister`). — `INFERRED` (SDK surface), verified at the SDK-options level.
6. **Is there a dapp-facing Wallet API registration method?** **No.** `STRK20_ACTION = deposit|withdraw|transfer|invoke` only; no register RPC. — confirmed from `@starknet-io/types-js` wallet-api spec.
7. **If no registration RPC, how does the wallet register/set up?** Via `autoRegister` + `autoSetup` during a real STRK20 action (SetViewingKey + OpenChannel + OpenTokenChannel), or through the wallet's own UI. — `INFERRED`.
8. **What does our `enablePrivateReceiving()` do?** Probes readiness; if `NEEDS_REGISTRATION`, submits a **real** `wallet_strk20InvokeTransaction` deposit so the wallet transparently registers + shields the first note; waits for confirmation; re-probes readiness; returns READY only after re-probe. — `IMPLEMENTED`.
9. **What does `getPrivateReceivingRequirement()` determine?** `wallet_strk20Balances` (empty token list): success ⇒ READY; `118` ⇒ NEEDS_REGISTRATION; `113`/other ⇒ UNKNOWN. — `IMPLEMENTED`.
10. **What makes the wallet "ready"?** A successful `wallet_strk20Balances` call (spec: implies registered + consent granted). — `INFERRED`.
11. **How does the user obtain the receive identity/address?** The connected wallet's Starknet address — the pool maps address → registered viewing key. There is no separate stealth address in STRK20. — confirmed.
12. **How does another wallet pay that identity?** A private `transfer` action addressed to that Starknet address. — `IMPLEMENTED` (send path).
13. **How does the recipient discover the incoming note?** The wallet scans the pool with the viewing key (`discoverNotes`). Not performed by the dapp. — `INFERRED`.
14. **How does `wallet_strk20Balances` relate to discovery?** It **is** the dapp-visible output of wallet-side discovery (balance per token). — confirmed.
15. **Is `wallet_strk20Balances` a discovery result, a permissioned query, or something else?** **Both.** It is wallet-side discovery output, AND it is permissioned (Ready's "share private balances" consent) — and it also doubles as the registration probe via its 118 error. Three roles, one RPC. — confirmed.
16. **What must the user do to make incoming payments discoverable?** Become registered (viewing key on-chain). That requires a real STRK20 action (needs a small funded amount) or in-wallet setup. — `BLOCKED` for zero-balance through the dapp alone.
17. **Can private receiving happen without the dapp seeing a viewing key?** **Yes** — that is exactly the current architecture. — confirmed.
18. **Can the dapp truthfully claim "Enable private receiving" then present a receive address?** Only if READY is genuinely confirmed (via re-probe), and only for the address that is actually registered. The current flow does re-probe. The UI must not present the "can receive" claim before READY (Phase 3 corrects this). — confirmed.
19. **Is this compliant with "Generates and registers viewing keys on first use"?** **Yes, with a caveat.** Responsibility is correctly delegated to the privacy wallet; the dapp triggers registration on first use via a real action. Caveat: it needs a funded action, and end-to-end is not verified here. — `INFERRED` / `BLOCKED` (zero-balance).
20. **If the architecture cannot satisfy this via the Wallet API, identify the exact blocker.** **Blocker:** there is no register-only Wallet API RPC and no way for the dapp to register a zero-balance user. **Current behavior:** dapp submits a funded deposit. **Required:** RFP wants first-use registration. **Available official API:** only action-driven transparent registration. **Recommended path:** keep action-driven registration; for zero-balance, guide the user to fund a small amount or complete setup in the wallet's own UI. Report this instead of inventing a workaround.

---

## 4. Responsibility table

| Responsibility | Dapp | Wallet | STRK20 | Status |
|----------------|------|--------|--------|--------|
| Viewing-key generation | — | ✅ | — | wallet-internal; `INFERRED` |
| Viewing-key storage | — | ✅ | — | wallet-internal; `UNKNOWN` detail |
| Viewing-key registration | triggers via action | ✅ performs | ✅ registry | dapp `IMPLEMENTED`; wallet `INFERRED` |
| Receive identity (address) | ✅ presents | ✅ owns | ✅ resolves addr→viewing key | `IMPLEMENTED` |
| Note encryption | — | ✅ | ✅ | wallet/pool; `INFERRED` |
| Note discovery | — | ✅ | ✅ pool data | wallet; `INFERRED` |
| Note decryption | — | ✅ | — | wallet; `INFERRED` |
| Private balance | ✅ displays | ✅ computes | ✅ holds notes | dapp display `IMPLEMENTED`; computation `INFERRED` |
| Private transfer | ✅ submits action | ✅ builds+proves+signs | ✅ pool | dapp `IMPLEMENTED`; wallet `INFERRED` |
| Proof generation | — | ✅ | — | wallet; `INFERRED` |
| Signing | — | ✅ | — | wallet; `VERIFIED` (in-browser) |
| Transaction submission | ✅ via Wallet API | ✅ broadcasts | ✅ executes | `IMPLEMENTED` |

✅ = owns the responsibility. `INFERRED` = believed correct from spec/SDK but not verified end-to-end here.

---

## 5. Consent gate limitation (important)

`wallet_strk20Balances` is gated behind Ready's **"Share private balances"** consent. Consequences:

- A registered user who **denies** consent ⇒ `USER_REFUSED_OP` (113) ⇒ readiness = `UNKNOWN` (not READY, not NEEDS_REGISTRATION).
- We therefore cannot distinguish "not registered" from "consent not granted" when consent is refused. Whether 118 is returned *before* the consent gate is wallet-internal — `UNKNOWN`.

The state model keeps `private-balance permission` (consent) **separate** from `private-receiving readiness` (registration), but the readiness probe itself is consent-gated.

---

## 6. State model (as implemented in `WalletContext`)

| Concept | Field | Values |
|---------|-------|--------|
| Wallet connected | `wallet.isConnected` | bool |
| Wallet supports STRK20 | `walletApiStatus.state` | READY / WRONG_NETWORK / PRIVACY_WALLET_REQUIRED / CONNECT_WALLET |
| Private-balance permission (consent) | `privateBalancePermission` | UNKNOWN / GRANTED / DENIED |
| Private-receiving readiness (registration) | `privateReceivingState` | UNKNOWN / READY / NEEDS_REGISTRATION |

These are distinct. `privateReceivingState === READY` is set from a successful `wallet_strk20Balances` (spec ⇒ registered + consent granted). `privateBalancePermission === GRANTED` is set from the same success but represents consent; they may differ when consent is denied (READY stays UNKNOWN, permission becomes DENIED).
