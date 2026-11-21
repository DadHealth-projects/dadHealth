import { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { AnalyticsError, analyticsResponse, workerAuthorized, runAnalyticsMaintenance } from '@/lib/analytics/service';
export const runtime = 'nodejs';
export const maxDuration = 60;
// Local DB maintenance only. This endpoint cannot claim or hand off events.
export async function POST(request: Request) {
  try {
    if (!workerAuthorized(request.headers.get('authorization'), process.env.ANALYTICS_WORKER_SECRET))
      throw new AnalyticsError('unauthorized', 401);
    return Response.json(await runAnalyticsMaintenance(createAdminSupabaseClient()), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return analyticsResponse(error); }
}
