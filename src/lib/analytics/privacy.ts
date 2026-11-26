import { AnalyticsError } from './service';
import { uuid } from './contract';
const quote = (value: string) => "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
/** Provider acceptance is not completion. Checkpoint discovery before erasure. */
export async function erasePosthogOwner(owner: string, progress: Record<string, unknown>, save: () => Promise<void>,
  transport: typeof fetch = fetch, validateAliases: (aliases: string[]) => Promise<boolean> = async aliases => aliases.length === 1 && aliases[0] === owner) {
  if (!uuid(owner)) throw new AnalyticsError('invalid_owner');
  const host = process.env.ANALYTICS_POSTHOG_API_HOST, project = process.env.POSTHOG_PROJECT_ID, key = process.env.POSTHOG_API_KEY;
  if (host !== 'https://eu.posthog.com' || project !== '162656' || !key) throw new AnalyticsError('posthog_cleanup_configuration_required');
  const base = `${host}/api/projects/${project}`;
  async function call(path: string, body?: unknown) {
    const response = await transport(base + path, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new AnalyticsError('posthog_cleanup_unavailable');
    return response.json();
  }
  if (!progress.analyticsDiscoveryComplete || !Array.isArray(progress.analyticsAliases)) {
    const identity = typeof progress.analyticsDiscoveryIdentity === 'string' ? progress.analyticsDiscoveryIdentity : owner;
    if (identity !== owner && !(progress.analyticsAliases as string[] | undefined)?.includes(identity)) throw new AnalyticsError('posthog_cleanup_identity_unverified');
    const path = typeof progress.analyticsProfileCursor === 'string' ? progress.analyticsProfileCursor : `/persons/?distinct_id=${encodeURIComponent(identity)}&limit=100`;
    const visited = Array.isArray(progress.analyticsProfileVisited) ? progress.analyticsProfileVisited as string[] : [];
    if (visited.includes(path) || visited.length >= 20) throw new AnalyticsError('posthog_cleanup_identity_review_required');
    const page = await call(path);
    if (!Array.isArray(page.results)) throw new AnalyticsError('posthog_cleanup_invalid');
    const persons = new Set(Array.isArray(progress.analyticsPersons) ? progress.analyticsPersons as string[] : []);
    const aliases = new Set<string>(Array.isArray(progress.analyticsAliases) ? progress.analyticsAliases as string[] : [owner]);
    for (const row of page.results) {
      if (!uuid(row.uuid) || !Array.isArray(row.distinct_ids) || !row.distinct_ids.includes(identity)
        || row.distinct_ids.some((id: unknown) => typeof id !== 'string' || !id || id.length > 512)) throw new AnalyticsError('posthog_cleanup_identity_unverified');
      persons.add(row.uuid); row.distinct_ids.forEach((id: string) => aliases.add(id));
    }
    if (!await validateAliases([...aliases])) throw new AnalyticsError('posthog_cleanup_identity_unverified');
    let next: string | null = null;
    if (page.next != null) {
      if (typeof page.next !== 'string') throw new AnalyticsError('posthog_cleanup_invalid');
      const url = new URL(page.next, base + '/');
      if (url.origin !== host || url.pathname !== `/api/projects/${project}/persons/` || url.searchParams.get('distinct_id') !== identity
        || url.username || url.password || url.hash) throw new AnalyticsError('posthog_cleanup_invalid');
      next = '/persons/' + url.search;
    }
    Object.assign(progress, { analyticsPersons: [...persons], analyticsAliases: [...aliases], analyticsProfileCursor: next,
      analyticsProfileVisited: [...visited, path], analyticsDiscoveryComplete: !next, analyticsDeletionRequested: false });
    await save();
    if (next) return false;
  }
  const aliases = progress.analyticsAliases as string[];
  if (!await validateAliases(aliases)) throw new AnalyticsError('posthog_cleanup_identity_unverified');
  const erase = () => call('/persons/bulk_delete/', { distinct_ids: aliases, delete_events: true, delete_recordings: true });
  if (!progress.analyticsDeletionRequested) {
    await erase();
    progress.analyticsDeletionRequested = true;
    await save();
    return false;
  }
  // One bounded status page per turn, persisted for restart. Require provider
  // verification for every known person, not merely an accepted delete request.
  const persons = progress.analyticsPersons as string[];
  const index = Number(progress.analyticsStatusIndex ?? 0);
  if (index < persons.length) {
    const person = persons[index];
    if (!uuid(person)) throw new AnalyticsError('posthog_cleanup_invalid');
    const path = typeof progress.analyticsStatusCursor === 'string' ? progress.analyticsStatusCursor
      : `/persons/deletion_status/?person_uuid=${encodeURIComponent(person)}&status=all&limit=100`;
    const visited = Array.isArray(progress.analyticsStatusVisited) ? progress.analyticsStatusVisited as string[] : [];
    if (visited.includes(path) || visited.length >= 20) throw new AnalyticsError('posthog_cleanup_identity_review_required');
    const result = await call(path);
    if (!Array.isArray(result.results)) throw new AnalyticsError('posthog_cleanup_invalid');
    if (!result.results.length || result.results.some((r: { status?: string; delete_verified_at?: string }) =>
      r.status !== 'completed' || !r.delete_verified_at || !Number.isFinite(Date.parse(r.delete_verified_at)))) return false;
    if (result.next != null) {
      if (typeof result.next !== 'string') throw new AnalyticsError('posthog_cleanup_invalid');
      const url = new URL(result.next, base + '/');
      if (url.origin !== host || url.pathname !== `/api/projects/${project}/persons/deletion_status/`
        || url.searchParams.get('person_uuid') !== person || url.searchParams.get('status') !== 'all'
        || url.username || url.password || url.hash) throw new AnalyticsError('posthog_cleanup_invalid');
      progress.analyticsStatusCursor = '/persons/deletion_status/' + url.search;
      progress.analyticsStatusVisited = [...visited, path];
    } else {
      progress.analyticsStatusIndex = index + 1;
      progress.analyticsStatusCursor = null;
      progress.analyticsStatusVisited = [];
    }
    await save();
    return false;
  }
  // A small aggregate query is not a bulk-export workaround. Missing persons
  // alone cannot prove erasure of personless or late-arriving events.
  const events = await call('/query/', { query: { kind: 'HogQLQuery', query: `SELECT count() FROM events WHERE distinct_id IN (${aliases.map(quote).join(',')})` } });
  const count = events.results?.[0]?.[0];
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || events.is_cached === true) throw new AnalyticsError('posthog_cleanup_invalid');
  if (count !== 0) { await erase(); return false; }
  const aliasIndex = Number(progress.analyticsFinalAliasIndex ?? 0);
  if (!Number.isSafeInteger(aliasIndex) || aliasIndex < 0 || aliasIndex >= aliases.length) throw new AnalyticsError('posthog_cleanup_invalid');
  const remaining = await call(`/persons/?distinct_id=${encodeURIComponent(aliases[aliasIndex])}&limit=100`);
  if (!Array.isArray(remaining.results)) throw new AnalyticsError('posthog_cleanup_invalid');
  if (remaining.results.length || remaining.next) {
    const rounds = Number(progress.analyticsErasureRounds ?? 0);
    if (rounds >= 3) throw new AnalyticsError('posthog_cleanup_pending');
    Object.assign(progress, { analyticsDiscoveryComplete: false, analyticsDiscoveryIdentity: aliases[aliasIndex], analyticsProfileCursor: null,
      analyticsProfileVisited: [], analyticsStatusIndex: 0, analyticsFinalAliasIndex: 0, analyticsErasureRounds: rounds + 1 });
    await save(); return false;
  }
  if (aliasIndex + 1 < aliases.length) {
    progress.analyticsFinalAliasIndex = aliasIndex + 1;
    await save(); return false;
  }
  return true;
}
