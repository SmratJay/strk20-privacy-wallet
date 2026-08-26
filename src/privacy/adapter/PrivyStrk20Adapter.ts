import type { AccountInterface, Call, ProviderInterface, ResourceBoundsBN } from "starknet";
import { constants } from "starknet";
import {
  ensurePrivacyPoolAllowance,
  readPoolFee,
  STRK_TOKEN_ADDRESS,
  type ApprovalStatus,
} from "@/privacy/privy/allowance";

export interface PrivyStrk20User {
  account: AccountInterface;
  address: string;
  viewingKey: bigint;
}

export interface PrivyStrk20AdapterConfig {
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

interface BuilderLike {
  with(token: string, ops: (t: TokenOpsLike) => void): BuilderLike;
  register(): BuilderLike;
  surplusTo(recipient: string, withdraw?: boolean): BuilderLike;
  execute(options?: Record<string, unknown>): Promise<ExecuteResultLike>;
  /** SDK fee-simulation: mock proof via CallMockProofProvider, no real proof generation. */
  simulate(options: { node: ProviderInterface; validateSignature?: boolean }): Promise<ExecuteResultLike>;
}

interface PrivateTransfersLike {
  build(options?: Record<string, unknown>): BuilderLike;
  discoverNotes(params?: { tokens?: string[] }): Promise<{
    notes: Map<bigint, ShieldedNote[]>;
  }>;
}

type CreatePrivateTransfersFn = (params: Record<string, unknown>) => PrivateTransfersLike;

let createPrivateTransfersFn: CreatePrivateTransfersFn | null = null;

async function loadCreatePrivateTransfers(): Promise<CreatePrivateTransfersFn> {
  if (createPrivateTransfersFn) return createPrivateTransfersFn;
  const mod = (await import("@starkware-libs/starknet-privacy-sdk")) as unknown as {
    createPrivateTransfers: CreatePrivateTransfersFn;
  };
  createPrivateTransfersFn = mod.createPrivateTransfers;
  return createPrivateTransfersFn;
}

export class PrivyStrk20Adapter {
  private readonly config: PrivyStrk20AdapterConfig;
  private transfersCache = new Map<string, PrivateTransfersLike>();

  constructor(config: PrivyStrk20AdapterConfig) {
    this.config = config;
  }

  async getTransfers(user: PrivyStrk20User): Promise<PrivateTransfersLike> {
    const key = user.address.toLowerCase();
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

  async register(user: PrivyStrk20User): Promise<Strk20ExecuteReceipt> {
    return this.runWithBounds(
      user,
      (t, node) => t.build({ autoRegister: true }).register().simulate({ node }),
      (t) => t.build({ autoRegister: true }).register().execute(),
    );
  }

  async shield(user: PrivyStrk20User, token: string, amountBase: bigint): Promise<Strk20ExecuteReceipt> {
    // autoSetup: opens the self-channel + STRK subchannel in the same apply_actions proof when
    // missing (protocol requires subchannel_exists before CreateEncNote — SUBCHANNEL_NOT_FOUND).
    const opts = { autoSetup: true, autoDiscover: { notes: "refresh", channels: "refresh" } };
    return this.runWithBounds(
      user,
      (t, node) =>
        t.build(opts).with(token, (x) => x.deposit({ amount: amountBase })).surplusTo(user.address).simulate({ node }),
      (t) =>
        t.build(opts).with(token, (x) => x.deposit({ amount: amountBase })).surplusTo(user.address).execute(),
      // A shield pulls the deposit amount (transferFrom) + the STRK pool fee from the account.
      { depositToken: token, depositAmount: amountBase },
    );
  }

  async unshield(user: PrivyStrk20User, token: string, amountBase: bigint): Promise<Strk20ExecuteReceipt> {
    const opts = {
      autoSetup: true,
      autoDiscover: { notes: "refresh", channels: "refresh" },
      autoSelectNotes: "naive",
    };
    return this.runWithBounds(
      user,
      (t, node) =>
        t.build(opts).with(token, (x) => x.withdraw({ amount: amountBase })).surplusTo(user.address).simulate({ node }),
      (t) =>
        t.build(opts).with(token, (x) => x.withdraw({ amount: amountBase })).surplusTo(user.address).execute(),
    );
  }

  async transfer(
    user: PrivyStrk20User,
    token: string,
    amountBase: bigint,
    recipient: string,
  ): Promise<Strk20ExecuteReceipt> {
    const opts = {
      autoSetup: true,
      autoDiscover: { notes: "refresh", channels: "refresh" },
      autoSelectNotes: "naive",
    };
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
          .execute(),
    );
  }

  /**
   * RC5 fee-estimation flow: `simulate()` (CallMockProofProvider, mock proof, PROOF0 proofFacts)
   * → `estimateFee`. On public Sepolia the node's blockifier rejects the PROOF0 proof version
   * ("Proof version PROOF0 is not allowed under this protocol version") for fee estimation, so we
   * fall back to gas-price-derived resource bounds (2x headroom) and submit the real proof directly.
   */
  private async runWithBounds(
    user: PrivyStrk20User,
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

    const sim = await buildSim(transfers, node);
    let resourceBounds: ResourceBoundsBN;
    try {
      resourceBounds = await this.estimateFee(user, sim.callAndProof.call, sim.callAndProof.proof);
    } catch (err) {
      if (this.isProofVersionRejected(err)) {
        // eslint-disable-next-line no-console
        console.warn("[PrivyStrk20Adapter] estimateFee rejected the PROOF0 proof version; using gas-price resource bounds.", {
          message: err instanceof Error ? err.message : err,
        });
        resourceBounds = await this.resolveResourceBounds(user);
      } else {
        throw err;
      }
    }

    const result = await buildExec(transfers);
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
  private async resolveResourceBounds(user: PrivyStrk20User): Promise<ResourceBoundsBN> {
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
    // eslint-disable-next-line no-console
    console.log("[PrivyStrk20Adapter.resolveResourceBounds]", {
      l1GasPrice: l1.toString(),
      l2GasPrice: l2.toString(),
      l1DataGasPrice: l1Data.toString(),
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

  async getPrivateBalance(user: PrivyStrk20User, token: string): Promise<bigint> {
    const transfers = await this.getTransfers(user);
    const { notes } = await transfers.discoverNotes({ tokens: [token] });
    const tokenNotes = notes.get(BigInt(token)) ?? [];
    return tokenNotes.reduce((sum, n) => sum + n.amount, 0n);
  }

  private getNode(user: PrivyStrk20User): ProviderInterface {
    const provider = (user.account as unknown as { provider?: ProviderInterface }).provider;
    if (!provider) {
      throw new Error("Account has no RPC provider; cannot run fee estimation.");
    }
    return provider;
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
    user: PrivyStrk20User,
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
    user: PrivyStrk20User,
    call: Call,
    proof: CallAndProofLike["proof"],
  ): Promise<ResourceBoundsBN> {
    const proofFacts = proof?.proofFacts?.length ? proof.proofFacts : [];
    const calldata = (call.calldata ?? []) as unknown[];
    // eslint-disable-next-line no-console
    console.log(`[PrivyStrk20Adapter.estimateFee] request`, {
      contractAddress: call.contractAddress,
      entrypoint: call.entrypoint,
      calldataLength: calldata.length,
      proofFactsCount: proofFacts.length,
      proofBlobPresent: Boolean(proof?.data),
      accountAddress: user.address,
    });
    try {
      const estimate = await user.account.estimateInvokeFee(call, { tip: 0n, proofFacts });
      // eslint-disable-next-line no-console
      console.log(`[PrivyStrk20Adapter.estimateFee] response`, {
        overallFee: estimate.overall_fee?.toString?.(),
        resourceBounds: estimate.resourceBounds,
      });
      return estimate.resourceBounds;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[PrivyStrk20Adapter.estimateFee] FAILED`,
        err instanceof Error ? { message: err.message, stack: err.stack } : err,
      );
      throw err;
    }
  }

  private async submit(
    user: PrivyStrk20User,
    result: ExecuteResultLike,
    resourceBounds: ResourceBoundsBN,
  ): Promise<Strk20ExecuteReceipt> {
    const { callAndProof } = result;
    const proofDetails = callAndProof.proof?.proofFacts?.length
      ? { proofFacts: callAndProof.proof.proofFacts, proof: callAndProof.proof.data }
      : {};

    const log = (msg: string, data?: unknown) => {
      // eslint-disable-next-line no-console
      console.log(`[PrivyStrk20Adapter.submit] ${msg}`, data === undefined ? "" : data);
    };
    const logError = (msg: string, err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(
        `[PrivyStrk20Adapter.submit] ${msg}`,
        err instanceof Error ? { message: err.message, stack: err.stack } : err,
      );
    };

    const calldataArr = (callAndProof.call.calldata ?? []) as unknown[];
    log("apply_actions call", {
      contractAddress: callAndProof.call.contractAddress,
      entrypoint: callAndProof.call.entrypoint,
      calldataLength: calldataArr.length,
      calldataHead: calldataArr.slice(0, 6),
      calldataTail: calldataArr.slice(-4),
    });
    log("proof shape", {
      proofFactsCount: callAndProof.proof?.proofFacts?.length ?? 0,
      proofDataType: typeof callAndProof.proof?.data,
      proofDataLength: String(callAndProof.proof?.data ?? "").length,
    });
    log("details passed to Account.execute", {
      tip: "0n",
      proofFactsCount: proofDetails.proofFacts?.length ?? 0,
      proofLength: String(proofDetails.proof ?? "").length,
      resourceBounds,
      accountAddress: user.address,
    });

    // starknet.js Account.execute uses `this.prepareInvoke`, so it must stay bound to the
    // account instance. (AccountInterface types execute() with InvocationsDetails, which
    // lacks proofFacts/proof, hence the cast.)
    const execute = user.account.execute.bind(user.account) as unknown as (
      calls: Call,
      details?: Record<string, unknown>,
    ) => Promise<{ transaction_hash: string }>;

    // Instrument the stages INSIDE starknet.js Account.execute so the exact failure point is
    // recorded: nonce lookup, Privy signing, and RPC submission. (Fee estimation is skipped
    // here because resourceBounds are supplied.)
    const provider = (user.account as unknown as { provider?: unknown }).provider;
    const signer = (user.account as unknown as { signer?: unknown }).signer;
    const originals = new Map<string, unknown>();
    const instrument = (target: unknown, key: string) => {
      const obj = target as Record<string, unknown>;
      const original = obj?.[key];
      if (typeof original !== "function") return;
      const wrapped = async (...args: unknown[]) => {
        log(`stage → ${key} (start)`);
        try {
          const out = await (original as (...a: unknown[]) => Promise<unknown>).apply(obj, args);
          log(`stage → ${key} (ok)`);
          return out;
        } catch (err) {
          logError(`stage → ${key} (FAILED)`, err);
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
      log("submission ok", { transactionHash });
      return {
        transactionHash,
        status: "PENDING",
        explorerUrl: `https://sepolia.voyager.online/tx/${transactionHash}`,
        warnings: result.warnings ?? [],
      };
    } catch (err) {
      logError("Account.execute FAILED (post-proof submission)", err);
      throw err;
    } finally {
      restore(provider);
      restore(signer);
    }
  }
}