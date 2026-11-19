import { createHash, randomBytes } from 'node:crypto';
import { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { createServerSupabaseClient } from '@/utils/supabase/server';

export class PrivacyError extends Error {
  constructor(public code: string, public status = 503) { super(code); }
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
  const admin = createAdminSupabaseClient();
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  // Cookie mutations must be same-origin; bearer requests are not cookie-auth CSRF.
  if (!token && request.method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin) {
    throw new PrivacyError('unauthorized', 401);
  }
  const client = token ? admin : await createServerSupabaseClient();
  // The cookie session supplies a token only; getUser verifies that exact token.
  const accessToken = token ?? (await client.auth.getSession()).data.session?.access_token;
  if (!accessToken) throw new PrivacyError('unauthorized', 401);
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data.user) throw new PrivacyError('unauthorized', 401);
  let authenticatedAt: number | undefined;
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
    if (claims.sub === data.user.id && isId(claims.session_id) && Array.isArray(claims.amr)) {
      const times = claims.amr.filter((entry: { method?: unknown; timestamp?: unknown }) =>
        typeof entry.method === 'string' && entry.method !== 'token_refresh' &&
        typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp))
        .map((entry: { timestamp: number }) => entry.timestamp * 1000);
      if (times.length) authenticatedAt = Math.max(...times);
    }
  } catch { /* Missing session authentication evidence fails recent-auth closed. */ }
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
export function privacyFailure(error: unknown) {
  return privacyResponse({ state: 'unavailable', reason: error instanceof PrivacyError ? error.code : 'operation_unavailable' }, error instanceof PrivacyError ? error.status : 503);
}
