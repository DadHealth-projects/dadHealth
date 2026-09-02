export interface BrandConfig {
  primary?: string;
  primaryForeground?: string;
  accent?: string;
  lime?: string;
  ring?: string;
  sidebarPrimary?: string;
  sidebarRing?: string;
}

export interface Client {
  id: string;
  slug: string;
  name: string;
  brand_config: BrandConfig;
  created_at?: string;
}

export interface UserProfile {
  id: string;
  user_id: string;
  client_id?: string | null;
  /** IANA timezone name (e.g. "Europe/London") */
  timezone?: string | null;
  /** Master opt-in gate for all push notifications */
  push_notifications_enabled?: boolean;
  goals?: string[] | null;
  pillar_order?: string[] | null;
  onboarding_complete?: boolean;
  display_name?: string | null;
  /** Explicit admin/manual Pro entitlement. */
  is_pro?: boolean | null;
  /** Stripe Customer id (cus_…) */
  stripe_customer_id?: string | null;
  /** Stripe Subscription id (sub_…) */
  stripe_subscription_id?: string | null;
  /** Stripe subscription.status (active, trialing, canceled, …) */
  subscription_status?: string | null;
  /** Invited co-parent's auth user id (read-only shared-calendar access). */
  co_parent_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BiometricDeviceCredential {
  id: string;
  user_id: string;
  credential_digest: string;
  created_at: string;
  last_used_at?: string | null;
}

export type CoParentingEventType = "custody" | "handover" | "school";

export interface CoParentingSchedule {
  id: string;
  /** Owner (the dad) auth user id. */
  user_id: string;
  /** Invited co-parent auth user id (null until they accept). */
  co_parent_user_id?: string | null;
  /** Dates (YYYY-MM-DD) the dad has custody. */
  custody_dates: string[];
  created_at?: string;
}

export interface CoParentingEvent {
  id: string;
  schedule_id: string;
  event_date: string;
  event_type: CoParentingEventType;
  /** Short handover/event note, visible to both parties. */
  notes?: string | null;
  created_at?: string;
}

export type NotificationType =
  | "morning_checkin"
  | "bedtime_story"
  | "workout_window"
  | "weekly_score"
  | "streak_at_risk"
  | "weekly_challenge"
  | "journal_prompt"
  | "milestone_anniversary"
  | "community_reply"
  | "community_like"
  | "co_parent_event_added"
  | "present_dad_mode_complete";

export interface NotificationPreference {
  user_id: string;
  notification_type: NotificationType;
  enabled: boolean;
  /** Local time string from Postgres `time` (e.g. "21:00:00") */
  send_time?: string | null;
  created_at?: string;
}

export interface NotificationLog {
  id: string;
  user_id: string;
  type: NotificationType;
  sent_at: string;
  opened: boolean;
}

export interface MoodLog {
  id: string;
  user_id: string;
  date: string;
  mood_value: number;
  stress_level?: number | null;
  created_at?: string;
}

export interface DadScoreRow {
  user_id: string;
  mind_score: number;
  body_score: number;
  bond_score: number;
  previous_mind_score: number | null;
  previous_body_score: number | null;
  previous_bond_score: number | null;
  mind_week_change: number | null;
  body_week_change: number | null;
  bond_week_change: number | null;
}

export interface SleepLog {
  id: string;
  user_id: string;
  date: string;
  hours: number;
  source?: "manual" | "garmin" | "fitbit" | "apple_health" | "health_connect";
  created_at?: string;
}

export interface WorkoutSession {
  id: string;
  user_id: string;
  exercise_name: string;
  duration_minutes?: number;
  calories?: number;
  performed_at: string;
  created_at?: string;
}

export type WorkoutEquipment = "none" | "dumbbells" | "full_gym";
export type WorkoutFocus = "full_body" | "upper" | "lower" | "core";
export type WorkoutSource = "admin" | "ai_generated";

export interface WorkoutExercise {
  name: string;
  sets: number;
  reps_or_duration: string;
  rest_period: string;
  muscle_group: string;
  beginner_modification: string;
}

export interface Workout {
  id: string;
  user_id: string | null;
  title: string;
  duration_mins: number;
  equipment: WorkoutEquipment;
  focus: WorkoutFocus;
  exercises: WorkoutExercise[];
  source: WorkoutSource;
  created_at?: string;
}

export interface WorkoutCompletion {
  id: string;
  user_id: string;
  workout_id: string;
  completed_at: string;
  duration_actual_seconds: number;
}

export interface UserStreak {
  id: string;
  user_id: string;
  streak_count: number;
  last_activity_date: string;
  updated_at?: string;
}

export interface WeeklyChallenge {
  id: string;
  title: string;
  description?: string;
  participants_count?: number;
  active: boolean;
  created_at?: string;
}

export interface MealPlan {
   Row: {
    id: string
    user_id: string
    day: string | null
    name: string | null
    kcal: number | null
    created_at: string
    source: 'admin' | 'ai_generated' | 'user_custom'
    grocery_list: unknown
    preferences: unknown
    adults: number
    plan: unknown
  };
}

export interface BodyMetric {
  id: string;
  user_id: string;
  weight_kg?: number;
  metric_type: string;
  value: number;
  recorded_at: string;
  source?: "manual" | "garmin" | "fitbit" | "apple_health" | "health_connect";
  created_at?: string;
}

export interface UserIntegration {
  id: string;
  user_id: string;
  provider: "garmin" | "fitbit" | "apple_health" | "health_connect";
  device_name?: string | null;
  connected_at?: string | null;
  last_sync_at?: string | null;
}

export interface JournalEntry {
  id: string;
  user_id: string;
  content: string;
  created_at?: string;
}

export interface Therapist {
  id: string;
  name: string;
  spec: string;
  slots: string;
  price: string;
}

export interface Milestone {
  id: string;
  user_id: string;
  date: string;
  text: string;
  tag: string;
  photo_url?: string | null;
  created_at?: string;
}

export interface DadDate {
  id: string;
  icon: string;
  name: string;
  age_range: string;
  budget: string;
  time: string;
}

export interface AgePrompt {
  id: string;
  prompt: string;
  age_range?: string;
}

export interface Post {
  id: string;
  user_id: string | null;
  body: string;
  tag: string;
  anonymous: boolean;
  author_initials?: string;
  author_name?: string;
  author_meta?: string;
  created_at?: string;
  likes_count?: number;
  replies_count?: number;
}

export interface Like {
  id: string;
  user_id: string;
  post_id: string;
  created_at?: string;
}

export interface Comment {
  id: string;
  user_id: string;
  post_id: string;
  content: string;
  created_at?: string;
}

export interface Circle {
  id: string;
  icon: string;
  name: string;
  members_count: number;
}

export interface UserCircle {
  id: string;
  user_id: string;
  circle_id: string;
  joined_at?: string;
}

export interface Badge {
  id: string;
  icon: string;
  name: string;
}

export interface EarnedBadge {
  id: string;
  user_id: string;
  badge_id: string;
  earned_at?: string;
}
