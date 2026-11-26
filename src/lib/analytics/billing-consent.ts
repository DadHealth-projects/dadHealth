import { AnalyticsError } from './service';
import { uuid } from './contract';
import type { createAdminSupabaseClient } from '@/utils/supabase/admin';
type Admin = ReturnType<typeof createAdminSupabaseClient>;

export async function billingConsentChoice(admin: Admin, owner: string, body?: unknown) {
  if (!uuid(owner)) throw new AnalyticsError('unauthorized', 401);
  let args: Record<string, unknown> = { p_owner: owner };
  if (body !== undefined) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AnalyticsError('invalid_payload', 400);
    const b = body as Record<string, unknown>;
    if (Object.keys(b).some(k => !['granted','revision','operationId'].includes(k)) || typeof b.granted !== 'boolean'
      || !Number.isSafeInteger(b.revision) || Number(b.revision) < 0 || !uuid(b.operationId)) throw new AnalyticsError('invalid_payload', 400);
    args = { ...args, p_granted: b.granted, p_revision: b.revision, p_operation: b.operationId };
  }
  const { data, error } = await admin.rpc('billing_analytics_choice', args);
  if (error) throw new AnalyticsError(error.code === '40001' ? 'conflict' : 'storage_unavailable', error.code === '40001' ? 409 : 503, error.code);
  if (data?.owner !== owner || typeof data.granted !== 'boolean' || !Number.isSafeInteger(data.revision) || data.revision < 0
    || !(data.operationId === null || uuid(data.operationId))
    || !(data.grantedAt === null || typeof data.grantedAt === 'string' && Number.isFinite(Date.parse(data.grantedAt)))
    || (data.granted && data.grantedAt === null)) throw new AnalyticsError('storage_unavailable');
  return data;
}
