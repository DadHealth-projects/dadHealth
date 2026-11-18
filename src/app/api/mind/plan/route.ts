import { handleMindPlan } from '@/lib/mind/plan-api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request: Request) { return handleMindPlan(request,'read'); }
