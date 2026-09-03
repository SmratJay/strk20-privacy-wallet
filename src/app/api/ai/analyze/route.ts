import { NextRequest, NextResponse } from 'next/server';
import { SEPOLIA_TOKENS } from '@/config/networks';
import { createDefaultProvider } from '@/ai/provider';
import { runAgentLoop } from '@/ai/agent';
import { AgentToolContext, RecentActivityRow } from '@/ai/tools';
import { planToProposal, planToJsonSafe } from '@/ai/plan';
import { getShadowAccountCapability } from '@/ai/shadow';
import { buildExecutionPolicy, evaluateProposal, DEFAULT_TREASURY_POLICY, resolveUserPolicy, PolicyVerdict } from '@/ai/policy';
import { buildPortfolioSummary, PrivateBalanceRow } from '@/ai/portfolio';
import { resolvePortfolioPrices, AssetPrice } from '@/ai/prices';
import { computeTreasuryHealth } from '@/ai/health';
import { canonicalizeAddress } from '@/ai/address';

/**
 * Hamster AI analyze endpoint (M2 — agent loop).
 *
 *   POST /api/ai/analyze
 *   { prompt, balances: [{ token, balance }], context: { userAddress, privateTreasuryAddress },
 *     policy?: { preset, custom? }, recentActivity?: [...] }
 *
 * The endpoint runs the bounded agent loop: the model emits deterministic tool calls (read /
 * simulate / inspect — never execution primitives), then a structured AgentPlan. All scenario
 * numbers are computed server-side with the same deterministic policy math the rest of the app
 * uses. The response returns the validated plan plus a derived proposal/verdict for back-compat
 * with the existing execution gate.
 *
 * Security boundaries:
 *   - The server fetches FRESH AVNU prices and rebuilds the portfolio summary itself, so a
 *     stale/static volatile price cannot authorize execution.
 *   - Only tokens present in the existing `SEPOLIA_TOKENS` configuration are accepted; an
 *     unknown token address is rejected (400) — no invented metadata for unknown assets.
 *   - Destinations are ONLY the user's primary account, the STRK20 private treasury identity,
 *     and any server-configured allowlist. There is no Privy session: the addresses are
 *     client-claimed inputs from the Wallet Core runtime, and the final execution gate
 *     independently re-checks state and requires the user's wallet signature.
 *   - The AI can never modify policy (server-validated user selection), add a destination, or
 *     emit arbitrary calldata. The shadow-account anonymizer is feature-gated and NOT wired in
 *     this build unless the anonymizer address is configured.
 *   - Balances are wallet-provided analysis input, not server-verified on-chain truth.
 *   - Plans carry generatedAt/expiresAt; execution must re-fetch state and re-run policy.
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
  /** User-selected guardrail (preset or custom limits). Server-validated; the AI can never change it. */
  policy?: unknown;
  /** Compact recent treasury activity (the user's own private transfers). Optional. */
  recentActivity?: unknown;
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
  void req;
  return null;
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
 * There is no server-side wallet session (Privy is removed). Addresses are always the
 * client-claimed Wallet Core runtime addresses; the execution gate independently re-checks
 * current state and requires the user's wallet signature before anything moves.
 */
function resolveVerifiedAddresses(): Promise<{ userAddress: string; privateTreasuryAddress: string } | null> {
  return Promise.resolve(null);
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

  // Addresses: client-claimed Wallet Core runtime addresses (no server-side wallet session).
  const verified = await resolveVerifiedAddresses();
  const context = isRecord(body.context) ? body.context : {};
  const clientUser = typeof context.userAddress === 'string' ? context.userAddress : '';
  const clientTreasury =
    typeof context.privateTreasuryAddress === 'string' ? context.privateTreasuryAddress : '';
  const verification: 'client-claimed' = 'client-claimed';
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

  // 2. Server-authoritative policy: user-selected guardrail (validated) + verified/user
  //    addresses + configured allowlists only. The LLM can NEVER influence any of it.
  const resolvedPolicy = resolveUserPolicy(body.policy);
  if (!resolvedPolicy.ok) {
    return NextResponse.json({ error: resolvedPolicy.error }, { status: 400 });
  }
  const built = buildExecutionPolicy({
    userAddress,
    privateTreasuryAddress,
    allowedAssets: parseAllowlist(process.env.AI_ALLOWED_ASSETS),
    allowedDestinations: parseAllowlist(process.env.AI_ALLOWED_DESTINATIONS),
    base: { ...DEFAULT_TREASURY_POLICY, ...resolvedPolicy.values },
  });
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }
  const policy = built.policy;

  // 3. Run the bounded agent loop: the model emits deterministic tool calls, then a plan.
  let provider;
  try {
    provider = createDefaultProvider();
  } catch (e) {
    return NextResponse.json(
      { error: `AI provider is not configured: ${e instanceof Error ? e.message : 'unknown'}` },
      { status: 502 },
    );
  }

  // Compact recent activity (the user's own private transfers), if the client sent it.
  const recentActivity: RecentActivityRow[] = Array.isArray(body.recentActivity)
    ? body.recentActivity
        .filter((r): r is RecentActivityRow => isRecord(r) && typeof r.id === 'string' && typeof r.tokenSymbol === 'string')
        .slice(0, 10)
    : [];

  const agentContext: AgentToolContext = {
    summary,
    policy,
    health: computeTreasuryHealth(summary, policy),
    prices,
    identity: { userAddress, privateTreasuryAddress, verification },
    recentActivity,
    shadowCapability: getShadowAccountCapability(),
  };

  let plan;
  try {
    ({ plan } = await runAgentLoop(provider, agentContext, prompt));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ error: `AI analysis failed: ${msg}` }, { status: 502 });
  }

  // Derive the execution-facing proposal from the plan (advisory — the execution gate re-checks).
  const proposal = planToProposal(plan);
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
    plan: planToJsonSafe(plan),
    proposal,
    verdict: verdictDto,
    shadowCapability: agentContext.shadowCapability,
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