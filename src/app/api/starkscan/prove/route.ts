import { NextRequest, NextResponse } from 'next/server';
import { StarkscanProver, StarkscanProverError } from '@/services/starkscanProver';

/**
 * ORRANGE — server-side STRK20 mainnet prover proxy.
 *
 * The browser SDK calls its normal synchronous `starknet_proveTransaction` JSON-RPC endpoint. This
 * route IS that endpoint for mainnet: it holds the secret `STARKSCAN_API_KEY` on the server,
 * translates the request to the Starkscan async job+poll relay, and returns the proof in the same
 * synchronous JSON-RPC shape the SDK expects.
 *
 * SECURITY: `STARKSCAN_API_KEY` is read from the server environment ONLY. It is never sent to the
 * browser, never put in client bundles, and never printed.
 *
 *   POST /api/starkscan/prove  { jsonrpc, id, method: "starknet_proveTransaction", params: { block_id, transaction } }
 *   POST /api/starkscan/prove  { jsonrpc, id, method: "starknet_specVersion" }   → SDK health check
 *   GET  /api/starkscan/prove  → auth/availability probe (never returns the key)
 */
export const runtime = 'nodejs';

function jsonRpcOk(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}
function jsonRpcError(id: unknown, code: number, message: string) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } });
}

export async function GET() {
  const apiKey = process.env.STARKSCAN_API_KEY?.trim() ?? '';
  if (!apiKey) {
    return NextResponse.json({ ok: false, status: 'unconfigured' });
  }
  const prover = new StarkscanProver({ apiKey });
  const result = await prover.checkAuth();
  return NextResponse.json({
    ok: result.kind === 'authenticated',
    status: result.kind,
    code: result.code,
  });
}

export async function POST(req: NextRequest) {
  let id: unknown = null;
  let method: unknown;
  let params: unknown;
  try {
    const body = (await req.json()) as { id?: unknown; method?: unknown; params?: unknown };
    id = body.id;
    method = body.method;
    params = body.params;
  } catch {
    return jsonRpcError(null, -32700, 'Parse error: request body is not valid JSON.');
  }

  if (method === 'starknet_specVersion') {
    return jsonRpcOk(id, { protocol_version: '0.13.3', vendor: 'starkscan-strk20-proxy' });
  }

  if (method !== 'starknet_proveTransaction') {
    return jsonRpcError(id, -32601, `Method not found: ${String(method)}`);
  }

  const p = (params ?? {}) as { block_id?: unknown; transaction?: unknown };
  if (!p.block_id || p.transaction === undefined) {
    return jsonRpcError(id, -32602, 'Invalid params: block_id and transaction are required.');
  }

  const apiKey = process.env.STARKSCAN_API_KEY?.trim() ?? '';
  if (!apiKey) {
    return jsonRpcError(id, -32000, 'STARKSCAN_API_KEY is not configured on the server.');
  }

  const prover = new StarkscanProver({ apiKey });
  try {
    const result = await prover.proveTransaction({
      block_id: p.block_id as never,
      transaction: p.transaction,
    });
    return jsonRpcOk(id, result);
  } catch (err) {
    if (err instanceof StarkscanProverError) {
      return jsonRpcError(id, -32000, err.message);
    }
    return jsonRpcError(id, -32603, err instanceof Error ? err.message : 'Internal proving error.');
  }
}
