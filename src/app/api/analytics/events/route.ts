import { randomUUID } from 'node:crypto';
import { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { createServerSupabaseClient } from '@/utils/supabase/server';
import { AnalyticsError, analyticsResponse, ingest, limitedBody, rateLimit } from '@/lib/analytics/service';
export const runtime='nodejs';
export async function POST(request: Request) {
  const supplied = request.headers.get('x-analytics-request-id');
  const requestId = supplied && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(supplied) ? supplied : randomUUID();
  let stage = 'configuration', action = 'unknown';
  try {
    const admin=createAdminSupabaseClient();
    stage = 'validation';
    const body=await limitedBody(request);
    if (['grant','renew','withdraw','capture'].includes(body?.action)) action = body.action;
    stage = 'rate_limit';
    await rateLimit(admin,request,body);
    stage = 'rollout';
    // Revocations remain available while capture/delivery rollout is paused.
    if(body?.action!=='withdraw' && (process.env.ANALYTICS_INGEST_ENABLED!=='true' || process.env.ANALYTICS_PRIVACY_ENABLED!=='true')) throw new AnalyticsError('disabled');
    stage = 'authentication';
    let owner:string|null=null;
    if(body?.action!=='withdraw' && body?.owner!==null) {
      const bearer=request.headers.get('authorization');
      if(bearer) {
        const token=bearer.match(/^Bearer ([^\s]+)$/)?.[1]; if(!token) throw new AnalyticsError('unauthorized',401);
        const {data,error}=await admin.auth.getUser(token); if(error || !data.user) throw new AnalyticsError('unauthorized',401); owner=data.user.id;
      } else {
        if(request.headers.get('origin')!==new URL(request.url).origin) throw new AnalyticsError('unauthorized',401);
        const client=await createServerSupabaseClient(); const {data,error}=await client.auth.getUser();
        if(error || !data.user) throw new AnalyticsError('unauthorized',401); owner=data.user.id;
      }
    }
    stage = action === 'grant' ? 'issue_consent' : action === 'renew' ? 'renew_consent' : 'ingestion';
    const result = await ingest(admin,body,owner);
    return Response.json(result,{headers:{'Cache-Control':'private, no-store', 'X-Analytics-Request-ID':requestId}});
  } catch(error) {
    const response = analyticsResponse(error);
    const codes = ['disabled','configuration_required','unauthorized','owner_mismatch','invalid_payload','storage_unavailable','consent_unavailable','rate_limited','invalid_event','conflict'];
    const code = error instanceof AnalyticsError && codes.includes(error.code) ? error.code : 'unavailable';
    response.headers.set('X-Analytics-Request-ID', requestId);
    response.headers.set('X-Analytics-Failure-Code', code);
    if (response.status >= 500) console.warn('[analytics]', { stage, status: response.status, requestId, code, databaseCode: error instanceof AnalyticsError ? error.databaseCode : undefined });
    return response;
  }
}
