import { sendEmail } from '@/lib/email/resend';
import type { createAdminSupabaseClient } from '@/utils/supabase/admin';

type Admin = ReturnType<typeof createAdminSupabaseClient>;
type Claim = { id: string; lease: string; kind: string; target: string; reason: string; explanation: string; excerpt: string; createdAt: string };
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function moderationEmail(report: Claim) {
  // Immutable version 1 payload: no retry timestamp, reporter identity or author identity.
  const rows = [['Report', report.id], ['Content type', report.kind], ['Content reference', report.target], ['Reason', report.reason], ['Explanation', report.explanation || 'Not supplied'], ['Reported content (up to 500 characters)', report.excerpt], ['Received', report.createdAt]];
  return { to: 'hello@dadhealth.co.uk', subject: 'Dad Health community report', idempotencyKey: `community-report-v1-${report.id}`,
    html: `<html><body style="margin:0;background:#0a0a0a;color:#d9d9d9;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="24"><tr><td align="center"><table role="presentation" width="100%" style="max-width:600px;background:#111;border:1px solid #1f1f1f;border-radius:16px" cellpadding="20"><tr><td><strong style="color:#b8e64a;font-size:28px">DH</strong><p>BUILT FOR DADS, BY DADS</p><h1 style="color:#fff">COMMUNITY REPORT</h1>${rows.map(([label,value]) => `<p><strong>${label}</strong><br><span style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(value)}</span></p>`).join('')}<p>Review this report using the referenced content. This email does not establish that the content breaches policy.</p><p>Dad Health — Be the Stronger Dad</p></td></tr></table></td></tr></table></body></html>` };
}
export async function runModerationWorker(admin: Admin, send = sendEmail) {
  const retention = await admin.rpc('purge_resolved_community_reports');
  if (retention.error) throw new Error('retention_failed');
  let accepted = 0, pending = 0;
  for (let i = 0; i < 3; i++) {
    const claim = await admin.rpc('claim_community_report_delivery');
    if (claim.error) throw new Error('claim_failed');
    if (!claim.data) break;
    const report = claim.data as Claim;
    if (![report.id, report.lease, report.kind, report.target, report.reason, report.explanation, report.excerpt, report.createdAt].every(v => typeof v === 'string')) throw new Error('invalid_claim');
    let messageId: string | null = null;
    try { messageId = (await send({ ...moderationEmail(report), signal: AbortSignal.timeout(15000) })).id; }
    catch { console.warn('[ModerationDelivery]', { stage: 'handoff', reason: 'provider_unconfirmed' }); }
    const saved = await admin.rpc('finish_community_report_delivery', { p_id: report.id, p_lease: report.lease, p_message_id: messageId });
    if (saved.error || saved.data !== true) throw new Error('receipt_unconfirmed');
    if (messageId) accepted++; else pending++;
  }
  return { accepted, pending };
}
