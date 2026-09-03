# WHAT WE HAVE DONE SO FAR — Privacy Infrastructure Investigation Appendix

> **Chronological record of the STRK20 privacy infrastructure work, live debugging, experiments, failures, confirmed fixes, and current blocker.**
>
> This appendix is intentionally factual. It records what was actually tested and what was actually proven. It does not mark unresolved protocol behavior as solved.

---

## 1. Goal and Target Architecture

The product target remains **public Starknet Sepolia now**, followed by a **mainnet deployment later**. The Wallet API lane and Privy lane are intentionally kept separate.

### Wallet API lane

```text
Dapp
  -> Wallet API
  -> Ready / wallet-provider privacy execution
  -> STRK20
```

### Privy lane

```text
Dapp
  -> Privy embedded Starknet wallet
  -> derived Ready account
  -> STRK20 Privacy SDK
  -> Starknet RPC
  -> STRK20 proving service
  -> discovery service
```

The goal is a real privacy wallet flow covering registration, shielding, private balance, note discovery, private send/receive, and unshielding. The public chain target is `SN_SEPOLIA`; the later production target is `SN_MAIN`.

---

## 2. Running the Privacy Prover and Discovery Infrastructure

### EC2 deployment

A dedicated EC2 operator environment was created under:

```text
~/strk20-privacy-wallet/infra/strk20-operator
```

The operator stack was built around three services:

```text
pathfinder
prover
 discovery-service
```

The project eventually ran custom containers for the prover and discovery service so the privacy stack could be operated independently from public third-party proving/discovery infrastructure.

### Public service endpoints

The running operator exposes:

```text
https://prover.orrange.xyz
https://discovery.orrange.xyz
```

DNS was later moved to the replacement EC2 public IP:

```text
3.110.50.64
```

Both DNS records were verified from the developer machine and resolved to the new instance.

### CORS

The prover endpoint was configured through Caddy to permit the deployed Vercel origin:

```text
https://strk20-privacy-wallet.vercel.app
```

The preflight check was verified to return `204` and include the expected `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers` headers.

---

## 3. First Prover Failure: Illegal CPU Instruction

The initial privacy prover container exited with:

```text
exit=132
```

Kernel logs showed:

```text
trap: invalid opcode
```

The prover binary contained AVX-512 instructions including `vpermi2b`, `vpermt2b`, `vpermi2w`, `vpermt2w`, and `vpternlog*`. A direct host test also confirmed AVX-512 VBMI instructions could execute on the host when explicitly requested, but the prebuilt prover binary was using a CPU-specific instruction set that was not safe for the original runtime configuration.

The Starknet sequencer build system was inspected and confirmed to support:

```text
-C target-cpu=<CPU>
```

The transaction prover was therefore rebuilt from the matching Starkware sequencer source at the privacy release commit, using:

```text
--target-cpu haswell
```

The rebuilt image was:

```text
strk20-prover-haswell:rc2
```

The rebuilt binary no longer contained the problematic `vpermi2b` / `vpermt2b` sequence in the same way, and the prover successfully started on the EC2 machine.

---

## 4. Second Prover Failure: Memory Exhaustion

After the CPU issue was removed, the prover reached real transaction proving but was killed during Cairo proof generation.

The container exited with:

```text
exit=137
OOMKilled=true
```

The kernel recorded an OOM event with approximately:

```text
14.7 GiB anonymous RSS
16.9 GiB total virtual memory
```

At the time the EC2 instance had only about 15 GiB RAM and initially no usable swap.

A 32 GiB swapfile was subsequently enabled, but this was treated as a mitigation rather than the final solution.

The instance was upgraded to:

```text
r7i.2xlarge
```

providing approximately 61 GiB usable RAM to the operating system.

The resulting prover process was observed using roughly 12 GiB RSS during proof generation while the machine remained stable. This removed the previous OOM failure mode.

---

## 5. First Successful End-to-End Real Proof Generation

After the CPU rebuild and memory upgrade, the custom Haswell prover successfully completed real privacy proofs.

A representative successful run showed:

```text
Starting transaction proving
OS execution completed
Generate the cairo proof
Prepare the cairo proof for the cairo-circuit verifier
Build the cairo-circuit verifier context
Prove the cairo-circuit verifier
Prepare the circuit proof for the circuit verifier
Serialize and compress the proof
Proving completed
prove_transaction completed
```

The successful proving time was roughly 20–30 seconds depending on the run, with the final stable runs around 20 seconds.

This proved that:

```text
Privacy transaction input
  -> private bootloader
  -> Cairo proof
  -> recursive/circuit proof
  -> serialized compressed proof
```

works on the self-hosted prover.

The prover is therefore **not currently the primary blocker**.

---

## 6. Privy Account Deployment and On-Chain Funding

A Privy-derived Ready Starknet account was deployed on public Starknet Sepolia.

The account address used throughout the investigation is:

```text
0x05df7811d293190dca0e180fe03023f520658ceaf5a6ad999603741e51266c42
```

The address was independently verified in Voyager and through direct Starknet RPC calls.

Its class hash was verified as:

```text
0x36078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f
```

The account's public STRK balance was independently verified through direct `balanceOf` calls against a working Sepolia RPC as approximately:

```text
99.954688 STRK
```

Voyager independently showed the same deployed account and balance, including the `DEPLOY_ACCOUNT` transaction.

This established that the account, deployment, and public funds are real on public Sepolia.

---

## 7. RPC Investigation

Several RPC endpoints were tested because the privacy flow requires modern RPC support as well as correct Sepolia chain state.

### Lava

The bare Lava endpoint was tested and initially reported a modern RPC spec, but direct calls against the exact Privy account returned inconsistent state:

```text
starknet_getClassHashAt -> Contract not found
balanceOf -> 0
```

while Voyager and Alchemy showed the account as deployed and funded.

Lava was therefore not selected as the application's Privy RPC.

### Vauban

The versioned Vauban endpoint:

```text
https://sepolia.rpc.vauban.tech/rpc/v0_10
```

was tested directly and returned:

```text
starknet_specVersion -> 0.10.3-rc.0
```

It also returned the correct deployed class hash and approximately 99.95 STRK balance.

However, browser requests were blocked because the endpoint did not return the required CORS header for the Vercel origin. Vauban was therefore not used directly by the browser.

### Alchemy

The existing EC2 Alchemy Sepolia endpoint was tested directly and returned:

```text
correct deployed account class hash
correct ~99.95 STRK public balance
```

The same endpoint was also tested from the developer machine with an OPTIONS preflight and returned the required browser CORS headers.

The application therefore returned to the existing Alchemy `v0_10` endpoint rather than introducing a new `rpc.orrange.xyz` proxy.

---

## 8. Privy Submission Bug: Detached `Account.execute()`

After the prover started working, the Privy transaction submission path exposed a separate JavaScript bug.

The adapter did effectively:

```ts
const execute = user.account.execute as ...;
await execute(call, details);
```

This detached the `Account.execute` method from its `Account` instance. Starknet.js internally uses `this.prepareInvoke`, so the detached call eventually failed because `this` was undefined.

The fix was:

```ts
const execute = user.account.execute.bind(user.account) as ...;
```

The fix was committed and pushed as:

```text
0017979
```

Verification performed at that point included:

```text
TypeScript typecheck clean
Next.js production build successful
75/75 tests passing
```

This was a real application-side bug and is considered resolved.

---

## 9. Fee Estimation Bug: Real Proof Was Being Sent to `estimateFee`

The first working proof run revealed another concrete bug.

The Privy adapter generated the real proof correctly, then passed the real `proof` plus `proofFacts` into `Account.execute()` without `resourceBounds`.

Starknet.js consequently entered its normal fee-estimation path and sent the real proof-bearing transaction through `starknet_estimateFee`.

That failed.

The adapter was changed to follow the Privacy SDK's intended separation:

```text
1. simulate with mock proof
2. estimate fee from mock proof facts
3. obtain resource bounds
4. execute using the real proof + real proof facts + resource bounds
```

The new implementation also added stage instrumentation and full fee-estimation logging.

A dedicated test was added to ensure:

```text
simulate happens before execute
fee estimation contains proofFacts but no real proof blob
real execution contains resourceBounds + real proofFacts + real proof
```

This change was deployed and the test surface reached 76 passing tests.

---

## 10. Current Hard Blocker: `PROOF0` Protocol Rejection During Fee Estimation

The next run produced the exact RPC error:

```text
Invalid proof facts: Proof version 88314448135728 (PROOF0) is not allowed under this protocol version.
```

The request had:

```text
proofFactsCount = 9
proofBlobPresent = false
proofFacts[0] = 0x50524f4f4630
```

`0x50524f4f4630` is the felt representation of:

```text
PROOF0
```

This was reproduced against:

```text
Alchemy public Sepolia
Lava public Sepolia
self-hosted Pathfinder v0.22.7 configured as sepolia-testnet
```

All returned the same protocol-level rejection during `starknet_estimateFee`.

Therefore the current blocker is **not browser CORS, not Privy signing, not the prover CPU, and not prover memory**.

The failing path is:

```text
Privy SDK
  -> mock proof / proofFacts generation
  -> starknet_estimateFee
  -> execution-layer PROOF0 validation
  -> rejected
  -> real prover is never called on these failing runs
```

This is also why the Haswell prover logs are sometimes completely quiet: the request fails before reaching the proving service.

---

## 11. Self-Hosted Pathfinder Investigation

The repository's operator compose configuration contains:

```text
image: eqlabs/pathfinder:v0.22.7
PATHFINDER_NETWORK=sepolia-testnet
PATHFINDER_STORAGE_STATE_TRIES=10000
PATHFINDER_HTTP_RPC_ENDPOINT=0.0.0.0:9545
PATHFINDER_WEBSOCKET_ENABLED=true
```

Pathfinder was not initially running. It was then started directly from the operator compose file.

The container came up successfully with:

```text
RPC server started on [::]:9545
```

The node reported:

```text
version = v0.22.7
RPC spec = 0.10.3-rc.0
```

At the time of the test the local Pathfinder state was only around block `117277`, so `Contract not found` for the newly deployed Privy account was expected because the node had not synced to the current public Sepolia head.

However, the critical proof-facts test was still run directly against the local Pathfinder RPC.

Result:

```text
starknet_estimateFee(PROOF0)
-> code 41
-> PROOF0 is not allowed under this protocol version
```

This proved that simply running Pathfinder v0.22.7 as ordinary `sepolia-testnet` does not solve the PROOF0 fee-estimation problem.

Pathfinder itself is therefore not being exposed publicly at this stage.

---

## 12. Starknet Privacy SDK RC5 Research

The official Starknet Privacy repository was cloned and checked out at:

```text
PRIVACY-0.14.3-RC.5
commit 66e3caae8c0201227a6719696d004e30d90aea65
```

Important findings from the RC5 source:

### RC5 continues to use PROOF0

The SDK's proof-facts implementation explicitly defines:

```text
proofFacts[0] = PROOF0
proofFacts[1] = VIRTUAL_SNOS
proofFacts[3] = VIRTUAL_SNOS0
```

Therefore upgrading the SDK does **not** mean the proof version disappears. PROOF0 remains part of the intended Privacy protocol.

### RC5 explicitly supports `SN_SEPOLIA`

The RC5 repository contains multiple SDK/e2e test paths using:

```text
constants.StarknetChainId.SN_SEPOLIA
```

including `CallMockProofProvider`, screening tests, smoke tests, discovery/payment-service tests, and browser/devnet testing helpers.

This is important because the target product is intentionally remaining on **public Starknet Sepolia**.

### RC5 changed mock proof construction

RC5's `CallMockProofProvider` now constructs the mock proof by simulating a real invocation and requires a node channel that supports `simulateTransaction`.

The SDK source explicitly states that a node whose channel supports `simulateTransaction` is required by this provider.

This makes the exact mock-proof / simulation path an important next research target.

### RC5 prover image availability

The attempted container pull:

```text
ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.5
```

returned `not found`.

The corresponding RC5 discovery image **does** exist and was successfully pulled.

The RC5 release commit itself contains only SDK package/changelog changes, so the currently proven self-hosted RC2 transaction prover should **not** be discarded or replaced blindly.

---

## 13. Current Verified Infrastructure State

### Working

```text
Privy-derived Sepolia account            ✅
Account deployment                      ✅
Public STRK funding                     ✅
Alchemy Sepolia reads                   ✅
Browser CORS to Alchemy                 ✅
Discovery service                       ✅
Prover public endpoint                  ✅
Haswell prover binary                   ✅
Haswell prover proof generation         ✅
CPU compatibility issue                ✅ resolved
Original prover OOM                     ✅ resolved with larger instance
Detached Account.execute bug            ✅ fixed
Real-proof fee-estimation bug           ✅ fixed in adapter
Wallet API / Privy lane separation     ✅ retained
```

### Not yet working end-to-end

```text
Private receiving registration         ⏳
Private balance                        ⏳
Shield / deposit                       ⏳
Discovery of private notes              ⏳
Private transfer                        ⏳
Private receive                         ⏳
Unshield / withdraw                     ⏳
```

### Current hard blocker

```text
Public Sepolia estimateFee
        +
STRK20 PROOF0 proof facts
        ↓
PROOF0 rejected by execution protocol
```

---

## 14. Current Technical Question

The remaining investigation is now narrowly defined:

> **What exact Starknet Sepolia node/protocol configuration is required for the current Starknet Privacy SDK's `CallMockProofProvider` / PROOF0 fee-estimation path to work against public `SN_SEPOLIA`?**

The existing evidence establishes that:

1. PROOF0 is still the intended Privacy proof-facts version.
2. The Privacy SDK explicitly supports `SN_SEPOLIA` in its test code.
3. The current generic public Sepolia RPCs tested so far reject PROOF0 at execution/protocol validation during fee estimation.
4. Ordinary Pathfinder `v0.22.7` configured as `sepolia-testnet` reproduces the same rejection.
5. The RC5 SDK introduced a more explicit `simulateTransaction`-based mock-proof path, which now needs to be reproduced against an appropriate Sepolia node.

No claim is made here that the public Sepolia protocol is impossible for Privacy. That remains an unresolved compatibility question that must be settled by reproducing the official SDK's Sepolia simulation path or identifying the exact compatible Starknet node configuration.

---

## 15. Next Investigation Plan

### A. Reproduce the official RC5 `CallMockProofProvider` flow on `SN_SEPOLIA`

Run the upstream RC5 simulation path directly and record:

```text
node type
RPC version
simulateTransaction response
proofFacts generated
estimateFee response
```

### B. Compare RC2 and RC5 mock proof facts

Determine whether the generated facts differ materially in:

```text
proof version
program variant
Starknet OS output version
base block
L2->L1 message hash
```

### C. Determine the exact compatible Sepolia execution environment

Do not switch the product to `SN_INTEGRATION_SEPOLIA` merely to hide the problem. The product target remains public `SN_SEPOLIA`.

### D. Only after protocol compatibility is proven, wire the final Privy-lane RPC

The Wallet API lane remains separate and unchanged.

### E. Re-run the complete lifecycle

```text
register
-> shield/deposit
-> discover notes
-> private balance
-> private transfer
-> receive
-> unshield
```

---

## 16. Important Lessons From the Investigation

### The prover is not the same thing as the execution environment

A transaction prover can successfully generate a proof while the Starknet execution node rejects the proof facts before the prover is even reached on the next request.

### RPC API version is not equivalent to Privacy protocol support

A node reporting RPC `0.10.x` can still reject `PROOF0` at execution time. API compatibility and protocol compatibility must be tested separately.

### Browser CORS and protocol compatibility are separate failure classes

CORS caused one earlier failure with Vauban. The current Alchemy failure is different and occurs inside `starknet_estimateFee` with a concrete protocol error.

### Fee estimation and real proof generation must be separated

Sending the real proof into the normal `estimateFee` path was a confirmed application integration bug. The corrected path estimates using mock proof facts and submits the real proof with calculated resource bounds.

### Do not paper over protocol errors with hardcoded fees

A fee result from another network cannot simply be copied into a target-chain proof transaction and be considered equivalent. Proof facts contain chain-sensitive data such as base-block information and L2-to-L1 message information, and the on-chain privacy protocol validates them.

---

## 17. Current Status

**The self-hosted infrastructure is materially operational.** The custom discovery service is reachable, the custom Haswell transaction prover successfully generates complete privacy proofs, the Privy-derived Sepolia account is deployed and funded, the browser can reach the chosen Alchemy Sepolia RPC, and multiple concrete frontend bugs have been fixed.

**The remaining blocker is protocol compatibility for the STRK20 `PROOF0` fee-estimation path on the public Sepolia execution environment.** The next step is to reproduce the official Privacy SDK's current Sepolia simulation path and identify the exact execution-node capability/configuration required for PROOF0 acceptance.

---

## Appendix: Key Commits Referenced During Investigation

```text
0017979  Privy account.execute binding fix
8f61ab2  fee-estimation / mock-proof submission-path work
```

The infrastructure versions currently proven in the investigation are:

```text
Transaction prover: PRIVACY-0.14.3-RC.2
Discovery:           PRIVACY-0.14.3-RC.2 (with a later RC5 image also tested)
Pathfinder:          eqlabs/pathfinder:v0.22.7
Target network:      SN_SEPOLIA
Current public RPC:  Alchemy Starknet Sepolia v0_10
EC2 instance:        r7i.2xlarge
```

> **This appendix is a point-in-time engineering record.** The protocol-compatibility conclusion should be updated immediately when the RC5/Sepolia simulation experiment produces a definitive result.
