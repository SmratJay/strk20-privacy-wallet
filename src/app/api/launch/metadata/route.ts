import { NextRequest, NextResponse } from 'next/server';
import {
  LaunchMetadataInput,
  sanitizeMetadata,
  upsertRecord,
  getRecord,
  readAllRecords,
} from '@/services/launchMetadata';

/**
 * ORRANGE LAUNCH off-chain metadata store.
 *
 *   GET /api/launch/metadata?token=<addr>  → single record (or 404)
 *   GET /api/launch/metadata               → all records keyed by token address
 *   POST /api/launch/metadata              → upsert { token, name, symbol, description, image, socials }
 *
 * This is enrichment ONLY. The token list, price, liquidity, market cap and graduation
 * progress always come from on-chain reads; description/image/socials live here because a
 * felt short string cannot carry them, and the on-chain reference stays a tiny URI.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (token) {
    const record = getRecord(token);
    if (!record) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(record);
  }
  return NextResponse.json(readAllRecords());
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as LaunchMetadataInput;
    if (!body || typeof body !== 'object' || !body.token) {
      return NextResponse.json({ error: 'Missing token address.' }, { status: 400 });
    }
    const record = sanitizeMetadata(body);
    upsertRecord(record);
    return NextResponse.json(record, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Could not store metadata.' },
      { status: 400 },
    );
  }
}