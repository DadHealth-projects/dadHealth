import { AnalyticsError } from './service';
import { uuid } from './contract';
/** Provider erasure is asynchronous. Persist person IDs before requesting it. */
export async function erasePosthogOwner(owner: string, progress: Record<string, unknown>, save: () => Promise<void>, transport: typeof fetch=fetch) {
  if(!uuid(owner)) throw new AnalyticsError('invalid_owner');
  const host=process.env.ANALYTICS_POSTHOG_API_HOST, project=process.env.POSTHOG_PROJECT_ID, key=process.env.POSTHOG_API_KEY;
  if(!host || !['https://us.posthog.com','https://eu.posthog.com'].includes(host) || !project || !/^\d+$/.test(project) || !key) throw new AnalyticsError('posthog_cleanup_configuration_required');
  const base=`${host}/api/projects/${project}`;
  async function call(path:string,body?:unknown) {
    const r=await transport(base+path,{method:body?'POST':'GET',signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    if(!r.ok) throw new AnalyticsError('posthog_cleanup_unavailable');
    return r.json();
  }
  if(!Array.isArray(progress.analyticsPersons)) {
    const data=await call(`/persons/?distinct_id=${encodeURIComponent(owner)}&limit=100`);
    if(!Array.isArray(data.results) || data.next || data.results.some((p:{uuid?:unknown})=>!uuid(p.uuid))) throw new AnalyticsError('posthog_cleanup_invalid');
    progress.analyticsPersons=data.results.map((p:{uuid:string})=>p.uuid);
    await save();
  }
  if(!progress.analyticsDeletionRequested) {
    // Repeat after a lost response is safe; never send a new capture for this owner.
    await call('/persons/bulk_delete/',{distinct_ids:[owner],delete_events:true,delete_recordings:true});
    progress.analyticsDeletionRequested=true;
    await save();
    return false;
  }
  for(const person of progress.analyticsPersons as string[]) {
    const data=await call(`/persons/deletion_status/?person_uuid=${encodeURIComponent(person)}&status=all&limit=100`);
    if(!Array.isArray(data.results) || data.next) throw new AnalyticsError('posthog_cleanup_invalid');
    if(!data.results.length || data.results.some((r:{status?:string;delete_verified_at?:string})=>r.status!=='completed'||!r.delete_verified_at)) return false;
  }
  // No-person is not proof of no events (personless/legacy capture). Verify independently.
  const events=await call('/query/',{query:{kind:'HogQLQuery',query:`SELECT count() FROM events WHERE distinct_id = '${owner}'`}});
  const count=events.results?.[0]?.[0];
  if(typeof count!=='number' || !Number.isSafeInteger(count) || count<0) throw new AnalyticsError('posthog_cleanup_invalid');
  if(count!==0) {
    // Provider ingestion may settle after the first asynchronous erasure request.
    // Reconcile on the existing privacy-worker cadence, never assume acceptance
    // or a missing person means that historical events have disappeared.
    await call('/persons/bulk_delete/',{distinct_ids:[owner],delete_events:true,delete_recordings:true});
    return false;
  }
  return true;
}
