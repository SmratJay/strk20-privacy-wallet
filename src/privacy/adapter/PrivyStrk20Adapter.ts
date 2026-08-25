import type { AccountInterface, Call } from "starknet";
import { constants } from "starknet";

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
    const transfers = await this.getTransfers(user);
    const result = await transfers.build({ autoRegister: true }).register().execute();
    return this.submit(user, result);
  }

  async shield(user: PrivyStrk20User, token: string, amountBase: bigint): Promise<Strk20ExecuteReceipt> {
    const transfers = await this.getTransfers(user);
    const result = await transfers
      .build({ autoDiscover: { notes: "refresh", channels: "refresh" } })
      .with(token, (t) => t.deposit({ amount: amountBase }))
      .surplusTo(user.address)
      .execute();
    return this.submit(user, result);
  }

  async unshield(user: PrivyStrk20User, token: string, amountBase: bigint): Promise<Strk20ExecuteReceipt> {
    const transfers = await this.getTransfers(user);
    const result = await transfers
      .build({
        autoDiscover: { notes: "refresh", channels: "refresh" },
        autoSelectNotes: "naive",
      })
      .with(token, (t) => t.withdraw({ amount: amountBase }))
      .surplusTo(user.address)
      .execute();
    return this.submit(user, result);
  }

  async transfer(
    user: PrivyStrk20User,
    token: string,
    amountBase: bigint,
    recipient: string,
  ): Promise<Strk20ExecuteReceipt> {
    const transfers = await this.getTransfers(user);
    const result = await transfers
      .build({
        autoDiscover: { notes: "refresh", channels: "refresh" },
        autoSelectNotes: "naive",
      })
      .with(token, (t) => t.transfer({ recipient, amount: amountBase }))
      .surplusTo(user.address)
      .execute();
    return this.submit(user, result);
  }

  async getPrivateBalance(user: PrivyStrk20User, token: string): Promise<bigint> {
    const transfers = await this.getTransfers(user);
    const { notes } = await transfers.discoverNotes({ tokens: [token] });
    const tokenNotes = notes.get(BigInt(token)) ?? [];
    return tokenNotes.reduce((sum, n) => sum + n.amount, 0n);
  }

  private async submit(user: PrivyStrk20User, result: ExecuteResultLike): Promise<Strk20ExecuteReceipt> {
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
      proofFactsHead: callAndProof.proof?.proofFacts?.slice(0, 2),
      proofDataType: typeof callAndProof.proof?.data,
      proofDataLength: String(callAndProof.proof?.data ?? "").length,
    });
    log("details passed to Account.execute", {
      tip: "0n",
      proofFactsCount: proofDetails.proofFacts?.length ?? 0,
      proofLength: String(proofDetails.proof ?? "").length,
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
    // recorded: nonce/fee estimation, Privy signing, and RPC submission.
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
    instrument(provider, "getEstimateFee");
    instrument(provider, "getEstimateFeeBulk");
    instrument(provider, "invokeFunction");
    instrument(signer, "signTransaction");

    try {
      const response = await execute(callAndProof.call, { tip: 0n, ...proofDetails });
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
