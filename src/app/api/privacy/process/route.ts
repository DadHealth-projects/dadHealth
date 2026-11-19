import { timingSafeEqual } from 'node:crypto';
import { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { privacyFailure, privacyResponse, PrivacyError } from '@/lib/privacy/auth';
import { runPrivacyWorker } from '@/lib/privacy/worker';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const expected = process.env.PRIVACY_WORKER_SECRET;
    const given = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (!expected || Buffer.byteLength(given) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) throw new PrivacyError('unauthorized', 401);
    if (process.env.PRIVACY_OPERATIONS_ENABLED !== 'true') throw new PrivacyError('setup_pending');
    return privacyResponse(await runPrivacyWorker(createAdminSupabaseClient()));
  } catch (error) { return privacyFailure(error); }
}
