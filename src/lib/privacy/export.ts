import { sendEmail } from '@/lib/email/resend';
import { PrivacyError } from './auth';
import { type Operation, type PrivacyAdmin } from './operations';
import { exportAttachment, validateCapturedExport } from './export-catalogue';

export async function processExport(admin: PrivacyAdmin, o: Operation) {
  // Never retry an uncertain provider send after its idempotency window.
  if (o.handoff_at && Date.now() - Date.parse(o.handoff_at) >= 23 * 3600_000) throw new PrivacyError('delivery_reconciliation_required');
  const capture = await admin.rpc('capture_account_export', { p_id: o.id, p_lease: o.lease_token });
  if (capture.error) throw new PrivacyError('capture_failed');
  if (!capture.data) throw new PrivacyError('capture_unavailable');
  const metadata = await admin.rpc('read_account_export_chunk', { p_id: o.id, p_user_id: o.user_id, p_offset: 0, p_limit: 0 });
  if (metadata.error || !metadata.data || !Number.isSafeInteger(metadata.data.bytes)) throw new PrivacyError('artifact_unavailable');
  let attachment: ReturnType<typeof exportAttachment> = null;
  // Above this conservative raw-byte threshold the encoded email cannot fit.
  // Do not materialize/base64-encode a large owner dataset in worker memory.
  if (metadata.data.bytes <= 3_500_000) {
    const artifact = await admin.from('account_export_artifacts').select('payload').eq('operation_id', o.id).single();
    if (artifact.error || !artifact.data) throw new PrivacyError('artifact_unavailable');
    validateCapturedExport(artifact.data.payload);
    attachment = exportAttachment(artifact.data.payload);
  }
  const origin = process.env.PRIVACY_PUBLIC_ORIGIN;
  if (!origin || new URL(origin).protocol !== 'https:') throw new PrivacyError('download_configuration_required');
  const expiry = metadata.data.expiresAt;
  const href = new URL(`/privacy-request/confirm?download=${encodeURIComponent(o.id)}`, origin).href;
  const html = attachment
    ? '<p>Your Dad Health data is attached. This file contains personal information. Keep it somewhere safe.</p>'
    : `<p>Your Dad Health data is ready. Sign in to your account to download it.</p><p><a href="${href}">Download your data</a></p><p>This download expires at ${new Date(expiry).toISOString()}.</p>`;
  // Last DB operation before the external handoff rechecks Auth email and
  // serializes authorization with deletion. Never substitute a changed email.
  const authorization = await admin.rpc('authorize_account_export_send', { p_id: o.id, p_lease: o.lease_token });
  if (authorization.error) throw new PrivacyError('send_authorization_failed');
  if (!authorization.data) return;
  const result = await sendEmail({ to: authorization.data.destination, subject: 'Your Dad Health data', html,
    ...(attachment ? { attachments: [attachment] } : {}), idempotencyKey: `privacy-export/${o.id}`, signal: AbortSignal.timeout(20_000) });
  const recorded = await admin.rpc('record_privacy_email_result', { p_id: o.id, p_lease: o.lease_token, p_message_id: result.id });
  if (recorded.error || recorded.data !== true) throw new PrivacyError('delivery_record_failed');
}
