import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { runModerationWorker } from '@/lib/community/moderation';
export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store' };
export async function POST(request: Request) {
  const expected = process.env.MODERATION_WORKER_SECRET;
  const supplied = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1] ?? '';
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return NextResponse.json({ state: 'unauthorized' }, { status: 401, headers });
  }
  if (process.env.MODERATION_DELIVERY_ENABLED !== 'true') return NextResponse.json({ state: 'disabled' }, { status: 503, headers });
  try { return NextResponse.json(await runModerationWorker(createAdminSupabaseClient()), { headers }); }
  catch { console.error('[ModerationDelivery]', { stage: 'worker', reason: 'processing_failed' });
    return NextResponse.json({ state: 'unavailable' }, { status: 503, headers }); }
}
