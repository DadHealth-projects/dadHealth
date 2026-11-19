import { handleRequest } from '@/lib/privacy/operations';
export const runtime = 'nodejs';
export async function POST(request: Request) { return handleRequest(request, 'delete'); }
