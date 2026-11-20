import { handleRequest, status } from '@/lib/privacy/operations';
import { authenticatePrivacy, tracePrivacy, privacyResponse, privacyFailure, privacyRpcFailure } from '@/lib/privacy/auth';
export const runtime = 'nodejs';
export async function POST(request: Request) { return handleRequest(request, 'export'); }
// Recovery only: never creates, advances or sends an export. Ownership is
// derived from verified Auth, including when the device lost its receipt.
export function GET(request: Request) {
  return tracePrivacy(request, async () => {
    try {
      const { admin, user } = await authenticatePrivacy(request);
      const { data, error } = await admin.from('account_privacy_operations').select('id')
        .eq('user_id', user.id).eq('kind', 'export')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
      if (error) throw privacyRpcFailure(error, 'status_unavailable');
      return privacyResponse({ status: data ? await status(admin, data.id, user.id, undefined, request) : null });
    } catch (error) { return privacyFailure(error, request); }
  });
}
