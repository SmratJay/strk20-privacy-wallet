/**
 * @file privyPrivacyStatus.test.ts
 * @description STRK20 privacy-registration detection. The Settings "Privacy Transactions"
 * status is authoritative only when reconstructed from pool state — `discoverRequirement`
 * returns `SetupRequirement.Register` (0) for an unregistered viewing key and any other value
 * for a registered one. `PrivyStrk20Adapter.getPrivacyRegistration` maps that to a clean
 * "registered" | "unregistered" result and propagates discovery failures (so the caller can
 * surface an "error" status rather than a false "disabled").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { constants } from "starknet";
import { PrivyStrk20Adapter } from "../privacy/adapter/PrivyStrk20Adapter";

const h = vi.hoisted(() => {
  const discoverRequirement = vi.fn(async (_recipient: string, _token: string) => 0);
  return { discoverRequirement };
});

vi.mock("@starkware-libs/starknet-privacy-sdk", () => ({
  createPrivateTransfers: () => ({
    discoverRequirement: h.discoverRequirement,
  }),
}));

function buildAdapter(): PrivyStrk20Adapter {
  return new PrivyStrk20Adapter({
    poolContractAddress: "0xpool",
    chainId: constants.StarknetChainId.SN_SEPOLIA,
    proverUrl: "https://prover.example.com",
    discoveryUrl: "https://discovery.example.com",
  });
}

const user = {
  account: { address: "0xowner", signer: {} } as any,
  address: "0xowner",
  viewingKey: 1n,
};
const TOKEN = "0xtoken";

describe("PrivyStrk20Adapter.getPrivacyRegistration", () => {
  beforeEach(() => {
    h.discoverRequirement.mockReset();
  });

  it("reports 'unregistered' when discoverRequirement returns Register (0) — fresh account", async () => {
    h.discoverRequirement.mockResolvedValue(0);
    const adapter = buildAdapter();

    await expect(adapter.getPrivacyRegistration(user, TOKEN)).resolves.toBe("unregistered");
    expect(h.discoverRequirement).toHaveBeenCalledWith(user.address, TOKEN);
  });

  it("reports 'registered' for SetupChannel / SetupToken / Ready (registered viewing key)", async () => {
    for (const requirement of [1, 2, 3]) {
      h.discoverRequirement.mockResolvedValue(requirement);
      const adapter = buildAdapter();
      await expect(adapter.getPrivacyRegistration(user, TOKEN)).resolves.toBe("registered");
    }
  });

  it("propagates a discovery failure so the caller can surface 'error' (never 'disabled')", async () => {
    h.discoverRequirement.mockRejectedValue(
      new Error("Indexer API /v1/sync/preflight_check failed (500)"),
    );
    const adapter = buildAdapter();
    await expect(adapter.getPrivacyRegistration(user, TOKEN)).rejects.toThrow(/preflight_check/);
  });

  it("does not cache a transient result across calls (always re-reads the pool)", async () => {
    h.discoverRequirement.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const adapter = buildAdapter();

    await expect(adapter.getPrivacyRegistration(user, TOKEN)).resolves.toBe("unregistered");
    await expect(adapter.getPrivacyRegistration(user, TOKEN)).resolves.toBe("registered");
    expect(h.discoverRequirement).toHaveBeenCalledTimes(2);
  });
});
