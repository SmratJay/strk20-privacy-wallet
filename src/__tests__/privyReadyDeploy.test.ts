/**
 * @file privyReadyDeploy.test.ts
 * @description Unit tests for Ready account deployment: on-chain deployment detection,
 * DEPLOY_ACCOUNT submission (salt = publicKey, same constructor calldata as the address
 * derivation), and the ~10-block finality wait.
 */

import { describe, it, expect, vi } from "vitest";
import { CallData } from "starknet";
import {
  buildReadyConstructorCalldata,
  computeReadyAccountAddress,
  deployReadyAccount,
  isAccountDeployed,
  waitForDeploymentFinality,
  READY_DEPLOY_FINALITY_BLOCKS,
  READY_SEPOLIA_CLASS_HASH,
} from "../privacy/privy/ready";

describe("isAccountDeployed", () => {
  it("returns true when the class hash exists", async () => {
    const provider = { getClassHashAt: vi.fn(async () => "0x123") };
    expect(await isAccountDeployed(provider as any, "0xabc")).toBe(true);
  });

  it("returns false when the RPC reports contract not found", async () => {
    const provider = {
      getClassHashAt: vi.fn(async () => {
        throw new Error("Contract not found");
      }),
    };
    expect(await isAccountDeployed(provider as any, "0xabc")).toBe(false);
  });

  it("returns false when the class hash is zero", async () => {
    const provider = { getClassHashAt: vi.fn(async () => "0x0") };
    expect(await isAccountDeployed(provider as any, "0xabc")).toBe(false);
  });
});

describe("computeReadyAccountAddress", () => {
  it("is deterministic for a given public key", () => {
    const pk = "0x0123456789abcdef0123456789abcdef";
    expect(computeReadyAccountAddress(pk)).toBe(computeReadyAccountAddress(pk));
  });
});

describe("deployReadyAccount", () => {
  it("submits DEPLOY_ACCOUNT with salt=publicKey, derived address, and matching constructor calldata", async () => {
    const publicKey = "0x0123456789abcdef";
    const deploySelf = vi.fn(async (_payload: any) => ({
      transaction_hash: "0xtx",
      contract_address: "0xaddr",
    }));
    const account = { deploySelf } as unknown as import("starknet").Account;

    const result = await deployReadyAccount(account, publicKey);

    expect(deploySelf).toHaveBeenCalledTimes(1);
    const payload = deploySelf.mock.calls[0][0];
    expect(payload.classHash).toBe(READY_SEPOLIA_CLASS_HASH);
    expect(payload.addressSalt).toBe(publicKey);
    expect(payload.contractAddress).toBe(computeReadyAccountAddress(publicKey));
    // The constructor calldata submitted on-chain must byte-for-byte match the one used
    // to derive the address (otherwise the account would deploy to a different address).
    expect(CallData.compile(payload.constructorCalldata)).toEqual(buildReadyConstructorCalldata(publicKey));
    expect(result.transactionHash).toBe("0xtx");
    expect(result.contractAddress).toBe("0xaddr");
  });
});

describe("waitForDeploymentFinality", () => {
  it("resolves once the deployed block is 10 blocks behind the tip", async () => {
    let calls = 0;
    const provider = {
      getBlockNumber: vi.fn(async () => {
        calls += 1;
        return calls === 1 ? 100 : 110;
      }),
    };
    const latest = await waitForDeploymentFinality(
      provider as any,
      100,
      READY_DEPLOY_FINALITY_BLOCKS,
      { pollMs: 1, timeoutMs: 1000 },
    );
    expect(latest).toBe(110);
  });

  it("resolves immediately when already final", async () => {
    const provider = { getBlockNumber: vi.fn(async () => 110) };
    const latest = await waitForDeploymentFinality(provider as any, 100, READY_DEPLOY_FINALITY_BLOCKS, {
      pollMs: 1,
      timeoutMs: 1000,
    });
    expect(latest).toBe(110);
  });

  it("throws a descriptive error on timeout", async () => {
    const provider = { getBlockNumber: vi.fn(async () => 100) };
    await expect(
      waitForDeploymentFinality(provider as any, 100, READY_DEPLOY_FINALITY_BLOCKS, {
        pollMs: 1,
        timeoutMs: 25,
      }),
    ).rejects.toThrow(/finality/);
  });
});
