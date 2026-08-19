-- DadHealth Supabase schema (run in Supabase SQL Editor if tables don't exist)

-- =========================
-- EXTENSIONS
-- =========================
create extension if not exists "pgcrypto";
create extension if not exists "pg_cron";
create extension if not exists "pg_net";

-- =========================
-- TABLES
-- =========================

-- mood_logs
create table if not exists mood_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  mood_value int not null check (mood_value between 0 and 4),
  created_at timestamptz default now(),
  unique(user_id, date)
);

-- sleep_logs
create table if not exists sleep_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  hours numeric not null,
  quality int check (quality between 1 and 5),
  source text default 'manual',
  created_at timestamptz default now(),
  unique(user_id, date)
);


-- workout_sessions
create table if not exists workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  exercise_name text not null,
  duration_minutes int not null,
  calories int not null,
  exercises_completed int,
  performed_at timestamptz not null,
  created_at timestamptz default now()
);

-- workouts (library + AI generated)
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  duration_mins int not null check (duration_mins in (10, 20, 30, 45)),
  equipment text not null check (equipment in ('none', 'dumbbells', 'full_gym')),
  focus text not null check (focus in ('full_body', 'upper', 'lower', 'core')),
  exercises jsonb not null default '[]'::jsonb,
  source text not null check (source in ('admin', 'ai_generated')),
  created_at timestamptz default now()
);

create table if not exists workout_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  workout_id uuid references workouts(id) on delete cascade not null,
  completed_at timestamptz not null default now(),
  duration_actual_seconds int not null default 0 check (duration_actual_seconds >= 0)
);

-- clients (brand config per organization) - must exist before user_profile
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  -- Brand colours as HSL values (same format as CSS vars: "H S% L%")
  brand_config jsonb default '{
    "primary": "78 89% 65%",
    "primaryForeground": "0 0% 4%",
    "accent": "78 89% 65%",
    "lime": "78 89% 65%",
    "ring": "78 89% 65%",
    "sidebarPrimary": "78 89% 65%",
    "sidebarRing": "78 89% 65%"
  }'::jsonb,
  created_at timestamptz default now()
);

-- Seed default Dad Health client
insert into clients (id, slug, name, brand_config) values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'dadhealth',
  'Dad Health',
  '{"primary":"78 89% 65%","primaryForeground":"0 0% 4%","accent":"78 89% 65%","lime":"78 89% 65%","ring":"78 89% 65%","sidebarPrimary":"78 89% 65%","sidebarRing":"78 89% 65%"}'
) on conflict (id) do nothing;

-- Add optional branding fields for white-label clients
alter table clients add column if not exists logo_url text;
alter table clients add column if not exists primary_colour text;
alter table clients add column if not exists welcome_message text;
alter table clients add column if not exists active boolean default true;
alter table clients add column if not exists subdomain text;
create unique index if not exists idx_clients_subdomain on clients(subdomain) where subdomain is not null;

-- user_profile
create table if not exists user_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  client_id uuid references clients(id) on delete set null,
  -- IANA timezone name (e.g. "Europe/London"). Used for scheduled notifications.
  timezone text default 'UTC',
  -- Master opt-in gate for all push notifications (client-controlled).
  push_notifications_enabled boolean not null default false,
  goals jsonb default '[]',
  pillar_order jsonb default '[]',
  onboarding_complete boolean default false,
  display_name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- For existing DBs: add client_id if missing, backfill
alter table user_profile add column if not exists client_id uuid references clients(id) on delete set null;
update user_profile set client_id = '00000000-0000-0000-0000-000000000001'::uuid where client_id is null;

-- For existing DBs: add timezone if missing
alter table user_profile add column if not exists timezone text default 'UTC';
alter table user_profile add column if not exists push_notifications_enabled boolean not null default false;
alter table user_profile add column if not exists avatar_url text;

-- Stripe Billing (synced from webhooks)
alter table user_profile add column if not exists stripe_customer_id text;
alter table user_profile add column if not exists stripe_subscription_id text;
alter table user_profile add column if not exists subscription_status text;

-- Biometric device credentials are independent of Supabase sessions so a
-- genuine sign-out does not revoke an explicitly enrolled device. The raw
-- credential never reaches this table: the server stores an HMAC digest only.
create table if not exists biometric_device_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  credential_digest text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_biometric_device_credentials_user
on biometric_device_credentials(user_id);

alter table biometric_device_credentials enable row level security;
revoke all on table biometric_device_credentials from anon, authenticated;
grant select, insert, update, delete on table biometric_device_credentials to service_role;

-- Fixed-window rate-limit buckets. Both device identifiers and request IPs are
-- HMACed by the server before they are stored here.
create table if not exists biometric_auth_rate_limits (
  bucket_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count int not null default 0 check (attempt_count >= 0),
  updated_at timestamptz not null default now()
);

alter table biometric_auth_rate_limits enable row level security;
revoke all on table biometric_auth_rate_limits from anon, authenticated;
grant select, insert, update, delete on table biometric_auth_rate_limits to service_role;

-- Atomically consumes one attempt from a fixed-window bucket. Only the service
-- role used by the Dad Health backend may execute this function.
create or replace function public.consume_biometric_auth_rate_limit(
  p_bucket_hash text,
  p_limit int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count int;
begin
  if p_bucket_hash is null or length(p_bucket_hash) = 0 then
    raise exception 'Rate-limit bucket is required';
  end if;
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate-limit configuration';
  end if;

  insert into biometric_auth_rate_limits (
    bucket_hash,
    window_started_at,
    attempt_count,
    updated_at
  )
  values (p_bucket_hash, now(), 1, now())
  on conflict (bucket_hash) do update
  set
    window_started_at = case
      when biometric_auth_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
        then now()
      else biometric_auth_rate_limits.window_started_at
    end,
    attempt_count = case
      when biometric_auth_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
        then 1
      else biometric_auth_rate_limits.attempt_count + 1
    end,
    updated_at = now()
  returning attempt_count into next_count;

  return next_count <= p_limit;
end;
$$;

revoke all on function public.consume_biometric_auth_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.consume_biometric_auth_rate_limit(text, int, int) to service_role;

-- =========================
-- ONBOARDING QUESTIONNAIRE FIELDS (Phase 1-3)
-- =========================

-- Phase 1
alter table user_profile add column if not exists parent_type text;
alter table user_profile add column if not exists pronouns text;
alter table user_profile add column if not exists custody_arrangement text;
-- M2.1: new 4-option custody pattern (daily / split / weekends / varies) from the
-- mobile onboarding flow. The web Phase 1 flow keeps using custody_arrangement;
-- mobile writes BOTH (this column + a legacy-mapped value) so the two stay in sync.
alter table user_profile add column if not exists custody_pattern text;

-- arrays kept as jsonb (repo currently uses jsonb for goals/pillar_order)
alter table user_profile add column if not exists kids_ages jsonb default '[]'::jsonb;
alter table user_profile add column if not exists goals jsonb default '[]'::jsonb;

-- Phase 2
alter table user_profile add column if not exists challenge text;
alter table user_profile add column if not exists current_support text;
alter table user_profile add column if not exists dad_years text;

-- Pillars order already exists as jsonb in this repo
alter table user_profile add column if not exists pillar_order jsonb default '[]'::jsonb;

-- Phase 3
alter table user_profile add column if not exists notification_times jsonb default '[]'::jsonb;
alter table user_profile add column if not exists commitment text;

alter table user_profile add column if not exists phase2_complete boolean default false;
alter table user_profile add column if not exists phase3_complete boolean default false;

-- already exists but keep idempotent
alter table user_profile add column if not exists onboarding_complete boolean default false;

-- Day 30 callback
alter table user_profile add column if not exists day30_prompt_sent boolean default false;


-- user_streaks
create table if not exists user_streaks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  streak_count int default 0,
  last_activity_date date,
  updated_at timestamptz default now()
);

-- daily_tasks
create table if not exists daily_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  category text,
  status text default 'open',
  date date not null,
  created_at timestamptz default now(),
  unique(user_id, title, date)
);

-- weekly_challenges
create table if not exists weekly_challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  participants_count int default 0,
  active boolean default true,
  created_at timestamptz default now()
);

insert into weekly_challenges (title, description, participants_count, active) 
select 'Screen-free Sunday', 'Put the phone down for a full Sunday. Be fully present with your kids.', 0, true 
where not exists (select 1 from weekly_challenges);

-- Fix stale seed data if description was left as the hardcoded marketing copy
update weekly_challenges
set description = 'Put the phone down for a full Sunday. Be fully present with your kids.',
    participants_count = 0
where title = 'Screen-free Sunday'
  and description = '847 dads taking part';

-- meal_plans
create table if not exists meal_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  day text,
  name text,
  kcal int,
  created_at timestamptz default now(),
  unique(user_id, day)
);

alter table meal_plans
  add column if not exists source text default 'user_custom',
  add column if not exists grocery_list jsonb,
  add column if not exists preferences jsonb,
  add column if not exists adults int default 1,
  add column if not exists plan jsonb;

alter table meal_plans
  alter column day drop not null,
  alter column name drop not null,
  alter column kcal drop not null;

-- body_metrics
create table if not exists body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  metric_type text not null,
  value numeric not null,
  weight_kg numeric not null,
  recorded_at timestamptz not null,
  created_at timestamptz default now()
);

-- Allow non-weight activity metrics such as active_mins.
alter table body_metrics
  alter column weight_kg drop not null;

-- source of the metric (manual entry vs wearable sync)
alter table body_metrics
  add column if not exists source text not null default 'manual';

-- journal_entries
create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  content text not null,
  mood_value int not null,
  tag text,
  created_at timestamptz default now()
);

alter table journal_entries add column if not exists prompt text;

-- therapists
create table if not exists therapists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  spec text,
  availability text,
  price_per_hour numeric not null
);

-- milestones
create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  text text not null,
  tag text not null,
  photo_url text,
  created_at timestamptz default now()
);

alter table milestones add column if not exists photo_url text;

-- dad_dates
create table if not exists dad_dates (
  id uuid primary key default gen_random_uuid(),
  icon text not null,
  name text not null,
  age_range text not null,
  budget text not null,
  duration_minutes int not null,
  time_of_day text
);

alter table dad_dates
add column if not exists source text default 'admin';

alter table dad_dates
add column if not exists booking_url text;

alter table dad_dates
add column if not exists address text;

alter table dad_dates
add column if not exists requires_booking boolean default false;


-- dad_day_searches 
create table if not exists dad_day_searches (
  id uuid primary key default gen_random_uuid(),

  user_id uuid references auth.users(id) on delete cascade not null,

  budget text not null check (
    budget in ('free', 'under_20', 'over_20')
  ),

  radius int not null default 20,

  child_age text not null check (
    child_age in ('toddler', 'primary', 'teen')
  ),

  result_count int default 0,

  searched_at timestamptz default now()
);

-- cook together recipes
create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  difficulty text not null check (difficulty in ('easy', 'medium')),
  age_min int not null check (age_min >= 0),
  prep_mins int not null check (prep_mins > 0),
  ingredients jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  cook_together boolean not null default true,
  image_url text,
  created_at timestamptz default now()
);

create table if not exists user_saved_recipes (
  user_id uuid references auth.users(id) on delete cascade not null,
  recipe_id uuid references recipes(id) on delete cascade not null,
  saved_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create table if not exists bond_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  recipe_id uuid references recipes(id) on delete set null,
  activity_type text not null,
  quality int not null check (quality between 1 and 5),
  minutes int,
  created_at timestamptz default now()
);

-- posts
create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  content text not null,
  tag text not null,
  anonymous boolean default false,
  author_initials text,
  author_name text,
  author_meta text,
  created_at timestamptz default now()
);

create table if not exists anonymous_post_owners (
  post_id uuid primary key references posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table anonymous_post_owners enable row level security;

drop policy if exists "Users can read own anonymous post ownership" on anonymous_post_owners;
create policy "Users can read own anonymous post ownership"
on anonymous_post_owners for select to authenticated
using (auth.uid() = user_id);

create or replace function public.capture_anonymous_post_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.anonymous is true and new.user_id is null and auth.uid() is not null then
    insert into public.anonymous_post_owners (post_id, user_id)
    values (new.id, auth.uid()) on conflict (post_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists capture_anonymous_post_owner_on_insert on posts;
create trigger capture_anonymous_post_owner_on_insert
after insert on posts for each row execute function public.capture_anonymous_post_owner();

create or replace function public.delete_own_community_post(p_post_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare deleted_count integer;
begin
  if auth.uid() is null then return false; end if;
  delete from public.posts p where p.id = p_post_id and (
    p.user_id = auth.uid() or exists (
      select 1 from public.anonymous_post_owners apo
      where apo.post_id = p.id and apo.user_id = auth.uid()
    )
  );
  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

-- likes
create table if not exists likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  post_id uuid references posts(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(user_id, post_id)
);

-- comments (parent_id null = top-level; parent_id = comment.id = one-level reply)
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  post_id uuid references posts(id) on delete cascade not null,
  parent_id uuid references comments(id) on delete cascade,
  content text not null,
  anonymous boolean default false,
  created_at timestamptz default now()
);

-- saved posts (bookmarks)
create table if not exists saved_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  post_id uuid references posts(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(user_id, post_id)
);

-- circles
create table if not exists circles (
  id uuid primary key default gen_random_uuid(),
  icon text not null,
  name text not null,
  members_count int default 0
);

-- user_circles
create table if not exists user_circles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  circle_id uuid references circles(id) on delete cascade not null,
  joined_at timestamptz default now(),
  unique(user_id, circle_id)
);

create or replace function public.sync_circle_member_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.circles
    set members_count = coalesce(members_count, 0) + 1
    where id = new.circle_id;
    return new;
  end if;

  if tg_op = 'DELETE' then
    update public.circles
    set members_count = greatest(coalesce(members_count, 0) - 1, 0)
    where id = old.circle_id;
    return old;
  end if;

  if old.circle_id is distinct from new.circle_id then
    update public.circles
    set members_count = greatest(coalesce(members_count, 0) - 1, 0)
    where id = old.circle_id;

    update public.circles
    set members_count = coalesce(members_count, 0) + 1
    where id = new.circle_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_circle_member_count_on_membership on public.user_circles;

create trigger sync_circle_member_count_on_membership
after insert or delete or update of circle_id
on public.user_circles
for each row
execute function public.sync_circle_member_count();

-- badges
create table if not exists badges (
  id uuid primary key default gen_random_uuid(),
  icon text not null,
  name text not null
);

-- earned_badges
create table if not exists earned_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  badge_id uuid references badges(id) on delete cascade not null,
  earned_at timestamptz default now(),
  unique(user_id, badge_id)
);

-- =========================
-- NOTIFICATIONS (OneSignal)
-- =========================

-- Supported notification types
-- (kept as text for flexibility; constrained to known values)
-- - morning_checkin
-- - bedtime_story
-- - workout_window
-- - weekly_score
-- - streak_at_risk
-- - weekly_challenge
-- - journal_prompt
-- - milestone_anniversary
-- - community_reply
-- - co_parent_event_added
-- - present_dad_mode_complete

create table if not exists notification_preferences (
  user_id uuid references auth.users(id) on delete cascade not null,
  notification_type text not null,
  enabled boolean not null default false,
  -- Local time in the dad's timezone. Only used for user-set time notifications.
  send_time time,
  created_at timestamptz default now(),
  primary key (user_id, notification_type),
  constraint notification_preferences_type_chk check (notification_type in (
    'morning_checkin',
    'bedtime_story',
    'workout_window',
    'weekly_score',
    'streak_at_risk',
    'weekly_challenge',
    'journal_prompt',
    'milestone_anniversary',
    'community_reply',
    'co_parent_event_added',
    'present_dad_mode_complete'
  ))
);

create table if not exists notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  type text not null,
  sent_at timestamptz not null default now(),
  opened boolean not null default false,
  constraint notification_log_type_chk check (type in (
    'morning_checkin',
    'bedtime_story',
    'workout_window',
    'weekly_score',
    'streak_at_risk',
    'weekly_challenge',
    'journal_prompt',
    'milestone_anniversary',
    'community_reply',
    'co_parent_event_added',
    'present_dad_mode_complete'
  ))
);

-- Existing environments need their original constraints replaced; CREATE TABLE IF
-- NOT EXISTS does not update a check constraint on an already-created table.
alter table notification_preferences drop constraint if exists notification_preferences_type_chk;
alter table notification_preferences add constraint notification_preferences_type_chk check (notification_type in (
  'morning_checkin', 'bedtime_story', 'workout_window', 'weekly_score',
  'streak_at_risk', 'weekly_challenge', 'journal_prompt', 'milestone_anniversary',
  'community_reply', 'co_parent_event_added', 'present_dad_mode_complete'
));
alter table notification_log drop constraint if exists notification_log_type_chk;
alter table notification_log add constraint notification_log_type_chk check (type in (
  'morning_checkin', 'bedtime_story', 'workout_window', 'weekly_score',
  'streak_at_risk', 'weekly_challenge', 'journal_prompt', 'milestone_anniversary',
  'community_reply', 'co_parent_event_added', 'present_dad_mode_complete'
));

create table if not exists present_dad_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'cancelled', 'completed')),
  completed_at timestamptz,
  notification_attempted_at timestamptz,
  notification_sent_at timestamptz
);

create unique index if not exists idx_present_dad_one_active_per_user
on present_dad_sessions(user_id) where status = 'active';
create index if not exists idx_present_dad_due
on present_dad_sessions(status, ends_at);

create or replace function public.enforce_present_dad_session_timing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.started_at := statement_timestamp();
    new.ends_at := new.started_at + interval '60 minutes';
    new.status := 'active';
    new.completed_at := null;
    new.notification_attempted_at := null;
    new.notification_sent_at := null;
    return new;
  end if;

  if new.user_id <> old.user_id
    or new.started_at <> old.started_at
    or new.ends_at <> old.ends_at then
    raise exception 'Present Dad session identity and timing cannot be changed';
  end if;

  if new.status <> old.status then
    if old.status <> 'active' or new.status not in ('cancelled', 'completed') then
      raise exception 'Invalid Present Dad session status transition';
    end if;

    if new.status = 'completed' then
      if statement_timestamp() < old.ends_at then
        raise exception 'Present Dad session cannot complete before ends_at';
      end if;
      new.completed_at := statement_timestamp();
    else
      new.completed_at := null;
      new.notification_attempted_at := null;
      new.notification_sent_at := null;
    end if;
  elsif new.status = 'completed' then
    new.completed_at := old.completed_at;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_present_dad_session_timing on present_dad_sessions;
create trigger enforce_present_dad_session_timing
before insert or update on present_dad_sessions
for each row execute function public.enforce_present_dad_session_timing();

alter table present_dad_sessions enable row level security;
drop policy if exists "Users can CRUD own present_dad_sessions" on present_dad_sessions;
drop policy if exists "Users can read own present_dad_sessions" on present_dad_sessions;
create policy "Users can read own present_dad_sessions"
on present_dad_sessions for select
using (auth.uid() = user_id);
drop policy if exists "Users can start own present_dad_sessions" on present_dad_sessions;
create policy "Users can start own present_dad_sessions"
on present_dad_sessions for insert
with check (
  auth.uid() = user_id
  and status = 'active'
  and completed_at is null
  and notification_attempted_at is null
  and notification_sent_at is null
);
drop policy if exists "Users can cancel own present_dad_sessions" on present_dad_sessions;
create policy "Users can cancel own present_dad_sessions"
on present_dad_sessions for update
using (auth.uid() = user_id and status = 'active')
with check (
  auth.uid() = user_id
  and status = 'cancelled'
  and completed_at is null
  and notification_attempted_at is null
  and notification_sent_at is null
);

create table if not exists notification_delivery_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  type text not null,
  local_day date not null,
  event_key text not null default 'scheduled',
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  provider_message_id text,
  constraint notification_delivery_claims_type_chk check (type in (
    'morning_checkin', 'bedtime_story', 'workout_window', 'weekly_score',
    'streak_at_risk', 'weekly_challenge', 'journal_prompt', 'milestone_anniversary',
    'community_reply', 'co_parent_event_added', 'present_dad_mode_complete'
  ))
);

alter table notification_delivery_claims drop constraint if exists notification_delivery_claims_type_chk;
alter table notification_delivery_claims add constraint notification_delivery_claims_type_chk check (type in (
  'morning_checkin', 'bedtime_story', 'workout_window', 'weekly_score',
  'streak_at_risk', 'weekly_challenge', 'journal_prompt', 'milestone_anniversary',
  'community_reply', 'co_parent_event_added', 'present_dad_mode_complete'
));

-- Event-driven notifications need one claim per source record, while scheduled
-- notifications retain their existing one-per-type/day identity.
alter table notification_delivery_claims add column if not exists event_key text;
update notification_delivery_claims
set event_key = 'scheduled'
where event_key is null or btrim(event_key) = '';
alter table notification_delivery_claims alter column event_key set default 'scheduled';
alter table notification_delivery_claims alter column event_key set not null;
alter table notification_delivery_claims
drop constraint if exists notification_delivery_claims_user_id_type_local_day_key;
create unique index if not exists idx_notification_delivery_claims_identity
on notification_delivery_claims(user_id, type, local_day, event_key);

alter table notification_log
add column if not exists delivery_claim_id uuid references notification_delivery_claims(id) on delete set null;

create index if not exists idx_notification_delivery_claims_user_day
on notification_delivery_claims(user_id, local_day);
create unique index if not exists idx_notification_log_delivery_claim_unique
on notification_log(delivery_claim_id) where delivery_claim_id is not null;

create index if not exists idx_notification_log_user_sent_at on notification_log(user_id, sent_at desc);
create index if not exists idx_notification_log_user_type_sent_at on notification_log(user_id, type, sent_at desc);

alter table notification_preferences enable row level security;
alter table notification_log enable row level security;
alter table notification_delivery_claims enable row level security;

-- Users can manage their own preferences (opt-in, configurable settings)
drop policy if exists "Users can CRUD own notification_preferences" on notification_preferences;
create policy "Users can CRUD own notification_preferences"
on notification_preferences
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Intentionally no client policies for notification_log.
-- Writes should happen server-side using the service role key.

revoke all on table notification_log from public, anon, authenticated;
revoke all on table notification_delivery_claims from public, anon, authenticated;
grant select, insert, update, delete on table notification_log to service_role;
grant select, insert, update, delete on table notification_delivery_claims to service_role;

-- Atomically reserve a notification slot. The per-user advisory lock makes the
-- daily cap and per-type suppression safe across concurrent cron/webhook runs.
-- The UUID is also used as OneSignal's idempotency key.
create or replace function public.claim_notification_delivery(
  p_user_id uuid,
  p_type text,
  p_timezone text,
  p_event_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  time_zone text := coalesce(nullif(p_timezone, ''), 'UTC');
  claim_event_key text := coalesce(nullif(btrim(p_event_key), ''), 'scheduled');
  claim_local_day date;
  existing_claim record;
  reserved_today int;
  legacy_sent_today int;
  claim_id uuid;
begin
  begin
    claim_local_day := (now() at time zone time_zone)::date;
  exception when invalid_parameter_value then
    time_zone := 'UTC';
    claim_local_day := (now() at time zone time_zone)::date;
  end;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select id, completed_at into existing_claim
  from public.notification_delivery_claims
  where user_id = p_user_id
    and type = p_type
    and notification_delivery_claims.local_day = claim_local_day
    and notification_delivery_claims.event_key = claim_event_key;

  if found then
    if existing_claim.completed_at is not null then return null; end if;
    return existing_claim.id;
  end if;

  select count(*) into reserved_today
  from public.notification_delivery_claims c
  where c.user_id = p_user_id and c.local_day = claim_local_day;

  select count(*) into legacy_sent_today
  from public.notification_log l
  where l.user_id = p_user_id
    and l.delivery_claim_id is null
    and (l.sent_at at time zone time_zone)::date = claim_local_day;

  if reserved_today + legacy_sent_today >= 3 then return null; end if;

  insert into public.notification_delivery_claims (user_id, type, local_day, event_key)
  values (p_user_id, p_type, claim_local_day, claim_event_key)
  returning id into claim_id;

  return claim_id;
end;
$$;

-- Backward-compatible scheduled wrapper. Existing server instances can keep
-- calling the original three-argument RPC during deployment.
create or replace function public.claim_notification_delivery(
  p_user_id uuid,
  p_type text,
  p_timezone text
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.claim_notification_delivery(
    p_user_id,
    p_type,
    p_timezone,
    'scheduled'
  );
$$;

-- A notification is recorded as sent only after OneSignal returns a message ID.
create or replace function public.complete_notification_delivery(
  p_claim_id uuid,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed record;
begin
  select id, user_id, type, completed_at into claimed
  from public.notification_delivery_claims
  where id = p_claim_id
  for update;

  if not found then return false; end if;
  if claimed.completed_at is not null then return true; end if;
  if nullif(p_provider_message_id, '') is null then return false; end if;

  insert into public.notification_log (user_id, type, sent_at, opened, delivery_claim_id)
  values (claimed.user_id, claimed.type, now(), false, claimed.id)
  on conflict do nothing;

  update public.notification_delivery_claims
  set completed_at = now(), provider_message_id = p_provider_message_id
  where id = claimed.id;

  return true;
end;
$$;

drop function if exists public.log_notification_if_allowed(uuid, text, text);
revoke all on function public.claim_notification_delivery(uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_notification_delivery(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_notification_delivery(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_notification_delivery(uuid, text, text) to service_role;
grant execute on function public.claim_notification_delivery(uuid, text, text, text) to service_role;
grant execute on function public.complete_notification_delivery(uuid, text) to service_role;

-- =========================
-- FUNCTIONS
-- =========================

-- streak logic
create or replace function update_streak(p_user_id uuid)
returns void
language plpgsql
as $$
declare
  last_date date;
begin
  select last_activity_date into last_date
  from user_streaks
  where user_id = p_user_id;

  if last_date = current_date then return; end if;

  if last_date = current_date - interval '1 day' then
    update user_streaks
    set streak_count = streak_count + 1,
        last_activity_date = current_date,
        updated_at = now()
    where user_id = p_user_id;
  else
    update user_streaks
    set streak_count = 1,
        last_activity_date = current_date,
        updated_at = now()
    where user_id = p_user_id;
  end if;
end;
$$;

-- check-in logic
create or replace function handle_daily_checkin(
  p_user_id uuid,
  p_mood int,
  p_sleep numeric
)
returns void
language plpgsql
as $$
begin
  insert into mood_logs (user_id, date, mood_value)
  values (p_user_id, current_date, p_mood)
  on conflict (user_id, date)
  do update set mood_value = excluded.mood_value;

  insert into sleep_logs (user_id, date, hours)
  values (p_user_id, current_date, p_sleep)
  on conflict (user_id, date)
  do update set hours = excluded.hours;

  perform update_streak(p_user_id);
end;
$$;

-- complete task
create or replace function complete_task(
  p_user_id uuid,
  p_title text
)
returns void
language plpgsql
as $$
begin
  insert into daily_tasks (user_id, title, date, status)
  values (p_user_id, p_title, current_date, 'done')
  on conflict (user_id, title, date)
  do update set status = 'done';
end;
$$;

-- complete cook together recipe
create or replace function public.complete_cook_together_recipe(
  p_recipe_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_recipe recipes%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into v_recipe
  from recipes
  where id = p_recipe_id
    and cook_together = true;

  if not found then
    raise exception 'Recipe not found';
  end if;

  insert into bond_logs (
    user_id,
    recipe_id,
    activity_type,
    quality,
    minutes
  )
  values (
    v_user_id,
    p_recipe_id,
    'cook_together_recipe',
    4,
    v_recipe.prep_mins
  );

  -- Cook Together should not be stored as a workout session.
  -- The activity is tracked in bond_logs and active minutes.
  /*
  insert into workout_sessions (
    user_id,
    exercise_name,
    duration_minutes,
    calories,
    exercises_completed,
    performed_at
  )
  values (
    v_user_id,
    'Cook Together: ' || v_recipe.title,
    v_recipe.prep_mins,
    0,
    1,
    now()
  );
  */

  insert into body_metrics (
    user_id,
    metric_type,
    value,
    recorded_at
  )
  values (
    v_user_id,
    'active_mins',
    v_recipe.prep_mins,
    now()
  );

  perform update_streak(v_user_id);
end;
$$;

grant execute on function public.complete_cook_together_recipe(uuid) to authenticated;

-- =========================
-- CO-PARENTING (shared custody calendar)
-- Defined before VIEWS because dad_score_view references co_parenting_schedules.
-- =========================

-- A dad's custody schedule, optionally linked to an invited co-parent account.
-- user_id            = the Dad Health user (owner) who controls the schedule
-- co_parent_user_id  = the invited co-parent's auth user (null until they accept)
-- custody_dates      = the set of dates the dad has custody
create table if not exists co_parenting_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  co_parent_user_id uuid references auth.users(id) on delete set null,
  custody_dates date[] not null default '{}',
  created_at timestamptz default now()
);

-- Calendar events attached to a schedule (custody / handover / school).
-- notes is the short handover/event note visible to both parties.
create table if not exists co_parenting_events (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references co_parenting_schedules(id) on delete cascade not null,
  event_date date not null,
  event_type text not null check (event_type in ('custody', 'handover', 'school')),
  notes text,
  created_at timestamptz default now()
);

-- Event-driven push bridge. Configure the deployed database with the full
-- backend endpoint and the same secret as NOTIFICATION_WEBHOOK_SECRET:
-- alter database postgres set app.settings.notification_webhook_url =
--   'https://www.dadhealth.co.uk/api/notifications/events';
-- alter database postgres set app.settings.notification_webhook_secret = '...';
create or replace function public.invoke_notification_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  webhook_url text := nullif(current_setting('app.settings.notification_webhook_url', true), '');
  webhook_secret text := nullif(current_setting('app.settings.notification_webhook_secret', true), '');
  notification_type text;
  request_id bigint;
begin
  if webhook_url is null or webhook_secret is null then
    raise warning 'Skipping notification event: webhook URL or secret is not configured';
    return new;
  end if;

  notification_type := case tg_table_name
    when 'comments' then 'community_reply'
    when 'co_parenting_events' then 'co_parent_event_added'
    else null
  end;
  if notification_type is null then return new; end if;

  select net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || webhook_secret
    ),
    body := jsonb_build_object(
      'type', notification_type,
      'record_id', new.id,
      'actor_user_id', auth.uid()
    )
  ) into request_id;
  raise log 'Queued notification event type %, record %, pg_net request %', notification_type, new.id, request_id;
  return new;
end;
$$;

drop trigger if exists notify_community_reply_on_insert on comments;
create trigger notify_community_reply_on_insert
after insert on comments for each row execute function public.invoke_notification_event();

drop trigger if exists notify_co_parent_event_on_insert on co_parenting_events;
create trigger notify_co_parent_event_on_insert
after insert on co_parenting_events for each row execute function public.invoke_notification_event();

-- user_profile: link to an invited co-parent account (nullable FK to users.id).
alter table user_profile add column if not exists co_parent_id uuid references auth.users(id) on delete set null;

create index if not exists idx_co_parenting_schedules_user on co_parenting_schedules(user_id);
create index if not exists idx_co_parenting_schedules_co_parent on co_parenting_schedules(co_parent_user_id);
create index if not exists idx_co_parenting_events_schedule on co_parenting_events(schedule_id, event_date);

alter table co_parenting_schedules enable row level security;
alter table co_parenting_events enable row level security;

-- =========================
-- VIEWS
-- =========================

-- Base on public.user_profile (not auth.users) and use SECURITY INVOKER so RLS of the
-- querying user applies. Safe for PostgREST (anon/authenticated).
create or replace view dad_score_view
  with (security_invoker = true)
as
select 
  p.user_id,

  coalesce((
    select avg(m.mood_value) * 25
    from mood_logs m
    where m.user_id = p.user_id
    and m.date >= current_date - 7
  ), 0) as mind_score,

  least(
    coalesce((
      select count(*) * 8
      from workout_sessions w
      where w.user_id = p.user_id
      and w.performed_at >= now() - interval '7 days'
    ), 0)
    +
    coalesce((
      select least(avg(s.hours) / 8 * 30, 30)
      from sleep_logs s
      where s.user_id = p.user_id
      and s.date >= current_date - 7
    ), 0)
    +
    coalesce((
      select least(avg(bm.value) / 10000 * 20, 20)
      from body_metrics bm
      where bm.user_id = p.user_id
      and bm.metric_type = 'steps'
      and bm.recorded_at >= now() - interval '7 days'
    ), 0)
    +
    coalesce((
      select least(avg(bm.value) / 30 * 10, 10)
      from body_metrics bm
      where bm.user_id = p.user_id
      and bm.metric_type = 'active_mins'
      and bm.recorded_at >= now() - interval '7 days'
    ), 0),
    100
  ) as body_score,

  least((
    coalesce((
      select count(*) * 15
      from journal_entries j
      where j.user_id = p.user_id
      and j.created_at >= now() - interval '7 days'
    ), 0)
    +
    -- Bond activity scoring.
    -- Co-parenting is opt-in: dads with no co_parenting_schedules row keep the
    -- original full scoring (quality * 5) for every activity. For dads who have
    -- opted in, activities logged on a custody day get full activity scoring
    -- (quality * 5); activities on non-custody days get quality-only scoring
    -- (quality * 2).
    coalesce((
      select sum(
        case
          when not exists (
            select 1 from co_parenting_schedules s where s.user_id = p.user_id
          )
            then bl.quality * 5
          when bl.created_at::date = any (
            select unnest(s.custody_dates)
            from co_parenting_schedules s
            where s.user_id = p.user_id
          )
            then bl.quality * 5
          else bl.quality * 2
        end
      )
      from bond_logs bl
      where bl.user_id = p.user_id
      and bl.created_at >= now() - interval '7 days'
    ), 0)
  ), 100) as bond_score

from public.user_profile p;

create or replace view dashboard_view
  with (security_invoker = true)
as
select 
  p.user_id,
  m.mood_value,
  s.hours as sleep_hours,
  st.streak_count,
  (
    select count(*) 
    from workout_sessions w 
    where w.user_id = p.user_id 
    and w.performed_at::date = current_date
  ) as today_workouts
from public.user_profile p
left join mood_logs m on m.user_id = p.user_id and m.date = current_date
left join sleep_logs s on s.user_id = p.user_id and s.date = current_date
left join user_streaks st on st.user_id = p.user_id;

-- =========================
-- TRIGGERS
-- =========================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
as $$
declare
  default_client_id uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  signup_client_id uuid;
  final_client_id uuid;
begin
  -- Resolve client_id: from signup metadata, or default if it exists, else null
  signup_client_id := (new.raw_user_meta_data->>'client_id')::uuid;
  if signup_client_id is not null then
    final_client_id := signup_client_id;
  else
    select id into final_client_id from public.clients where id = default_client_id limit 1;
  end if;

  insert into public.user_profile (user_id, client_id) values (new.id, final_client_id);
  insert into public.user_streaks (user_id, streak_count) values (new.id, 0);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- =========================
-- INDEXES
-- =========================

create index if not exists idx_mood_user_date on mood_logs(user_id, date);
create index if not exists idx_sleep_user_date on sleep_logs(user_id, date);
create index if not exists idx_workout_user on workout_sessions(user_id);
create index if not exists idx_workouts_source_created on workouts(source, created_at desc);
create index if not exists idx_workouts_user_created on workouts(user_id, created_at desc);
create index if not exists idx_workout_completions_user_completed on workout_completions(user_id, completed_at desc);
create index if not exists idx_tasks_user_date on daily_tasks(user_id, date);
create index if not exists idx_recipes_cook_together on recipes(cook_together);
create index if not exists idx_recipes_filters on recipes(difficulty, age_min, prep_mins);
create index if not exists idx_user_saved_recipes_user on user_saved_recipes(user_id);
create index if not exists idx_bond_logs_user_created on bond_logs(user_id, created_at desc);

-- Milestone photos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'milestone-photos',
  'milestone-photos',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can view own milestone photos" on storage.objects;
create policy "Users can view own milestone photos"
on storage.objects
for select
using (
  bucket_id = 'milestone-photos'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "Users can insert own milestone photos" on storage.objects;
create policy "Users can insert own milestone photos"
on storage.objects
for insert
with check (
  bucket_id = 'milestone-photos'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "Users can update own milestone photos" on storage.objects;
create policy "Users can update own milestone photos"
on storage.objects
for update
using (
  bucket_id = 'milestone-photos'
  and auth.uid()::text = split_part(name, '/', 1)
)
with check (
  bucket_id = 'milestone-photos'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "Users can delete own milestone photos" on storage.objects;
create policy "Users can delete own milestone photos"
on storage.objects
for delete
using (
  bucket_id = 'milestone-photos'
  and auth.uid()::text = split_part(name, '/', 1)
);

-- Recipe images (admin-uploaded via service role; publicly readable)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recipe-images',
  'recipe-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can read recipe images. Writes happen server-side with the service
-- role key (which bypasses RLS), so no client insert/update/delete policies.
drop policy if exists "Public can view recipe images" on storage.objects;
create policy "Public can view recipe images"
on storage.objects
for select
using (bucket_id = 'recipe-images');

create unique index if not exists limit_posts_per_hour
on posts(user_id, date_trunc('hour', created_at AT TIME ZONE 'UTC'));

-- =========================
-- LEGACY REPAIR (idempotent — run if signup failed before clients existed)
-- =========================
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  brand_config jsonb default '{}',
  created_at timestamptz default now()
);

alter table user_profile add column if not exists client_id uuid references clients(id) on delete set null;

insert into clients (id, slug, name, brand_config) values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'dadhealth',
  'Dad Health',
  '{"primary":"78 89% 65%","primaryForeground":"0 0% 4%","accent":"78 89% 65%","lime":"78 89% 65%","ring":"78 89% 65%","sidebarPrimary":"78 89% 65%","sidebarRing":"78 89% 65%"}'
) on conflict (id) do nothing;

update user_profile set client_id = '00000000-0000-0000-0000-000000000001'::uuid where client_id is null;

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
as $$
declare
  default_client_id uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  signup_client_id uuid;
  final_client_id uuid;
begin
  signup_client_id := (new.raw_user_meta_data->>'client_id')::uuid;
  if signup_client_id is not null then
    final_client_id := signup_client_id;
  else
    select id into final_client_id from public.clients where id = default_client_id limit 1;
  end if;

  insert into public.user_profile (user_id, client_id) values (new.id, final_client_id);
  insert into public.user_streaks (user_id, streak_count) values (new.id, 0);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- =========================
-- COMMUNITY: trending tags (RPC for GROUP BY over all posts)
-- =========================
create or replace function public.trending_post_tags(limit_n int default 5)
returns table(tag text, count bigint)
language sql
stable
security invoker
as $$
  select p.tag, count(*)::bigint
  from public.posts p
  group by p.tag
  order by count(*) desc
  limit greatest(1, coalesce(limit_n, 5));
$$;

grant execute on function public.trending_post_tags(int) to anon, authenticated;

-- =========================
-- MIGRATION: comment threading (existing DBs)
-- =========================
alter table comments add column if not exists parent_id uuid references comments(id) on delete cascade;
create index if not exists idx_comments_post_parent on comments(post_id, parent_id);

-- =========================
-- EXPERT Q&A EVENTS (Feature 10 — Admin Dashboard)
-- =========================
create table if not exists expert_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  expert_name text not null,
  event_date timestamptz not null,
  booking_url text,
  active boolean not null default true,
  created_at timestamptz default now()
);

alter table expert_events enable row level security;

-- =========================
-- WEARABLE INTEGRATIONS
-- =========================

create table if not exists user_integrations (
  id uuid primary key default gen_random_uuid(),

  user_id uuid references auth.users(id) on delete cascade not null,

  provider text not null,

  access_token text,
  refresh_token text,

  connected_at timestamptz default now(),
  last_sync_at timestamptz,

  device_name text,

  unique(user_id, provider)
);

alter table user_integrations enable row level security;

drop policy if exists "Users can view own integrations" on user_integrations;
create policy "Users can view own integrations"
on user_integrations
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own integrations" on user_integrations;
create policy "Users can insert own integrations"
on user_integrations
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own integrations" on user_integrations;
create policy "Users can update own integrations"
on user_integrations
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own integrations" on user_integrations;
create policy "Users can delete own integrations"
on user_integrations
for delete
using (auth.uid() = user_id);

-- body_metrics wearable source
alter table body_metrics
add column if not exists source text
default 'manual';

-- sleep logs wearable source
alter table sleep_logs
add column if not exists source text
default 'manual';

update body_metrics set source = 'manual' where source is null;
update sleep_logs set source = 'manual' where source is null;
alter table body_metrics alter column source set default 'manual', alter column source set not null;
alter table sleep_logs alter column source set default 'manual', alter column source set not null;

-- Normalize wearable constraints for existing databases as well as fresh installs.
alter table body_metrics
drop constraint if exists body_metrics_source_check;
alter table body_metrics
add constraint body_metrics_source_check
check (source in ('manual', 'garmin', 'fitbit', 'apple_health'));

alter table sleep_logs
drop constraint if exists sleep_logs_source_check;
alter table sleep_logs
add constraint sleep_logs_source_check
check (source in ('manual', 'garmin', 'fitbit', 'apple_health'));

alter table user_integrations
drop constraint if exists user_integrations_provider_check;
alter table user_integrations
add constraint user_integrations_provider_check
check (provider in ('garmin', 'fitbit', 'apple_health'));

alter table user_integrations
alter column access_token drop not null,
alter column refresh_token drop not null;

alter table user_integrations
drop constraint if exists user_integrations_tokens_check;
alter table user_integrations
add constraint user_integrations_tokens_check check (
  (provider in ('garmin', 'fitbit') and access_token is not null and refresh_token is not null)
  or
  (provider = 'apple_health' and access_token is null and refresh_token is null)
);

-- Atomically import Apple Health daily aggregates without replacing a user's
-- manual value for the same day. Other wearable rows keep the existing
-- last-successful-sync behaviour.
create or replace function public.upsert_apple_health_daily_data(
  p_metrics jsonb default '[]'::jsonb,
  p_sleep jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  metrics_written int := 0;
  sleep_written int := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  with written as (
    insert into body_metrics (user_id, metric_type, value, recorded_at, source)
    select
      current_user_id,
      metric.metric_type,
      metric.value,
      metric.recorded_at,
      'apple_health'
    from jsonb_to_recordset(coalesce(p_metrics, '[]'::jsonb))
      as metric(metric_type text, value numeric, recorded_at timestamptz)
    where metric.metric_type in ('steps', 'active_mins', 'resting_hr')
      and metric.value >= 0
      and not exists (
        select 1
        from body_metrics existing
        where existing.user_id = current_user_id
          and existing.metric_type = metric.metric_type
          and existing.recorded_at::date = metric.recorded_at::date
          and existing.source = 'manual'
      )
    on conflict (user_id, metric_type, recorded_at)
    do update set
      value = excluded.value,
      source = excluded.source
    where body_metrics.source <> 'manual'
    returning 1
  )
  select count(*) into metrics_written from written;

  with written as (
    insert into sleep_logs (user_id, date, hours, source)
    select
      current_user_id,
      sleep.date,
      sleep.hours,
      'apple_health'
    from jsonb_to_recordset(coalesce(p_sleep, '[]'::jsonb))
      as sleep(date date, hours numeric)
    where sleep.hours > 0
      and sleep.hours <= 24
    on conflict (user_id, date)
    do update set
      hours = excluded.hours,
      source = excluded.source
    where sleep_logs.source <> 'manual'
    returning 1
  )
  select count(*) into sleep_written from written;

  return jsonb_build_object(
    'metrics_written', metrics_written,
    'sleep_written', sleep_written
  );
end;
$$;

revoke execute on function public.upsert_apple_health_daily_data(jsonb, jsonb) from public;
grant execute on function public.upsert_apple_health_daily_data(jsonb, jsonb) to authenticated;

-- resting heart rate metric index
create index if not exists idx_body_metrics_user_metric_date
on body_metrics(user_id, metric_type, recorded_at desc);

create unique index if not exists idx_body_metrics_user_metric_recorded_at_unique
on body_metrics(user_id, metric_type, recorded_at);

create index if not exists idx_user_integrations_user
on user_integrations(user_id);

-- Supabase Edge Function cron. Set these DB settings before enabling in production:
-- alter database postgres set app.settings.supabase_url = 'https://YOUR_PROJECT.supabase.co';
-- alter database postgres set app.settings.wearable_sync_secret = 'same value as WEARABLE_SYNC_SECRET';
create or replace function public.invoke_wearable_sync()
returns void
language plpgsql
security definer
as $$
declare
  function_url text := nullif(current_setting('app.settings.supabase_url', true), '') || '/functions/v1/wearable-sync';
  sync_secret text := nullif(current_setting('app.settings.wearable_sync_secret', true), '');
begin
  if function_url is null then
    raise notice 'Skipping wearable sync: app.settings.supabase_url is not set';
    return;
  end if;

  perform net.http_post(
    url := function_url,
    headers := case
      when sync_secret is null then '{"content-type":"application/json"}'::jsonb
      else jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || sync_secret)
    end,
    body := '{}'::jsonb
  );
end;
$$;

select cron.unschedule('wearable-sync-daily-3am')
where exists (select 1 from cron.job where jobname = 'wearable-sync-daily-3am');

select cron.schedule(
  'wearable-sync-daily-3am',
  '0 3 * * *',
  $$select public.invoke_wearable_sync();$$
);

-- Push notification dispatcher cron. Supabase Cron is used because Vercel
-- Hobby only permits one cron invocation per day, while notifications need a
-- 15-minute scheduling window. Set these DB settings in production:
-- alter database postgres set app.settings.notification_dispatch_url =
--   'https://www.dadhealth.co.uk/api/notifications/dispatch';
-- alter database postgres set app.settings.cron_secret = 'same value as CRON_SECRET';
create or replace function public.invoke_notification_dispatch()
returns void
language plpgsql
security definer
as $$
declare
  dispatch_url text := nullif(current_setting('app.settings.notification_dispatch_url', true), '');
  dispatch_secret text := nullif(current_setting('app.settings.cron_secret', true), '');
  request_id bigint;
begin
  if dispatch_url is null or dispatch_secret is null then
    raise warning 'Skipping notification dispatch: URL or cron secret is not configured';
    return;
  end if;

  select net.http_get(
    url := dispatch_url,
    headers := jsonb_build_object('authorization', 'Bearer ' || dispatch_secret),
    timeout_milliseconds := 10000
  ) into request_id;
  raise log 'Queued notification dispatch pg_net request %', request_id;
end;
$$;

select cron.unschedule('notification-dispatch-every-15-min')
where exists (select 1 from cron.job where jobname = 'notification-dispatch-every-15-min');

select cron.schedule(
  'notification-dispatch-every-15-min',
  '*/15 * * * *',
  $$select public.invoke_notification_dispatch();$$
);
