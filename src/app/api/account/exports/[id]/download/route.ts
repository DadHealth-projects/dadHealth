import { authenticatePrivacy, isId, PrivacyError, privacyFailure } from '@/lib/privacy/auth';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, user } = await authenticatePrivacy(request);
    const { id } = await context.params;
    if (!isId(id)) throw new PrivacyError('download_unavailable', 404);
    const read = async (offset: number, limit = 65536) => {
      const { data, error } = await admin.rpc('read_account_export_chunk', { p_id: id, p_user_id: user.id, p_offset: offset, p_limit: limit });
      if (error) throw new PrivacyError('download_unavailable');
      if (!data) throw new PrivacyError('download_unavailable', 404);
      if (typeof data.text !== 'string' || !Number.isSafeInteger(data.length)) throw new PrivacyError('download_unavailable');
      return data as { text: string; length: number };
    };
    const initial = await read(0);
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
  } catch (error) { return privacyFailure(error); }
}
