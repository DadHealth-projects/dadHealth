import { handleConfirmation } from '@/lib/privacy/operations';
import { tracePrivacy, privacyStage, privacyRpcFailure, authenticatePrivacy, configuredSeconds, hashSecret, isId, newSecret, objectBody, PrivacyError, privacyFailure, privacyResponse, requireRecentIdentity } from '@/lib/privacy/auth';
import { acquireAppleRevocationToken, openCleanup, sealCleanup } from '@/lib/privacy/external-cleanup';
import { createAdminSupabaseClient } from '@/utils/supabase/admin';
export const runtime = 'nodejs';
const cookie = (name: string, value: string, seconds: number) => `${name}=${value}; HttpOnly; Secure; SameSite=None; Path=/api/account/privacy-verification; Max-Age=${seconds}`;
function readCookie(request: Request, name: string) {
 return request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(name+'='))?.slice(name.length+1);
}
// Explicit authenticated navigation, never an account deletion or export.
export function GET(request: Request) { return tracePrivacy(request, () => getVerification(request)); }
async function getVerification(request: Request) {
 try {
  const { user, authenticatedAt } = await authenticatePrivacy(request); requireRecentIdentity(authenticatedAt);
  privacyStage(request, 'apple_redirect');
  const operationId = new URL(request.url).searchParams.get('apple');
  const subject = user.identities?.find(i => i.provider === 'apple')?.identity_data?.sub;
  if (!isId(operationId) || typeof subject !== 'string') throw new PrivacyError('invalid_request',400);
  const client = process.env.PRIVACY_APPLE_WEB_CLIENT_ID, origin = process.env.PRIVACY_PUBLIC_ORIGIN;
  if (!client || !origin || !origin.startsWith('https://')) throw new PrivacyError('apple_configuration_required');
  const seconds = configuredSeconds('PRIVACY_CONFIRMATION_SECONDS'); const nonce = newSecret();
  const state = sealCleanup({ owner:user.id, operationId, subject, nonce, expires:Date.now()+seconds*1000 });
  const url = new URL('https://appleid.apple.com/auth/authorize');
  url.search = new URLSearchParams({client_id:client,redirect_uri:new URL('/api/account/privacy-verification',origin).href,response_type:'code',response_mode:'form_post',state,nonce}).toString();
  return new Response(null,{status:303,headers:{Location:url.href,'Set-Cookie':cookie('privacy_apple_state',state,seconds),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 } catch(error) { return privacyFailure(error, request); }
}
export function POST(request: Request) { return tracePrivacy(request, () => postVerification(request)); }
async function postVerification(request: Request) {
 if (request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
  try {
   privacyStage(request, 'apple_callback');
   const raw = await request.text(); if (raw.length>16384) throw new PrivacyError('invalid_request',400);
   const form = new URLSearchParams(raw); const state = form.get('state');
   if (!state || state !== readCookie(request,'privacy_apple_state')) throw new PrivacyError('apple_confirmation_required',403);
   const context = openCleanup(state);
   if (typeof context.expires !== 'number' || context.expires<=Date.now() || typeof context.owner !== 'string' || !isId(context.operationId)) throw new PrivacyError('apple_confirmation_required',403);
   const origin = process.env.PRIVACY_PUBLIC_ORIGIN; if (!origin) throw new PrivacyError('apple_configuration_required');
   const headers = new Headers({'Location':new URL('/privacy-request/confirm',origin).href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
   headers.append('Set-Cookie',cookie('privacy_apple_state','',0));
   if (form.get('error') === 'user_cancelled_authorize') return new Response(null,{status:303,headers});
   const code = form.get('code'); if (!code) throw new PrivacyError('apple_confirmation_required',403);
   const admin = createAdminSupabaseClient();
   const {data,error} = await admin.auth.admin.getUserById(context.owner);
   const subject = data.user?.identities?.find(i=>i.provider==='apple')?.identity_data?.sub;
   if (error || typeof subject !== 'string' || subject !== context.subject || typeof context.nonce !== 'string') throw new PrivacyError('apple_identity_mismatch',403);
   const token = await acquireAppleRevocationToken(code,subject,true,context.nonce);
   const seconds = configuredSeconds('PRIVACY_CONFIRMATION_SECONDS');
   const expires = Date.now()+seconds*1000;
   privacyStage(request, 'confirmation_rpc');
   const saved = await admin.rpc('confirm_account_privacy_operation', {
    p_user_id:context.owner,p_id:context.operationId,p_kind:'delete',p_hash:hashSecret(newSecret()),p_destination:null,
    p_expires_at:new Date(expires).toISOString(),p_cleanup_material:sealCleanup({appleRefreshToken:token,appleWeb:true}),
   });
   if(saved.error)throw privacyRpcFailure(saved.error, 'confirmation_unavailable');
   // The provider grant stays encrypted in server storage; the browser carries
   // only its owner/operation-bound verification reference.
   headers.append('Set-Cookie',cookie('privacy_apple_grant',sealCleanup({owner:context.owner,operationId:context.operationId,expires}),seconds));
   return new Response(null,{status:303,headers});
  } catch(error) { return privacyFailure(error, request); }
 }
 // Email is always obtained from verified Auth, never from request parameters.
 const copy = request.clone();
 try {
  const body = await copy.json();
  if (body?.action === 'verify_email') {
   await objectBody(request,['action']);
   const {admin,user,authenticatedAt} = await authenticatePrivacy(request); requireRecentIdentity(authenticatedAt);
   privacyStage(request, 'email_verification');
   if (!user.email) throw new PrivacyError('account_email_missing',409);
   if (!user.email_confirmed_at) {
    const result = await admin.auth.resend({type:'signup',email:user.email});
    if(result.error) throw new PrivacyError('email_verification_unavailable');
   }
   return privacyResponse({state:user.email_confirmed_at?'verified':'verification_requested', email:user.email});
  }
 } catch(error) { return privacyFailure(error, request); }
 return handleConfirmation(request);
}
