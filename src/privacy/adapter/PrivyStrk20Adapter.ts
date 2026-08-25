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

    // starknet.js Account.execute uses `this.prepareInvoke`, so it must stay bound to the
    // account instance. (AccountInterface types execute() with InvocationsDetails, which
    // lacks proofFacts/proof, hence the cast.)
    const execute = user.account.execute.bind(user.account) as unknown as (
      calls: Call,
      details?: Record<string, unknown>,
    ) => Promise<{ transaction_hash: string }>;

    const response = await execute(callAndProof.call, { tip: 0n, ...proofDetails });
    const transactionHash = response.transaction_hash;

    return {
      transactionHash,
      status: "PENDING",
      explorerUrl: `https://sepolia.voyager.online/tx/${transactionHash}`,
      warnings: result.warnings ?? [],
    };
  }
}
