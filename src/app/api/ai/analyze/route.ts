import { NextRequest, NextResponse } from 'next/server';
import { SEPOLIA_TOKENS } from '@/config/networks';
import { createDefaultProvider } from '@/ai/provider';
import { analyzeTreasury } from '@/ai/agent';
import { buildExecutionPolicy, evaluateProposal, DEFAULT_TREASURY_POLICY, PolicyVerdict } from '@/ai/policy';
import { buildPortfolioSummary, PrivateBalanceRow } from '@/ai/portfolio';
import { resolvePortfolioPrices, AssetPrice } from '@/ai/prices';
import { canonicalizeAddress } from '@/ai/address';
import { computeReadyAccountAddress } from '@/privacy/privy/ready';

/**
 * Hamster AI analyze endpoint (M2).
 *
 *   POST /api/ai/analyze
 *   { prompt, balances: [{ token, balance }], context: { userAddress, privateTreasuryAddress } }
 *   Authorization: Bearer <privy-session-jwt>  (optional; preferred when present)
 *
 * Security boundaries:
 *   - The server fetches FRESH AVNU prices and rebuilds the portfolio summary itself, so a
 *     stale/static volatile price cannot authorize execution.
 *   - Only tokens present in the existing `SEPOLIA_TOKENS` configuration are accepted; an
 *     unknown token address is rejected (400) — no invented metadata for unknown assets.
 *   - Destinations are ONLY the user's primary account, the STRK20 private treasury
 *     identity, and any server-configured allowlist. When a valid Privy session is supplied,
 *     those addresses are derived server-side from the verified user's Starknet wallet (the
 *     treasury identity is `computeReadyAccountAddress(publicKey)` — the exact address the
 *     existing STRK20 integration uses as its `user`, owning private notes and sourcing
 *     private transfers), and client-supplied addresses are ignored. Without a session they
 *     are accepted only as NON-authoritative, client-claimed inputs
 *     (`addressVerification: 'client-claimed'`) — the final wallet confirmation/execution
 *     gate independently re-checks state and requires the user's signature.
 *   - The SDK's separate "Shadow Account" (`shadow_account_anonymizer`) is NOT used by this
 *     integration; the treasury identity above is distinct from it.
 *   - Balances are wallet-provided analysis input, not server-verified on-chain truth.
 *   - Proposals carry generatedAt/expiresAt; execution must re-fetch state and re-run policy.
 *
 * The AI NEVER receives notes, viewing keys, private keys, or per-transaction metadata.
 */

const MAX_PROMPT_CHARS = 2000;
const MAX_BALANCES = 50;
const PROPOSAL_TTL_MS = 120_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

interface AnalyzeBody {
  prompt?: unknown;
  balances?: unknown;
  context?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function parseAllowlist(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/** Minimal in-memory sliding-window request guard (best-effort; not a security boundary). */
const rateBuckets = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const buckets = (rateBuckets.get(ip) ?? []).filter((t) => t > windowStart);
  if (buckets.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(ip, buckets);
    return true;
  }
  buckets.push(now);
  rateBuckets.set(ip, buckets);
  return false;
}

/**
 * Server-verified addresses when a valid Privy session is presented. Returns null when the
 * session cannot be verified or Privy is not configured — callers then fall back to the
 * client-claimed (non-authoritative) path.
 */
async function resolveVerifiedAddresses(
  token: string | null,
): Promise<{ userAddress: string; privateTreasuryAddress: string } | null> {
  if (!token) return null;
  try {
    const { getPrivyServerClient } = await import('@/privacy/privy/server');
    const privy = getPrivyServerClient();
    const claims = await privy.verifyAuthToken(token);
    const user: any = await privy.getUserById(claims.userId);
    const walletId = user?.customMetadata?.starknetWalletId;
    if (typeof walletId !== 'string' || !walletId) return null;
    const wallet: any = await privy.walletApi.getWallet({ id: walletId });
    const address = String(wallet?.address ?? '');
    const publicKey = String(wallet?.public_key ?? wallet?.publicKey ?? '');
    if (!address || !publicKey) return null;
    let treasury: string;
    try {
      // The STRK20 user identity (owns private notes + sources private transfers).
      treasury = computeReadyAccountAddress(publicKey);
    } catch {
      return null;
    }
    return { userAddress: address, privateTreasuryAddress: treasury };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  if (rateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 });
  }

  let body: AnalyzeBody;
  try {
    body = (await req.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  if (typeof body.prompt !== 'string' || body.prompt.trim() === '') {
    return NextResponse.json({ error: 'prompt is required.' }, { status: 400 });
  }
  const prompt = body.prompt.trim();
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: `prompt too long (max ${MAX_PROMPT_CHARS} chars).` }, { status: 400 });
  }

  if (!Array.isArray(body.balances) || body.balances.length === 0 || body.balances.length > MAX_BALANCES) {
    return NextResponse.json({ error: `balances array (1..${MAX_BALANCES}) is required.` }, { status: 400 });
  }

  // Every token MUST be a supported token in SEPOLIA_TOKENS (canonical match). Unknown → 400.
  const supportedTokens = new Set<string>();
  for (const t of SEPOLIA_TOKENS) {
    const c = canonicalizeAddress(t.address);
    supportedTokens.add(c.ok ? c.value : t.address.toLowerCase());
  }
  const rows: PrivateBalanceRow[] = [];
  for (const raw of body.balances) {
    if (!isRecord(raw) || typeof raw.token !== 'string' || typeof raw.balance !== 'string') {
      return NextResponse.json({ error: 'each balance must be { token, balance }.' }, { status: 400 });
    }
    const canonical = canonicalizeAddress(raw.token);
    if (!canonical.ok || !supportedTokens.has(canonical.value)) {
      return NextResponse.json({ error: `unsupported token: ${raw.token}.` }, { status: 400 });
    }
    let balance: bigint;
    try {
      balance = BigInt(raw.balance);
    } catch {
      return NextResponse.json({ error: `invalid balance for ${raw.token}.` }, { status: 400 });
    }
    if (balance < 0n) {
      return NextResponse.json({ error: `negative balance for ${raw.token}.` }, { status: 400 });
    }
    rows.push({ token: raw.token, balance });
  }

  // Addresses: server-verified (Privy session) preferred; otherwise client-claimed.
  const verified = await resolveVerifiedAddresses(bearerToken(req));
  const context = isRecord(body.context) ? body.context : {};
  const clientUser = typeof context.userAddress === 'string' ? context.userAddress : '';
  const clientTreasury =
    typeof context.privateTreasuryAddress === 'string' ? context.privateTreasuryAddress : '';
  const verification: 'privy' | 'client-claimed' = verified ? 'privy' : 'client-claimed';
  const userAddress = verified?.userAddress ?? clientUser;
  const privateTreasuryAddress = verified?.privateTreasuryAddress ?? clientTreasury;

  // 1. Fresh prices, server-side (no stale-price reuse; static volatile prices are advisory).
  const symbols = new Set<string>();
  const symbolByToken = new Map<string, string>();
  for (const row of rows) {
    const token = row.token.toLowerCase();
    const meta = SEPOLIA_TOKENS.find((t) => t.address.toLowerCase() === token);
    if (meta) {
      symbols.add(meta.symbol);
      symbolByToken.set(token, meta.symbol);
    }
  }
  let prices: Record<string, AssetPrice> = {};
  try {
    const bySymbol = await resolvePortfolioPrices([...symbols]);
    prices = {};
    for (const [token, symbol] of symbolByToken) {
      const price = bySymbol[symbol];
      if (price) prices[token] = price;
    }
  } catch {
    return NextResponse.json({ error: 'Could not resolve asset prices.' }, { status: 502 });
  }
  const summary = buildPortfolioSummary(rows, prices);

  // 2. Server-authoritative policy: verified/user + treasury + configured allowlists only.
  const built = buildExecutionPolicy({
    userAddress,
    privateTreasuryAddress,
    allowedAssets: parseAllowlist(process.env.AI_ALLOWED_ASSETS),
    allowedDestinations: parseAllowlist(process.env.AI_ALLOWED_DESTINATIONS),
    base: DEFAULT_TREASURY_POLICY,
  });
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }
  const policy = built.policy;

  // 3. AI proposes (schema-validated), policy decides.
  let provider;
  try {
    provider = createDefaultProvider();
  } catch (e) {
    return NextResponse.json(
      { error: `AI provider is not configured: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 502 },
    );
  }

  let proposal;
  try {
    proposal = (await analyzeTreasury(provider, summary, prompt, policy)).proposal;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (/invalid proposal/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    return NextResponse.json({ error: `AI analysis failed: ${msg}` }, { status: 502 });
  }

  const verdict = evaluateProposal(proposal, summary, policy);

  const now = Date.now();

  // JSON-safe response DTO: bigint is serialized as a decimal string at the HTTP boundary.
  const verdictDto = {
    allowed: verdict.allowed,
    reportOnly: verdict.reportOnly,
    amountUsd: verdict.amountUsd,
    amountBaseUnits: verdict.amountBaseUnits.toString(),
    checks: verdict.checks,
  } satisfies PolicyVerdictTo;

  return NextResponse.json({
    summary,
    proposal,
    verdict: verdictDto,
    // Full effective policy is returned so the client can re-run the SAME deterministic
    // policy against CURRENT state (with fresh prices) before execution. The verdict is
    // advisory; this policy + a fresh state re-check are what gate execution client-side.
    policy,
    addresses: { userAddress, privateTreasuryAddress, verification },
    trust: {
      balances: 'wallet-provided-analysis-input',
      note: 'Execution independently re-checks current STRK20 state client-side and requires the user’s wallet confirmation before signing.',
    },
    proposalGeneratedAt: now,
    proposalExpiresAt: now + PROPOSAL_TTL_MS,
  });
}

type PolicyVerdictTo = {
  allowed: boolean;
  reportOnly: boolean;
  amountUsd: number;
  amountBaseUnits: string;
  checks: PolicyVerdict['checks'];
};