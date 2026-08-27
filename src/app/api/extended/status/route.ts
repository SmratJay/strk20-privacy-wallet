import { NextResponse } from 'next/server';
import { ExtendedServerClient } from '@/extended/server';
import type { ExtendedStatus } from '@/extended/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/extended/status
 * Reports whether the server has Extended credentials configured. Never returns secrets.
 */
export async function GET() {
  const server = new ExtendedServerClient();
  const status: ExtendedStatus = server.configured;
  return NextResponse.json(status);
}