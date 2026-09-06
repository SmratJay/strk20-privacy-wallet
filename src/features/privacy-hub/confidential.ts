/**
 * Privacy Hub — Confidential Intents provider SEAM (NOT an implementation).
 *
 * Research (official docs.near-intents.org, verified against the live 1Click API 2026-09-06):
 *
 *   - Confidential Intents is a private-transaction layer on NEAR Intents: a public NEAR chain
 *     (`intents.near`) plus a private NEAR fork `FAR` (`intents.far`) where swaps settle with
 *     shielded balances. The Private PoA Bridge mints/burns IMT tokens across the boundary.
 *   - A consumer/integrator can opt into it via the 1Click REST API's `confidentiality` field
 *     (`"basic" | "advanced"`) on a normal foreign-to-foreign `ORIGIN_CHAIN → DESTINATION_CHAIN`
 *     swap — everything else is identical to a standard swap.
 *   - BLOCKER (verified live): confidential quotes return HTTP 401 `"User authentication is
 *     required for confidential intent quotes"`. `confidentiality: "public"` works keyless; `basic`/
 *     `advanced` require a User-Session token from `/v0/auth/authenticate` (a signed proof of
 *     account ownership via NEP-413 / ERC-191 / WebAuthn / raw-ed25519 / ...).
 *   - The current Orrange Wallet Core is a STARKNET account; NEAR Intents has NO Starknet signing
 *     standard, so it cannot produce the signed message a User-Session token requires. Direct
 *     confidential integration is therefore NOT consumable by this project's Starknet-only source
 *     identity today.
 *
 * We are a CONSUMER. This module is the boundary only: it declares the capability metadata + an
 * explicit `unavailable` state and a provider type the future integration can fill in. It performs
 * NO HTTP, returns NO quotes, and fabricates NO settlement — and it is never registered in the hub,
 * so the hub can never accidentally route to it.
 */
import { PrivacyHubError } from "./types";
import type {
  PrivacyHubIntent,
  PrivacyHubQuote,
  PrivacyHubPrepared,
  PrivacyHubStatus,
  PrivacyHubReceipt,
  PrivacyHubReadiness,
} from "./types";
import type { CrossChainProvider } from "./provider";

export type ConfidentialityLevel = "public" | "basic" | "advanced";

/** Researched integration facts + explicit availability for confidential execution. */
export interface ConfidentialIntentAvailability {
  available: boolean;
  reason: string | null;
  /** Confidential quotes require a User-Session token (signed proof of account ownership). */
  requiresUserSessionAuth: boolean;
  /** NEAR Intents advertises no Starknet intent-signing standard. */
  starknetSigningSupported: boolean;
  /** `confidentiality` values the 1Click API accepts (from the official docs). */
  supportedLevels: readonly ConfidentialityLevel[];
}

/**
 * Current (2026-09) authoritative availability. `available: false`; the exact blocker is captured
 * in `reason` and documented in docs/PRIVACY_HUB.md.
 */
export function confidentialIntentAvailability(): ConfidentialIntentAvailability {
  return {
    available: false,
    reason:
      "NEAR confidential-intent quotes require User-Session authentication " +
      "(a signed proof of account ownership; NEP-413 / ERC-191 / WebAuthn / raw-ed25519 — none " +
      "of which the Starknet Wallet Core account can produce). Confidential execution is not yet " +
      "consumable by this project's Starknet-only source identity.",
    requiresUserSessionAuth: true,
    starknetSigningSupported: false,
    supportedLevels: ["basic", "advanced"],
  };
}

/**
 * The provider SEAM for a future confidential-execution integration. It is NOT registered in the
 * hub (`PRIVACY_HUB_ROUTES` routes only to `near-intents`) and every method fails with an explicit
 * unavailable error — never a fabricated quote, deposit address, or settlement.
 */
export class ConfidentialIntentProvider implements CrossChainProvider {
  readonly id = "confidential-intents";
  readonly availability = confidentialIntentAvailability();

  private unavailable(): never {
    throw new PrivacyHubError(
      `Confidential execution is unavailable: ${this.availability.reason ?? "unknown reason"}`,
    );
  }

  async quote(_intent: PrivacyHubIntent): Promise<PrivacyHubQuote> {
    return this.unavailable();
  }

  async prepare(_intent: PrivacyHubIntent, _quote: PrivacyHubQuote | null): Promise<PrivacyHubPrepared> {
    return this.unavailable();
  }

  async execute(
    _intent: PrivacyHubIntent,
    _prepared: PrivacyHubPrepared,
  ): Promise<PrivacyHubReceipt> {
    return this.unavailable();
  }

  async status(_reference: string): Promise<PrivacyHubStatus> {
    return this.unavailable();
  }

  async readiness(_intent: PrivacyHubIntent): Promise<PrivacyHubReadiness> {
    return {
      provider: this.id,
      ready: false,
      checks: [{ name: "confidential execution available", ok: false, detail: this.availability.reason ?? null }],
      reason: this.availability.reason,
    };
  }
}
