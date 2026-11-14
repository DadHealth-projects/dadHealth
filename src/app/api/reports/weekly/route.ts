import { NextResponse } from 'next/server';
import { authenticateNativeSubscriptionRequest } from '@/lib/native-subscriptions/auth';
import { reportReleaseForWeek } from '@/lib/reports/weekly-report-calendar';
import { readWeeklyReport } from '@/lib/reports/weekly-report-snapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

export async function GET(request: Request) {
  try {
    const auth = await authenticateNativeSubscriptionRequest(request);
    if (!auth) return NextResponse.json({ error: 'Sign in required', code: 'unauthorized' }, { status: 401, headers });
    const params = new URL(request.url).searchParams;
    // No user/access/tier overrides; only one optional Monday date selector.
    if ([...params.keys()].some(key => key !== 'week') || params.getAll('week').length > 1) {
      return NextResponse.json({ error: 'Invalid report request', code: 'invalid_request' }, { status: 400, headers });
    }
    const week = params.get('week') ?? undefined;
    if (week !== undefined) {
      try { reportReleaseForWeek(week); } catch {
        return NextResponse.json({ error: 'Invalid reporting week', code: 'invalid_request' }, { status: 400, headers });
      }
    }
    const result = await readWeeklyReport(auth.admin, auth.user.id, week);
    if (result.state === 'available') return NextResponse.json({ state: 'available', ...result.result }, { headers });
    const status = result.reason === 'snapshot_missing' || result.reason === 'not_released' ? 404 : 503;
    return NextResponse.json({ ...result, report: null }, { status, headers });
  } catch {
    // No identity, tokens, payloads or underlying database errors in logs/responses.
    return NextResponse.json({ state: 'unavailable', reason: 'read_failed', report: null }, { status: 503, headers });
  }
}
