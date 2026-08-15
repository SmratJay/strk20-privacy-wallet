# STRK20 Privacy Wallet — Integration Plan

> Umbra-grade UX on Starknet, fully powered by the existing STRK20 privacy pool.
> No new contracts. No protocol changes. The work is product, UX, and SDK integration.

---

## Background

Umbra on Ethereum hides the recipient behind a one-time stealth address. STRK20 hides
the recipient, the sender, the amount, and the token type — all inside encrypted pool
storage. This wallet delivers the Umbra UX on a fundamentally stronger cryptographic
foundation.

**Pool address (Starknet Mainnet):**
`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`

---

## Privacy Analysis

### What should be private?

| Action | What to hide | How STRK20 does it |
|---|---|---|
| Receiving funds | Recipient identity, amount, token | Encrypted channel note; no on-chain address |
| Sending funds | Sender identity, amount, token | UseNote → CreateEncNote inside pool |
| Viewing your balance | Balance existence | Note discovery only with your viewing key |
| Gas payment | Transaction initiator | Paymaster / pool-mediated submission |

### What stays visible (by design)

- Shield deposits: depositor address, token, amount
- Unshield withdrawals: recipient address, token, amount
- Timing of pool interactions
- That *someone* is using the pool (not who)

---

## Integration Route

**Primary:** Build Privacy Wallets SDK route (`@starkware-libs/starknet-privacy`)

This is the wallet-builder route — we manage viewing keys, channels, note discovery,
transaction construction, and proving ourselves. The Starknet Wallet API route is for
dapps that sit on top of a wallet; we ARE the wallet.

**Supporting:** Starknet Wallet API (for compatibility with other dapps connecting to us)

---

## Phased Implementation Plan

### Phase 0 — Environment & Tooling (Day 1)
- [x] Repository created: `https://github.com/SmratJay/strk20-privacy-wallet`
- [x] `strk20.json` added at repo root
- [x] `.env.example` with `ALCHEMY_STARKNET_KEY` pattern documented
- [ ] Alchemy key provisioned and stored in `.env.local` (never committed)
- [ ] `npm install starknet@^10.4.0` — pin the exact version (10.0.x has no STRK20 API)
- [ ] `npm install @starkware-libs/starknet-privacy` — Privacy SDK

**Key env vars:**
```
ALCHEMY_STARKNET_KEY=<your_key>
NEXT_PUBLIC_STARKNET_RPC=https://starknet-mainnet.g.alchemy.com/v2/<key>
NEXT_PUBLIC_STRK20_POOL=0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
NEXT_PUBLIC_CHAIN_ID=SN_MAIN
```

---

### Phase 1 — Viewing Key Registration (Core Identity)

The single most important step. A user cannot hold or receive private balances
without registering. This is the `SetViewingKey` action.

**What to build:**
- On first app open: generate a viewing keypair (`k`, `K = k·G` on STARK curve)
- Store the private viewing key encrypted in browser (IndexedDB + user passphrase or wallet signature)
- Submit `SetViewingKey` transaction to the pool
- Show a "Privacy Address" (derived from `K`) that others can pay to — this is the "publish once" step

**SDK calls (pseudocode):**
```typescript
import { PrivacySDK } from '@starkware-libs/starknet-privacy';

const sdk = new PrivacySDK({ rpcUrl: process.env.NEXT_PUBLIC_STARKNET_RPC });

// Generate viewing keypair
const { privateKey, publicKey } = await sdk.generateViewingKey();

// Register on-chain — this is a pool transaction
await sdk.register({ account, privateKey, publicKey });
```

**Privacy note:** The public viewing key `K` is registered on-chain. The private key
`k` is escrowed to the auditor's public key at registration (compliance requirement).
**The private key must never leave the client unencrypted.**

---

### Phase 2 — Note Discovery (Receive Privately)

Once registered, the user needs to find their incoming funds.

**How STRK20 discovery works:**
1. Scan channel entries addressed to you → decrypt with ECDH using your private viewing key
2. For each channel: walk subchannels (by token) until first empty slot
3. For each (channel, token): walk note indices, unmask amounts, check nullifiers

**What to build:**
- Background discovery worker (Web Worker or server-side job)
- Display spendable balance by token
- Show incoming transaction history (sender hidden, amount revealed)

**SDK calls:**
```typescript
const notes = await sdk.discover({ privateKey, fromBlock: 0 });
const spendableBalance = notes
  .filter(n => !n.spent)
  .reduce((sum, n) => sum + n.amount, 0n);
```

**UX:** Auto-run discovery on app load and every N minutes. Show a "syncing..." 
indicator. The user never needs to understand channels or subchannels.

---

### Phase 3 — Shield (Deposit → Private Note)

Move public ERC-20 tokens into the pool. The deposit itself is visible on-chain
(depositor and amount) but the resulting note is encrypted.

**Flow:**
1. User selects token + amount
2. `approve` the pool to spend the ERC-20
3. Pool: `Deposit` action → creates an encrypted note in your self-channel
4. Note becomes spendable private balance

**What to build:**
- Token selector + amount input
- Transaction preview showing what stays public (the deposit event) vs. what's private (the note)
- FPI screening happens automatically on-chain — no extra steps needed

---

### Phase 4 — Private Transfer (Send Privately)

Spend notes, create new notes. The sender, recipient, amount, and token are all
hidden inside the pool.

**Flow:**
1. Sender inputs recipient's **privacy address** (their public viewing key `K`)
2. SDK: UseNote (sender's note) → CreateEncNote (recipient's channel) + CreateEncNote (change back to sender)
3. Zero-knowledge proof generated (~30s on modern hardware)
4. Submit via paymaster (hides the submitter's address from the fee payment)

**What to build:**
- "Pay to privacy address" input
- Address book that maps human names → privacy addresses
- Progress indicator during proof generation ("Generating proof... ~30s")
- Paymaster integration for gas abstraction

**UX principle:** The proof generation wait is the biggest UX challenge. Show a
progress bar with estimated time. Do NOT let the UI appear frozen.

---

### Phase 5 — Unshield (Withdraw → Public Address)

Move tokens back out of the pool to a public Starknet address.

**Flow:**
1. User inputs destination address + amount
2. Pool: UseNote → Withdraw
3. ERC-20 transfer to the destination address (visible on-chain)

**What to build:**
- Withdraw flow with destination address input
- Warning that this withdrawal is public (amount + destination visible)
- Option to withdraw to a fresh address (Argentx / Braavos account creation hint)

---

### Phase 6 — Paymaster Integration (Gas Abstraction)

The pool is the caller during private transfers, so the submitter's address can be
hidden. Use a paymaster to fully decouple the gas payer from the transaction.

**What to build:**
- Integrate a Starknet paymaster (AVNU paymaster or custom)
- Users never need to hold ETH for gas — pay gas from their shielded STRK balance
- Show "Gas: paid privately" in the transaction summary

---

### Phase 7 — Mobile + Polish

- React Native wrapper (Expo) for mobile
- Hardware key storage (Secure Enclave on iOS / Android Keystore)
- Push notifications for incoming notes (server-side discovery polling)
- QR code for sharing privacy address

---

## Architecture Decision: Key Storage

| Option | Security | UX | Recommendation |
|---|---|---|---|
| Browser IndexedDB + passphrase | Good | Extra step | Use for web MVP |
| Derive from wallet signature | Good | No extra step | Use if starknet.js supports it |
| Hardware wallet (Ledger) | Best | Requires hardware | Phase 7 |

**MVP decision:** Derive the viewing key from a deterministic wallet signature
(`signMessage("strk20-viewing-key-v1")`). The user's Argentx/Braavos wallet is
the root of trust. No separate passphrase needed.

---

## What Stays Public (Honest UX Copy)

The UI must be honest about what is and isn't private:

- ✅ **Private:** who you pay, who pays you, amounts, token types, your balance
- ⚠️ **Public:** that you joined the pool (registration event), deposit amounts, withdrawal amounts and destinations, timing

---

## References

- STRK20 docs: https://strk20-by-example.org/llms-full.txt
- Privacy SDK: https://github.com/starkware-libs/starknet-privacy
- Starter kit: https://github.com/Akashneelesh/strk20-starter-kit
- Awesome STRK20: https://github.com/Akashneelesh/awesome-strk20
- Pool: `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`
