import { randomUUID } from 'node:crypto';
import { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { createServerSupabaseClient } from '@/utils/supabase/server';
import { AnalyticsError, analyticsResponse, hash, limitedBody } from '@/lib/analytics/service';
import { billingConsentChoice } from '@/lib/analytics/billing-consent';
export const runtime = 'nodejs';
async function handle(request: Request) {
  const requestId = randomUUID();
  try {
    const admin = createAdminSupabaseClient();
    const bearer = request.headers.get('authorization');
    let owner: string;
    if (bearer) {
      const token = bearer.match(/^Bearer ([^\s]+)$/)?.[1];
      if (!token) throw new AnalyticsError('unauthorized', 401);
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) throw new AnalyticsError('unauthorized', 401);
      owner = data.user.id;
    } else {
      if (request.headers.get('origin') !== new URL(request.url).origin) throw new AnalyticsError('unauthorized', 401);
      const client = await createServerSupabaseClient();
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) throw new AnalyticsError('unauthorized', 401);
      owner = data.user.id;
    }
    // Authenticated owner bucket; no IP/config dependency can block withdrawal.
    const limited = await admin.rpc('analytics_rate_limit', { p_key: hash(`billing-choice:${owner}`), p_limit: 60 });
    if (limited.error) throw new AnalyticsError('storage_unavailable', 503, limited.error.code);
    if (limited.data !== true) throw new AnalyticsError('rate_limited', 429);
    const result = await billingConsentChoice(admin, owner, request.method === 'POST' ? await limitedBody(request) : undefined);
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store', 'X-Analytics-Request-ID': requestId } });
  } catch (error) {
    const response = analyticsResponse(error);
    response.headers.set('X-Analytics-Request-ID', requestId);
    if (response.status >= 500) console.warn('[analytics]', { stage: 'billing_consent', requestId,
      code: 'unavailable', databaseCode: error instanceof AnalyticsError ? error.databaseCode : undefined });
    return response;
  }
}
export const GET = handle;
export const POST = handle;
