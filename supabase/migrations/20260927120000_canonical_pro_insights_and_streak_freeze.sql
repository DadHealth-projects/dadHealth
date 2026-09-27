-- Keep Pro access decisions shared between the server resolver and database
-- triggers, then make streak writes authoritative and weekly-freeze safe.
begin;

create or replace function public.user_has_pro_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
      select profile.is_pro
      from public.user_profile profile
      where profile.user_id = p_user_id
    ), false)
    or exists (
      select 1
      from public.user_profile profile
      where profile.user_id = p_user_id
        and profile.stripe_customer_id is not null
        and profile.subscription_status in ('active', 'trialing')
    )
    or exists (
      select 1
      from public.subscription_entitlements entitlement
      where entitlement.user_id = p_user_id
        and entitlement.status in ('active', 'trialing', 'grace_period')
        and (entitlement.current_period_end is null or entitlement.current_period_end > now())
    );
$$;

revoke all on function public.user_has_pro_access(uuid) from public, anon, authenticated;
grant execute on function public.user_has_pro_access(uuid) to service_role;

create table if not exists public.user_streak_freezes (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  missed_date date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, week_start),
  unique (user_id, missed_date),
  check (extract(isodow from week_start) = 1),
  check (date_trunc('week', missed_date)::date = week_start)
);

alter table public.user_streak_freezes enable row level security;
revoke all on table public.user_streak_freezes from public, anon, authenticated;
grant all on table public.user_streak_freezes to service_role;

create or replace function public.record_streak_activity(
  p_user_id uuid,
  p_activity_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_activity date;
  current_count integer;
  next_count integer;
  gap_days integer;
  missed_day date;
  freeze_recorded boolean := false;
  inserted_rows integer := 0;
begin
  if p_user_id is null or p_activity_date is null then
    return null;
  end if;

  -- Serializes retries, offline replay and simultaneous activity writes.
  perform pg_advisory_xact_lock(hashtextextended('streak:' || p_user_id::text, 0));

  insert into public.user_streaks (user_id, streak_count, last_activity_date)
  values (p_user_id, 0, null)
  on conflict (user_id) do nothing;

  select streak_count, last_activity_date
  into current_count, previous_activity
  from public.user_streaks
  where user_id = p_user_id
  for update;

  -- The same day is an idempotent replay; backdated offline rows cannot
  -- overwrite a newer authoritative streak state.
  if previous_activity is not null and p_activity_date <= previous_activity then
    return current_count;
  end if;

  if previous_activity is null then
    next_count := 1;
  else
    gap_days := p_activity_date - previous_activity;
    if gap_days = 1 then
      next_count := coalesce(current_count, 0) + 1;
    elsif gap_days = 2
      and coalesce(current_count, 0) > 0
      and public.user_has_pro_access(p_user_id)
    then
      missed_day := previous_activity + 1;
      insert into public.user_streak_freezes (user_id, week_start, missed_date)
      values (p_user_id, date_trunc('week', missed_day)::date, missed_day)
      on conflict (user_id, week_start) do nothing;
      get diagnostics inserted_rows = row_count;
      freeze_recorded := inserted_rows > 0;
      next_count := case when freeze_recorded then current_count + 1 else 1 end;
    else
      next_count := 1;
    end if;
  end if;

  update public.user_streaks
  set streak_count = next_count,
      last_activity_date = p_activity_date,
      updated_at = now()
  where user_id = p_user_id;

  return next_count;
end;
$$;

revoke all on function public.record_streak_activity(uuid, date) from public, anon, authenticated;
grant execute on function public.record_streak_activity(uuid, date) to service_role;

create or replace function public.update_streak(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Cannot update another user streak';
  end if;
  -- Legacy callers may still invoke this helper. Require a same-day logged
  -- check-in or Cook Together completion so it cannot manufacture activity.
  if auth.uid() is not null
    and not exists (
      select 1 from public.mood_logs
      where user_id = p_user_id and date = current_date
    )
    and not exists (
      select 1 from public.bond_logs
      where user_id = p_user_id
        and activity_type = 'cook_together_recipe'
        and created_at::date = current_date
    )
  then
    return;
  end if;
  perform public.record_streak_activity(p_user_id, current_date);
end;
$$;
revoke all on function public.update_streak(uuid) from public, anon;
grant execute on function public.update_streak(uuid) to authenticated, service_role;

create or replace function public.handle_mood_streak_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'INSERT' then
    perform public.record_streak_activity(new.user_id, new.date);
  elsif tg_op = 'UPDATE' and new.date is distinct from old.date then
    perform public.record_streak_activity(new.user_id, new.date);
  end if;
  return new;
end;
$$;

drop trigger if exists mood_logs_record_streak_activity on public.mood_logs;
create trigger mood_logs_record_streak_activity
after insert or update or delete on public.mood_logs
for each row execute function public.handle_mood_streak_activity();

-- Clients may read their streak, but only the trigger/definer path can change it.
alter table public.user_streaks enable row level security;
drop policy if exists "Users can CRUD own user_streaks" on public.user_streaks;
drop policy if exists "Users can read own user_streaks" on public.user_streaks;
create policy "Users can read own user_streaks"
on public.user_streaks for select to authenticated
using (auth.uid() = user_id);
revoke insert, update, delete on table public.user_streaks from anon, authenticated;
grant select on table public.user_streaks to authenticated;

-- Pro history is returned only through the authenticated server insights API.
revoke all on table public.dad_score_history_view from anon, authenticated;
grant select on table public.dad_score_history_view to service_role;

commit;
