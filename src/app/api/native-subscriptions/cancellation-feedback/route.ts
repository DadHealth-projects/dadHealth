import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { authenticateNativeSubscriptionRequest } from '@/lib/native-subscriptions/auth';
import { parseFeedback } from '@/lib/native-subscriptions/cancellation';
import { nativeSubscriptionErrorResponse } from '@/lib/native-subscriptions/route-response';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const auth = await authenticateNativeSubscriptionRequest(request);
  if (!auth) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const input = parseFeedback(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: 'Choose a reason and use at most 1,000 characters.', code: 'invalid_feedback' }, { status: 400 });
  const { error } = await auth.admin.rpc('save_subscription_cancellation_feedback', {
    p_request_id: input.id, p_user_id: auth.user.id, p_subscription_id: input.subscriptionId, p_reason: input.reason, p_details: input.details,
  });
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Retry the original feedback or continue without saving.', code: 'feedback_conflict' }, { status: 409 });
    if (error.code === '42501') return NextResponse.json({ error: 'Subscription unavailable' }, { status: 403 });
    return NextResponse.json({ error: 'We could not confirm your feedback was saved. You can continue without saving.' }, { status: 503 });
  }
  return NextResponse.json({ receipt: input.id }, { headers: { 'Cache-Control': 'private, no-store' } });
}
// Reuse the existing Dad Health admin-session authorization. No ordinary-user read API.
export async function GET() {
  const key = process.env.ADMIN_SECRET_KEY;
  if (!key || (await cookies()).get('admin_session')?.value !== key) return NextResponse.json({ error: 'Administrator required' }, { status: 403 });
  try {
    const admin = createAdminSupabaseClient();
    const { error: cleanupError } = await admin.rpc('cleanup_subscription_cancellation_feedback');
    if (cleanupError) throw cleanupError;
    const { data, error } = await admin.from('subscription_cancellation_feedback')
      .select('request_id,subscription_id,reason,details,submitted_at,retain_until').gt('retain_until', new Date().toISOString())
      .order('submitted_at', { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ feedback: data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return nativeSubscriptionErrorResponse(error); }
}
