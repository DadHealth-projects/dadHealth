import { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { authenticatePrivacy, isId, privacyFailure, privacyResponse, PrivacyError } from '@/lib/privacy/auth';
import { status } from '@/lib/privacy/operations';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isId(id)) throw new PrivacyError('operation_not_found', 404);
    const recovery = request.headers.get('x-privacy-recovery');
    // A high-entropy operation-specific capability exposes status only. It
    // cannot read exports, identify an account, or initiate/retry deletion.
    if (recovery && /^[\w-]{43}$/.test(recovery)) return privacyResponse(await status(createAdminSupabaseClient(), id, null, recovery));
    const { admin, user } = await authenticatePrivacy(request);
    return privacyResponse(await status(admin, id, user.id));
  } catch (error) { return privacyFailure(error); }
}
