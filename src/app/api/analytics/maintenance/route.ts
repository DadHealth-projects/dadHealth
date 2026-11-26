import { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { AnalyticsError, analyticsResponse, workerAuthorized, runAnalyticsMaintenance } from '@/lib/analytics/service';
import { drainBillingTransitions } from '@/lib/analytics/billing';
export const runtime = 'nodejs';
export const maxDuration = 60;
// Local DB maintenance only. This endpoint cannot claim or hand off events.
export async function POST(request: Request) {
  try {
    if (!workerAuthorized(request.headers.get('authorization'), process.env.ANALYTICS_WORKER_SECRET))
      throw new AnalyticsError('unauthorized', 401);
    const admin = createAdminSupabaseClient();
    const maintained = await runAnalyticsMaintenance(admin);
    // Client audit A6: retry journalled billing transitions (no-op while collection is off).
    const billing = await drainBillingTransitions(admin, null, 100);
    return Response.json({ ...maintained, billingTransitions: billing.processed, billingRetry: billing.failed },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return analyticsResponse(error); }
}
