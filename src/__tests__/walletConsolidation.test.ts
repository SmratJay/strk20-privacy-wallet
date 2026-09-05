/**
 * @file walletConsolidation.test.ts
 * @description Stage 3A.5 consolidation — Orrange is a SINGLE-wallet-runtime product.
 *
 * Behavioral + architectural guards for:
 *   - full Privy removal (no @privy-io imports, no legacy wallet contexts in the product)
 *   - single source of truth (WalletRuntime everywhere; settings/activity/swap derive from it)
 *   - allowance decimals (STRK headroom only; non-STRK tokens approved exactly)
 *   - no provider/signer monkey-patching in the STRK20 adapter
 *   - network-scoped anonymizer config (no server secret)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ensurePrivacyPoolAllowance, STRK_TOKEN_ADDRESS, DEFAULT_STRK_ALLOWANCE_TARGET } from "../privacy/strk20";

// ────────────────────────────────────────────────────────────────────────────────────────
// 1. Privy removal
// ────────────────────────────────────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const PRODUCT_DIRS = [
  "src/app",
  "src/components",
  "src/context",
  "src/hooks",
  "src/privacy",
  "src/wallet",
  "src/services",
  "src/providers",
  "src/ai",
];

const FORBIDDEN_PRODUCT = [
  "@privy-io",
  "usePrivy",
  "PrivyWalletContext",
  "PrivyAuthProvider",
  "PrivyWalletProvider",
  "ConnectWalletModal",
  "useStarknetWallet",
  "@/context/WalletContext",
  "@/services/strk20WalletApiService",
];

describe("Privy is fully removed from the product", () => {
  it("no product source imports @privy-io or the legacy wallet stack", () => {
    const files: string[] = [];
    for (const dir of PRODUCT_DIRS) {
      if (dir === "src/app") {
        // Docs pages may mention Privy historically (documentation only); app routes may not.
        const routes = join("src", "app");
        for (const entry of readdirSync(routes, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name !== "docs") {
            files.push(...walk(join(routes, entry.name)));
          }
        }
      } else {
        files.push(...walk(dir));
      }
    }
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const needle of FORBIDDEN_PRODUCT) {
        expect(source, `${file} must not contain ${needle}`).not.toContain(needle);
      }
    }
  });

  it("package.json has no Privy dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@privy-io/react-auth"]).toBeUndefined();
    expect(pkg.dependencies["@privy-io/server-auth"]).toBeUndefined();
  });

  it("the root layout mounts only non-wallet providers + WalletRuntimeProvider", () => {
    const layout = readFileSync(join(__dirname, "..", "app", "layout.tsx"), "utf8");
    expect(layout).toContain("WalletRuntimeProvider");
    expect(layout).not.toContain("PrivyAuthProvider");
    expect(layout).not.toContain("PrivyWalletProvider");
    expect(layout).not.toContain("WalletProvider");
    expect(layout).not.toContain("@privy-io");
  });

  it("the app shell has no legacy connect modal and derives the header account from WalletRuntime", () => {
    const shell = readFileSync(join(__dirname, "..", "components", "wallet", "AppShell.tsx"), "utf8");
    expect(shell).toContain("useWalletRuntime");
    expect(shell).not.toContain("ConnectWalletModal");
    expect(shell).not.toContain("useWallet(");
    expect(shell).not.toContain("privy");
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 2. Single wallet source of truth
// ────────────────────────────────────────────────────────────────────────────────────────

describe("single wallet source of truth (WalletRuntime)", () => {
  it("settings derives from WalletRuntime and has no legacy account state", () => {
    const settings = readFileSync(join(__dirname, "..", "app", "settings", "page.tsx"), "utf8");
    expect(settings).toContain("useWalletRuntime");
    expect(settings).not.toContain("useWallet(");
    expect(settings).not.toContain("usePrivyWallet");
    expect(settings).not.toContain("privy");
  });

  it("activity derives from WalletRuntime session activity (no legacy transactions)", () => {
    const activity = readFileSync(join(__dirname, "..", "app", "activity", "page.tsx"), "utf8");
    expect(activity).toContain("useWalletRuntime");
    expect(activity).not.toContain("useWallet(");
    expect(activity).not.toContain("TransactionList");
    expect(activity).not.toContain("privy");
  });

  it("swap reads the WalletRuntime account and routes private swaps to the shadow-account feature (no fallback)", () => {
    const swap = readFileSync(join(__dirname, "..", "app", "swap", "page.tsx"), "utf8");
    expect(swap).toContain("useWalletRuntime");
    expect(swap).not.toContain("useWallet(");
    expect(swap).not.toContain("ConnectGate");
    expect(swap).toContain("WalletCoreGate");
    expect(swap).toMatch(/private swaps use a REAL\s*shadow account/);
    // The public swap page is a public-only lane; the REAL private swap lives in the feature
    // module and never falls back to another wallet.
    const featureIndex = readFileSync(join(__dirname, "..", "features", "private-swap", "index.ts"), "utf8");
    expect(featureIndex).toContain("PrivateSwapService");
  });

  it("the treasury page reads only the WalletRuntime account/balances", () => {
    const treasury = readFileSync(join(__dirname, "..", "app", "treasury", "page.tsx"), "utf8");
    expect(treasury).toContain("useWalletRuntime");
    expect(treasury).not.toContain("useWallet(");
    expect(treasury).not.toContain("usePrivyWallet");
    expect(treasury).not.toContain("strk20WalletApiService");
    expect(treasury).not.toContain("ConnectGate");
  });

  it("launchpad and extended trading are explicitly unavailable (no second wallet path)", () => {
    const launch = readFileSync(join(__dirname, "..", "app", "launch", "page.tsx"), "utf8");
    const token = readFileSync(join(__dirname, "..", "app", "launch", "[token]", "page.tsx"), "utf8");
    const extended = readFileSync(join(__dirname, "..", "app", "extended", "page.tsx"), "utf8");
    for (const src of [launch, token, extended]) {
      expect(src).toMatch(/being migrated to Wallet Core/);
      expect(src).not.toContain("useWallet(");
      expect(src).not.toContain("usePrivyWallet");
      expect(src).not.toContain("ConnectGate");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 3. Allowance decimals (STRK headroom only; non-STRK tokens approved exactly)
// ────────────────────────────────────────────────────────────────────────────────────────

function allowanceHarness(initialAllowance: bigint, postAllowance?: bigint) {
  let reads = 0;
  const provider = {
    callContract: vi.fn(async () => {
      reads++;
      const value = reads === 1 ? initialAllowance : (postAllowance ?? initialAllowance);
      return [(value & ((1n << 128n) - 1n)).toString(), (value >> 128n).toString()];
    }),
    waitForTransaction: vi.fn(async () => ({ execution_status: "SUCCEEDED" })),
  };
  const account = {
    address: "0xuser",
    provider,
    execute: vi.fn(async (_call: { calldata: unknown[] }) => ({ transaction_hash: "0xapprove" })),
  };
  return { account, provider };
}

function approveCalldata(account: { execute: ReturnType<typeof vi.fn> }): unknown[] {
  return (account.execute.mock.calls[0]?.[0] as { calldata: unknown[] }).calldata;
}

describe("allowance decimals — never over-approve a non-STRK token", () => {
  it("STRK keeps deliberate headroom (at least 10 STRK)", async () => {
    const { account, provider } = allowanceHarness(0n, DEFAULT_STRK_ALLOWANCE_TARGET);
    const required = 2n * 10n ** 18n;
    await ensurePrivacyPoolAllowance(account as never, STRK_TOKEN_ADDRESS, "0xpool", required, { strk: true });
    expect(account.execute).toHaveBeenCalledTimes(1);
    expect(approveCalldata(account)[1]).toBe(DEFAULT_STRK_ALLOWANCE_TARGET);
    void provider;
  });

  it("a 6-decimal token (e.g. USDC) is approved for EXACTLY its required base units, not 10^18", async () => {
    const requiredUsdc = 5_000_000n; // 5 USDC at 6 decimals
    const { account, provider } = allowanceHarness(0n, requiredUsdc);
    await ensurePrivacyPoolAllowance(account as never, "0xusdc", "0xpool", requiredUsdc, { strk: false });
    expect(account.execute).toHaveBeenCalledTimes(1);
    expect(approveCalldata(account)[1]).toBe(5_000_000n);
    expect(approveCalldata(account)[1]).not.toBe(DEFAULT_STRK_ALLOWANCE_TARGET);
    void provider;
  });

  it("approves exactly the required amount when it is already above the STRK default", async () => {
    const required = 42n * 10n ** 18n;
    const { account, provider } = allowanceHarness(0n, required);
    await ensurePrivacyPoolAllowance(account as never, STRK_TOKEN_ADDRESS, "0xpool", required, { strk: true });
    expect(approveCalldata(account)[1]).toBe(required);
    void provider;
  });

  it("throws on insufficient allowance (never silently proceeds)", async () => {
    const { account, provider } = allowanceHarness(0n, 0n); // post-approval still 0
    await expect(
      ensurePrivacyPoolAllowance(account as never, "0xusdc", "0xpool", 5_000_000n, { strk: false }),
    ).rejects.toThrow(/approve|allowance/i);
    void provider;
  });

  it("repeated calls with a sufficient allowance do not re-approve", async () => {
    const { account, provider } = allowanceHarness(20n * 10n ** 18n); // already sufficient
    await ensurePrivacyPoolAllowance(account as never, STRK_TOKEN_ADDRESS, "0xpool", 2n * 10n ** 18n, { strk: true });
    expect(account.execute).not.toHaveBeenCalled();
    void provider;
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────
// 4. No provider/signer monkey-patching in the STRK20 adapter
// ────────────────────────────────────────────────────────────────────────────────────────

describe("STRK20 adapter never monkey-patches third-party objects", () => {
  it("submit() contains no instrument/restore/getNonceForAddress mutation scaffolding", () => {
    const adapter = readFileSync(join(__dirname, "..", "privacy", "strk20", "Strk20Adapter.ts"), "utf8");
    expect(adapter).not.toContain("instrument(");
    expect(adapter).not.toContain("restore(");
    expect(adapter).not.toContain("getNonceForAddress");
    expect(adapter).not.toContain("originals");
  });
});
describe("generic adapter composition boundary (item 12)", () => {
  it("executeBuilder is used ONLY by the private-curve adapter — never by UI/app modules", () => {
    const dirs = ["app", "components", "context", "wallet", "services", "ai"];
    const files: string[] = [];
    for (const dir of dirs) {
      for (const f of walk(join(__dirname, "..", dir))) files.push(f);
    }
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // No app/UI/service module may invoke the generic adapter's raw builder execution.
      expect(source, `${file} must not call executeBuilder`).not.toContain(".executeBuilder(");
    }
    // The only sanctioned consumer is the launchpad private-curve adapter.
    const curve = readFileSync(join(__dirname, "..", "privacy", "strk20", "privateCurve.ts"), "utf8");
    expect(curve).toContain("adapter.executeBuilder(");
  });
});
