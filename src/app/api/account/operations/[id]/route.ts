import { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { tracePrivacy, privacyStage, privacyRpcFailure, authenticatePrivacy, isId, privacyFailure, privacyResponse, PrivacyError } from '@/lib/privacy/auth';
import { status } from '@/lib/privacy/operations';
export const runtime = 'nodejs';
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return tracePrivacy(request, () => readRequest(request, context));
}
async function readRequest(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    privacyStage(request, 'status_rpc');
    const { id } = await context.params;
    if (!isId(id)) throw new PrivacyError('operation_not_found', 404);
    const recovery = request.headers.get('x-privacy-recovery');
    // A high-entropy operation-specific capability exposes status only. It
    // cannot read exports, identify an account, or initiate/retry deletion.
    if (recovery && /^[\w-]{43}$/.test(recovery)) return privacyResponse(await status(createAdminSupabaseClient(), id, null, recovery, request));
    const { admin, user } = await authenticatePrivacy(request);
    return privacyResponse(await status(admin, id, user.id, undefined, request));
  } catch (error) { return privacyFailure(error, request); }
}
