import { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { AnalyticsError, analyticsResponse, workerAuthorized, runAnalyticsWorker } from '@/lib/analytics/service';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request: Request) {
  try {
    if(!workerAuthorized(request.headers.get('authorization'),process.env.ANALYTICS_WORKER_SECRET)) throw new AnalyticsError('unauthorized',401);
    return Response.json(await runAnalyticsWorker(createAdminSupabaseClient()),{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return analyticsResponse(error); }
}
