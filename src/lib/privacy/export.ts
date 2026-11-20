import { sendEmail } from '@/lib/email/resend';
import { PrivacyError } from './auth';
import { checkpoint, type Operation, type PrivacyAdmin } from './operations';
import { exportAttachment, exportAttachmentsFit, exportEncodedSizesFit, validateCapturedExport } from './export-catalogue';
import { renderExportPdf, PDF_PRESENTATION_VERSION } from './export-pdf';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function exportEmailHtml(attached: boolean, href: string, expiry: string, origin: string) {
  const link = escapeHtml(href);
  const logo = escapeHtml(new URL('/Dad_Health_Web_Graphics/logo-monogram.png', origin).href);
  const copy = attached
    ? 'Your Dad Health data is attached.<br>Open the PDF to read your information. The JSON file is a structured copy you can use with other tools.'
    : 'Your Dad Health data is ready. Sign in to download your readable PDF and structured JSON copy.';
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0a0a0a;color:#d9d9d9;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#111;border:1px solid #1f1f1f;border-radius:20px;">
<tr><td align="center" style="padding:28px 24px 12px;"><img src="${logo}" alt="DH" width="64" height="64" style="display:block;border:0;width:64px;height:64px;"><p style="margin:16px 0 0;color:#b8e64a;font-size:12px;line-height:18px;letter-spacing:2px;font-weight:bold;">BUILT FOR DADS, BY DADS</p></td></tr>
<tr><td style="padding:16px 24px 28px;"><h1 style="margin:0 0 20px;color:#fff;font-size:28px;line-height:34px;font-weight:bold;">YOUR DATA IS READY</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:25px;color:#d9d9d9;">${copy}</p>
${attached ? '' : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#b8e64a" style="border-radius:12px;text-align:center;"><a href="${link}" style="display:inline-block;padding:16px 22px;color:#0a0a0a;font-size:16px;line-height:22px;font-weight:bold;text-decoration:none;">DOWNLOAD MY DATA</a></td></tr></table>
<p style="margin:20px 0 12px;font-size:14px;line-height:22px;">This download expires at ${escapeHtml(new Date(expiry).toISOString())}.</p>
<p style="margin:0 0 20px;font-size:14px;line-height:22px;overflow-wrap:anywhere;word-break:break-all;">Or open this link:<br><a href="${link}" style="color:#b8e64a;text-decoration:underline;word-break:break-all;">${link}</a></p>`}
<p style="margin:20px 0 0;border-top:1px solid #1f1f1f;padding-top:20px;font-size:14px;line-height:22px;color:#d9d9d9;">These files contain personal information. Keep them somewhere safe.</p>
</td></tr></table><p style="margin:20px 0 0;color:#d9d9d9;font-size:12px;line-height:18px;">Dad Health &mdash; Be the Stronger Dad</p>
</td></tr></table></body></html>`;
}

export async function processExport(admin: PrivacyAdmin, o: Operation) {
  // Never retry an uncertain provider send after its idempotency window.
  if (o.handoff_at && Date.now() - Date.parse(o.handoff_at) >= 23 * 3600_000) throw new PrivacyError('delivery_reconciliation_required');
  const capture = await admin.rpc('capture_account_export', { p_id: o.id, p_lease: o.lease_token });
  if (capture.error) throw new PrivacyError('capture_failed');
  if (!capture.data) throw new PrivacyError('capture_unavailable');
  const metadata = await admin.rpc('read_account_export_chunk', { p_id: o.id, p_user_id: o.user_id, p_offset: 0, p_limit: 0 });
  if (metadata.error || !metadata.data || !Number.isSafeInteger(metadata.data.bytes)) throw new PrivacyError('artifact_unavailable');
  const saved = o.checkpoint?.exportPresentation as { version: number; mode: string; html: string; hashes: string[] } | undefined;
  const legacy = Boolean(o.handoff_at && !saved);
  if (saved && saved.version !== PDF_PRESENTATION_VERSION) throw new PrivacyError('presentation_version_unavailable');
  let attachment: ReturnType<typeof exportAttachment> = null;
  let attachments: Array<{ filename: string; content: string }> | undefined;
  // Above this conservative raw-byte threshold the encoded email cannot fit.
  // Do not materialize/base64-encode a large owner dataset in worker memory.
  if (metadata.data.bytes <= 3_500_000) {
    const artifact = await admin.from('account_export_artifacts').select('payload').eq('operation_id', o.id).single();
    if (artifact.error || !artifact.data) throw new PrivacyError('artifact_unavailable');
    validateCapturedExport(artifact.data.payload);
    attachment = exportAttachment(artifact.data.payload);
    if (!legacy && (!saved || saved.mode === 'attachments')) {
      const payload = artifact.data.payload;
      const pdf = await renderExportPdf((async function* () { yield JSON.stringify(payload); })(), payload.generatedAt);
      try {
        // Check output size BEFORE reading/base64 encoding the spooled PDF.
        if (attachment && exportEncodedSizesFit([
          { filename: 'dad-health-my-data.pdf', base64Length: Math.ceil(pdf.bytes / 3) * 4 },
          { filename: attachment.filename, base64Length: attachment.content.length },
        ])) {
          const pair = [{ filename: 'dad-health-my-data.pdf', content: (await readFile(pdf.path)).toString('base64') }, attachment];
          if (exportAttachmentsFit(pair)) attachments = pair;
        }
      } finally { await pdf.dispose(); }
    }
  }
  const origin = process.env.PRIVACY_PUBLIC_ORIGIN;
  if (!origin || new URL(origin).protocol !== 'https:') throw new PrivacyError('download_configuration_required');
  const expiry = metadata.data.expiresAt;
  const href = new URL(`/privacy-request/confirm?download=${encodeURIComponent(o.id)}`, origin).href;
  let html = attachment
    ? '<p>Your Dad Health data is attached. This file contains personal information. Keep it somewhere safe.</p>'
    : `<p>Your Dad Health data is ready. Sign in to your account to download it.</p><p><a href="${href}">Download your data</a></p><p>This download expires at ${new Date(expiry).toISOString()}.</p>`;
  if (legacy) attachments = attachment ? [attachment] : undefined;
  else {
    html = saved?.html ?? exportEmailHtml(Boolean(attachments), href, expiry, origin);
    const mode = attachments ? 'attachments' : 'link';
    const hashes = (attachments ?? []).map(a => createHash('sha256').update(a.content).digest('hex'));
    if (saved && (saved.mode !== mode || JSON.stringify(saved.hashes) !== JSON.stringify(hashes)))
      throw new PrivacyError('presentation_changed');
    if (!saved) {
      const presentation = { version: PDF_PRESENTATION_VERSION, mode, html, hashes };
      await checkpoint(admin, o, { checkpoint: { ...o.checkpoint, exportPresentation: presentation } });
      o.checkpoint = { ...o.checkpoint, exportPresentation: presentation };
    }
  }
  // Last DB operation before the external handoff rechecks Auth email and
  // serializes authorization with deletion. Never substitute a changed email.
  const authorization = await admin.rpc('authorize_account_export_send', { p_id: o.id, p_lease: o.lease_token });
  if (authorization.error) throw new PrivacyError('send_authorization_failed');
  if (!authorization.data) return;
  const result = await sendEmail({ to: authorization.data.destination, subject: 'Your Dad Health data', html,
    ...(attachments ? { attachments } : {}), idempotencyKey: `privacy-export/${o.id}`, signal: AbortSignal.timeout(20_000) });
  const recorded = await admin.rpc('record_privacy_email_result', { p_id: o.id, p_lease: o.lease_token, p_message_id: result.id });
  if (recorded.error || recorded.data !== true) throw new PrivacyError('delivery_record_failed');
}
