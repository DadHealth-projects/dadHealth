import type { createAdminSupabaseClient } from '@/utils/supabase/admin';

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;
export interface StreakStatus {
  state: 'scheduled' | 'pending' | 'current';
  count: number | null;
  lastKnownCount: number | null;
  reconciledThrough: string | null;
  protectedDates: string[];
  allowance: 0 | 1 | null;
  activationAt: string | null;
  pendingDate: string | null;
  currentDate?: string;
  weekStart?: string;
  calendarDays?: string[];
  /** Last day a running streak was reset (brief 02 calm reset message); null when none is recorded. */
  resetOn: string | null;
}
export type StreakReadResult =
  | { state: 'available'; streak: StreakStatus }
  | { state: 'unavailable'; reason: 'read_failed' | 'invalid_status'; streak: null };

function dateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Read only. Reconciliation belongs to the trusted worker, not a GET request. */
export async function readStreakStatus(admin: AdminClient, owner: string): Promise<StreakReadResult> {
  const { data, error } = await admin.rpc('read_checkin_streak_status', { p_user_id: owner });
  if (error) return { state: 'unavailable', reason: 'read_failed', streak: null };
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { state: 'unavailable', reason: 'invalid_status', streak: null };
  }
  const row = data as Record<string, unknown>;
  if (!['current', 'pending', 'scheduled'].includes(String(row.state))
    || (row.state === 'current' ? !count(row.count) : row.count !== null)
    || (row.lastKnownCount != null && !count(row.lastKnownCount))
    || (row.reconciledThrough !== null && !dateKey(row.reconciledThrough))
    || (row.pendingDate != null && !dateKey(row.pendingDate))
    || (row.currentDate != null && !dateKey(row.currentDate))
    || (row.weekStart != null && !dateKey(row.weekStart))
    || (row.resetOn != null && !dateKey(row.resetOn))
    || (row.calendarDays != null && (!Array.isArray(row.calendarDays) || row.calendarDays.length !== 7 || !row.calendarDays.every(dateKey)))
    || !Array.isArray(row.protectedDates) || !row.protectedDates.every(dateKey)
    || (row.allowance !== null && row.allowance !== 0 && row.allowance !== 1)
    || (row.state !== 'current' && row.allowance !== null)
    || (row.activationAt != null && (typeof row.activationAt !== 'string'
      || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.activationAt) || !Number.isFinite(Date.parse(row.activationAt))))) {
    return { state: 'unavailable', reason: 'invalid_status', streak: null };
  }
  return { state: 'available', streak: {
    state: row.state as StreakStatus['state'], count: row.count as number | null,
    lastKnownCount: (row.lastKnownCount ?? null) as number | null,
    reconciledThrough: row.reconciledThrough as string | null,
    protectedDates: [...row.protectedDates] as string[], allowance: row.allowance as 0 | 1 | null,
    activationAt: (row.activationAt ?? null) as string | null,
    pendingDate: (row.pendingDate ?? null) as string | null,
    resetOn: row.state === 'current' ? (row.resetOn ?? null) as string | null : null,
    ...(row.currentDate ? { currentDate: row.currentDate as string } : {}),
    ...(row.weekStart ? { weekStart: row.weekStart as string } : {}),
    ...(row.calendarDays ? { calendarDays: [...row.calendarDays as string[]] } : {}),
  } };
}
