import type { createAdminSupabaseClient } from '@/utils/supabase/admin';

type Admin = ReturnType<typeof createAdminSupabaseClient>;
type Operation = 'read' | 'start' | 'complete';
export type PlanAction = { id: string; title: string; instruction: string; route: 'BreathingSession' | 'Journal' };
type Completion = { actionNumber: number; completedOn: string; completedAt: string; timezone: string };
export type MindPlanResult =
  | { state: 'locked' | 'not_started' }
  | { state: 'unavailable'; reason: string }
  | { state: 'conflict'; reason: string }
  | { state: 'available'; currentDate: string; timezone: string; receipt: Completion | null; plan: {
      id: string; version: string; copyStatus: 'draft'; variant: string; createdAt: string;
      startedOn: string; actions: PlanAction[]; completions: Completion[];
      completed: boolean; nextAction: number | null; canComplete: boolean;
    } };
const unavailable = (): MindPlanResult => ({ state: 'unavailable', reason: 'plan_unavailable' });
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const instant = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
export const isPlanId = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v);
function completion(v: any): Completion {
  if (!v || !Number.isInteger(v.actionNumber) || v.actionNumber<1 || v.actionNumber>7
    || !date(v.completedOn) || !instant(v.completedAt) || typeof v.timezone!=='string') throw Error('Invalid receipt');
  return { actionNumber:v.actionNumber, completedOn:v.completedOn, completedAt:v.completedAt, timezone:v.timezone };
}

/** Owner is supplied only by verified server authentication. RPC rechecks canonical access. */
export async function operateMindPlan(admin: Admin, owner: string, operation: Operation,
  target?: { planId: string; actionNumber: number }): Promise<MindPlanResult> {
  try {
    const { data: row, error } = await admin.rpc('mind_plan_operation', {
      p_user_id:owner, p_operation:operation, p_plan_id:target?.planId ?? null,
      p_action_number:target?.actionNumber ?? null,
    });
    if (error || !row || typeof row!=='object') return unavailable();
    if (row.state==='locked' || row.state==='not_started') return { state:row.state };
    if (row.state==='unavailable') return unavailable();
    if (row.state==='conflict' && ['plan_mismatch','action_out_of_order','daily_limit'].includes(row.reason)) {
      return { state:'conflict', reason:row.reason };
    }
    const p=row.plan;
    if (row.state!=='available' || !date(row.currentDate) || typeof row.timezone!=='string'
      || !p || !isPlanId(p.id) || p.version!=='mind-plan-v1' || p.copyStatus!=='draft'
      || !['balanced','gentle','presence'].includes(p.variant) || !instant(p.createdAt) || !date(p.startedOn)
      || !Array.isArray(p.actions) || p.actions.length!==7 || !Array.isArray(p.completions)
      || p.completions.length>7 || typeof p.completed!=='boolean' || typeof p.canComplete!=='boolean') return unavailable();
    const actions: PlanAction[] = p.actions.map((a: any) => {
      if (!a || !['BreathingSession','Journal'].includes(a.route)
        || !['id','title','instruction'].every(k=>typeof a[k]==='string' && a[k].length>0)) throw Error('Invalid action');
      return { id:a.id,title:a.title,instruction:a.instruction,route:a.route };
    });
    const completions = p.completions.map(completion);
    if (completions.some((c,i)=>c.actionNumber!==i+1 || (i>0 && c.completedOn<=completions[i-1].completedOn))
      || p.completed!==(completions.length===7)
      || p.nextAction!==(p.completed?null:completions.length+1)
      || p.canComplete!==(!p.completed && (!completions.length || row.currentDate>completions[completions.length-1].completedOn))) return unavailable();
    return { state:'available', currentDate:row.currentDate, timezone:row.timezone,
      receipt:row.receipt==null?null:completion(row.receipt), plan:{
        id:p.id,version:p.version,copyStatus:p.copyStatus,variant:p.variant,createdAt:p.createdAt,
        startedOn:p.startedOn,actions,completions,completed:p.completed,nextAction:p.nextAction,canComplete:p.canComplete,
      } };
  } catch { return unavailable(); }
}
