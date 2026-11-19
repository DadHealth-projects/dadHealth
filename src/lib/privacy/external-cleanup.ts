import { encryptWearableToken } from '@/lib/wearables/tokens';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PrivacyError } from './auth';

export function sealCleanup(value: unknown): string {
  const key = cleanupKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(v => v.toString('base64url')).join('.');
}
export function openCleanup(value: string): Record<string, unknown> {
  const [iv, tag, data] = value.split('.').map(v => Buffer.from(v, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', cleanupKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}
function cleanupKey() {
  const key = Buffer.from(process.env.PRIVACY_CLEANUP_KEY ?? '', 'base64');
  if (key.length !== 32) throw new PrivacyError('cleanup_configuration_required');
  return key;
}
export async function deleteOneSignalOwner(owner: string) {
  const app = process.env.ONESIGNAL_APP_ID, key = process.env.ONESIGNAL_REST_API_KEY;
  if (!app || !key) throw new PrivacyError('onesignal_configuration_required');
  const response = await fetch(`https://api.onesignal.com/apps/${encodeURIComponent(app)}/users/by/external_id/${encodeURIComponent(owner)}`,
    { method: 'DELETE', headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok && response.status !== 404) throw new PrivacyError('onesignal_cleanup_failed');
}
export async function revokeAppleToken(token: string, web = false) {
  const client = web ? process.env.PRIVACY_APPLE_WEB_CLIENT_ID : process.env.PRIVACY_APPLE_CLIENT_ID,
    secret = web ? process.env.PRIVACY_APPLE_WEB_CLIENT_SECRET : process.env.PRIVACY_APPLE_CLIENT_SECRET;
  if (!client || !secret) throw new PrivacyError('apple_configuration_required');
  const response = await fetch('https://appleid.apple.com/auth/revoke', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client, client_secret: secret, token, token_type_hint: 'refresh_token' }),
    signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new PrivacyError('apple_cleanup_failed');
}

export async function acquireAppleRevocationToken(code: string, expectedSubject: string, web = false, nonce?: string) {
  const client = web ? process.env.PRIVACY_APPLE_WEB_CLIENT_ID : process.env.PRIVACY_APPLE_CLIENT_ID,
    secret = web ? process.env.PRIVACY_APPLE_WEB_CLIENT_SECRET : process.env.PRIVACY_APPLE_CLIENT_SECRET;
  if (!client || !secret) throw new PrivacyError('apple_configuration_required');
  const response = await fetch('https://appleid.apple.com/auth/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client, client_secret: secret, code, grant_type: 'authorization_code', ...(web ? { redirect_uri: new URL('/api/account/privacy-verification', process.env.PRIVACY_PUBLIC_ORIGIN).href } : {}) }),
    signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new PrivacyError('apple_confirmation_failed');
  const tokens = await response.json();
  // This ID token comes directly from Apple's authenticated HTTPS token endpoint,
  // never from a client-supplied JWT. Bind the returned grant to verified Auth.
  const claims = JSON.parse(Buffer.from(String(tokens.id_token).split('.')[1] ?? '', 'base64url').toString('utf8'));
  if (nonce !== undefined && claims.nonce !== nonce) throw new PrivacyError('apple_identity_mismatch', 403);
  if (claims.sub !== expectedSubject || claims.iss !== 'https://appleid.apple.com' || claims.aud !== client
    || typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now() || typeof tokens.refresh_token !== 'string')
    throw new PrivacyError('apple_identity_mismatch', 403);
  return tokens.refresh_token as string;
}

function unwrapWearableToken(value: string) {
  // Matches the installed v1 AES-GCM format in lib/wearables/tokens.ts.
  const secret = process.env.WEARABLE_TOKEN_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new PrivacyError('integration_key_required');
  const [version, iv, tag, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new PrivacyError('integration_token_unavailable');
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
export async function revokeWearableAuthorization(integration: Record<string, unknown>, persist?: (next: Record<string, unknown>) => Promise<void>) {
  if (integration.provider === 'garmin') {
    if (typeof integration.access_token !== 'string') throw new PrivacyError('integration_token_unavailable');
    const remove = (token: string) => fetch('https://apis.garmin.com/wellness-api/rest/user/registration', {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
    });
    let response = await remove(unwrapWearableToken(integration.access_token));
    if (response.status === 401 && typeof integration.refresh_token === 'string') {
      const client = process.env.GARMIN_CLIENT_ID, secret = process.env.GARMIN_CLIENT_SECRET;
      if (!client || !secret || !persist) throw new PrivacyError('garmin_refresh_configuration_required');
      const refreshed = await fetch('https://diauth.garmin.com/di-oauth2-service/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: client, client_secret: secret,
          refresh_token: unwrapWearableToken(integration.refresh_token) }), signal: AbortSignal.timeout(20_000),
      });
      if (!refreshed.ok) throw new PrivacyError('garmin_refresh_failed');
      const tokens = await refreshed.json();
      if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') throw new PrivacyError('garmin_refresh_failed');
      // Garmin rotates refresh tokens. Persist before the destructive request so
      // a later worker can resume with the new grant after a transport failure.
      const next = { ...integration, access_token: encryptWearableToken(tokens.access_token), refresh_token: encryptWearableToken(tokens.refresh_token) };
      await persist(next);
      response = await remove(tokens.access_token);
    }
    if (!response.ok) throw new PrivacyError('garmin_revocation_failed');
    return;
  }
  if (integration.provider !== 'fitbit') throw new PrivacyError('unsupported_integration_provider');
  const client = process.env.FITBIT_CLIENT_ID, secret = process.env.FITBIT_CLIENT_SECRET;
  if (!client || !secret) throw new PrivacyError('fitbit_configuration_required');
  const encrypted = integration.refresh_token ?? integration.access_token;
  if (typeof encrypted !== 'string') throw new PrivacyError('integration_token_unavailable');
  const response = await fetch('https://api.fitbit.com/oauth2/revoke', { method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${client}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: unwrapWearableToken(encrypted) }), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new PrivacyError('fitbit_revocation_failed');
}
