import { handleMindPlan } from '@/lib/mind/plan-api';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request: Request) { return handleMindPlan(request,'complete'); }
