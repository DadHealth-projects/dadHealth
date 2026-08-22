export type DashboardScreen =
  | "HOME"
  | "FITNESS"
  | "MIND"
  | "BOND"
  | "COMMUNITY"
  | "CHALLENGE"
  | "PROGRESS";

export type DashboardGoalStatus = "done" | "start" | "log" | "open";

export type DashboardGoal = {
  iconKey: string;
  name: string;
  time: string;
  status: DashboardGoalStatus;
};

export type ScoreItem = {
  label: string;
  value: number;
};

export type DadDateItem = {
  id?: string;
  icon?: string;
  iconKey?: string;
  name: string;
  age_range?: string;
  budget?: string;
};

export type ReminderItem = {
  id: string;
  type?: string;
  text: string;
};

export type CircleItem = {
  id: string;
  icon?: string;
  name: string;
  members_count?: number;
};

export type MilestoneItem = {
  id: string;
  date: string;
  text: string;
  photo_url?: string | null;
};
