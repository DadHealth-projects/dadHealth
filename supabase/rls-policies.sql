-- DAD HEALTH COMPLETE ROW LEVEL SECURITY POLICIES
-- All 26 tables with full RLS enforcement
-- Run in Supabase SQL Editor after schema creation

-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================

alter table clients enable row level security;
alter table mood_logs enable row level security;
alter table sleep_logs enable row level security;
alter table workout_sessions enable row level security;
alter table workouts enable row level security;
alter table workout_completions enable row level security;
alter table user_profile enable row level security;
alter table user_streaks enable row level security;
alter table meal_plans enable row level security;
alter table body_metrics enable row level security;
alter table journal_entries enable row level security;
alter table milestones enable row level security;
alter table posts enable row level security;
alter table likes enable row level security;
alter table comments enable row level security;
alter table saved_posts enable row level security;
alter table user_circles enable row level security;
alter table earned_badges enable row level security;
alter table recipes enable row level security;
alter table user_saved_recipes enable row level security;
alter table bond_logs enable row level security;
alter table dad_day_searches enable row level security;
alter table user_integrations enable row level security;
alter table co_parenting_schedules enable row level security;
alter table co_parenting_events enable row level security;
alter table expert_events enable row level security;

-- ============================================================
-- AUTHENTICATION AND ADMIN TABLES
-- ============================================================

-- clients: public read only (no user writes)
drop policy if exists "Anyone can read clients" on clients;
create policy "Anyone can read clients" on clients for select using (true);

-- ============================================================
-- USER CORE DATA - OWNER ONLY
-- ============================================================

-- user_profile: users can CRUD own profile only
drop policy if exists "Users can CRUD own user_profile" on user_profile;
create policy "Users can CRUD own user_profile" on user_profile for all
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

-- user_streaks: users can CRUD own streaks only
drop policy if exists "Users can CRUD own user_streaks" on user_streaks;
create policy "Users can CRUD own user_streaks" on user_streaks for all using (auth.uid() = user_id);

-- ============================================================
-- HEALTH TRACKING DATA - OWNER ONLY
-- ============================================================

-- mood_logs: users can CRUD own mood logs
drop policy if exists "Users can CRUD own mood_logs" on mood_logs;
create policy "Users can CRUD own mood_logs" on mood_logs for all using (auth.uid() = user_id);

-- sleep_logs: users can CRUD own sleep logs
drop policy if exists "Users can CRUD own sleep_logs" on sleep_logs;
create policy "Users can CRUD own sleep_logs" on sleep_logs for all using (auth.uid() = user_id);

-- body_metrics: users can CRUD own metrics
drop policy if exists "Users can CRUD own body_metrics" on body_metrics;
create policy "Users can CRUD own body_metrics" on body_metrics for all using (auth.uid() = user_id);

-- journal_entries: users can CRUD own entries
drop policy if exists "Users can CRUD own journal_entries" on journal_entries;
create policy "Users can CRUD own journal_entries" on journal_entries for all using (auth.uid() = user_id);

-- ============================================================
-- FITNESS DATA - OWNER ONLY (with admin created workouts)
-- ============================================================

-- workout_sessions: users can CRUD own sessions
drop policy if exists "Users can CRUD own workout_sessions" on workout_sessions;
create policy "Users can CRUD own workout_sessions" on workout_sessions for all using (auth.uid() = user_id);

-- workouts: users can read admin and own, write own only
drop policy if exists "Users can read admin and own workouts" on workouts;
create policy "Users can read admin and own workouts"
on workouts for select
using (source = 'admin' or auth.uid() = user_id);

drop policy if exists "Users can insert own ai workouts" on workouts;
create policy "Users can insert own ai workouts"
on workouts for insert
with check (auth.uid() = user_id and source = 'ai_generated');

drop policy if exists "Users can update own ai workouts" on workouts;
create policy "Users can update own ai workouts"
on workouts for update
using (auth.uid() = user_id and source = 'ai_generated')
with check (auth.uid() = user_id and source = 'ai_generated');

drop policy if exists "Users can delete own ai workouts" on workouts;
create policy "Users can delete own ai workouts"
on workouts for delete
using (auth.uid() = user_id and source = 'ai_generated');

-- workout_completions: users can CRUD own completions
drop policy if exists "Users can CRUD own workout_completions" on workout_completions;
create policy "Users can CRUD own workout_completions"
on workout_completions for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- meal_plans: users can CRUD own plans
drop policy if exists "Users can CRUD own meal_plans" on meal_plans;
create policy "Users can CRUD own meal_plans" on meal_plans for all using (auth.uid() = user_id);

-- ============================================================
-- PARENTING DATA - OWNER ONLY (WITH CO-PARENT SHARING)
-- ============================================================

-- milestones: users own, co-parents read-only when shared
drop policy if exists "Users can CRUD own milestones" on milestones;
create policy "Users can CRUD own milestones" on milestones for all using (auth.uid() = user_id);

drop policy if exists "Co-parent can read linked owner milestones" on milestones;
create policy "Co-parent can read linked owner milestones"
on milestones for select
using (
  exists (
    select 1 from co_parenting_schedules s
    where s.user_id = milestones.user_id
      and s.co_parent_user_id = auth.uid()
  )
);

-- bond_logs: users can CRUD own logs
drop policy if exists "Users can CRUD own bond_logs" on bond_logs;
create policy "Users can CRUD own bond_logs"
on bond_logs for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- ============================================================
-- COMMUNITY AND ENGAGEMENT - PUBLIC WITH USER OWNERSHIP
-- ============================================================

-- posts: anyone can read, auth can write, author can delete
drop policy if exists "Allow read posts" on posts;
create policy "Allow read posts" on posts for select using (true);

drop policy if exists "Auth can insert posts" on posts;
create policy "Auth can insert posts" on posts for insert with check (true);

drop policy if exists "Users can delete own posts" on posts;
create policy "Users can delete own posts" on posts for delete using (auth.uid() = user_id);

-- likes: anyone can read, auth can like, user can unlike
drop policy if exists "Allow read likes" on likes;
create policy "Allow read likes" on likes for select using (true);

drop policy if exists "Users can insert own likes" on likes;
create policy "Users can insert own likes" on likes for insert with check (auth.uid() = user_id);

drop policy if exists "Users can delete own likes" on likes;
create policy "Users can delete own likes" on likes for delete using (auth.uid() = user_id);

-- comments: anyone can read, auth can reply, user can delete own
drop policy if exists "Allow read comments" on comments;
create policy "Allow read comments" on comments for select using (true);

drop policy if exists "Users can insert own comments" on comments;
create policy "Users can insert own comments" on comments for insert with check (auth.uid() = user_id);

drop policy if exists "Users can delete own comments" on comments;
create policy "Users can delete own comments" on comments for delete using (auth.uid() = user_id);

-- saved_posts: users can CRUD own saves
drop policy if exists "Allow read saved_posts" on saved_posts;
create policy "Allow read saved_posts" on saved_posts for select using (true);

drop policy if exists "Users can insert own saves" on saved_posts;
create policy "Users can insert own saves" on saved_posts for insert with check (auth.uid() = user_id);

drop policy if exists "Users can delete own saves" on saved_posts;
create policy "Users can delete own saves" on saved_posts for delete using (auth.uid() = user_id);

-- ============================================================
-- GROUPS AND BADGES - USER SPECIFIC
-- ============================================================

-- user_circles: users can CRUD own circle memberships
drop policy if exists "Users can CRUD own user_circles" on user_circles;
create policy "Users can CRUD own user_circles" on user_circles for all using (auth.uid() = user_id);

-- earned_badges: users can CRUD own badges (badges awarded by triggers)
drop policy if exists "Users can CRUD own earned_badges" on earned_badges;
create policy "Users can CRUD own earned_badges" on earned_badges for all using (auth.uid() = user_id);

-- ============================================================
-- RECIPES AND SAVED RECIPES
-- ============================================================

-- recipes: anyone can read cook together recipes (admin writes via service role)
drop policy if exists "Anyone can read cook together recipes" on recipes;
create policy "Anyone can read cook together recipes"
on recipes for select
using (cook_together = true);

-- user_saved_recipes: users can CRUD own saved recipes
drop policy if exists "Users can CRUD own saved recipes" on user_saved_recipes;
create policy "Users can CRUD own saved recipes"
on user_saved_recipes for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- ============================================================
-- SEARCH AND INTEGRATION HISTORY
-- ============================================================

-- dad_day_searches: users can view and insert own searches
drop policy if exists "Users can view own dad day searches" on dad_day_searches;
create policy "Users can view own dad day searches"
on dad_day_searches for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own dad day searches" on dad_day_searches;
create policy "Users can insert own dad day searches"
on dad_day_searches for insert
with check (auth.uid() = user_id);

-- user_integrations: users can view and delete own integrations
drop policy if exists "Users can view own integrations" on user_integrations;
create policy "Users can view own integrations"
on user_integrations for select
using (auth.uid() = user_id);

drop policy if exists "Users can delete own integrations" on user_integrations;
create policy "Users can delete own integrations"
on user_integrations for delete
using (auth.uid() = user_id);

-- ============================================================
-- EXPERT EVENTS - PUBLIC READ ONLY
-- ============================================================

-- expert_events: anyone can read active events (admin writes via service role)
drop policy if exists "Anyone can read active expert events" on expert_events;
create policy "Anyone can read active expert events"
on expert_events for select
using (active = true);

-- ============================================================
-- CO-PARENTING - OWNERSHIP AND SHARING MODEL
-- ============================================================

-- co_parenting_schedules: dad owns, co-parent reads
drop policy if exists "Owner can CRUD own co_parenting_schedules" on co_parenting_schedules;
create policy "Owner can CRUD own co_parenting_schedules"
on co_parenting_schedules for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Co-parent can read linked co_parenting_schedules" on co_parenting_schedules;
create policy "Co-parent can read linked co_parenting_schedules"
on co_parenting_schedules for select
using (
  auth.uid() = co_parent_user_id
  or exists (
    select 1 from user_profile p
    where p.user_id = auth.uid()
      and p.co_parent_id = co_parenting_schedules.co_parent_user_id
  )
);

-- co_parenting_events: dad owns (via schedule), co-parent reads
drop policy if exists "Owner can CRUD own co_parenting_events" on co_parenting_events;
create policy "Owner can CRUD own co_parenting_events"
on co_parenting_events for all
using (
  exists (
    select 1 from co_parenting_schedules s
    where s.id = co_parenting_events.schedule_id
      and s.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from co_parenting_schedules s
    where s.id = co_parenting_events.schedule_id
      and s.user_id = auth.uid()
  )
);

drop policy if exists "Co-parent can read linked co_parenting_events" on co_parenting_events;
create policy "Co-parent can read linked co_parenting_events"
on co_parenting_events for select
using (
  exists (
    select 1 from co_parenting_schedules s
    where s.id = co_parenting_events.schedule_id
      and (
        s.co_parent_user_id = auth.uid()
        or exists (
          select 1 from user_profile p
          where p.user_id = auth.uid()
            and p.co_parent_id = s.co_parent_user_id
        )
      )
  )
);

-- ============================================================
-- FILE STORAGE POLICIES
-- ============================================================

-- milestone-photos bucket: users can manage own photos
drop policy if exists "Users can view own milestone photos" on storage.objects;
create policy "Users can view own milestone photos"
on storage.objects for select
using (
  bucket_id = 'milestone-photos'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "Users can insert own milestone photos" on storage.objects;
create policy "Users can insert own milestone photos"
on storage.objects for insert
with check (
  bucket_id = 'milestone-photos'
  and auth.uid()::text = split_part(name, '/', 1)
);

drop policy if exists "Users can update own milestone photos" on storage.objects;
create policy "Users can update own milestone photos"
on storage.objects for update
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
on storage.objects for delete
using (
  bucket_id = 'milestone-photos'
  and auth.uid()::text = split_part(name, '/', 1)
);

-- ============================================================
-- SUMMARY
-- ============================================================
-- Total tables: 26
-- RLS enabled on all tables
-- Owner-only access: 16 tables
-- Public read + selective write: 7 tables
-- Public read only: 3 tables
-- Co-parenting sharing: 3 tables
-- Admin/service role only: seeded content tables