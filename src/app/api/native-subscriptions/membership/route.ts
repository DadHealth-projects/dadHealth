import { NextResponse } from 'next/server';
import { authenticateNativeSubscriptionRequest } from '@/lib/native-subscriptions/auth';
import { membershipDetails } from '@/lib/native-subscriptions/cancellation';
import { nativeSubscriptionErrorResponse } from '@/lib/native-subscriptions/route-response';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = await authenticateNativeSubscriptionRequest(request);
  if (!auth) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  try { return NextResponse.json({ subscriptions: await membershipDetails(auth) }, { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return nativeSubscriptionErrorResponse(error); }
}
