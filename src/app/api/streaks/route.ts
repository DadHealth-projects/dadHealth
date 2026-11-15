import { NextResponse } from 'next/server';
import { authenticateNativeSubscriptionRequest } from '@/lib/native-subscriptions/auth';
import { readStreakStatus } from '@/lib/streaks/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

export async function GET(request: Request) {
  try {
    const auth = await authenticateNativeSubscriptionRequest(request);
    if (!auth) return NextResponse.json({ error: 'Sign in required', code: 'unauthorized' }, { status: 401, headers });
    if ([...new URL(request.url).searchParams].length) {
      return NextResponse.json({ error: 'Invalid streak request', code: 'invalid_request' }, { status: 400, headers });
    }
    const result = await readStreakStatus(auth.admin, auth.user.id);
    return NextResponse.json(result, { status: result.state === 'available' ? 200 : 503, headers });
  } catch {
    return NextResponse.json({ state: 'unavailable', reason: 'read_failed', streak: null }, { status: 503, headers });
  }
}
