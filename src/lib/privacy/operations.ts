import { tracePrivacy, privacyStage, privacyRpcFailure, authenticatePrivacy, configuredSeconds, hashSecret, isId, newSecret, objectBody, PrivacyError, privacyFailure, privacyResponse, requireRecentIdentity } from './auth';
import type { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { acquireAppleRevocationToken, openCleanup, sealCleanup } from './external-cleanup';
export type PrivacyAdmin = ReturnType<typeof createAdminSupabaseClient>;
export class RemovedPrivacyOwnerError extends Error {
  constructor() { super('Account unavailable'); this.name = 'RemovedPrivacyOwnerError'; }
}
export async function privacyOwnerRemoved(admin: PrivacyAdmin, owner: string | null, provider: string, subscription: string | null, accountReference: string | null = null) {
  // No deployment dependency until this feature is explicitly enabled. Once
  // installed, database barriers remain active even if worker rollout is paused.
  if (process.env.PRIVACY_OPERATIONS_ENABLED !== 'true') return false;
  const {data,error} = await admin.rpc('account_privacy_owner_removed', {
    p_user_id: owner, p_provider: provider, p_subscription_id: subscription, p_account_reference: accountReference,
  });
  if (error || typeof data !== 'boolean') throw new PrivacyError('privacy_owner_check_unavailable');
  return data;
}
export type Operation = {
 id: string; user_id: string; kind: 'export' | 'delete'; state: string; destination: string | null;
 lease_token: string; attempts: number; handoff_at: string | null; account_removed_at: string | null;
 checkpoint: Record<string, unknown>;
};
export async function status(admin: PrivacyAdmin, id: string, owner: string | null, recovery?: string, request?: Request) {
  if (request) privacyStage(request, 'status_rpc');
  const { data, error } = await admin.rpc('account_privacy_status', { p_id: id, p_user_id: owner, p_recovery_hash: recovery ? hashSecret(recovery) : null });
  if (error) throw privacyRpcFailure(error, 'status_unavailable');
  if (!data) throw new PrivacyError('operation_not_found', 404);
  return data;
}
export function handleConfirmation(request: Request) {
  return tracePrivacy(request, () => prepareConfirmation(request));
}
async function prepareConfirmation(request: Request) {
  try {
    const { admin, user, authenticatedAt } = await authenticatePrivacy(request);
    requireRecentIdentity(authenticatedAt);
    privacyStage(request, 'body_validation');
    const body = await objectBody(request, ['operationId', 'kind', 'appleAuthorizationCode']);
    if (!isId(body.operationId) || !['export', 'delete'].includes(String(body.kind))) throw new PrivacyError('invalid_request', 400);
    if (body.kind === 'export' && (!user.email || !user.email_confirmed_at)) throw new PrivacyError('verified_email_required', 403);
    privacyStage(request, 'apple_evidence');
    const secret = newSecret();
    let cleanupMaterial: string | null = null;
    const webGrant = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith('privacy_apple_grant='))?.slice('privacy_apple_grant='.length);
    if (body.kind === 'delete' && webGrant) {
      let grant: Record<string, unknown> | null = null;
      try { grant = openCleanup(webGrant); } catch { /* Ignore unrelated/expired browser grants. */ }
      if (grant?.owner === user.id && grant.operationId === body.operationId && typeof grant.expires === 'number' && grant.expires > Date.now()) {
      const saved = await admin.from('account_privacy_confirmations').select('cleanup_material')
        .eq('operation_id', body.operationId).eq('user_id', user.id).eq('kind', 'delete')
        .gt('expires_at', new Date().toISOString()).is('used_at', null).maybeSingle();
      if (saved.error || typeof saved.data?.cleanup_material !== 'string') throw new PrivacyError('apple_confirmation_required', 403);
      cleanupMaterial = saved.data.cleanup_material;
      }
    }
    if (body.appleAuthorizationCode !== undefined) {
      if (body.kind !== 'delete' || typeof body.appleAuthorizationCode !== 'string' || !body.appleAuthorizationCode || body.appleAuthorizationCode.length > 4096)
        throw new PrivacyError('invalid_request', 400);
      const subject = user.identities?.find(identity => identity.provider === 'apple')?.identity_data?.sub;
      if (typeof subject !== 'string') throw new PrivacyError('apple_identity_mismatch', 403);
      cleanupMaterial = sealCleanup({ appleRefreshToken: await acquireAppleRevocationToken(body.appleAuthorizationCode, subject) });
    }
    if (body.kind === 'delete' && user.identities?.some(i => i.provider === 'apple') && !cleanupMaterial)
      throw new PrivacyError('apple_confirmation_required', 403);
    privacyStage(request, 'confirmation_expiry');
    const expiresAt = new Date(Date.now() + configuredSeconds('PRIVACY_CONFIRMATION_SECONDS') * 1000).toISOString();
    privacyStage(request, 'confirmation_rpc');
    const { error } = await admin.rpc('confirm_account_privacy_operation', {
      p_id: body.operationId, p_user_id: user.id, p_kind: body.kind, p_hash: hashSecret(secret),
      p_destination: body.kind === 'export' ? user.email : null, p_expires_at: expiresAt,
      p_cleanup_material: cleanupMaterial,
    });
    if (error) throw privacyRpcFailure(error, 'confirmation_unavailable');
    privacyStage(request, 'subscription_guidance');
    let subscriptionProviders: string[] | null = null;
    if (body.kind === 'delete') {
      const memberships = await admin.from('subscription_entitlements').select('provider').eq('user_id', user.id);
      if (!memberships.error && Array.isArray(memberships.data))
        subscriptionProviders = [...new Set(memberships.data.map(row => String(row.provider)))].filter(provider => ['apple','google','stripe'].includes(provider));
    }
    return privacyResponse({ confirmation: secret, expiresAt, destination: body.kind === 'export' ? user.email : null, subscriptionProviders });
  } catch (error) { return privacyFailure(error, request); }
}
export function handleRequest(request: Request, kind: 'export' | 'delete') {
  return tracePrivacy(request, () => submitRequest(request, kind));
}
async function submitRequest(request: Request, kind: 'export' | 'delete') {
  try {
    const { admin, user } = await authenticatePrivacy(request);
    privacyStage(request, 'body_validation');
    const body = await objectBody(request, ['operationId', 'confirmation', 'recovery']);
    if (!isId(body.operationId) || typeof body.confirmation !== 'string' || !/^[\w-]{43}$/.test(body.confirmation)
      || typeof body.recovery !== 'string' || !/^[\w-]{43}$/.test(body.recovery)) throw new PrivacyError('invalid_request', 400);
    // Installation alone must not enable unverified destructive work.
    privacyStage(request, 'rollout_gate');
    if (process.env.PRIVACY_OPERATIONS_ENABLED !== 'true') throw new PrivacyError('setup_pending');
    privacyStage(request, 'submission_rpc');
    const { data, error } = await admin.rpc('request_account_privacy_operation', {
      p_user_id: user.id, p_id: body.operationId, p_kind: kind,
      p_confirmation_hash: hashSecret(body.confirmation), p_recovery_hash: hashSecret(body.recovery),
    });
    if (error) throw privacyRpcFailure(error, error.code === 'P0001' ? 'export_limit' : error.code === '22023' ? 'reconfirmation_required' : 'confirmation_required', 409);
    return privacyResponse(data, 202);
  } catch (error) { return privacyFailure(error, request); }
}
export async function checkpoint(admin: PrivacyAdmin, o: Operation, patch: Record<string, unknown>) {
  const { data, error } = await admin.from('account_privacy_operations').update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', o.id).eq('lease_token', o.lease_token).select('id').maybeSingle();
  if (error || !data) throw new PrivacyError('lease_lost');
}
