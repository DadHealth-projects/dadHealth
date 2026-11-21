/** Versioned optional analytics contract. No free-text properties are accepted. */
export const CONTRACT_VERSION = 1;
const moments = ['score','checkIn','aiWorkout','dadDays','weeklyReport','progressTrends','dadDaysCounter','mind_plan','trends','streak_freeze','settings','body','bond','mind','meal_plan','workout_builder','ai_workout','dad_days_unlimited','score_insights','weekly_report','progress_trends','unknown'] as const;
type Rule = readonly (string | number)[] | 'count' | 'boolean';
const upgrade = { feature: moments, source: moments };
export const clientEventRules = {
  $pageview: {},
  app_opened: {}, onboarding_started: {},
  paywall_viewed: { source: moments }, paywall_opened: upgrade,
  lock_viewed: upgrade, lock_tapped: upgrade,
  upgrade_moment_shown: upgrade, upgrade_moment_dismissed: upgrade,
  breath_session_started: { pattern: ['4-4-4'] },
  journal_entry_created: {},
  dad_days_search_limit_reached: { searchesUsed: 'count' },
  // Persisted-action and billing facts are intentionally NOT client events.
} as const satisfies Record<string, Record<string, Rule>>;
export const serverEventRules = {
  onboarding_completed: {}, first_checkin: {}, first_workout_logged: {}, first_bond_log: {},
  streak_reached: { milestone: [7,14] }, return_day_reached: { day: [2,7,30] },
  trial_started: { provider: ['apple','google','stripe'], environment: ['production','sandbox','test','legacy'] },
  trial_converted: { provider: ['apple','google','stripe'], environment: ['production','sandbox','test','legacy'] },
  trial_cancelled: { provider: ['apple','google','stripe'], environment: ['production','sandbox','test','legacy'], reason: ['unavailable','too_expensive','not_using','missing_feature','technical_problem','other'] },
  subscription_cancelled: { provider: ['apple','google','stripe'], environment: ['production','sandbox','test','legacy'], reason: ['unavailable','too_expensive','not_using','missing_feature','technical_problem','other'] },
} as const satisfies Record<string, Record<string, Rule>>;
export const eventRules = { ...clientEventRules, ...serverEventRules };
export type AnalyticsEventName = keyof typeof clientEventRules;
export type ServerAnalyticsEventName = keyof typeof serverEventRules;
export function upgradeSource(value: unknown): typeof moments[number] {
  return typeof value === 'string' && (moments as readonly string[]).includes(value) ? value as typeof moments[number] : 'unknown';
}
type Value<R> = R extends readonly (string | number)[] ? R[number] : R extends 'boolean' ? boolean : number;
export type AnalyticsProperties<N extends AnalyticsEventName> = { [K in keyof typeof eventRules[N]]: Value<typeof eventRules[N][K]> };
export type AnalyticsEvent = { version: 1; id: string; event: AnalyticsEventName | ServerAnalyticsEventName; timestamp: string; properties: Record<string, string | number | boolean> };
export const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function permittedProperties(event: string, input: unknown, origin: 'client' | 'server' = 'client'): input is AnalyticsEvent['properties'] {
  if ((origin === 'client' && !Object.prototype.hasOwnProperty.call(clientEventRules, event)) || !Object.prototype.hasOwnProperty.call(eventRules, event) || !input || typeof input !== 'object' || Array.isArray(input)) return false;
  const rules = eventRules[event as keyof typeof eventRules] as Record<string, Rule>;
  const entries = Object.entries(input);
  return entries.length === Object.keys(rules).length && entries.every(([key, value]) => {
    if (!Object.prototype.hasOwnProperty.call(rules, key)) return false;
    const rule = rules[key];
    return Array.isArray(rule) ? rule.includes(value as string) : rule === 'boolean' ? typeof value === 'boolean'
      : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100000;
  });
}
export function parseAnalyticsEvent(input: unknown, now = Date.now(), origin: 'client' | 'server' = 'client'): AnalyticsEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const v = input as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'event,id,properties,timestamp,version' || v.version !== 1 || !uuid(v.id)
    || typeof v.event !== 'string' || !permittedProperties(v.event, v.properties, origin) || typeof v.timestamp !== 'string') return null;
  const at = Date.parse(v.timestamp);
  if (!Number.isFinite(at) || new Date(at).toISOString() !== v.timestamp || at > now + 60000 || at < now - 7 * 86400000) return null;
  return v as AnalyticsEvent;
}
