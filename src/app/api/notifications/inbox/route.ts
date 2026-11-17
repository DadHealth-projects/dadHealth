import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
async function handle(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.match(/^Bearer\s+\S+$/i)) return NextResponse.json({ error: 'Sign in required' }, { status: 401, headers });
  try {
    // User JWT, not service role: owner enforcement also occurs inside the RPC.
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    let action: string, id: string | null = null, beforeAt: string | null = null, beforeId: string | null = null, limit = 25;
    if (request.method === 'GET') {
      const q = new URL(request.url).searchParams;
      if ([...q.keys()].some(k => !['id','before_at','before_id','limit','count'].includes(k) || q.getAll(k).length !== 1)) throw Error('input');
      id=q.get('id'); beforeAt=q.get('before_at'); beforeId=q.get('before_id'); limit=Number(q.get('limit') ?? 25);
      if ((id !== null && !uuid(id)) || (beforeId !== null && !uuid(beforeId)) || Boolean(beforeAt)!==Boolean(beforeId)
        || (beforeAt !== null && !Number.isFinite(Date.parse(beforeAt))) || !Number.isInteger(limit) || limit<1 || limit>50
        || (q.has('count') && q.get('count')!=='1') || (id && (beforeAt || q.has('count'))) || (q.has('count') && beforeAt)) throw Error('input');
      action=id?'get':q.has('count')?'count':'list';
    } else {
      const body=await request.json().catch(()=>{throw Error('input');});
      if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['action','id'].includes(k))
        || !['read','read_all','unread_all'].includes(body.action)
        || (body.action==='read' && !uuid(body.id))
        || (['read_all','unread_all'].includes(body.action) && body.id!==undefined)) throw Error('input');
      action=body.action; id=body.id ?? null;
    }
    const result=await client.rpc('notification_inbox',{p_action:action,p_id:id,p_before_at:beforeAt,p_before_id:beforeId,p_limit:limit});
    if (result.error) {
      const status=['42501','PGRST301','PGRST303'].includes(result.error.code)?401:result.error.code==='P0002'?404:503;
      return NextResponse.json({error:'Notifications are temporarily unavailable.'},{status,headers});
    }
    if (action==='get' && !result.data?.event) return NextResponse.json({error:'This update is no longer available.'},{status:404,headers});
    if (action==='get') {
      // Recheck actual target access with this same user JWT. An old inbox row
      // does not authorize opening a deleted event or a former private circle.
      const destination=result.data.event.destination;
      const targets: [string,string][]=[];
      if (['community_reply','community_like'].includes(destination.type)) {
        targets.push(['posts',destination.post_id]);
        if(destination.comment_id) targets.push(['comments',destination.comment_id]);
      }
      if(destination.type==='co_parent_event_added') targets.push(['co_parenting_events',destination.event_id]);
      for(const [table,target] of targets){
        if(!uuid(target)) return NextResponse.json({error:'This update is no longer available.'},{status:404,headers});
        const found=await client.from(table).select('id').eq('id',target).maybeSingle();
        if(found.error) return NextResponse.json({error:'Notifications are temporarily unavailable.'},{status:503,headers});
        if(!found.data) return NextResponse.json({error:'This update is no longer available.'},{status:404,headers});
      }
    }
    return NextResponse.json({state:'available',...result.data},{headers});
  } catch(error) {
    return NextResponse.json({error:error instanceof Error && error.message==='input'?'Invalid request':'Notifications are temporarily unavailable.'},
      {status:error instanceof Error && error.message==='input'?400:503,headers});
  }
}
export const GET=handle;
export const POST=handle;
