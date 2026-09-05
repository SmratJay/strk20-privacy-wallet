/**
 * Private Swap — PrivateSwapService.
 *
 * The feature-level consumer that turns a typed `PrivateSwapIntent` into a REAL private swap
 * through the EXISTING STRK20 shadow-account path:
 *
 *   private STRK note → shadow identity → real shadow account → swap application (BondingCurve V2)
 *     → buy output collected back into a private note → private paymaster relay.
 *
 * It does NOT invent a second shadow-account implementation, does NOT fall back to a public
 * master-wallet send, and does NOT accept arbitrary `targetContract + entrypoint + calldata` from
 * the UI. The application target is owned by `PRIVATE_SWAP_APPS`; this service only assembles the
 * exact calls for the configured swap contract and executes them via the existing shadow path.
 *
 * The quote is always read fresh from the application on-chain and the execution re-verifies it
 * against the confirmed min-output right before proving — a stale/mutated quote is rejected.
 */
import type { UnlockedWallet } from "@/wallet";
import type { WalletPrivacySession } from "@/wallet/privacy";
import type { WalletNetworkId } from "@/wallet";
import { resolvePrivateSwapApp, PRIVATE_SWAP_SEPOLIA_POOL, type PrivateSwapAppConfig } from "./apps";
import { getOnChainSwapQuote, getPrivateExecutionFee, approveCalldata } from "./quote";
import {
  computeMinOutput,
  validatePrivateSwapIntent,
  PrivateSwapError,
  PrivateSwapQuoteStaleError,
  type PrivateSwapIntent,
  type PrivateSwapQuote,
  type PrivateSwapReceipt,
} from "./types";

export interface PrivateSwapServiceOptions {
  wallet: UnlockedWallet;
  privacySession: WalletPrivacySession;
  network: WalletNetworkId;
}

export class PrivateSwapService {
  readonly name = "private-swap-service";
  private readonly wallet: UnlockedWallet;
  private readonly privacySession: WalletPrivacySession;
  private readonly network: WalletNetworkId;

  constructor(options: PrivateSwapServiceOptions) {
    this.wallet = options.wallet;
    this.privacySession = options.privacySession;
    this.network = options.network;
  }

  /** Resolve the typed app for an intent (network + token pair). Throws on unknown pairs. */
  private resolveApp(intent: Pick<PrivateSwapIntent, "sellToken" | "buyToken">): PrivateSwapAppConfig {
    if (this.network !== "sepolia") {
      throw new PrivateSwapError(`Private swap is only available on Sepolia (active: ${this.network}).`);
    }
    const app = resolvePrivateSwapApp("sepolia", intent.sellToken, intent.buyToken);
    if (!app) {
      throw new PrivateSwapError(
        "Unsupported private-swap pair. The feature only swaps the configured application's tokens.",
      );
    }
    return app;
  }

  /** Provider from the wallet account (for the on-chain quote view). */
  private provider() {
    const provider = (this.wallet.account as unknown as { provider?: { callContract(call: unknown): Promise<string[]> } })
      .provider;
    if (!provider) throw new PrivateSwapError("Wallet account has no RPC provider; cannot quote the swap.");
    return provider;
  }

  /**
   * Fetch a REAL on-chain quote for the intent's pair + amount, plus the effective private
   * execution fee. The quote is bound to the live application state and never trusted from the UI.
   */
  async quote(intent: PrivateSwapIntent): Promise<PrivateSwapQuote> {
    const invalid = validatePrivateSwapIntent(intent);
    if (invalid) throw new PrivateSwapError(`Invalid private swap intent: ${invalid}`);
    const app = this.resolveApp(intent);
    const quote = await getOnChainSwapQuote(this.provider(), app, intent.sellAmount);
    const minOutput = computeMinOutput(quote.buyAmount, intent.slippageBps);
    const feeStrk = await getPrivateExecutionFee(PRIVATE_SWAP_SEPOLIA_POOL, app.sellToken.address);
    return {
      swapContract: app.swapContract,
      sellToken: app.sellToken.address,
      buyToken: app.buyToken.address,
      sellAmount: intent.sellAmount,
      buyAmount: quote.buyAmount,
      minOutput,
      route: app.name,
      feeStrk,
      slippageBps: intent.slippageBps,
      asOfBlock: quote.asOfBlock,
    };
  }

  /**
   * Execute a REAL private swap through the existing shadow-account path. The quote is
   * re-verified immediately before execution against the CONFIRMED quote: a stale/mutated quote
   * (fresh output < confirmed min-output) is rejected BEFORE any proof work. The root wallet is
   * never the swap application's caller.
   *
   * `confirmedQuote` is the quote the user confirmed (from `quote()`, never UI-typed). When
   * omitted the fresh quote is used directly (no mutation reference) — the runtime always passes
   * the confirmed quote for real swaps.
   */
  async execute(intent: PrivateSwapIntent, confirmedQuote?: PrivateSwapQuote): Promise<PrivateSwapReceipt> {
    const invalid = validatePrivateSwapIntent(intent);
    if (invalid) throw new PrivateSwapError(`Invalid private swap intent: ${invalid}`);
    if (intent.expiry !== undefined && intent.expiry <= Date.now()) {
      throw new PrivateSwapError("Private swap intent has expired.");
    }

    const app = this.resolveApp(intent);

    // Resolve the ACTIVE shadow identity scoped to THIS wallet on THIS network by (appName, nonce).
    // The session validates the identity belongs to the wallet's address + chain and is active.
    const identity = this.privacySession.getShadowIdentity(intent.appName, intent.nonce, this.wallet.address);

    // Re-quote fresh and reject a stale/mutated quote BEFORE building the proof. The confirmed
    // min-output (derived from the confirmed quote + slippage) is the floor the fresh quote must
    // meet. A changed pair/app is also refused.
    if (confirmedQuote) {
      if (confirmedQuote.sellToken.toLowerCase() !== intent.sellToken.toLowerCase()) {
        throw new PrivateSwapError("The confirmed quote does not match the sell token.");
      }
      if (confirmedQuote.buyToken.toLowerCase() !== intent.buyToken.toLowerCase()) {
        throw new PrivateSwapError("The confirmed quote does not match the buy token.");
      }
      if (confirmedQuote.swapContract.toLowerCase() !== app.swapContract.toLowerCase()) {
        throw new PrivateSwapError("The confirmed quote does not match the swap application.");
      }
      if (confirmedQuote.sellAmount !== intent.sellAmount) {
        throw new PrivateSwapError("The confirmed quote does not match the sell amount.");
      }
    }
    const fresh = await getOnChainSwapQuote(this.provider(), app, intent.sellAmount);
    const referenceBuyAmount = confirmedQuote?.buyAmount ?? fresh.buyAmount;
    const minOutput = computeMinOutput(referenceBuyAmount, intent.slippageBps);
    if (fresh.buyAmount < minOutput) {
      throw new PrivateSwapQuoteStaleError();
    }

    // Exact swap calls for the configured application: the shadow account approves the curve to
    // pull STRK, then buys with the output going to the SHADOW ACCOUNT (so the anonymizer collects
    // it into a private note; the application never sees the root wallet).
    const calls = [
      {
        contractAddress: app.sellToken.address,
        entrypoint: "approve" as const,
        calldata: approveCalldata(app.swapContract, intent.sellAmount),
      },
      {
        contractAddress: app.swapContract,
        entrypoint: app.swapEntrypoint,
        calldata: ["0x" + intent.sellAmount.toString(16), identity.shadowAddress],
      },
    ];

    // Execute through the EXISTING real shadow path (WalletRuntime → WalletPrivacySession →
    // shadowAccountInvoke → SDK shadowAccounts(appName).invoke → private paymaster). The STRK is
    // withdrawn privately into the shadow account; the buy token is collected back into a fresh
    // private note (collectTokens). NO STRK remainder note is opened: the buy spends the shadow
    // account's entire STRK, so a "collect all STRK" note would settle 0 and the anonymizer
    // reverts with ZERO_BALANCE. Unspent private STRK notes return via the pool's surplus.
    const result = await this.privacySession.executeShadowApplication({
      appName: identity.appName,
      nonce: intent.nonce,
      token: app.sellToken.address,
      amount: intent.sellAmount,
      calls,
      destination: this.wallet.address,
      collectTokens: [app.buyToken.address],
    });

    return {
      transactionHash: result.transactionHash,
      status: "PENDING",
      action: "private.swap",
      sellToken: app.sellToken.address,
      buyToken: app.buyToken.address,
      sellAmount: intent.sellAmount,
      minOutput,
      appName: identity.appName,
      nonce: identity.nonce,
      swapContract: app.swapContract,
      shadowAddress: result.shadowAddress,
      commitment: result.commitment,
    };
  }
}