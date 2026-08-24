# Deliverable A — Privy × STRK20 Compatibility Audit

> Definitive, source-backed answer to the gating question (§29) plus the API maps,
> signer-interface comparison, and the smallest-adapter contract. Every "supported"
> claim is anchored to code or documentation read during this audit, not to assumptions.

---

## 1. The gating question (§29)

> **Can a Privy Starknet embedded wallet sign and submit every invocation required by
> the current STRK20 SDK/proving flow, without modifying the STRK20 protocol?**

**Yes — with one architectural constraint: signing is server-side.**

Evidence chain (all verified in this repo or official docs):

1. **The STRK20 SDK's only signing requirement is a starknet.js `SignerInterface`.**
   `vendor/starknet-privacy-sdk/dist/interfaces.d.ts` defines
   `PrivateTransfersUser = { address: StarknetAddress; signer: SignerInterface }`, and
   the factory comment states explicitly: *"Only `address` and `signer` are read… a minimal
   `{ address, signer }` object [is accepted]. For smart wallets … supply a custom `signer`
   implementation."*

2. **The SDK uses only `signer.signTransaction`.** The proof-invocation factory
   (`vendor/.../internal/proof-invocation-factory.js:85`) calls exactly one signer method:
   ```js
   const signature = await user.signer.signTransaction([{ contractAddress: poolAddressHex,
       entrypoint: "compile_actions", calldata: executeViewCalldata }], { walletAddress: poolAddressHex,
       cairoVersion: "1", ...detailsWithNonce });
   ```
   No `signMessage`, no `signDeclareTransaction`, no `signDeployAccountTransaction`.

3. **starknet.js `Signer.signTransaction` only touches the private key in `signRaw`.**
   `node_modules/starknet/dist/index.js:10285` shows `signTransaction` computes the hash with
   `calculateInvokeTransactionHash2` and then returns `this.signRaw(msgHash)`. Everything except
   `signRaw` is deterministic and key-independent.

4. **Privy exposes exactly `signRaw`-equivalent functionality.** Privy supports Starknet as a
   *Tier 2* chain; the server SDK signs a **raw hash** with
   `privy.wallets().rawSign(walletId, { params: { hash } })` returning `{ signature }`
   (Starknet docs: `docs.starknet.io/build/starkzap/integrations/privy`; Privy:
   `docs.privy.io/recipes/use-tier-2`). This is precisely the primitive `Signer.signRaw`
   needs.

5. **starknet.js `Account` accepts a `SignerInterface`** (`AccountOptions.signer:
   Uint8Array | string | SignerInterface`, `index.d.ts:2384`), so a Privy-backed signer
   produces a full `Account` with `.execute()` for submission.

6. **The account class is Ready (Argent) v0.5.0** (`argentXV050`) — a standard smart account
   whose `__validate__` checks a STARK-curve ECDSA signature over the transaction hash. The
   SDK's V3 proof invocation (nonce 0, `skipValidate`, zero-priced resource bounds) is a
   *prover-facing* transaction: the prover verifies the signature against the user's account
   public key, which Privy's wallet key satisfies.

### 1.1 The constraint that shapes the design

Privy does **not** expose the private key to the client, and does **not** have a first-class
client-side Starknet `signTransaction` RPC today. Signing must round-trip through **your own
backend endpoint**, which calls `PrivyClient.wallets().rawSign(walletId, { params: { hash } })`.

This is **not** an incompatibility with STRK20 — it is the standard Privy Starknet pattern. It
does, however, mean the signer has an **async server dependency** and must be treated as a
network boundary (see the Security Model).

### 1.2 What remains to verify against the live Privy API

Two wire-format details cannot be proven from documentation alone and are flagged for a
one-hour spike against a real Privy app + funded Sepolia account:

- **Raw-signature byte format** for Starknet (`rawSign` return: single `0x<r||s>` hex string,
  `[r,s]` array, or `{r,s}` object). The signer below ships a defensive normalizer for all three.
- **Public-key format** on the wallet record (`public_key` vs `publicKey`, hex prefixing).

These are format questions, not feasibility questions. The `normalizePrivySignature` /
`normalizeStarkPublicKey` helpers centralize them so a fix is a one-line change.

---

## 2. Compatibility matrix (§26)

| Component                | Required | Privy support                              | STRK20 support                       | PEL work |
| ------------------------ | -------- | ------------------------------------------ | ------------------------------------ | -------- |
| Starknet embedded wallet | Yes      | **Verified** (Tier 2, `chain_type:"starknet"`) | N/A                                  | Adapter |
| Arbitrary invoke signing | Yes      | **Verified** (`rawSign` over a tx hash)    | Required                             | Adapter |
| STRK20 SDK               | Yes      | N/A                                        | **Yes** (vendored v0.14.3-rc.5)      | Integration |
| Viewing keys             | Yes      | Separate (Privy ≠ viewing key)             | **Yes** (`ViewingKeyProvider`)       | Storage (PEL) |
| Note discovery           | Yes      | N/A                                        | **Yes** (`IndexerDiscoveryProvider`) | Integration |
| Prover                   | Yes      | N/A                                        | **Yes** (`ProvingServiceProofProvider`) | Provider |
| CallAndProof             | Yes      | **Verified** (signer covers the invoke)    | **Yes**                             | Adapter |
| Transaction submission   | Yes      | **Verified** (via `Account.execute` on RPC) | **Yes**                             | Integration |
| Paymaster / gas          | Pref.    | **Verified** (AVNU paymaster path exists)  | Determine (pool-mediated fees)       | Integration |
| Private history          | Yes      | N/A                                        | **Yes** (`buildHistoryCursor`)       | UI/state |
| Recovery                 | Yes      | Partial (embedded wallet recovery = Privy login) | Determine (viewing-key derivation) | Design |

---

## 3. Privy API map (Starknet-relevant)

| Concern | API | Source |
| ------- | --- | ------ |
| Auth / identity | `@privy-io/react-auth` `PrivyProvider`, `usePrivy`, `useWallets` | docs.privy.io |
| Server client | `PrivyClient({ appId, appSecret })` from `@privy-io/node` / `@privy-io/server-auth` | starknet.io Privy guide |
| Create wallet | `privy.wallets().create({ chain_type:"starknet", user_id? })` → `{ id, address, public_key }` | starknet.io Privy guide |
| Read wallet | `privy.wallets().get(id)` | Privy server SDK |
| Raw sign | `privy.wallets().rawSign(walletId, { params: { hash } })` → `{ signature }` | starknet.io Privy guide |
| Account class | Ready / Argent v0.5.0 (`argentXV050`) | starknet.io "connecting-wallets" |
| Gasless | AVNU paymaster (SNIP-29) optional | starknet.io "connecting-wallets" |

Client-side the signer needs **three values**, all obtainable from your backend after login:
`walletId`, `publicKey`, and a `serverUrl` that performs `rawSign`.

---

## 4. STRK20 SDK API map (vendored v0.14.3-rc.5)

| Concern | API | File (vendored SDK) |
| ------- | --- | ------------------- |
| Factory | `createPrivateTransfers({ account, viewingKeyProvider, provingProvider, discoveryProvider, poolContractAddress })` | `factory.d.ts` |
| Identity | `account: { address, signer: SignerInterface }` | `interfaces.d.ts:28` |
| Viewing key | `ViewingKeyProvider.getViewingKey(): Promise<ViewingKey>` | `interfaces.d.ts:87` |
| Actions | `deposit` / `withdraw` / `transfer` / `useNotes` / `createNotes` / `computeAndInvoke` | `interfaces.d.ts:205` |
| Discovery | `discoverNotes` / `discoverChannels` / `discoverRequirement` | `interfaces.d.ts:363-391` |
| Prover | `ProofProviderInterface.prove(invocation, blockId): Promise<Proof>` | `interfaces.d.ts:651` |
| Proof | `{ data, output, proofFacts, additionalData }` | `interfaces.d.ts:64` |
| CallAndProof | `{ call: Call, proof: Proof }` | `interfaces.d.ts:79` |
| Result | `execute(actions, opts): Promise<{ callAndProof, registry, warnings }>` | `interfaces.d.ts:394` |
| History | `buildHistoryCursor`, `classifyTransaction` | `index.d.ts` |
| Prover config | `{ url, chainId, requestTimeoutMs?, ohttp?, retry? }` | `interfaces.d.ts:94` |
| Discovery config | `{ url }` | `interfaces.d.ts:121` |

**Signing surface consumed by the SDK:** exactly `SignerInterface.signTransaction` (and,
optionally in PEL's `strk20SdkService`, `signer.getPubKey` for viewing-key derivation — but the
viewing key should be a *separate* key per §6 of the mission).

---

## 5. Signer-interface comparison

`starknet.js` `SignerInterface` (required by the SDK):

```
getPubKey(): Promise<string>
signMessage(typedData, accountAddress): Promise<Signature>
signTransaction(calls, details): Promise<Signature>
signDeployAccountTransaction(details): Promise<Signature>
signDeclareTransaction(details): Promise<Signature>
```

Privy provides, server-side, the primitive that backs all of these:

```
rawSign(walletId, { params: { hash } }): Promise<{ signature }>   // STARK-curve ECDSA over `hash`
```

Mapping:

| SignerInterface method | Privy equivalent | Used by STRK20 SDK? |
| --------------------- | ---------------- | ------------------- |
| `getPubKey` | wallet record `public_key` | No (PEL uses a separate viewing key) |
| `signTransaction` | `rawSign` over `calculateInvokeTransactionHash2(...)` | **Yes** (only this) |
| `signMessage` | `rawSign` over `getMessageHash(...)` | No |
| `signDeployAccountTransaction` | `rawSign` over deploy hash | No (account deployed separately) |
| `signDeclareTransaction` | `rawSign` over declare hash | No |

**Conclusion:** every method is satisfiable by `rawSign` over the appropriate hash. The SDK needs
only `signTransaction`, which maps 1:1.

---

## 6. Exact incompatibilities (and their resolution)

| # | Incompatibility | Resolution |
| - | --------------- | ---------- |
| 1 | Privy has no client-side private key; `Signer` normally holds `pk` | Subclass `Signer`, override `signRaw` (and `getPubKey`) to delegate to the server |
| 2 | Privy signs server-side; signer becomes async/networked | Introduce a `signHash(walletId, hash)` client + `/api/privy/sign` route |
| 3 | Privy's raw signature wire format is not `[r,s]` guaranteed | `normalizePrivySignature` handles hex-string / array / object |
| 4 | Privy `Account.execute` fee estimation must run client-side over RPC | `StarknetAccountAdapter` wraps starknet.js `Account` (provider + Privy signer) |
| 5 | Privy ≠ STRK20 viewing key | Viewing key derived/stored **separately** by PEL's privacy layer |
| 6 | STRK20 SDK's `execute()` returns a call; submission is PEL's job | Adapter submits `callAndProof` via the Privy-backed `Account.execute` |

---

## 7. The smallest adapter (§29, second question)

### 7.1 `StarknetPrivySigner` (the only real "new" type)

```ts
import { Signer } from "starknet";

export interface PrivySigningClient {
  signHash(walletId: string, hashHex: string): Promise<unknown>; // raw Privy signature
}

export class StarknetPrivySigner extends Signer {
  constructor(
    private readonly walletId: string,
    private readonly publicKey: string,
    private readonly client: PrivySigningClient,
  ) {
    super(); // placeholder pk; getPubKey/signRaw are both overridden
  }
  async getPubKey(): Promise<string>;                       // returns normalized public key
  protected async signRaw(msgHash: string): Promise<Signature>; // client.signHash → normalize
}
```

### 7.2 `StarknetAccountAdapter`

```ts
export class StarknetAccountAdapter {
  static async create(opts: {
    address: string; walletId: string; publicKey: string;
    client: PrivySigningClient; provider: RpcProvider; cairoVersion?: CairoVersion;
  }): Promise<Account>;   // new Account({ provider, address, signer: new StarknetPrivySigner(...) })
}
```

### 7.3 `PrivyStrk20Adapter`

```ts
export class PrivyStrk20Adapter {
  constructor(cfg: {
    poolContractAddress: string; chainId: constants.StarknetChainId;
    proverUrl: string; discoveryUrl: string;
  });

  getPrivateTransfers(user: PrivyStrk20User): Promise<PrivateTransfersInterface>;
  register(user): Promise<Strk20ExecuteReceipt>;
  shield(user, token, amountBase): Promise<Strk20ExecuteReceipt>;
  unshield(user, token, amountBase): Promise<Strk20ExecuteReceipt>;
  transfer(user, token, amountBase, recipient): Promise<Strk20ExecuteReceipt>;
  getPrivateBalance(user, token): Promise<bigint>;
  submit(user, callAndProof): Promise<Strk20ExecuteReceipt>; // via Privy-backed Account.execute
}

export interface PrivyStrk20User {
  account: AccountInterface;         // Privy-backed Account (from StarknetAccountAdapter)
  address: string;
  viewingKey: bigint;                // SEPARATE from Privy — owned by PEL
}
```

`submit` is the only place Privy actually submits a proof-bearing transaction; the SDK's
`execute()` result (`callAndProof`) flows through `Account.execute(call, { proofFacts, proof })`
exactly as the existing `strk20SdkService.submit` does today.

---

## 8. Verdict

Privy + STRK20 are compatible. The STRK20 SDK was deliberately designed for exactly this
split (minimal `{ address, signer }` identity + separate `ViewingKeyProvider`). Privy's
server-side `rawSign` implements the single signer method the SDK consumes. The adapter is
one `Signer` subclass plus a thin `Account`/`PrivateTransfers` wiring layer.
