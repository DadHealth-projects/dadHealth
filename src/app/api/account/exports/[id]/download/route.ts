import { tracePrivacy, privacyStage, privacyRpcFailure, authenticatePrivacy, isId, PrivacyError, privacyFailure } from '@/lib/privacy/auth';
import { renderExportPdf } from '@/lib/privacy/export-pdf';
import { createReadStream } from 'node:fs';
export const runtime = 'nodejs';
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return tracePrivacy(request, () => readRequest(request, context));
}
async function readRequest(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    privacyStage(request, 'download');
    const { admin, user } = await authenticatePrivacy(request);
    const { id } = await context.params;
    if (!isId(id)) throw new PrivacyError('download_unavailable', 404);
    const formats = new URL(request.url).searchParams.getAll('format');
    const format = formats[0] ?? 'json';
    if (formats.length > 1 || !['json', 'pdf'].includes(format)) throw new PrivacyError('invalid_request', 400);
    const read = async (offset: number, limit = 65536) => {
      const { data, error } = await admin.rpc('read_account_export_chunk', { p_id: id, p_user_id: user.id, p_offset: offset, p_limit: limit });
      if (error) throw privacyRpcFailure(error, 'download_unavailable');
      if (!data) throw new PrivacyError('download_unavailable', 404);
      if (typeof data.text !== 'string' || !Number.isSafeInteger(data.length)) throw new PrivacyError('download_unavailable');
      return data as { text: string; length: number };
    };
    const initial = await read(0);
    if (format === 'pdf') {
      // Read only metadata from the SAME immutable artifact, never live records.
      const stamp = await admin.from('account_export_artifacts').select('payload->>generatedAt').eq('operation_id', id).single();
      if (stamp.error || typeof stamp.data?.generatedAt !== 'string') throw new PrivacyError('download_unavailable');
      const chunks = async function* () {
        let chunk = initial, position = 0;
        while (true) {
          request.signal.throwIfAborted();
          yield chunk.text;
          const count = Array.from(chunk.text).length;
          position += count;
          if (position >= chunk.length) break;
          if (!count) throw new Error('Incomplete capture');
          chunk = await read(position);
        }
      };
      const pdf = await renderExportPdf(chunks(), stamp.data.generatedAt, request.signal);
      let file: ReturnType<typeof createReadStream>;
      try { await read(0, 0); request.signal.throwIfAborted(); file = createReadStream(pdf.path, { highWaterMark: 65536 }); }
      catch (error) { await pdf.dispose(); throw error; }
      const iterator = file[Symbol.asyncIterator]();
      const cleanup = async () => { file.destroy(); await pdf.dispose(); };
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            request.signal.throwIfAborted();
            // Recheck expiry/deletion/ownership during delivery, not just before
            // the potentially long render. Revocation errors terminate the stream.
            await read(0, 0);
            const part = await iterator.next();
            if (part.done) { await cleanup(); controller.close(); }
            else controller.enqueue(part.value);
          } catch { await cleanup(); controller.error(new Error('Download unavailable')); }
        },
        async cancel() { await cleanup(); },
      });
      return new Response(stream, { headers: { 'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="dad-health-my-data.pdf"', 'Cache-Control': 'private, no-store',
        Vary: 'Authorization, Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
    }
    let offset = 0; let first = true;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (request.signal.aborted) { controller.error(new Error('Download cancelled')); return; }
          const chunk = first ? initial : await read(offset); first = false;
          // PostgreSQL offsets count Unicode code points, not UTF-16 units.
          offset += Array.from(chunk.text).length;
          if (chunk.text) controller.enqueue(encoder.encode(chunk.text));
          if (offset >= chunk.length) controller.close();
        } catch { controller.error(new Error('Download unavailable')); }
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="dad-health-data.json"', 'Cache-Control': 'private, no-store',
      Vary: 'Authorization, Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
  } catch (error) { return privacyFailure(error, request); }
}
