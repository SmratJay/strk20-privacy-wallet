import type { AccountInterface, Call, ProviderInterface, ResourceBoundsBN } from "starknet";
import { constants } from "starknet";
import {
  ensurePrivacyPoolAllowance,
  readPoolFee,
  STRK_TOKEN_ADDRESS,
  type ApprovalStatus,
} from "./allowance";

export interface Strk20User {
  account: AccountInterface;
  address: string;
  viewingKey: bigint;
}

export interface Strk20AdapterConfig {
  poolContractAddress: string;
  chainId: constants.StarknetChainId;
  proverUrl: string;
  discoveryUrl: string;
  /** STRK fee token the pool charges per apply_actions. Defaults to the canonical STRK address. */
  feeTokenAddress?: string;
  /** UX callback fired while the STRK allowance prerequisite is being handled. */
  onApprovalStatus?: (status: ApprovalStatus) => void;
}

export interface Strk20ExecuteReceipt {
  transactionHash: string;
  status: "PENDING" | "SUCCESS" | "REVERTED" | "REJECTED";
  explorerUrl: string;
  warnings: unknown[];
}

interface ShieldedNote {
  amount: bigint;
  [key: string]: unknown;
}

interface CallAndProofLike {
  call: Call;
  proof?: { proofFacts?: string[]; data?: string };
}

interface ExecuteResultLike {
  callAndProof: CallAndProofLike;
  warnings?: unknown[];
}

interface TokenOpsLike {
  deposit(...inputs: unknown[]): unknown;
  withdraw(...outputs: unknown[]): unknown;
  transfer(...outputs: unknown[]): unknown;
  inputs(...notes: unknown[]): unknown;
  surplusTo(recipient: string, withdraw?: boolean): unknown;
}

interface InvokeCalldataArgsLike {
  openNotes: { noteId: bigint }[];
  withdrawals: unknown[];
  poolAddress: bigint;
}

interface BuilderLike {
  with(token: string, ops: (t: TokenOpsLike) => void): BuilderLike;
  register(): BuilderLike;
  surplusTo(recipient: string, withdraw?: boolean): BuilderLike;
  /** Add a `privacy_invoke` call on an executor (anonymizer) that runs after the private ops. */
  invoke(callBuilder: (args: InvokeCalldataArgsLike) => unknown): BuilderLike;
  execute(options?: Record<string, unknown>): Promise<ExecuteResultLike>;
  /** SDK fee-simulation: mock proof via CallMockProofProvider, no real proof generation. */
  simulate(options: { node: ProviderInterface; validateSignature?: boolean }): Promise<ExecuteResultLike>;
}

interface PrivateTransfersLike {
  build(options?: Record<string, unknown>): BuilderLike;
  discoverNotes(params?: { tokens?: string[] }): Promise<{
    notes: Map<bigint, ShieldedNote[]>;
  }>;
  /** SDK readiness check (preflight) → SetupRequirement numeric enum: 0 = Register. */
  discoverRequirement(recipient: string, token: string): Promise<number>;
}

type CreatePrivateTransfersFn = (params: Record<string, unknown>) => PrivateTransfersLike;

/**
 * Wallet Core — STRK20 privacy adapter (generic).
 *
 * Consumes a generic STRK20 user: a starknet.js account/signer (e.g. a Wallet Core
 * `UnlockedWallet.account`) plus the wallet-native viewing key. No Privy, no external wallet,
 * no Wallet API. `PrivyStrk20Adapter` (legacy) aliases this class.
 *
 * STRK20 account validation rejects a proof whose block is too recent ("The proof block number X
 * is too recent. The maximum allowed block number is Y."). Proving against `latest` races that
 * validation headroom (observed ~5 blocks), so shields prove against a block a safety margin
 * behind the current chain head. Sepolia blocks are produced in seconds, so a 10-block margin is
 * a short real-time window while remaining comfortably older than the observed validation gap.
 */
const PROVING_SAFETY_MARGIN = 10;

/**
 * DEVELOPMENT-ONLY DIAGNOSTIC LOGGER.
 *
 * Privacy operations are sensitive: they involve the wallet's address, viewing key, private notes,
 * proofs, and amounts. NONE of that may appear in production logs. This logger:
 *   - is a no-op when NODE_ENV === "production" (the check is statically inlined by Next.js, so
 *     the logging code is dead-code-eliminated from production bundles);
 *   - is used ONLY for stage-level lifecycle diagnostics — never for keys, notes, proofs, private
 *     balances, secrets, raw calldata, or full prover/discovery URLs.
 */
function isDev(): boolean {
  try {
    return typeof process !== "undefined" && process.env?.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

const DEBUG = isDev();

function debug(...args: unknown[]): void {
  if (!DEBUG) return;
  // eslint-disable-next-line no-console
  console.debug("[Strk20Adapter]", ...args);
}

function debugWarn(...args: unknown[]): void {
  if (!DEBUG) return;
  // eslint-disable-next-line no-console
  console.warn("[Strk20Adapter]", ...args);
}

let createPrivateTransfersFn: CreatePrivateTransfersFn | null = null;
let openNoteSymbol: unknown = null;

async function loadCreatePrivateTransfers(): Promise<CreatePrivateTransfersFn> {
  if (createPrivateTransfersFn) return createPrivateTransfersFn;
  const mod = (await import("@starkware-libs/starknet-privacy-sdk")) as unknown as {
    createPrivateTransfers: CreatePrivateTransfersFn;
  };
  createPrivateTransfersFn = mod.createPrivateTransfers;
  return createPrivateTransfersFn;
}

/** The SDK's `Open` unique symbol — used as `amount` to create an open note that a
 * `privacy_invoke` executor deposit will fill. Cached after first load. */
async function loadOpenNoteSymbol(): Promise<unknown> {
  if (openNoteSymbol) return openNoteSymbol;
  const mod = (await import("@starkware-libs/starknet-privacy-sdk")) as unknown as {
    Open?: unknown;
  };
  openNoteSymbol = mod.Open;
  return openNoteSymbol;
}

/** A private trade through the launchpad's canonical PrivateCurveExecutor. `operation` is the
 * curve op (0 = BUY, 1 = SELL) matching `curve_operation` in the contracts. */
export interface PrivateCurveTradeParams {
  operation: number;
  /** PrivateCurveExecutor bound to this curve. */
  curveExecutor: string;
  /** Input token the pool withdraws to the executor (base for BUY, memecoin for SELL). */
  inputToken: string;
  /** Output token deposited to the user's open note (memecoin for BUY, base for SELL). */
  outputToken: string;
  /** Input amount in smallest units. */
  amount: bigint;
}

export class Strk20Adapter {
  private readonly config: Strk20AdapterConfig;
  private transfersCache = new Map<string, PrivateTransfersLike>();

  constructor(config: Strk20AdapterConfig) {
    this.config = config;
    debug("adapter initialized", { chainId: config.chainId, rpc: "per-account" });
  }

  /**
   * Cache a private-transfers context per (address + full STRK20 context). The key includes the
   * chain id, pool, prover, discovery, and fee token so a cached context can NEVER be reused across
   * incompatible networks/pools/configurations (a wrong-network private-transfers context would
   * silently discover/prove against the wrong deployment).
   */
  private cacheKey(user: Strk20User): string {
    return [
      this.config.chainId,
      this.config.poolContractAddress.toLowerCase(),
      this.config.proverUrl.toLowerCase(),
      this.config.discoveryUrl.toLowerCase(),
      (this.config.feeTokenAddress ?? STRK_TOKEN_ADDRESS).toLowerCase(),
      user.address.toLowerCase(),
    ].join("|");
  }

  async getTransfers(user: Strk20User): Promise<PrivateTransfersLike> {
    const key = this.cacheKey(user);
    const existing = this.transfersCache.get(key);
    if (existing) return existing;

    const createPrivateTransfers = await loadCreatePrivateTransfers();
    const transfers = createPrivateTransfers({
      account: { address: user.address, signer: user.account.signer },
      viewingKeyProvider: { getViewingKey: async () => user.viewingKey },
      provingProvider: { url: this.config.proverUrl, chainId: this.config.chainId },
      discoveryProvider: { url: this.config.discoveryUrl },
      poolContractAddress: this.config.poolContractAddress,
    });

    this.transfersCache.set(key, transfers);
    return transfers;
  }

  async register(user: Strk20User): Promise<Strk20ExecuteReceipt> {
    // Prove against a block safely behind the chain head (same rule as shield) so the pool's
    // account validation does not reject the proof as "too recent".
    const provingBlockId = await this.getSafeProvingBlock(user);
    return this.runWithBounds(
      user,
      (t, node) => t.build({ autoRegister: true }).register().simulate({ node }),
      (t) => t.build({ autoRegister: true }).register().execute({ provingBlockId }),
    );
  }

  async shield(user: Strk20User, token: string, amountBase: bigint): Promise<Strk20ExecuteReceipt> {
    // autoSetup: opens the self-channel + STRK subchannel in the same apply_actions proof when
    // missing (protocol requires subchannel_exists before CreateEncNote — SUBCHANNEL_NOT_FOUND).
    const opts = { autoSetup: true, autoDiscover: { notes: "refresh", channels: "refresh" } };
    // Prove against a block safely behind the current chain head so account validation does not
    // reject the proof as "too recent" (do NOT prove against `latest`).
    const provingBlockId = await this.getSafeProvingBlock(user);
    debug("shield starting", { provingBlockId });
    return this.runWithBounds(
      user,
      (t, node) =>
        t.build(opts).with(token, (x) => x.deposit({ amount: amountBase })).surplusTo(user.address).simulate({ node }),
      (t) =>
        t
          .build(opts)
          .with(token, (x) => x.deposit({ amount: amountBase }))
          .surplusTo(user.address)
          .execute({ provingBlockId }),
      // A shield pulls the deposit amount (transferFrom) + the STRK pool fee from the account.
      { depositToken: token, depositAmount: amountBase },
    );
  }

  async unshield(user: Strk20User, token: string, amountBase: bigint): Promise<Strk20ExecuteReceipt> {
    const opts = {
      autoSetup: true,
      autoDiscover: { notes: "refresh", channels: "refresh" },
      autoSelectNotes: "naive",
    };
    const provingBlockId = await this.getSafeProvingBlock(user);
    return this.runWithBounds(
      user,
      (t, node) =>
        t.build(opts).with(token, (x) => x.withdraw({ amount: amountBase })).surplusTo(user.address).simulate({ node }),
      (t) =>
        t.build(opts).with(token, (x) => x.withdraw({ amount: amountBase })).surplusTo(user.address).execute({ provingBlockId }),
    );
  }

  /**
   * Private trade on a launchpad BondingCurve through its canonical PrivateCurveExecutor —
   * the Privy-lane equivalent of the Ready wallet's STRK20 invoke actions:
   *   1. withdraw input token → executor          (pool pays the executor)
   *   2. transfer output token → OPEN note        (open-note deposit for the user)
   *   3. invoke(executor, privacy_invoke)         (executor trades on the public curve)
   * The pool fills the open note from the executor's returned `OpenNoteDeposit`.
   */
  async privateTrade(
    user: Strk20User,
    params: PrivateCurveTradeParams,
  ): Promise<Strk20ExecuteReceipt> {
    const open = await loadOpenNoteSymbol();
    if (open == null) throw new Error("STRK20 SDK did not expose the Open-note symbol.");
    const provingBlockId = await this.getSafeProvingBlock(user);
    return this.runWithBounds(
      user,
      (t, node) => this.buildCurveTrade(t, params, user.address, open).simulate({ node }),
      (t) => this.buildCurveTrade(t, params, user.address, open).execute({ provingBlockId }),
    );
  }

  private buildCurveTrade(
    t: PrivateTransfersLike,
    params: PrivateCurveTradeParams,
    recipient: string,
    open: unknown,
  ): BuilderLike {
    const opts = {
      autoSetup: true,
      autoDiscover: { notes: "refresh", channels: "refresh" },
      autoSelectNotes: "naive",
    };
    return t
      .build(opts)
      .with(params.inputToken, (x) =>
        x.withdraw({ recipient: params.curveExecutor, amount: params.amount }),
      )
      .with(params.outputToken, (x) => x.transfer({ recipient, amount: open }))
      .invoke(({ openNotes }) => ({
        contractAddress: params.curveExecutor,
        entrypoint: "privacy_invoke",
        calldata: [params.operation, params.inputToken, params.amount, openNotes[0]?.noteId ?? 0n],
      }))
      .surplusTo(recipient);
  }

  async transfer(
    user: Strk20User,
    token: string,
    amountBase: bigint,
    recipient: string,
  ): Promise<Strk20ExecuteReceipt> {
    const opts = {
      autoSetup: true,
      autoDiscover: { notes: "refresh", channels: "refresh" },
      autoSelectNotes: "naive",
    };
    const provingBlockId = await this.getSafeProvingBlock(user);
    return this.runWithBounds(
      user,
      (t, node) =>
        t
          .build(opts)
          .with(token, (x) => x.transfer({ recipient, amount: amountBase }))
          .surplusTo(user.address)
          .simulate({ node }),
      (t) =>
        t
          .build(opts)
          .with(token, (x) => x.transfer({ recipient, amount: amountBase }))
          .surplusTo(user.address)
          .execute({ provingBlockId }),
    );
  }

  /**
   * RC5 fee-estimation flow: `simulate()` (CallMockProofProvider, mock proof, PROOF0 proofFacts)
   * → `estimateFee`. On public Sepolia the node's blockifier rejects the PROOF0 proof version
   * ("Proof version PROOF0 is not allowed under this protocol version") for fee estimation, so we
   * fall back to gas-price-derived resource bounds (2x headroom) and submit the real proof directly.
   */
  private async runWithBounds(
    user: Strk20User,
    buildSim: (transfers: PrivateTransfersLike, node: ProviderInterface) => Promise<ExecuteResultLike>,
    buildExec: (transfers: PrivateTransfersLike) => Promise<ExecuteResultLike>,
    allowance?: { depositToken?: string; depositAmount?: bigint },
  ): Promise<Strk20ExecuteReceipt> {
    // The pool charges a STRK fee on every apply_actions call; a shield additionally pulls the
    // deposit amount from the account. Approve before the expensive prover call — an approval +
    // wait here is far cheaper than a ~20s proof that reverts.
    await this.ensureAllowance(user, allowance);

    const transfers = await this.getTransfers(user);
    const node = this.getNode(user);

    debug("runWithBounds stage=simulate start");
    const sim = await buildSim(transfers, node);
    debug("runWithBounds stage=simulate complete");
    let resourceBounds: ResourceBoundsBN;
    try {
      resourceBounds = await this.estimateFee(user, sim.callAndProof.call, sim.callAndProof.proof);
    } catch (err) {
      if (this.isProofVersionRejected(err)) {
        debugWarn("estimateFee rejected the PROOF0 proof version; using gas-price resource bounds.", {
          message: err instanceof Error ? err.message : err,
        });
        resourceBounds = await this.resolveResourceBounds(user);
      } else {
        throw err;
      }
    }

    debug("runWithBounds stage=execute start");
    let result: ExecuteResultLike;
    try {
      result = await buildExec(transfers);
    } catch (err) {
      debug("runWithBounds stage=execute FAILED", { message: err instanceof Error ? err.message : err });
      throw err;
    }
    debug("runWithBounds stage=execute complete");
    return this.submit(user, result, resourceBounds);
  }

  /** True when the node rejected the STRK20 PROOF0 proof version under its protocol. */
  private isProofVersionRejected(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /proof version|not allowed under this protocol version|is not allowed under/i.test(msg);
  }

  /**
   * Compute resource bounds from the current block's gas prices (2x headroom), the way the
   * starkware demo does for public testnets where estimateFee rejects STRK20 proof facts.
   */
  private async resolveResourceBounds(user: Strk20User): Promise<ResourceBoundsBN> {
    const provider = this.getNode(user);
    let l1 = 1n;
    let l2 = 1n;
    let l1Data = 1n;
    try {
      const block = (await provider.getBlockWithTxHashes("latest")) as unknown as {
        l1_gas_price?: { price_in_fri?: unknown };
        l2_gas_price?: { price_in_fri?: unknown };
        l1_data_gas_price?: { price_in_fri?: unknown };
      };
      const toFelt = (v: unknown): bigint => (v != null ? BigInt(String(v)) : 1n);
      l1 = toFelt(block?.l1_gas_price?.price_in_fri) || 1n;
      l2 = toFelt(block?.l2_gas_price?.price_in_fri) || 1n;
      l1Data = toFelt(block?.l1_data_gas_price?.price_in_fri) || 1n;
    } catch {
      // Fall back to defaults; the node still charges actual usage within these caps.
    }
    const l2GasAmount = 1_210_000_000n;
    const l1GasAmount = 1n;
    const l1DataGasAmount = 10_000n;
    debug("resolveResourceBounds", {
      l2GasMaxAmount: l2GasAmount.toString(),
      l1GasMaxAmount: l1GasAmount.toString(),
      l1DataGasMaxAmount: l1DataGasAmount.toString(),
      multiplier: 2,
    });
    return {
      l1_gas: { max_amount: l1GasAmount, max_price_per_unit: l1 * 2n },
      l2_gas: { max_amount: l2GasAmount, max_price_per_unit: l2 * 2n },
      l1_data_gas: { max_amount: l1DataGasAmount, max_price_per_unit: l1Data * 2n },
    };
  }

  async getPrivateBalance(user: Strk20User, token: string): Promise<bigint> {
    const transfers = await this.getTransfers(user);
    const { notes } = await transfers.discoverNotes({ tokens: [token] });
    const tokenNotes = notes.get(BigInt(token)) ?? [];
    return tokenNotes.reduce((sum, n) => sum + n.amount, 0n);
  }

  /**
   * Authoritative on-chain STRK20 registration check: queries the discovery provider's
   * `/v1/sync/preflight_check` for the user's own address and returns whether the viewing key
   * is registered in the pool. `SetupRequirement.Register` (0) means NOT registered; any other
   * value (SetupChannel / SetupToken / Ready) means the viewing key IS registered on-chain.
   */
  async getPrivacyRegistration(
    user: Strk20User,
    token: string,
  ): Promise<"registered" | "unregistered"> {
    const transfers = await this.getTransfers(user);
    const requirement = await transfers.discoverRequirement(user.address, token);
    return requirement === 0 ? "unregistered" : "registered";
  }

  private getNode(user: Strk20User): ProviderInterface {
    const provider = (user.account as unknown as { provider?: ProviderInterface }).provider;
    if (!provider) {
      throw new Error("Account has no RPC provider; cannot run fee estimation.");
    }
    return provider;
  }

  /**
   * Choose the block the SDK proves against for a shield. Reads the current chain head from the
   * account's existing RPC provider and steps back PROVING_SAFETY_MARGIN blocks so the resulting
   * proof references a block old enough to pass STRK20 account validation. Selected per-execution
   * (never cached) so it always tracks the live chain head.
   *
   * Returns a plain block NUMBER. The SDK consumes it two ways: the prover converts it to
   * `{ block_number }` for `starknet_proveTransaction`, and the discovery indexer expects a raw
   * primitive (integer / hex / block-tag) for `block_ref` — it REJECTS the `{ block_number }`
   * object form with HTTP 422, which stopped shields after fee estimation and before proving.
   */
  private async getSafeProvingBlock(user: Strk20User): Promise<number> {
    const provider = this.getNode(user);
    const currentBlock = await provider.getBlockNumber();
    const provingBlock = Math.max(currentBlock - PROVING_SAFETY_MARGIN, 0);
    debug("getSafeProvingBlock", { currentBlock, safetyMargin: PROVING_SAFETY_MARGIN, provingBlock });
    return provingBlock;
  }

  /**
   * STRK20 allowance prerequisite (Privy lane only). Reads the pool's `get_fee_amount()` once and
   * ensures the account has approved what the pool will pull from it:
   *   - the STRK pool fee on every apply_actions (collect_fee transfers STRK from the caller), plus
   *     the deposit amount when the deposit token IS STRK (a shield transferFrom pulls it from the
   *     caller);
   *   - when the deposit token is NOT STRK, a separate allowance on the deposit token for the
   *     deposit amount.
   * Approval is an ordinary ERC20 `approve` — it never goes through the privacy prover.
   */
  private async ensureAllowance(
    user: Strk20User,
    deposit?: { depositToken?: string; depositAmount?: bigint },
  ): Promise<void> {
    const provider = this.getNode(user);
    const feeToken = this.config.feeTokenAddress ?? STRK_TOKEN_ADDRESS;
    const fee = await readPoolFee(provider, this.config.poolContractAddress);

    const depositToken = deposit?.depositToken;
    const depositAmount = deposit?.depositAmount ?? 0n;
    const depositIsFeeToken =
      depositToken !== undefined && depositToken.toLowerCase() === feeToken.toLowerCase();

    // STRK allowance covers the fee, plus the deposit amount when depositing STRK itself.
    const strkRequired = fee + (depositIsFeeToken ? depositAmount : 0n);
    await ensurePrivacyPoolAllowance(user.account, feeToken, this.config.poolContractAddress, strkRequired, {
      onStatus: this.config.onApprovalStatus,
    });

    // Depositing a non-STRK token pulls that token from the account too — separate allowance.
    if (depositToken !== undefined && !depositIsFeeToken) {
      await ensurePrivacyPoolAllowance(user.account, depositToken, this.config.poolContractAddress, depositAmount, {
        onStatus: this.config.onApprovalStatus,
      });
    }
  }

  /**
   * Fee estimation in the SDK-supported way: the apply_actions call carries ONLY proof facts
   * (mock/virtual proof from `simulate`), never the real STARK proof blob. starknet.js
   * `estimateFeeBulk` fails when the real `proof` is attached (the node cannot estimate a
   * proof-bearing transaction), so we estimate first and pass the resulting resource bounds
   * straight into the real submission (which skips re-estimation).
   */
  private async estimateFee(
    user: Strk20User,
    call: Call,
    proof: CallAndProofLike["proof"],
  ): Promise<ResourceBoundsBN> {
    const proofFacts = proof?.proofFacts?.length ? proof.proofFacts : [];
    const calldata = (call.calldata ?? []) as unknown[];
    debug("estimateFee request", {
      entrypoint: call.entrypoint,
      calldataLength: calldata.length,
      proofFactsCount: proofFacts.length,
      proofBlobPresent: Boolean(proof?.data),
    });
    try {
      const estimate = await user.account.estimateInvokeFee(call, { tip: 0n, proofFacts });
      debug("estimateFee response", {
        overallFee: estimate.overall_fee?.toString?.(),
        resourceBounds: estimate.resourceBounds,
      });
      return estimate.resourceBounds;
    } catch (err) {
      debugWarn("estimateFee FAILED", { message: err instanceof Error ? err.message : err });
      throw err;
    }
  }

  private async submit(
    user: Strk20User,
    result: ExecuteResultLike,
    resourceBounds: ResourceBoundsBN,
  ): Promise<Strk20ExecuteReceipt> {
    const { callAndProof } = result;
    const proofDetails = callAndProof.proof?.proofFacts?.length
      ? { proofFacts: callAndProof.proof.proofFacts, proof: callAndProof.proof.data }
      : {};

    // starknet.js Account.execute uses `this.prepareInvoke`, so it must stay bound to the
    // account instance. (AccountInterface types execute() with InvocationsDetails, which
    // lacks proofFacts/proof, hence the cast.)
    const execute = user.account.execute.bind(user.account) as unknown as (
      calls: Call,
      details?: Record<string, unknown>,
    ) => Promise<{ transaction_hash: string }>;

    // Instrument the stages INSIDE starknet.js Account.execute so the exact failure point is
    // recorded: nonce lookup, signing, and RPC submission. (Fee estimation is skipped here
    // because resourceBounds are supplied.) Stage names only — no call data, proof blobs, or
    // secrets are ever logged.
    const provider = (user.account as unknown as { provider?: unknown }).provider;
    const signer = (user.account as unknown as { signer?: unknown }).signer;
    const originals = new Map<string, unknown>();
    const instrument = (target: unknown, key: string) => {
      const obj = target as Record<string, unknown>;
      const original = obj?.[key];
      if (typeof original !== "function") return;
      const wrapped = async (...args: unknown[]) => {
        debug(`stage → ${key} (start)`);
        try {
          const out = await (original as (...a: unknown[]) => Promise<unknown>).apply(obj, args);
          debug(`stage → ${key} (ok)`);
          return out;
        } catch (err) {
          debug(`stage → ${key} (FAILED)`, { message: err instanceof Error ? err.message : err });
          throw err;
        }
      };
      obj[key] = wrapped;
      originals.set(key, original);
    };
    const restore = (target: unknown) => {
      const obj = target as Record<string, unknown>;
      originals.forEach((original, key) => {
        obj[key] = original;
      });
    };

    instrument(provider, "getNonceForAddress");
    instrument(provider, "getChainId");
    instrument(provider, "getCairoVersion");
    instrument(provider, "invokeFunction");
    instrument(signer, "signTransaction");

    try {
      const response = await execute(callAndProof.call, {
        tip: 0n,
        resourceBounds,
        ...proofDetails,
      });
      const transactionHash = response.transaction_hash;
      debug("submission ok", { transactionHash });
      return {
        transactionHash,
        status: "PENDING",
        explorerUrl: `https://sepolia.voyager.online/tx/${transactionHash}`,
        warnings: result.warnings ?? [],
      };
    } catch (err) {
      debug("Account.execute FAILED (post-proof submission)", { message: err instanceof Error ? err.message : err });
      throw err;
    } finally {
      restore(provider);
      restore(signer);
    }
  }
}