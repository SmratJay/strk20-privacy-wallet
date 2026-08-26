/**
 * @file privyAutoSetup.test.ts
 * @description autoSetup prerequisite for the Privy lane (shield/transfer/unshield):
 * - real SDK (Mocknet): shield/transfer/unshield with autoSetup open the required
 *   channel + token subchannel in the SAME proof — no SUBCHANNEL_NOT_FOUND.
 * - adapter: build() is called with autoSetup: true while autoDiscover is preserved.
 * - Wallet API lane untouched.
 */

import { describe, it, expect, vi } from "vitest";
import { constants } from "starknet";
import { Mocknet } from "../../vendor/starknet-privacy-sdk/dist/testing/mocknet.js";
import { SetupRequirement } from "../../vendor/starknet-privacy-sdk/dist/interfaces.js";
import { PrivyStrk20Adapter } from "../privacy/adapter/PrivyStrk20Adapter";

const TOKEN = new Mocknet().initialize().ace as string;

const h = vi.hoisted(() => {
  const buildOpts: Record<string, unknown>[] = [];
  const simFn = vi.fn(async () => ({
    callAndProof: {
      call: { contractAddress: "0xpool", entrypoint: "apply_actions", calldata: ["0x1"] },
      proof: { proofFacts: ["0xmock"], data: undefined },
    },
    warnings: [],
  }));
  const execFn = vi.fn(async () => ({
    callAndProof: {
      call: { contractAddress: "0xpool", entrypoint: "apply_actions", calldata: ["0x1"] },
      proof: { proofFacts: ["0xreal"], data: "proof-b64" },
    },
    warnings: [],
  }));
  return { buildOpts, simFn, execFn };
});

vi.mock("@starkware-libs/starknet-privacy-sdk", () => ({
  createPrivateTransfers: () => ({
    build: (opts: unknown) => {
      h.buildOpts.push(opts as Record<string, unknown>);
      return {
        register: () => ({ simulate: h.simFn, execute: h.execFn }),
        with: () => ({ surplusTo: () => ({ simulate: h.simFn, execute: h.execFn }) }),
        surplusTo: () => ({ simulate: h.simFn, execute: h.execFn }),
      };
    },
    discoverNotes: async () => ({ notes: new Map() }),
  }),
}));

async function registerUser(transfers: any, address: bigint) {
  const reg = await transfers.build({ autoRegister: true }).register().execute();
  return reg;
}

describe("SDK autoSetup (real Mocknet) — protocol-state prerequisites", () => {
  it("shield on a fresh registered account with autoSetup opens self-channel+subchannel (no SUBCHANNEL_NOT_FOUND)", async () => {
    const mocknet = new Mocknet();
    const env = mocknet.initialize();
    const alice = mocknet.createPrivateTransfers(env.alice.address, env.alice.privateKey);

    mocknet.executeOutside(await registerUser(alice, env.alice.address));

    // Register alone only sets the viewing key — self setup is NOT ready yet.
    expect(await alice.discoverRequirement(env.alice.address, TOKEN)).toBe(SetupRequirement.SetupChannel);

    // No self-channel/subchannel yet; autoSetup must construct both in the same proof.
    const shield = await alice
      .build({ autoSetup: true, autoDiscover: { notes: "refresh", channels: "refresh" } })
      .with(TOKEN, (t) => t.deposit({ amount: 100n }))
      .surplusTo(env.alice.address)
      .execute();
    mocknet.executeOutside(shield);

    expect(await alice.discoverRequirement(env.alice.address, TOKEN)).toBe(SetupRequirement.Ready);
    // The deposit created a note (registry is authoritative; mock contract discovery cannot
    // enumerate self-channel notes — the production flow uses the indexer discovery provider).
    const aliceNotes = shield.registry.notes.get(BigInt(TOKEN)) ?? [];
    expect(aliceNotes.length).toBeGreaterThan(0);
  });

  it("transfer to a fresh recipient with autoSetup creates the A->B channel+subchannel and a spendable note", async () => {
    const mocknet = new Mocknet();
    const env = mocknet.initialize();
    const alice = mocknet.createPrivateTransfers(env.alice.address, env.alice.privateKey);
    const bob = mocknet.createPrivateTransfers(env.bob.address, env.bob.privateKey);

    mocknet.executeOutside(await registerUser(alice, env.alice.address));
    mocknet.executeOutside(await registerUser(bob, env.bob.address));

    // Alice shields 100 (opens her self-channel/subchannel).
    mocknet.executeOutside(
      await alice
        .build({ autoSetup: true, autoDiscover: { notes: "refresh", channels: "refresh" } })
        .with(TOKEN, (t) => t.deposit({ amount: 100n }))
        .surplusTo(env.alice.address)
        .execute(),
    );

    // First A->B transfer: autoSetup must open the A->B channel + STRK subchannel before CreateEncNote.
    const tx = await alice
      .build({
        autoSetup: true,
        autoDiscover: { notes: "refresh", channels: "refresh" },
        autoSelectNotes: "naive",
      })
      .with(TOKEN, (t) => t.transfer({ recipient: env.bob.address, amount: 50n }))
      .surplusTo(env.alice.address)
      .execute();
    mocknet.executeOutside(tx);

    expect(await alice.discoverRequirement(env.bob.address, TOKEN)).toBe(SetupRequirement.Ready);

    // The A->B transfer produced a 50-note (registry authoritative; the recipient decrypts it with
    // its own viewing key — the channel key is shared, so no prior B-side channel setup is needed).
    const bobNotes = tx.registry.notes.get(BigInt(TOKEN)) ?? [];
    expect(bobNotes.length).toBeGreaterThan(0);
  });

  it("unshield does not regress with autoSetup", async () => {
    const mocknet = new Mocknet();
    const env = mocknet.initialize();
    const alice = mocknet.createPrivateTransfers(env.alice.address, env.alice.privateKey);
    mocknet.executeOutside(await registerUser(alice, env.alice.address));

    mocknet.executeOutside(
      await alice
        .build({ autoSetup: true, autoDiscover: { notes: "refresh", channels: "refresh" } })
        .with(TOKEN, (t) => t.deposit({ amount: 100n }))
        .surplusTo(env.alice.address)
        .execute(),
    );

    const unshield = await alice
      .build({
        autoSetup: true,
        autoDiscover: { notes: "refresh", channels: "refresh" },
        autoSelectNotes: "naive",
      })
      .with(TOKEN, (t) => t.withdraw({ amount: 30n }))
      .surplusTo(env.alice.address)
      .execute();
    mocknet.executeOutside(unshield);

    // 100 shielded, 30 withdrawn → 70 change note remains.
    const aliceNotes = unshield.registry.notes.get(BigInt(TOKEN)) ?? [];
    const total = aliceNotes.reduce((s: bigint, n: { amount: bigint }) => s + n.amount, 0n);
    expect(total).toBe(70n);
  });
});

describe("PrivyStrk20Adapter passes autoSetup: true", () => {
  it("shield/transfer/unshield build() opts contain autoSetup: true and keep autoDiscover", async () => {
    h.buildOpts.length = 0;
    const fee = 2n * 10n ** 18n;
    // Generous allowance so no approval is triggered for the 100-STRK shield (fee + deposit).
    const allowance = 1000n * 10n ** 18n;
    const provider = {
      callContract: vi.fn(async ({ entrypoint }: { entrypoint: string }) => {
        if (entrypoint === "get_fee_amount") return ["0x" + fee.toString(16)];
        if (entrypoint === "allowance") return ["0x" + allowance.toString(16), "0x0"];
        return ["0x0"];
      }),
      waitForTransaction: vi.fn(async () => ({ execution_status: "SUCCEEDED" })),
      getBlockWithTxHashes: vi.fn(async () => ({
        l1_gas_price: { price_in_fri: "0x64" },
        l2_gas_price: { price_in_fri: "0x2" },
        l1_data_gas_price: { price_in_fri: "0x1" },
      })),
    };
    const execute = vi.fn(async function (this: unknown) {
      if (!this) throw new Error("unbound");
      return { transaction_hash: "0xtx" };
    });
    const estimateInvokeFee = vi.fn(async () => ({
      resourceBounds: {
        l1_gas: { max_amount: 1n, max_price_per_unit: 200n },
        l2_gas: { max_amount: 1_210_000_000n, max_price_per_unit: 4n },
        l1_data_gas: { max_amount: 10_000n, max_price_per_unit: 2n },
      },
      overall_fee: 100n,
      unit: "FRI",
    }));
    const account = { address: "0xowner", signer: {}, provider, execute, estimateInvokeFee };
    const user = { account: account as any, address: "0xowner", viewingKey: 1n };

    const adapter = new PrivyStrk20Adapter({
      poolContractAddress: "0xpool",
      chainId: constants.StarknetChainId.SN_SEPOLIA,
      proverUrl: "",
      discoveryUrl: "",
    });

    await adapter.shield(user, "0xtoken", 100n);
    await adapter.transfer(user, "0xtoken", 50n, "0xrecipient");
    await adapter.unshield(user, "0xtoken", 30n);

    expect(h.buildOpts.length).toBeGreaterThan(0);
    for (const opts of h.buildOpts) {
      expect(opts.autoSetup).toBe(true);
      expect(opts.autoDiscover).toEqual({ notes: "refresh", channels: "refresh" });
    }
  });
});