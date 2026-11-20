import { createHash, randomBytes } from 'node:crypto';
import { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { createServerSupabaseClient } from '@/utils/supabase/server';

export class PrivacyError extends Error {
  constructor(public code: string, public status = 503, public diagnostic?: string, public safeCode?: string) { super(code); }
}
export const hashSecret = (value: string) => createHash('sha256').update(value).digest('hex');
export const newSecret = () => randomBytes(32).toString('base64url');
export const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function configuredSeconds(name: string) {
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < 1) throw new PrivacyError('verification_configuration_required');
  return value;
}
export async function authenticatePrivacy(request: Request) {
  privacyStage(request, 'admin_client');
  let admin: ReturnType<typeof createAdminSupabaseClient>;
  try { admin = createAdminSupabaseClient(); }
  catch { throw new PrivacyError('operation_unavailable', 503, 'admin_configuration_required'); }
  privacyStage(request, 'session_selection');
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  // Cookie mutations must be same-origin; bearer requests are not cookie-auth CSRF.
  if (!token && request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin) {
    throw new PrivacyError('unauthorized', 401);
  }
  const client = token ? admin : await createServerSupabaseClient();
  // The cookie session supplies a token only; getUser verifies that exact token.
  const accessToken = token ?? (await client.auth.getSession()).data.session?.access_token;
  if (!accessToken) throw new PrivacyError('unauthorized', 401, 'missing_session');
  privacyStage(request, 'session_verification');
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) throw new PrivacyError('unauthorized', 401, 'invalid_session', error?.code);
  let authenticatedAt: number | undefined;
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
    if (claims.sub !== data.user.id) throw new PrivacyError('unauthorized', 401, 'owner_mismatch');
    if (claims.sub === data.user.id && isId(claims.session_id) && Array.isArray(claims.amr)) {
      const times = claims.amr.filter((entry: { method?: unknown; timestamp?: unknown }) =>
        typeof entry.method === 'string' && entry.method !== 'token_refresh' &&
        typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp))
        .map((entry: { timestamp: number }) => entry.timestamp * 1000);
      if (times.length) authenticatedAt = Math.max(...times);
    }
  } catch (error) {
    if (error instanceof PrivacyError) throw error;
    // Missing session authentication evidence fails recent-auth closed.
  }
  privacyStage(request, 'recent_auth');
  return { admin, user: data.user, authenticatedAt };
}
export function requireRecentIdentity(authenticatedAt: number | undefined, now = Date.now()) {
  const seconds = configuredSeconds('PRIVACY_RECENT_AUTH_SECONDS');
  if (typeof authenticatedAt !== 'number' || !Number.isFinite(authenticatedAt) || authenticatedAt > now || now - authenticatedAt > seconds * 1000)
    throw new PrivacyError('reauthentication_required', 403);
}
export async function objectBody(request: Request, keys: string[]) {
  const raw = await request.text();
  if (raw.length > 8192) throw new PrivacyError('invalid_request', 400);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new PrivacyError('invalid_request', 400); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) {
    throw new PrivacyError('invalid_request', 400);
  }
  return value as Record<string, unknown>;
}
export function privacyResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie', 'Referrer-Policy': 'no-referrer' } });
}
export function privacyFailure(error: unknown, request?: Request) {
  const trace = request && traces.get(request);
  if (trace) {
    const reason = error instanceof PrivacyError ? error.diagnostic ?? error.code : 'operation_unavailable';
    trace.reason = reasons.has(reason) ? reason : 'operation_unavailable';
    trace.safeCode = error instanceof PrivacyError && safeCodes.has(error.safeCode ?? '') ? error.safeCode : undefined;
  }
  return privacyResponse({ state: 'unavailable', reason: error instanceof PrivacyError ? error.code : 'operation_unavailable' }, error instanceof PrivacyError ? error.status : 503);
}

// Only fixed taxonomy values enter diagnostics. Never serialize an error object.
const reasons = new Set(['ok','unauthorized','missing_session','invalid_session','owner_mismatch',
  'reauthentication_required','verification_configuration_required','admin_configuration_required',
  'invalid_request','verified_email_required','setup_pending','confirmation_unavailable',
  'confirmation_required','reconfirmation_required','export_limit','operation_conflict',
  'rpc_unavailable','rpc_permission_denied','operation_unavailable','status_unavailable','operation_not_found',
  'apple_configuration_required','apple_confirmation_required','apple_confirmation_failed','apple_identity_mismatch',
  'cleanup_configuration_required','account_email_missing','email_verification_unavailable','download_unavailable']);
const stages = new Set(['received','admin_client','session_selection','session_verification','recent_auth',
  'body_validation','apple_evidence','confirmation_expiry','confirmation_rpc','subscription_guidance',
  'rollout_gate','submission_rpc','status_rpc','email_verification','apple_redirect','apple_callback','download']);
const safeCodes = new Set(['42501','42883','42P01','42703','23503','23505','22023','P0001',
  'PGRST202','PGRST301','PGRST302','PGRST204','session_not_found','bad_jwt','jwt_expired']);
type PrivacyTrace = { id: string; started: number; stage: string; reason?: string; safeCode?: string };
const traces = new WeakMap<Request, PrivacyTrace>();
export function privacyStage(request: Request, stage: string) {
  const trace = traces.get(request);
  if (trace && stages.has(stage)) trace.stage = stage;
}
export function privacyRpcFailure(error: { code?: string; message?: string }, fallback: string, status = 503) {
  // Match only known fixed database messages; never print the supplied message.
  const reason = error.code === '42501'
    ? error.message === 'Confirmation required' ? 'confirmation_required' : 'rpc_permission_denied'
    : error.code === '23505' ? 'operation_conflict'
    : ['42883','42P01','42703','PGRST202','PGRST204'].includes(error.code ?? '') ? 'rpc_unavailable' : fallback;
  return new PrivacyError(fallback, status, reason, safeCodes.has(error.code ?? '') ? error.code : undefined);
}
export async function tracePrivacy(request: Request, handler: () => Promise<Response>): Promise<Response> {
  if (traces.has(request)) return handler();
  const incoming = request.headers.get('x-privacy-request-id');
  const trace: PrivacyTrace = { id: incoming && /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(incoming)
    ? incoming : randomBytes(16).toString('hex'), started: Date.now(), stage: 'received' };
  traces.set(request, trace);
  let response: Response;
  try { response = await handler(); } catch (error) { response = privacyFailure(error, request); }
  response.headers.set('X-Privacy-Request-ID', trace.id);
  const revision = process.env.VERCEL_GIT_COMMIT_SHA;
  if (revision && /^[a-f0-9]{40}$/i.test(revision)) response.headers.set('X-Privacy-Revision', revision.slice(0, 12));
  const event = { correlationId: trace.id, stage: trace.stage,
    reason: trace.reason ?? (response.ok || response.status < 400 ? 'ok' : 'operation_unavailable'),
    status: response.status, durationMs: Date.now() - trace.started, safeErrorCode: trace.safeCode ?? null };
  if (response.status >= 400) console.warn('[AccountPrivacy]', event);
  else if (process.env.PRIVACY_DEBUG === 'true') console.info('[AccountPrivacy]', event);
  return response;
}
