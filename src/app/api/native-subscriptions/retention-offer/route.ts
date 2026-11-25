import { NextResponse } from 'next/server';
import { authenticateNativeSubscriptionRequest } from '@/lib/native-subscriptions/auth';
import { isUuid, ownedSubscription } from '@/lib/native-subscriptions/cancellation';
import { retentionOfferConfig, signRetentionOffer } from '@/lib/native-subscriptions/retention-offer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

// Brief 01 last-resort offer. Returns a signed Apple promotional offer for the member's own
// subscription, or `offer_unavailable` (not configured / not eligible). Never a fabricated offer.
export async function POST(request: Request) {
  const auth = await authenticateNativeSubscriptionRequest(request);
  if (!auth) return NextResponse.json({ error: 'Sign in required' }, { status: 401, headers });
  const body = await request.json().catch(() => null) as { subscriptionId?: unknown } | null;
  if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || !isUuid(body.subscriptionId)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers });
  }
  const config = retentionOfferConfig();
  if (!config) return NextResponse.json({ state: 'offer_unavailable' }, { status: 404, headers });
  try {
    const item = await ownedSubscription(auth, body.subscriptionId);
    const signed = item ? signRetentionOffer(item, auth.user.id, config) : null;
    if (!signed) return NextResponse.json({ state: 'offer_unavailable' }, { status: 404, headers });
    return NextResponse.json({ state: 'available', ...signed }, { headers });
  } catch {
    return NextResponse.json({ error: 'offer_check_failed' }, { status: 503, headers });
  }
}
