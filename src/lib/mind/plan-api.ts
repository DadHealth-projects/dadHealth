import { NextResponse } from 'next/server';
import { authenticateNativeSubscriptionRequest } from '@/lib/native-subscriptions/auth';
import { isPlanId, logPlanFailure, operateMindPlan } from './plan';

const headers = { 'Cache-Control':'private, no-store', Vary:'Authorization' };
export async function handleMindPlan(request: Request, operation: 'read' | 'start' | 'complete') {
  const json = (body: unknown, status=200) => NextResponse.json(body,{status,headers});
  try {
    const auth = await authenticateNativeSubscriptionRequest(request);
    if (!auth) return json({state:'unauthorized'},401);
    if ([...new URL(request.url).searchParams.keys()].length) return json({state:'invalid_request'},400);
    let target: {planId:string;actionNumber:number} | undefined;
    if (operation!=='read') {
      let body: any;
      try { body=await request.json(); } catch { return json({state:'invalid_request'},400); }
      if (!body || typeof body!=='object' || Array.isArray(body)) return json({state:'invalid_request'},400);
      const keys=Object.keys(body);
      if (operation==='start' ? keys.length!==0 : keys.length!==2 || !keys.includes('planId') || !keys.includes('actionNumber')
        || !isPlanId(body.planId) || !Number.isInteger(body.actionNumber) || body.actionNumber<1 || body.actionNumber>7) {
        return json({state:'invalid_request'},400);
      }
      if (operation==='complete') target={planId:body.planId,actionNumber:body.actionNumber};
    }
    const result=await operateMindPlan(auth.admin,auth.user.id,operation,target);
    return json(result,result.state==='locked'?403:result.state==='unavailable'?503:result.state==='conflict'?409:200);
  } catch { logPlanFailure(operation, 'route_exception'); return json({state:'unavailable',reason:'plan_unavailable'},503); }
}
