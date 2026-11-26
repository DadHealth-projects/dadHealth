import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const funnel = ['onboarding_started', 'onboarding_completed', 'first_checkin', 'paywall_viewed', 'trial_started', 'trial_converted'];
const billing = ['trial_started', 'trial_converted', 'trial_cancelled', 'subscription_cancelled', 'retention_offer_accepted'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function dashboardDefinition({ account, environment = 'production' } = {}) {
  if (account && !uuid.test(account)) throw Error('Account must be an opaque Auth UUID');
  if (!['production', 'sandbox', 'test', 'legacy'].includes(environment)) throw Error('Unsupported billing environment');
  const identity = account ? `distinct_id = '${account}'` : "not startsWith(distinct_id, 'anonymous-')";
  const filter = { type: 'hogql', key: identity, value: null };
  const env = { type: 'event', key: 'environment', operator: 'exact', value: [environment] };
  const scope = `${environment}${account ? ` / ${account}` : ''}`;
  const name = `Dad Health consented funnel / ${scope}`;
  const description = 'Consented occurrences only, not all registered accounts. Missing consent is not tracked drop-off. Billing stages are activation-blocked until attributable consent and verified transition context exist. Purchases without trials are outside this trial funnel. The 50% offer is counted only from Apple-verified promotional-offer transactions and stays empty until the store offer is configured. Cancellation reasons come only from a structured answer the member gave for that subscription, otherwise unavailable. Remote delivery remains off pending retention approval.';
  const totals = (events, extra = '') => ({ kind: 'DataTableNode', source: { kind: 'HogQLQuery', query:
    `SELECT event, count() AS event_total, uniqExact(distinct_id) AS unique_accounts FROM events WHERE timestamp >= now() - INTERVAL 30 DAY AND ${identity} AND event IN (${events.map(x => `'${x}'`).join(',')}) ${extra} GROUP BY event ORDER BY event` } });
  const panels = [
    { name: 'Main sequential funnel — unique consented accounts', query: { kind: 'InsightVizNode', source: {
      kind: 'FunnelsQuery', dateRange: { date_from: '-30d' }, properties: [filter],
      series: funnel.map(event => ({ kind: 'EventsNode', event, name: event, math: 'dau', ...(billing.includes(event) ? { properties: [env] } : {}) })),
      funnelsFilter: { funnelVizType: 'steps', funnelOrderType: 'ordered', funnelWindowInterval: 30, funnelWindowIntervalUnit: 'day' },
    } } },
    { name: 'Funnel stage totals and distinct accounts (not sequential conversion)', query: totals(funnel,
      `AND (event NOT IN (${billing.map(x => `'${x}'`).join(',')}) OR properties.environment = '${environment}')`) },
    { name: 'First workout and Bond — totals / accounts', query: totals(['first_workout_logged', 'first_bond_log']) },
    ...[['return_day_reached','day'],['streak_reached','milestone']].map(([event, field]) => ({
      name: `${event} — totals / accounts by ${field}`,
      query: { kind: 'DataTableNode', source: { kind: 'HogQLQuery', query:
        `SELECT properties.${field} AS ${field}, count() AS event_total, uniqExact(distinct_id) AS unique_accounts FROM events WHERE timestamp >= now() - INTERVAL 30 DAY AND ${identity} AND event = '${event}' GROUP BY ${field} ORDER BY ${field}` } },
    })),
    { name: 'Verified cancellations — totals / accounts', query: totals(['trial_cancelled','subscription_cancelled'], `AND properties.environment = '${environment}'`) },
    { name: 'Cancellations by reason (structured answers only)', query: { kind: 'DataTableNode', source: { kind: 'HogQLQuery', query:
      `SELECT event, properties.reason AS reason, count() AS event_total, uniqExact(distinct_id) AS unique_accounts FROM events WHERE timestamp >= now() - INTERVAL 30 DAY AND ${identity} AND event IN ('trial_cancelled','subscription_cancelled') AND properties.environment = '${environment}' GROUP BY event, reason ORDER BY event, reason` } } },
    { name: '50% offer accepted (Apple-verified) — totals / accounts', query: totals(['retention_offer_accepted'], `AND properties.environment = '${environment}'`) },
    {
      name: 'Authenticated app opens — totals / accounts',
      query: totals(['app_opened']),
    },
    {
      name: 'Paywall views by upgrade source',
      query: {
        kind: 'DataTableNode',
        source: {
          kind: 'HogQLQuery',
          query:
            `SELECT properties.source AS upgrade_source, ` +
            `count() AS event_total, ` +
            `uniqExact(distinct_id) AS unique_accounts ` +
            `FROM events ` +
            `WHERE timestamp >= now() - INTERVAL 30 DAY ` +
            `AND ${identity} AND event = 'paywall_viewed' ` +
            `GROUP BY upgrade_source ORDER BY event_total DESC`,
        },
      },
    },
    { name: 'Anonymous opens — separate identities, not accounts', query: { kind: 'DataTableNode', source: { kind: 'HogQLQuery', query:
      "SELECT count() AS event_total, uniqExact(distinct_id) AS anonymous_identities FROM events WHERE timestamp >= now() - INTERVAL 30 DAY AND startsWith(distinct_id, 'anonymous-') AND event = 'app_opened'" } } },
  ];
  return { name, description, panels: panels.map(p => ({ ...p, description, saved: true, tags: ['dadhealth-consented-funnel-v1'] })) };
}

/** Explicit operator action only; default CLI below only writes a local artifact. */
export async function provision(definition, { host, project, token, request = fetch }) {
  if (!['https://eu.posthog.com','https://us.posthog.com'].includes(host) || !/^\d+$/.test(project) || !token) throw Error('Explicit existing project, region and private API key required');
  const base = `${host}/api/projects/${project}/`;
  async function api(path, method = 'GET', body) {
    const response = await request(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error(`PostHog setup failed (${response.status})`);
    return response.json();
  }
  async function list(path) {
    const rows = []; let offset = 0;
    for (;;) {
      const page = await api(`${path}?limit=100&offset=${offset}`); rows.push(...page.results);
      if (!page.next) return rows;
      offset += 100;
      if (offset > 10000) throw Error('Project inventory too large; review manually');
    }
  }
  const matches = (await list('dashboards/')).filter(d => !d.deleted && d.name === definition.name);
  if (matches.length > 1) throw Error('Duplicate dashboard names; review before provisioning');
  const dashboard = matches[0] ?? await api('dashboards/', 'POST', { name: definition.name, description: definition.description, tags: ['dadhealth-consented-funnel-v1'] });
  const existing = await list('insights/');
  for (const panel of definition.panels) {
    const matches = existing.filter(i => !i.deleted && i.name === panel.name && i.dashboards?.includes(dashboard.id));
    if (matches.length > 1) throw Error('Duplicate insight names; review before provisioning');
    if (matches[0]) await api(`insights/${matches[0].id}/`, 'PATCH', { ...panel, dashboards: [dashboard.id] });
    else await api('insights/', 'POST', { ...panel, dashboards: [dashboard.id] });
  }
  return dashboard.id;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const definition = dashboardDefinition({ account: process.env.ANALYTICS_TEST_ACCOUNT, environment: process.env.ANALYTICS_BILLING_ENVIRONMENT ?? 'production' });
  if (process.argv.includes('--apply')) {
    const id = await provision(definition, { host: process.env.POSTHOG_API_HOST, project: process.env.POSTHOG_PROJECT_ID, token: process.env.POSTHOG_PERSONAL_API_KEY });
    console.log(`Dashboard ${id} prepared. Delivery/retention settings were not changed.`);
  } else {
    const path = process.argv[2];
    if (!path || path.startsWith('--')) throw Error('Supply a local output JSON path; no remote operations run by default');
    writeFileSync(path, JSON.stringify(definition, null, 2) + '\n');
    console.log('Local dashboard definition written. No remote operations performed.');
  }
}
