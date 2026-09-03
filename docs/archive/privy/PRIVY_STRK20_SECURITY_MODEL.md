# Deliverable C — PEL Privy × STRK20 Security Model

## 1. Key hierarchy

```
User identity (Privy login: email/social)
 └─ Privy embedded Starknet wallet key      [held server-side by Privy; never on client]
      └─ authorizes Starknet txs via rawSign (server)
 └─ STRK20 viewing key (k, K = k·G)         [PEL privacy layer; NOT Privy]
      └─ decrypts notes, reconstructs balance, discovers state
 └─ (optional) PEL app session token (Privy JWT)
      └─ scopes /api/privy/* endpoints to the logged-in user
```

**Invariant:** Privy never sees the viewing key; PEL never sees the Privy wallet private key;
the browser never sees either.

## 2. Threat model

| Threat | Control |
| ------ | ------- |
| Client-side secret exposure | No private key on client; signing is server-side |
| Signing endpoint abuse | `/api/privy/sign` requires authenticated Privy JWT; hash-only signing (no blind tx) |
| Viewing-key theft | Encrypted at rest (AES-GCM under a wallet/device-derived key); never in logs/analytics |
| Note/balance forgery | Balances only from `discoverNotes`/Wallet API; never from local cache |
| Replay | SDK nullifier domain separation; nonce handling; idempotency in state machine |
| Prover learns too much | OHTTP envelope optional; screening signatures handled by SDK |
| Account-drain via paymaster/relayer | Relayer endpoint already fails-closed (existing `relayerSecurity.ts`); Privy path submits only PEL-built calls |
| Tx-finality lies | `submit` waits for terminal on-chain status; never reports success from a hash |

## 3. Private-state storage design

- Viewing key: **encrypted** local store (AES-GCM), derived deterministically from a PEL
  recovery secret; never written plaintext to a server DB.
- Notes/registry: PEL holds a decrypted **cache only**; authoritative state is the pool +
  discovery service.
- No raw viewing keys, note secrets, or decrypted balances in any centralized log/analytics.

## 4. Logging policy (enforced)

Never log: raw viewing keys, note secrets, decrypted balances tied to identities, proving
witnesses, private tx payloads. Prover/discovery/RPC/telemetry must not correlate public
addresses with private recipients.

## 5. Attack surfaces (Privy-specific)

1. `/api/privy/sign` — auth, rate-limit, hash-only input validation.
2. `/api/privy/wallet` — only create/get the *caller's* wallet (JWT-bound `user_id`).
3. Signature normalizer — reject malformed signature lengths; fail closed.
4. Public-key trust — verify `public_key` corresponds to the walletId (server returns it).

## 6. Recovery strategy

Deterministic: Privy login → same embedded wallet → viewing key re-derived from PEL recovery
secret → discovery reconstructs private state. No server holds a plaintext recovery key.
