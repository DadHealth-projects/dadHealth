// Presentation metadata only: SQL owns the actual atomic allowlisted capture.
export const EXPORT_FORMAT_VERSION = 1;
export const EXPORT_MESSAGE_BUDGET = 5_000_000;
export function exportEncodedSizesFit(files: Array<{ filename: string; base64Length: number }>) {
  return files.reduce((total, file) => total + file.base64Length
    + Math.ceil(file.base64Length / 76) * 2 + Buffer.byteLength(file.filename, 'utf8') + 4096, 64_000) <= EXPORT_MESSAGE_BUDGET;
}
export function exportAttachmentsFit(attachments: Array<{ filename: string; content: string }>) {
  // Base64 line folding, per-part MIME headers/boundaries plus message envelope.
  return exportEncodedSizesFit(attachments.map(file => ({ filename: file.filename, base64Length: file.content.length })));
}
export function exportAttachment(payload: unknown) {
  const content = Buffer.from(JSON.stringify(payload, null, 2), 'utf8').toString('base64');
  // Reserve envelope/headers/MIME space. The budget is NOT raw JSON bytes.
  const encodedBytes = Math.ceil(content.length / 76) * 2 + content.length + 64_000;
  return encodedBytes <= EXPORT_MESSAGE_BUDGET ? { filename: 'dad-health-data.json', content } : null;
}
export function validateCapturedExport(value: unknown): asserts value is { formatVersion: number; generatedAt: string; sections: Record<string, unknown> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid export');
  const v = value as Record<string, unknown>;
  if (v.formatVersion !== EXPORT_FORMAT_VERSION || typeof v.generatedAt !== 'string' || !Number.isFinite(Date.parse(v.generatedAt))
    || !v.sections || typeof v.sections !== 'object' || Array.isArray(v.sections) || !v.fieldExplanations) throw new Error('Invalid export');
}
