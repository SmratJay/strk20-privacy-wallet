/**
 * @file src/ai/shadow.ts
 * @description STRK20 Shadow Account capability + commitment derivation (feature-gated).
 *
 * The vendored STRK20 SDK ships a `shadow_account_anonymizer` execution identity keyed by
 * (user, viewingKey, anonymizer contract, dappName, nonce). This repository does NOT wire the
 * anonymizer contract by default: `SHADOW_ACCOUNT_ANONYMIZER_ADDRESS` is unset, so the
 * capability is DISABLED and the standard private-transfer path remains the execution lane.
 *
 * When the anonymizer IS configured, commitment derivation is computed with the real SDK
 * (`ShadowAccountsBuilder.partialCommitment` / `.commitment`) — locally, client/wallet-side,
 * never on the server and never exposed to the AI. This module never leaks the viewing key.
 *
 * Terminology:
 *   - STRK20 Private Identity = the Ready-derived user / note-owner (already in the repo).
 *   - Shadow Account = the SDK's anonymizer-derived execution identity (feature-gated here).
 */
import { createPrivateTransfers } from '@starkware-libs/starknet-privacy-sdk';

export const SHADOW_ANONYMIZER_ENV = 'SHADOW_ACCOUNT_ANONYMIZER_ADDRESS';
export const SHADOW_DAPP_ENV = 'SHADOW_ACCOUNT_DAPP_NAME';
export const DEFAULT_SHADOW_DAPP_NAME = 'orrange';

export interface ShadowAccountCapability {
  enabled: boolean;
  reason: string;
  anonymizerAddress?: string;
  dappName?: string;
}

/**
 * Detect whether the shadow-account anonymizer is configured. Defaults to DISABLED — the repo
 * ships no anonymizer address, so we never claim Shadow Accounts are operational.
 */
export function getShadowAccountCapability(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): ShadowAccountCapability {
  const anonymizer = (env[SHADOW_ANONYMIZER_ENV] ?? '').trim();
  if (!anonymizer) {
    return {
      enabled: false,
      reason:
        'no SHADOW_ACCOUNT_ANONYMIZER_ADDRESS configured — the shadow-account anonymizer is not wired in this build',
    };
  }
  return {
    enabled: true,
    reason: 'shadow-account anonymizer configured',
    anonymizerAddress: anonymizer,
    dappName: (env[SHADOW_DAPP_ENV] ?? '').trim() || DEFAULT_SHADOW_DAPP_NAME,
  };
}

function toFelt(value: bigint | string): string {
  return typeof value === 'string' && /^0x/i.test(value) ? value : '0x' + BigInt(value).toString(16);
}

export interface ShadowCommitmentInput {
  /** STRK20 private identity (the user address). */
  user: bigint | string;
  /** Client/wallet-controlled viewing key felt. NEVER sent to the server or the AI. */
  viewingKey: bigint | string;
  anonymizerAddress: string;
  dappName: string;
  poolContractAddress: string;
}

export interface ShadowCommitmentResult {
  partialCommitment: string;
  commitment: (nonce: bigint) => Promise<string>;
}

/**
 * Derive the shadow-account commitment for (user, viewingKey, anonymizer, dapp, nonce) using
 * the REAL vendored SDK. Side-effect-free for commitment computation (no network). Call this
 * only in the client/wallet execution layer — the server/AI never sees the viewing key.
 */
export async function deriveShadowCommitment(input: ShadowCommitmentInput): Promise<ShadowCommitmentResult> {
  const transfers = createPrivateTransfers({
    account: { address: toFelt(input.user), signer: {} as never },
    viewingKeyProvider: { getViewingKey: async () => BigInt(input.viewingKey) },
    provingProvider: { url: 'https://prover.invalid', chainId: '0x0' } as never,
    discoveryProvider: { url: 'https://discovery.invalid' } as never,
    poolContractAddress: toFelt(input.poolContractAddress),
    shadowAccountAnonymizerAddress: toFelt(input.anonymizerAddress),
  });
  const shadow = transfers.build().shadowAccounts(input.dappName);
  const partial = await shadow.partialCommitment();
  return {
    partialCommitment: partial.toString(),
    commitment: async (nonce: bigint) => (await shadow.commitment(nonce)).toString(),
  };
}