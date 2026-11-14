/** Release labels only. Account boundaries must come from the canonical SQL calendar. */
export interface ReportRelease {
  weekStart: string;
  weekEndExclusive: string;
  deliveryAt: string;
}

function dateKey(value: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime())
    || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid reporting date');
  return date;
}

export function reportReleaseForWeek(weekStart: string): ReportRelease {
  const monday = dateKey(weekStart);
  if (monday.getUTCDay() !== 1) throw new Error('Reporting week must start Monday');
  const day = (offset: number) => new Date(monday.getTime() + offset * 86400000).toISOString().slice(0, 10);
  // At 18:00 neither UK clock transition is ambiguous. Resolve the actual offset
  // from IANA data, rather than assuming a fixed GMT/BST season or device zone.
  const candidate = new Date(`${day(6)}T18:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23',
  }).format(candidate));
  return { weekStart, weekEndExclusive: day(7),
    deliveryAt: new Date(candidate.getTime() - (hour - 18) * 3600000).toISOString() };
}

export function latestReleasedReportWeek(now: Date): ReportRelease {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid observation time');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const today = dateKey(`${part('year')}-${part('month')}-${part('day')}`);
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86400000);
  let release = reportReleaseForWeek(monday.toISOString().slice(0, 10));
  if (now.getTime() < Date.parse(release.deliveryAt)) {
    release = reportReleaseForWeek(new Date(monday.getTime() - 7 * 86400000).toISOString().slice(0, 10));
  }
  return release;
}
