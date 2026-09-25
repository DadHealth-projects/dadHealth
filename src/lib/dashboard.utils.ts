type DashboardData = {
  total_score?: number | string | null;
  mind_score?: number | null;
  body_score?: number | null;
  bond_score?: number | null;
  reportStats?: {
    workouts?: number;
    journal?: number;
    dadDates?: number;
  };
};

type MoodLog = {
  date: string;
  mood_value: number;
};

export function getDashboardScore(dashboard: DashboardData | null | undefined, hasUser: boolean): number | null {
  if (!hasUser) return null;
  const total = typeof dashboard?.total_score === "string" ? Number(dashboard.total_score) : dashboard?.total_score;
  return typeof total === "number" && Number.isFinite(total) ? Math.round(total) : null;
}

export function getScoreBreakdown(dashboard: DashboardData | null | undefined, hasUser: boolean) {
  if (!hasUser || !dashboard) return { mind: 0, body: 0, bond: 0 };
  return {
    mind: Math.min(100, Math.max(0, Math.round(typeof dashboard.mind_score === "number" ? dashboard.mind_score : 0))),
    body: Math.min(100, Math.max(0, Math.round(typeof dashboard.body_score === "number" ? dashboard.body_score : 0))),
    bond: Math.min(100, Math.max(0, Math.round(typeof dashboard.bond_score === "number" ? dashboard.bond_score : 0))),
  };
}

export function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Calendar-week keys for charts with Monday–Sunday weekday labels. */
export function getCurrentWeekDayKeys(now = new Date()) {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toLocalDateKey(d);
  });
}

export function getMoodWeek(moodLogs: MoodLog[], dayKeys: string[]) {
  const moodMap = new Map(moodLogs.map((m) => [m.date, m.mood_value]));
  return dayKeys.map((d) => moodMap.get(d) ?? 0);
}

export function getMoodSummary(moodWeek: number[], hasUser: boolean) {
  if (!hasUser || moodWeek.length === 0) return { label: "—", scoreText: "" };
  const validMoodValues = moodWeek.filter((v) => v > 0);
  if (validMoodValues.length === 0) return { label: "—", scoreText: "" };
  const avg = validMoodValues.reduce((a, b) => a + b, 0) / validMoodValues.length;
  const label = avg >= 3.5 ? "Great" : avg >= 3 ? "Good" : avg >= 2 ? "Okay" : "Low";
  const scoreText = ` (${avg.toFixed(1)}/4)`;
  return { label, scoreText };
}

export function getReportStatsList(reportStats: DashboardData["reportStats"]) {
  if (!reportStats) return [["—", "Workouts"], ["—", "Journal"], ["—", "Dad dates"]] as const;
  return [
    [String(reportStats.workouts ?? "—"), "Workouts"],
    [String(reportStats.journal ?? "—"), "Journal"],
    [String(reportStats.dadDates ?? "—"), "Dad dates"],
  ] as const;
}
