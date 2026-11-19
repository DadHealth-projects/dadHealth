import { createHmac, timingSafeEqual } from 'node:crypto';
import { createAdminSupabaseClient } from '@/utils/supabase/admin';
import { privacyFailure, privacyResponse, PrivacyError } from '@/lib/privacy/auth';
export const runtime = 'nodejs';
// Svix raw-body protocol: https://docs.svix.com/receiving/verifying-payloads/how
export function verifyResendSignature(raw: string, headers: Headers, secret: string, now = Date.now()) {
 const id=headers.get('svix-id'), timestamp=headers.get('svix-timestamp'), signatures=headers.get('svix-signature');
 if(!id||!timestamp||!signatures||!/^\d+$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300) return false;
 const key=Buffer.from(secret.replace(/^whsec_/,''),'base64');if(key.length<16)return false;
 const expected=createHmac('sha256',key).update(`${id}.${timestamp}.${raw}`).digest();
 return signatures.split(' ').some(signature=>{
  const [version,value]=signature.split(',');if(version!=='v1'||!value)return false;
  const given=Buffer.from(value,'base64');return given.length===expected.length&&timingSafeEqual(given,expected);
 });
}
export async function POST(request:Request) {
 try {
  const secret=process.env.RESEND_WEBHOOK_SECRET;
  if(!secret)throw new PrivacyError('webhook_configuration_required');
  const raw=await request.text();
  if(raw.length>262144||!verifyResendSignature(raw,request.headers,secret))throw new PrivacyError('unauthorized',401);
  const event=JSON.parse(raw);
  if(!['email.bounced','email.failed','email.complained'].includes(event.type))return privacyResponse({received:true});
  if(typeof event.data?.email_id!=='string')throw new PrivacyError('invalid_event',400);
  // Monotonic and idempotent: repeated failure callbacks cannot resend an email.
  // Provider text, recipient and email content are deliberately not persisted.
  const {error}=await createAdminSupabaseClient().rpc('record_privacy_email_failure',{
   p_message_id:event.data.email_id,p_type:event.type,
  });
  if(error)throw new PrivacyError('delivery_status_unavailable');
  return privacyResponse({received:true});
 }catch(error){return privacyFailure(error);}
}
