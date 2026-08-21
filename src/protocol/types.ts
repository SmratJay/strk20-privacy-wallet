/**
 * @file src/protocol/types.ts
 * @description PEL BTC-PERP Canonical Protocol Types — Single Source of Truth
 * All Cairo contracts, TypeScript services, and tests must import from here.
 * Never duplicate these definitions elsewhere.
 */

// ─── Domain Separators ─────────────────────────────────────────────────────────
// Canonical values live in src/protocol/canonical.ts (DOMAIN_SEP, NULLIFIER_TAG,
// MARGIN_NULLIFIER_TAG, PAYOUT_TAG) and MUST match the Circom circuits. These
// legacy constants are kept for backwards-compatibility only — do not use them for
// commitment/nullifier computation.

export const DOMAIN_SEPARATOR = '0x50454c5f504f534954494f4e5f5632' as const;      // "PEL_POSITION_V2"
export const NULLIFIER_TAG    = '0x50454c5f4e554c4c49464945525f5632' as const;      // "PEL_NULLIFIER_V2"
export const STWO_FACT_TAG    = '0x5354574f5f534e495033365f50524f4f465f5632' as const; // "STWO_SNIP36_PROOF_V2"
export const FUNDING_TAG      = '0x46554e44494e475f5441473a5631' as const;            // "FUNDING_TAG:V1"

// ─── Protocol Version (canonical: 3 — matches Cairo config_version) ────────────

export const PROTOCOL_VERSION = 3 as const;

// ─── Fixed-Point Scales ───────────────────────────────────────────────────────

export const PRICE_SCALE   = 100n;          // 1 USD = 100 cents
export const QTY_SCALE     = 100_000_000n;  // 1 BTC = 1e8 sats
export const RATE_SCALE    = 100_000_000n;  // 1.0 = 1e8 (funding rate)
export const BPS_SCALE     = 10_000n;       // 1.0 = 10000 bps

// ─── Canonical Private Position State ────────────────────────────────────────
// This is the client-side private witness. It NEVER goes on-chain.
// It MUST contain enough information to regenerate the commitment and all proofs.

export interface PrivatePositionState {
  readonly protocolVersion: 2 | 3;
  readonly marketId: 'BTC-PERP';           // V1: single market only
  readonly side: 'LONG' | 'SHORT';         // MUST be in commitment hash
  readonly quantitySats: bigint;           // 1e8 fixed-point: 0.1 BTC = 10_000_000n
  readonly entryPriceCents: bigint;        // 1e2 fixed-point: $96,420.50 = 9_642_050n
  readonly marginCents: bigint;            // 1e2 fixed-point: $1,000 = 100_000n
  readonly fundingCents: bigint;           // Cumulative funding paid, cents (>= 0)
  readonly feesCents: bigint;              // Cumulative fees paid, cents (>= 0)
  readonly nonce: string;                  // 0x-prefixed 32-byte hex, CSPRNG
  readonly ownerSecret: string;            // 0x-prefixed 32-byte hex — NEVER leaves client
  readonly commitment: string;             // Derived: Poseidon commitment C_t
  readonly nullifier: string;              // Derived: Poseidon nullifier NF_t
  readonly openedAtMs: number;             // Unix ms — display only
  readonly onChainTxHash?: string;         // Confirmed on-chain open tx
  readonly onChainMarketId?: string;       // On-chain market_id felt252 (hex)
}

// ─── BTC-PERP Market Configuration ───────────────────────────────────────────
// Single authoritative config. Cairo constructor must mirror these values.

export interface MarketConfig {
  readonly marketId: 'BTC-PERP';
  readonly maxLeverage: number;             // 50
  readonly initialMarginBps: number;        // 200 (2.0%)
  readonly maintenanceMarginBps: number;    // 200 (2.0%)
  readonly takerFeeBps: number;             // 7   (0.07%)
  readonly makerFeeBps: number;             // 2   (0.02%)
  readonly fundingRateBpsHr: number;        // 120 (0.0012% / hour), can be negative
  readonly fundingIntervalSecs: number;     // 3600
  readonly maxOracleAgeSecs: number;        // 180
  readonly maxExecDeviationBps: number;     // 100 (1.0%)
  readonly configVersion: number;           // 3
}

export const BTC_PERP_CONFIG: MarketConfig = {
  marketId:            'BTC-PERP',
  maxLeverage:         50,
  initialMarginBps:    200,
  maintenanceMarginBps:200,
  takerFeeBps:         7,
  makerFeeBps:         2,
  fundingRateBpsHr:    120,
  fundingIntervalSecs: 3600,
  maxOracleAgeSecs:    180,
  maxExecDeviationBps: 100,
  configVersion:       3,
} as const;

// ─── On-Chain Oracle Price ────────────────────────────────────────────────────

export interface OraclePriceFeed {
  readonly priceCents: bigint;    // USD cents
  readonly timestamp: number;     // Unix seconds (on-chain block timestamp)
  readonly isFresh: boolean;      // priceCents > 0 && age <= maxOracleAgeSecs
  readonly source: 'on-chain' | 'api-fallback';
}

// ─── Proof Artifact ──────────────────────────────────────────────────────────

export type ProofType = 'OPEN' | 'UPDATE' | 'FUND' | 'CLOSE' | 'LIQUIDATE';

export interface TransitionFact {
  readonly proofType: ProofType;
  readonly factHash: string;          // Submitted to StwoVerifier
  readonly publicInputsHash: string;  // Poseidon(proofType, marketId, commitment, nullifier, amount, price)
  readonly commitment: string;        // New commitment C_t+1 (or C_0 for OPEN)
  readonly nullifier: string;         // Consumed nullifier NF_t
  readonly amountCents: bigint;       // margin (OPEN), payout (CLOSE), funding (FUND)
  readonly oraclePriceCents: bigint;  // Oracle price at proof generation time
  readonly timestamp: number;
}

// ─── Position Record (public, from on-chain get_position) ────────────────────

export interface OnChainPositionRecord {
  readonly commitment: string;
  readonly marginNullifier: string;
  readonly lockedMarginCents: bigint;
  readonly marketId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly isActive: boolean;
}

// ─── Relayer Call Schemas ────────────────────────────────────────────────────
// Exact parameter counts that relayerSecurity.ts enforces.

export const CALLDATA_SCHEMAS = {
  open_position:            { expectedLength: 6, fields: ['collateral_owner', 'market_id', 'commitment', 'margin_nullifier', 'margin_amount', 'fact_hash'] },
  update_position:          { expectedLength: 5, fields: ['market_id', 'old_commitment', 'old_nullifier', 'new_commitment', 'fact_hash'] },
  fund_position:            { expectedLength: 7, fields: ['market_id', 'commitment', 'old_nullifier', 'new_commitment', 'funding_amount', 'is_long_pays', 'fact_hash'] },
  close_position:           { expectedLength: 7, fields: ['market_id', 'commitment', 'final_nullifier', 'payout_note_commitment', 'payout_amount', 'recipient', 'fact_hash'] },
  liquidate_position:       { expectedLength: 5, fields: ['market_id', 'commitment', 'nullifier', 'fact_hash', 'keeper_recipient'] },
  claim_keeper_bounty:      { expectedLength: 1, fields: ['keeper_recipient'] },
  claim_payout:             { expectedLength: 2, fields: ['payout_nullifier', 'recipient_note_commitment'] },
  register_verified_fact:   { expectedLength: 8, fields: ['proof_type', 'market_id', 'commitment', 'nullifier', 'amount', 'oracle_price', 'recipient', 'fact_hash'] },
  deposit_liquidity:        { expectedLength: 1, fields: ['amount'] },
  withdraw_liquidity_shares:{ expectedLength: 1, fields: ['shares'] },
} as const;
