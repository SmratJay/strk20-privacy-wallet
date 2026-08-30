import { NextRequest, NextResponse } from 'next/server';
import { SEPOLIA_TOKENS } from '@/config/networks';
import { createDefaultProvider } from '@/ai/provider';
import { analyzeTreasury } from '@/ai/agent';
import { buildExecutionPolicy, evaluateProposal, DEFAULT_TREASURY_POLICY, TreasuryPolicy } from '@/ai/policy';
import { buildPortfolioSummary, PrivateBalanceRow } from '@/ai/portfolio';
import { resolvePortfolioPrices, AssetPrice } from '@/ai/prices';

/**
 * Hamster AI analyze endpoint (M2).
 *
 *   POST /api/ai/analyze
 *   { prompt, balances: [{ token, balance }], context: { userAddress, shadowAccountAddress } }
 *
 * The server is the ONLY place policy is decided:
 *   - it fetches FRESH prices (AVNU) and rebuilds the portfolio summary itself — stale or
 *     static volatile prices cannot authorize execution;
 *   - it builds the execution policy from the user's primary + Shadow Account addresses and
 *     server-configured allowlists — the model can never invent a destination or asset;
 *   - it returns a structured, schema-validated proposal plus the policy verdict.
 *
 * The AI NEVER receives notes, viewing keys, private keys, or per-transaction metadata — only
 * the aggregate balances the client already reads through the STRK20 wallet lane.
 */

const MAX_PROMPT_CHARS = 2000;
const MAX_BALANCES = 50;

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

function sanitizedPolicyView(policy: TreasuryPolicy) {
  return {
    minLiquidityUsd: policy.minLiquidityUsd,
    maxPositionPct: policy.maxPositionPct,
    maxTxUsd: policy.maxTxUsd,
    allowedAssetCount: policy.allowedAssets.length,
    allowedDestinationCount: policy.allowedDestinations.length,
  };
}

export async function POST(req: NextRequest) {
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

  const rows: PrivateBalanceRow[] = [];
  for (const raw of body.balances) {
    if (!isRecord(raw) || typeof raw.token !== 'string' || typeof raw.balance !== 'string') {
      return NextResponse.json({ error: 'each balance must be { token, balance }.' }, { status: 400 });
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

  const context = isRecord(body.context) ? body.context : {};
  const userAddress = typeof context.userAddress === 'string' ? context.userAddress : '';
  const shadowAccountAddress =
    typeof context.shadowAccountAddress === 'string' ? context.shadowAccountAddress : '';

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

  // 2. Server-authoritative policy: user + Shadow Account + configured allowlists only.
  const built = buildExecutionPolicy({
    userAddress,
    shadowAccountAddress,
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

  return NextResponse.json({
    summary,
    proposal,
    verdict,
    policy: sanitizedPolicyView(policy),
  });
}