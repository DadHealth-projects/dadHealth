import { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { createServerSupabaseClient } from '@/utils/supabase/server';
import { AnalyticsError, analyticsResponse, ingest, limitedBody, rateLimit } from '@/lib/analytics/service';
export const runtime='nodejs';
export async function POST(request: Request) {
  try {
    const admin=createAdminSupabaseClient();
    const body=await limitedBody(request);
    await rateLimit(admin,request,body);
    // Revocations remain available while capture/delivery rollout is paused.
    if(body?.action!=='withdraw' && (process.env.ANALYTICS_INGEST_ENABLED!=='true' || process.env.ANALYTICS_PRIVACY_ENABLED!=='true')) throw new AnalyticsError('disabled');
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
    return Response.json(await ingest(admin,body,owner),{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return analyticsResponse(error); }
}
