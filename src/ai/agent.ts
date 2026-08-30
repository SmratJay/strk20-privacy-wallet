/**
 * @file src/ai/agent.ts
 * @description Hamster AI orchestration: privacy-minimized portfolio + prompt → structured,
 * schema-validated proposal. Never signs and never executes — the policy engine and the
 * user confirm before the existing STRK20 stack runs anything.
 */
import { AiProvider } from '@/ai/provider';
import { ActionProposal, validateProposal } from '@/ai/schema';
import { PortfolioSummary } from '@/ai/portfolio';
import { TreasuryPolicy, DEFAULT_TREASURY_POLICY } from '@/ai/policy';

/** Build the system prompt: role, portfolio summary, policy rules, strict JSON schema. */
export function buildSystemPrompt(
  summary: PortfolioSummary,
  policy: TreasuryPolicy = DEFAULT_TREASURY_POLICY,
): string {
  const portfolioLines = summary.positions.length
    ? summary.positions
        .map(
          (p) =>
            `- ${p.symbol}: ${p.balanceHuman.toLocaleString(undefined, { maximumFractionDigits: 6 })} tokens ≈ $${p.usdValue.toFixed(2)} (${p.pct.toFixed(1)}% of treasury, price source: ${p.priceSource})`,
        )
        .join('\n')
    : '- (empty treasury)';
  const allowedAssets = policy.allowedAssets.length
    ? policy.allowedAssets.join(', ')
    : 'any asset present in the portfolio';
  const allowedDests = policy.allowedDestinations.length
    ? policy.allowedDestinations.join(', ')
    : 'NONE — execution is disabled (no approved destinations)';

  return [
    'You are Hamster AI, the private treasury agent for a Starknet STRK20 Private Treasury.',
    'You propose, you never execute. A deterministic policy engine and the user confirm before any transaction.',
    '',
    'PORTFOLIO (privacy-minimized aggregate — you never see notes, viewing keys, or tx metadata):',
    `Total: $${summary.totalUsd.toFixed(2)} · Liquid: $${summary.liquidityUsd.toFixed(2)} (${summary.liquidPct.toFixed(1)}%)`,
    portfolioLines,
    '',
    'TREASURY POLICY (you MUST respect these):',
    `- keep at least $${policy.minLiquidityUsd.toFixed(2)} liquid after any action`,
    `- no single position above ${policy.maxPositionPct}% after any action`,
    `- any single action ≤ $${policy.maxTxUsd.toFixed(2)}`,
    `- assets allowed: ${allowedAssets}`,
    `- destinations allowed: ${allowedDests}`,
    '',
    'RESPONSE: return ONLY strict JSON matching this schema:',
    '{',
    '  "intent": "short label (e.g. rebalance | liquidate | diversify | transfer | report)",',
    '  "reason": "one or two plain sentences",',
    '  "action": {',
    '    "type": "private_transfer" | "report",',
    '    "asset": "0x token address from the portfolio (empty for report)",',
    '    "amount": "human-readable decimal string, e.g. \\"150.25\\" (empty for report)",',
    '    "recipient": "0x destination address (empty for report)"',
    '  },',
    '  "requiresUserConfirmation": true (false only for report)',
    '  "insight": {',
    '    "diagnosis": "one concise sentence: what is wrong with the treasury",',
    '    "recommendation": "one concise sentence: what to do, e.g. Move 400 USDC to your approved private reserve.",',
    '    "why": "one concise sentence: the expected effect, grounded in the numbers above",',
    '    "outcome": "one concise sentence: the expected consequence for liquidity/policy"',
    '  }',
    '}',
    '',
    'Rules: amounts are human units of the asset. Use ONLY assets listed in the portfolio.',
    'The "insight" fields are concise display copy (1 sentence each); never invent assets,',
    'balances, prices, or destinations. If no action is appropriate, return',
    '{"intent":"report","reason":"...","action":{"type":"report","asset":"","amount":"","recipient":""},"requiresUserConfirmation":false,"insight":{"diagnosis":"...","recommendation":"...","why":"...","outcome":"..."}}.',
    'Do not invent balances, prices, or destinations.',
  ].join('\n');
}

export interface AnalyzeResult {
  proposal: ActionProposal;
}

/** Run the analysis: build prompt → provider → strict schema validation. */
export async function analyzeTreasury(
  provider: AiProvider,
  summary: PortfolioSummary,
  prompt: string,
  policy: TreasuryPolicy = DEFAULT_TREASURY_POLICY,
): Promise<AnalyzeResult> {
  const system = buildSystemPrompt(summary, policy);
  const raw = await provider.completeJson(system, prompt);
  const validated = validateProposal(raw);
  if (!validated.ok) {
    throw new Error(`Hamster AI produced an invalid proposal: ${validated.error}`);
  }
  return { proposal: validated.value };
}