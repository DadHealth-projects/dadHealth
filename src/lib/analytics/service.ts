import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { parseAnalyticsEvent, uuid } from './contract';
import type { createAdminSupabaseClient } from '@/utils/supabase/admin';
type Admin = ReturnType<typeof createAdminSupabaseClient>;
export class AnalyticsError extends Error {
  readonly databaseCode: string | undefined;
  constructor(public code: string, public status = 503, databaseCode?: unknown) {
    super(code);
    // Only SQLSTATE/PostgREST identifiers; never database messages, hints or details.
    this.databaseCode = typeof databaseCode === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(databaseCode)
      ? databaseCode : undefined;
  }
}
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function workerAuthorized(header: string | null, expected: string | undefined) {
  const given = header?.match(/^Bearer ([^\s]+)$/)?.[1] ?? '';
  return Boolean(expected && Buffer.byteLength(given) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(given), Buffer.from(expected)));
}
export async function limitedBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json') || Number(request.headers.get('content-length') ?? 0)>8192) throw new AnalyticsError('invalid_payload',400);
  const reader=request.body?.getReader(); if (!reader) throw new AnalyticsError('invalid_payload',400);
  const chunks: Uint8Array[]=[]; let bytes=0;
  try {
    while (true) { const {done,value}=await reader.read(); if(done) break; bytes+=value.length;
      if(bytes>8192) { await reader.cancel(); throw new AnalyticsError('invalid_payload',400); } chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new AnalyticsError('invalid_payload',400); }
}
export async function ingest(admin: Admin, value: unknown, verifiedOwner: string | null) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new AnalyticsError('invalid_payload',400);
  const b=value as Record<string,unknown>;
  if (b.action==='grant' || b.action==='renew') {
    if (b.owner!==verifiedOwner || !(b.owner===null || uuid(b.owner))) throw new AnalyticsError('owner_mismatch',403);
    const allowed=b.action==='grant'?['action','owner']:['action','owner','consent','secret'];
    if(Object.keys(b).some(k=>!allowed.includes(k))) throw new AnalyticsError('invalid_payload',400);
    if(b.action==='renew' && (!uuid(b.consent) || typeof b.secret!=='string' || !/^[a-f0-9-]{72}$/i.test(b.secret))) throw new AnalyticsError('invalid_payload',400);
    const secret=b.action==='grant'?randomUUID()+randomUUID():String(b.secret);
    const result=await admin.rpc(b.action==='grant'?'issue_analytics_consent':'renew_analytics_consent',
      {p_owner:b.owner,p_hash:hash(secret),...(b.action==='renew'?{p_consent:b.consent}:{})});
    if(result.error) throw new AnalyticsError('storage_unavailable', 503, result.error.code);
    if(!uuid(result.data?.consent) || !Number.isFinite(Date.parse(result.data?.expiresAt))) throw new AnalyticsError('consent_unavailable',403);
    return {owner:b.owner,consent:result.data.consent,secret,expiresAt:result.data.expiresAt};
  }
  if (!['capture','withdraw'].includes(String(b.action)) || !uuid(b.consent) || typeof b.secret!=='string' || !/^[a-f0-9-]{72}$/i.test(b.secret)
    || !(b.owner===null || uuid(b.owner)) || Object.keys(b).some(k=>!['action','consent','secret','owner','event'].includes(k))) throw new AnalyticsError('invalid_payload',400);
  // Withdrawal is a revocation-only capability: it cannot read, create events or grant consent.
  if (b.action==='capture' && b.owner!==verifiedOwner) throw new AnalyticsError('owner_mismatch',403);
  const event=b.action==='capture'?parseAnalyticsEvent(b.event):null;
  if (b.action==='capture' && !event) throw new AnalyticsError('invalid_event',400);
  const {data,error}=await admin.rpc('ingest_optional_analytics',{p_owner:b.owner,p_consent:b.consent,p_hash:hash(b.secret),p_event:event,p_withdraw:b.action==='withdraw'});
  if(error) throw new AnalyticsError(error.code==='23505'?'conflict':'storage_unavailable',error.code==='23505'?409:503);
  if(!['accepted','withdrawn'].includes(data)) throw new AnalyticsError(['removed','revoked'].includes(data)?'consent_unavailable':data==='limited'?'rate_limited':'invalid_event',data==='limited'?429:data==='conflict'?409:403);
  return event?{accepted:event.id}:{withdrawn:true};
}
export async function rateLimit(
  admin: Admin,
  request: Request,
  body?: unknown,
) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AnalyticsError('invalid_payload', 400);
  }

  const value = body as Record<string, unknown>;
  if (!['capture','withdraw','grant','renew'].includes(String(value.action))) {
    throw new AnalyticsError('invalid_payload', 400);
  }

  let key: string;
  let limit: number;

  if (value.action === 'withdraw') {
    if (
      !uuid(value.consent) ||
      typeof value.secret !== 'string' ||
      !/^[a-f0-9-]{72}$/i.test(value.secret)
    ) {
      throw new AnalyticsError('invalid_payload', 400);
    }

    // Separate capability bucket; capture configuration cannot block withdrawal.
    key = hash(`withdraw:${value.consent}:${value.secret}`);
    limit = 300;
  } else {
    const salt = process.env.ANALYTICS_RATE_SECRET;
    const ip = process.env.ANALYTICS_TRUST_VERCEL_IP === 'true'
      ? request.headers.get('x-vercel-forwarded-for')?.trim()
      : undefined;

    if (!salt || !ip) {
      throw new AnalyticsError('configuration_required');
    }

    key = hash(`${salt}:capture:${ip.slice(0, 128)}`);
    limit = 120;
  }

  const { data, error } = await admin.rpc('analytics_rate_limit', {
    p_key: key,
    p_limit: limit,
  });

  if (error) throw new AnalyticsError('storage_unavailable', 503, error.code);
  if (data !== true) throw new AnalyticsError('rate_limited', 429);
}
export function analyticsResponse(error: unknown) {
  const e=error instanceof AnalyticsError?error:new AnalyticsError('unavailable');
  if(e.status>=500) console.warn('[analytics]',{stage:'operation',code:e.code,databaseCode:e.databaseCode});
  return Response.json({error:'Analytics unavailable'},{status:e.status,headers:{'Cache-Control':'private, no-store'}});
}
export type Delivery = {id:string;lease:string;lease_until:string;consent_id:string;distinct_id:string;event:string;occurred_at:string;created_at:string;properties:Record<string,unknown>;attempts:number};
export async function deliver(item: Delivery, transport: typeof fetch=fetch): Promise<'sent'|'retry'|'failed'> {
  const at = Date.parse(item.occurred_at);
  if (!Number.isFinite(at) || !parseAnalyticsEvent({version:1,id:item.id,event:item.event,
    timestamp:new Date(at).toISOString(),properties:item.properties}, Date.now(), 'server')) return 'failed';
  const host=process.env.ANALYTICS_POSTHOG_CAPTURE_HOST, token=process.env.ANALYTICS_POSTHOG_TOKEN;
  if(!host || !['https://us.i.posthog.com','https://eu.i.posthog.com'].includes(host) || !token) throw new AnalyticsError('configuration_required');
  if(Date.parse(item.lease_until)<=Date.now()+10000) return 'retry';
  const response=await transport(`${host}/i/v1/analytics/events`,{method:'POST',signal:AbortSignal.timeout(8000),headers:{
    Authorization:`Bearer ${token}`,'Content-Type':'application/json','User-Agent':'dadhealth-analytics/1.0.0',
    'PostHog-Sdk-Info':'dadhealth/1.0.0','PostHog-Request-Id':item.id,'PostHog-Attempt':String(item.attempts),
    'PostHog-Request-Timestamp':new Date().toISOString(),
  },body:JSON.stringify({created_at:item.created_at,batch:[{uuid:item.id,event:item.event,distinct_id:item.distinct_id,timestamp:item.occurred_at,
    properties:item.properties,options: {
      process_person_profile: !item.distinct_id.startsWith('anonymous-'),
      disable_skew_correction: true,
    }}]})});
  if(!response.ok) return [400,401,402,403,413,415].includes(response.status)?'failed':'retry';
  const result=(await response.json()).results?.[item.id.toLowerCase()]?.result;
  return result==='ok'||result==='warning'?'sent':result==='retry'?'retry':'failed';
}
export async function runAnalyticsMaintenance(admin: Admin) {
  const cleanup=await admin.rpc('cleanup_optional_analytics'); if(cleanup.error) throw new AnalyticsError('retention_failed');
  const recovery=await admin.rpc('recover_analytics_actions');
  if(recovery.error) throw new AnalyticsError('recovery_failed');
  return { maintained: true };
}
export async function runAnalyticsWorker(admin: Admin, transport: typeof fetch=fetch) {
  const deadline = Date.now() + 45_000;
  await runAnalyticsMaintenance(admin);
  // Remote retention remains an explicit rollout prerequisite, not an assumed default.
  if(process.env.ANALYTICS_DELIVERY_ENABLED!=='true' || process.env.ANALYTICS_REMOTE_RETENTION_APPROVED!=='true' || process.env.ANALYTICS_PRIVACY_ENABLED!=='true') return {sent:0,paused:true};
  let sent=0;
  for (let i = 0; i < 25 && Date.now() + 12_000 < deadline; i++) {
    const claimed=await admin.rpc('claim_optional_analytics'); if(claimed.error) throw new AnalyticsError('claim_failed');
    const item=claimed.data?.[0] as Delivery|undefined; if(!item) break;
    const authorized=await admin.rpc('authorize_optional_analytics',{p_id:item.id,p_lease:item.lease});
    if(authorized.error) throw new AnalyticsError('authorization_failed');
    if(authorized.data!==true) continue;
    let result:'sent'|'retry'|'failed'='retry';
    try { result=await deliver(item,transport); } catch { console.warn('[analytics]',{stage:'delivery',code:'provider_unavailable'}); }
    const finished=await admin.rpc('finish_optional_analytics',{p_id:item.id,p_lease:item.lease,p_result:result});
    if(finished.error || finished.data!==true) throw new AnalyticsError('receipt_failed');
    if(result==='sent') sent++; else console.warn('[analytics]',{stage:'delivery',code:result==='failed'?'delivery_failed':'retry_pending'});
  }
  return {sent,paused:false};
}
