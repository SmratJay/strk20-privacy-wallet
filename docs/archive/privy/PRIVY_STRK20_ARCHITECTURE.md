# Deliverable B — PEL Privy × STRK20 Architecture

## 1. Component architecture

```
                     ┌────────────────────────────────────┐
                     │             PEL UI                 │
                     │  Balance · Send · Receive · Activity│
                     └────────────────┬───────────────────┘
                                      │
                     ┌────────────────▼───────────────────┐
                     │         PEL Wallet Core            │
                     │  WalletContext · tx state machine  │
                     │  balances · history · recovery     │
                     └───────┬──────────────────┬─────────┘
                             │                  │
              ┌──────────────▼─────┐      ┌─────▼──────────────┐
              │ PrivyStrk20Adapter │      │  Privy (auth+wallet)│
              │  (privacy lane)    │      │  embedded wallet    │
              └──────┬─────────────┘      │  login/session      │
                     │                    └─────┬──────────────┘
        ┌────────────┼───────────┐              │
        ▼            ▼           ▼              │
  STRK20 SDK   ProvingSvc  DiscoverySvc          │
  (vendored)   (OHTTP)     (indexer)             │
        └────────────┬───────────┘              │
                     │  ┌───────────────────────┘
                     ▼  ▼
              StarknetPrivySigner ──► /api/privy/sign ──► Privy rawSign
                     │
                     ▼
              StarknetAccountAdapter (starknet.js Account)
                     │
                     ▼
                  Starknet
                     │
                     ▼
               STRK20 Pool
```

- **`PrivyStrk20Adapter`** isolates Privy from the protocol (the only module that knows about
  both Privy and STRK20).
- **`StarknetPrivySigner`** implements starknet.js `SignerInterface` by delegating `signRaw`
  to the backend.
- **`StarknetAccountAdapter`** produces a full starknet.js `Account` so the existing
  `Account.execute(...)` submission path is reused unchanged.

## 2. Key flow

```
User
 ├─ Privy embedded wallet key  ──► authorizes Starknet txs (server-side rawSign)
 └─ STRK20 viewing key          ──► decrypt notes / discover state (PEL-owned, separate)
```

The two keys are independent (§6). Privy never learns the viewing key; the viewing key is
derived and stored by PEL's privacy layer (encrypted at rest).

## 3. Signing flow (proof invocation)

```
STRK20 SDK.build().execute()
  → ProofInvocationFactory.create()
      → serializeClientActions → compile_actions calldata
      → StarknetPrivySigner.signTransaction(call, details)
          → calculateInvokeTransactionHash2(...)         (client, key-free)
          → signRaw(hash) → POST /api/privy/sign {walletId, hash}
              → PrivyClient.wallets().rawSign(walletId, {params:{hash}})
              → { signature } → normalize → [r, s]
      → INVOKE_TXN_V3 proof invocation (signature attached)
  → ProvingServiceProofProvider.prove(invocation, blockId)
      → { proof, proofFacts, l2_to_l1_messages, additionalData }
  → CallAndProof { call, proof }
```

## 4. Proving flow

```
PEL → SDK.execute(actions, {autoDiscover, autoSelectNotes, autoRegister, autoSetup})
    → createProofInvocation → prove(invocation)   [ProvingService, OHTTP-capable]
    → CallAndProof
PEL → StarknetAccountAdapter.execute(call, {proofFacts, proof})
    → Starknet
```

## 5. Note lifecycle

```
deposit → note (encrypted) → discoverNotes(viewingKey) → spendable set
spend   → useNotes + createNotes (self remainder) → nullifier marked spent
```

## 6. Recovery flow

```
New device → Privy login (email/social) → same embedded wallet (address)
           → derive/re-import STRK20 viewing key → discovery reconstructs notes
           → private balances restored (never from local cache)
```

## 7. Fee flow

```
Account.execute → fee estimation (RPC) → resourceBounds → sign → submit
Optional: AVNU paymaster (SNIP-29) for gasless UX (chain-sponsored)
```

## 8. Transaction state machine (UI-visible stages)

```
idle → preparing → discovering_notes → selecting_notes → building_private_action
     → signing → proving → proof_ready → submitting → confirming → confirmed

failure branches:
  note_discovery_failed / signing_rejected / prover_unavailable / proof_failed /
  submission_failed / confirmation_timeout / insufficient_private_balance /
  insufficient_fee_balance / recipient_invalid / privacy_state_corrupt
```
