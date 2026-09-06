/**
 * Privacy Hub — orchestration service.
 *
 * Owns the routing decision (intent → route → provider) and forwards the lifecycle. It implements
 * NO keys, STRK20, Shadow Accounts, proving, NEAR HTTP, or solver logic — it only validates, routes,
 * and delegates to the registered provider (today: `NearIntentProvider` → `NearIntentAdapter`).
 */
import {
  validatePrivacyHubIntent,
  computeHubMinOutput,
  PrivacyHubError,
  type PrivacyHubIntent,
  type PrivacyHubQuote,
  type PrivacyHubPrepared,
  type PrivacyHubStatus,
  type PrivacyHubReceipt,
  type PrivacyHubReadiness,
  type PrivacyHubPhase,
} from "./types";
import { resolvePrivacyHubRoute, privacyHubRouteById, type PrivacyHubRoute, type ProviderCapability } from "./routes";
import type { CrossChainProvider } from "./provider";

export interface PrivacyHubOptions {
  providers: Record<string, CrossChainProvider>;
}

export class PrivacyHub {
  private readonly providers: Record<string, CrossChainProvider>;

  constructor(options: PrivacyHubOptions) {
    this.providers = options.providers;
  }

  private resolveRoute(intent: PrivacyHubIntent): PrivacyHubRoute {
    const route = intent.routeId
      ? privacyHubRouteById(intent.routeId)
      : resolvePrivacyHubRoute(intent.sourceChain, intent.sourceAsset, intent.destinationChain, intent.destinationAsset);
    if (!route) {
      throw new PrivacyHubError(
        `Unsupported cross-chain route: ${intent.sourceChain}:${intent.sourceAsset} → ${intent.destinationChain}:${intent.destinationAsset}.`,
      );
    }
    return route;
  }

  private providerFor(route: PrivacyHubRoute, capability: ProviderCapability): CrossChainProvider {
    const provider = this.providers[route.provider];
    if (!provider) {
      throw new PrivacyHubError(`No provider registered for "${route.provider}".`);
    }
    if (!route.capabilities.includes(capability)) {
      throw new PrivacyHubError(`Provider "${route.provider}" does not support "${capability}" on route "${route.id}".`);
    }
    return provider;
  }

  private validate(intent: PrivacyHubIntent): PrivacyHubRoute {
    const invalid = validatePrivacyHubIntent(intent);
    if (invalid) throw new PrivacyHubError(`Invalid cross-chain intent: ${invalid}`);
    if (intent.expiry !== undefined && intent.expiry <= Date.now()) {
      throw new PrivacyHubError("Cross-chain intent has expired.");
    }
    return this.resolveRoute(intent);
  }

  /** Fetch a pricing quote bound to the intent (never a UI-supplied output). */
  async quote(intent: PrivacyHubIntent): Promise<PrivacyHubQuote> {
    const route = this.validate(intent);
    const provider = this.providerFor(route, "quote");
    return provider.quote(intent);
  }

  /** Reserve/publish what the provider needs to execute (the publish step before funding). */
  async prepare(intent: PrivacyHubIntent, quote: PrivacyHubQuote | null): Promise<PrivacyHubPrepared> {
    const route = this.validate(intent);
    const provider = this.providerFor(route, "prepare");
    return provider.prepare(intent, quote);
  }

  /** Execute: source-side private funding + track to a terminal state (provider reconciles). */
  async execute(
    intent: PrivacyHubIntent,
    prepared: PrivacyHubPrepared,
    options?: { onPhase?: (phase: PrivacyHubPhase) => void },
  ): Promise<PrivacyHubReceipt> {
    const route = this.validate(intent);
    const provider = this.providerFor(route, "execute");
    if (prepared.route !== route.id && prepared.route !== route.name) {
      throw new PrivacyHubError("The prepared intent does not match the resolved route.");
    }
    return provider.execute(intent, prepared, options);
  }

  /** Reconcile a previously prepared reference to a terminal state. */
  async status(reference: string, providerId?: string): Promise<PrivacyHubStatus> {
    const id = providerId ?? "near-intents";
    const provider = this.providers[id];
    if (!provider) throw new PrivacyHubError(`No provider registered for "${id}".`);
    return provider.status(reference);
  }

  /** Live pre-flight readiness (defaults to always-ready when the provider omits it). */
  async readiness(intent: PrivacyHubIntent): Promise<PrivacyHubReadiness> {
    const route = this.validate(intent);
    const provider = this.providerFor(route, "readiness");
    if (!provider.readiness) {
      return { provider: provider.id, ready: true, checks: [], reason: null };
    }
    return provider.readiness(intent);
  }

  /** Derive the min-output floor from a hub quote (for UI display; integer math only). */
  minOutput(amountOut: bigint, slippageBps: number): bigint {
    return computeHubMinOutput(amountOut, slippageBps);
  }
}
