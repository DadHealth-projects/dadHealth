import { createHash } from 'node:crypto';
import { PrivacyError } from './auth';
// Public provider contract: https://posthog.com/docs/data-pipelines/file-download-exports
// Only organization-enabled HogQL file exports. Never /query/ or project-wide models.
export type ExportRun = { key: string; id: string; pageSize?: number; files?: string[]; fileIndex?: number; rows?: unknown[][] };
type Input = { aliases: string[]; cutoff: string; cursor?: string; limit: number; pass: string };
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export async function readPosthogExportPage(input: Input, saved: ExportRun | undefined,
  save: (run: ExportRun) => Promise<void>, transport: typeof fetch = fetch) {
  if (process.env.POSTHOG_OWNER_SQL_EXPORTS_VERIFIED !== 'true') throw new PrivacyError('analytics_export_capability_required');
  if (process.env.ANALYTICS_POSTHOG_API_HOST !== 'https://eu.posthog.com' || process.env.POSTHOG_PROJECT_ID !== '162656'
    || !process.env.POSTHOG_API_KEY) throw new PrivacyError('analytics_export_configuration_required');
  if (!input.aliases.length || input.aliases.some(a => !a || a.length > 512) || input.limit !== 101
    || !Number.isFinite(Date.parse(input.cutoff)) || (input.cursor && !id(input.cursor))) throw new PrivacyError('analytics_export_invalid');
  const base = 'https://eu.posthog.com/api/projects/162656/file_download_batch_exports/';
  const key = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  async function api(path: string, body?: unknown, redirect: RequestRedirect = 'error') {
    const response = await transport(base + path, { method: body ? 'POST' : 'GET', redirect,
      signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${process.env.POSTHOG_API_KEY}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok && !(redirect === 'manual' && response.status === 302)) throw new PrivacyError('analytics_export_provider_unavailable');
    return response;
  }
  const pageSize = saved?.key === key ? (saved.pageSize ?? 101) : 101;
  if (!Number.isInteger(pageSize) || pageSize < 2 || pageSize > 101) throw new PrivacyError('analytics_export_invalid');
  if (!saved || saved.key !== key || !saved.id) {
    const query = `SELECT uuid AS id, event, timestamp, distinct_id, properties FROM events WHERE distinct_id IN (${input.aliases.map(quote).join(',')}) `
      + `AND timestamp <= ${quote(new Date(input.cutoff).toISOString())} `
      + (input.cursor ? `AND uuid > ${quote(input.cursor)} ` : '') + `ORDER BY uuid LIMIT ${pageSize}`;
    const response = await (await api('', { model: 'hogql', hogql_query: query,
      hogql_modifiers: { convertToProjectTimezone: false }, file: { format: 'JSONLines', max_size_mb: 1 } })).json();
    if (!id(response.id)) throw new PrivacyError('analytics_export_invalid');
    // A lost create response may orphan this owner-scoped provider job. Existing
    // bounded worker retries apply; no idempotency support is invented.
    await save({ key, id: response.id, pageSize });
    return null;
  }
  if (!saved.files) {
    const result = await (await api(`${saved.id}/`)).json();
    if (['Starting','Running'].includes(result.status)) return null;
    if (result.status !== 'Completed' || !Array.isArray(result.files) || !result.files.every(id)
      || new Set(result.files).size !== result.files.length) throw new PrivacyError('analytics_export_provider_unavailable');
    saved = { ...saved, files: result.files, fileIndex: 0, rows: [] };
    await save(saved);
    return null;
  }
  const fileIndex = saved.fileIndex ?? 0;
  if (fileIndex < saved.files.length) {
    const redirect = await api(`${saved.id}/download/${saved.files[fileIndex]}/`, undefined, 'manual');
    if (redirect.status !== 302) throw new PrivacyError('analytics_export_invalid');
    const location = redirect.headers.get('location');
    if (!location) throw new PrivacyError('analytics_export_invalid');
    const url = new URL(location);
    // Exact storage hosts must be operator-verified. Never forward provider keys
    // to signed storage URLs or follow another redirect to an arbitrary host.
    const hosts = (process.env.POSTHOG_EXPORT_DOWNLOAD_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !hosts.includes(url.hostname))
      throw new PrivacyError('analytics_export_download_host_required');
    const response = await transport(url.href, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok || !response.body) throw new PrivacyError('analytics_export_provider_unavailable');
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    const rows = [...(saved.rows ?? [])]; let pending = '', bytes = 0;
    function line(text: string) {
      if (!text.trim()) return;
      const row = JSON.parse(text);
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new PrivacyError('analytics_export_invalid');
      rows.push([row.id, row.event, row.timestamp, row.distinct_id, row.properties]);
      if (rows.length > pageSize) throw new PrivacyError('analytics_export_invalid');
    }
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        // Resource ceiling is a visible failure, NEVER truncation/success.
        if (bytes > 16 * 1024 * 1024) throw new PrivacyError('analytics_export_page_too_large');
        pending += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) { line(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
      }
      pending += decoder.decode(); line(pending);
      if (Buffer.byteLength(JSON.stringify(rows)) > 16 * 1024 * 1024) throw new PrivacyError('analytics_export_page_too_large');
    } catch (error) {
      if (error instanceof PrivacyError && error.code === 'analytics_export_page_too_large' && pageSize > 2) {
        // Retry this same keyset position with a smaller page; never skip records.
        await save({ key, id: '', pageSize: Math.max(2, Math.floor(pageSize / 2)) });
        return null;
      }
      throw error;
    } finally { await reader.cancel().catch(() => undefined); }
    await save({ ...saved, fileIndex: fileIndex + 1, rows });
    return null;
  }
  return { results: [...(saved.rows ?? [])].sort((a, b) => String(a[0]).localeCompare(String(b[0]))), pageSize };
}
