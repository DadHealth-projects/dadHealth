begin;

-- Circle descriptions are Admin-managed copy. Existing rows stay valid and
-- render without a description until Jamie enters one.
alter table public.circles
  add column if not exists description text;

-- Remember that the one-time introduction has been shown for this account.
create table if not exists public.present_dad_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  intro_seen_at timestamptz not null default now()
);

alter table public.present_dad_preferences enable row level security;
drop policy if exists present_dad_preferences_select_own on public.present_dad_preferences;
create policy present_dad_preferences_select_own on public.present_dad_preferences
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists present_dad_preferences_insert_own on public.present_dad_preferences;
create policy present_dad_preferences_insert_own on public.present_dad_preferences
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists present_dad_preferences_update_own on public.present_dad_preferences;
create policy present_dad_preferences_update_own on public.present_dad_preferences
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.present_dad_preferences from public, anon, authenticated;
grant select, insert, update on public.present_dad_preferences to authenticated;
grant all on public.present_dad_preferences to service_role;

create table if not exists public.present_dad_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'cancelled', 'completed')),
  completed_at timestamptz,
  completed_duration_seconds integer,
  completion_acknowledged_at timestamptz,
  notification_attempted_at timestamptz,
  notification_sent_at timestamptz,
  constraint present_dad_duration_valid check (completed_duration_seconds is null or completed_duration_seconds between 0 and 3600)
);

alter table public.present_dad_sessions
  add column if not exists completed_duration_seconds integer,
  add column if not exists completion_acknowledged_at timestamptz;
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'present_dad_duration_valid'
      and conrelid = 'public.present_dad_sessions'::regclass
  ) then
    alter table public.present_dad_sessions
      add constraint present_dad_duration_valid
      check (completed_duration_seconds is null or completed_duration_seconds between 0 and 3600);
  end if;
end $$;

create unique index if not exists idx_present_dad_one_active_per_user
  on public.present_dad_sessions(user_id) where status = 'active';
create index if not exists idx_present_dad_due
  on public.present_dad_sessions(status, ends_at);
create index if not exists idx_present_dad_unacknowledged
  on public.present_dad_sessions(user_id, completed_at desc)
  where status = 'completed' and completion_acknowledged_at is null;

create or replace function public.present_dad_session_counts_toward_score(p_duration_seconds integer)
returns boolean
language sql immutable parallel safe
as $$ select coalesce(p_duration_seconds >= 300, false) $$;
revoke all on function public.present_dad_session_counts_toward_score(integer) from public, anon, authenticated;

create or replace function public.enforce_present_dad_session_timing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ended_at timestamptz;
  elapsed_seconds integer;
begin
  if tg_op = 'INSERT' then
    new.started_at := statement_timestamp();
    new.ends_at := new.started_at + interval '60 minutes';
    new.status := 'active';
    new.completed_at := null;
    new.completed_duration_seconds := null;
    new.completion_acknowledged_at := null;
    new.notification_attempted_at := null;
    new.notification_sent_at := null;
    return new;
  end if;

  if new.user_id is distinct from old.user_id
    or new.started_at is distinct from old.started_at
    or new.ends_at is distinct from old.ends_at then
    raise exception 'Present Dad session identity and timing cannot be changed';
  end if;

  if old.status <> 'active' then
    if new.status is distinct from old.status
      or new.completed_at is distinct from old.completed_at
      or new.completed_duration_seconds is distinct from old.completed_duration_seconds then
      raise exception 'Finished Present Dad session results cannot be changed';
    end if;
    return new;
  end if;

  if new.status = 'active' then
    if new.completed_at is not null or new.completed_duration_seconds is not null then
      raise exception 'Active Present Dad sessions cannot have completion data';
    end if;
    return new;
  end if;

  if new.status not in ('cancelled', 'completed') then
    raise exception 'Invalid Present Dad session status transition';
  end if;

  ended_at := statement_timestamp();
  elapsed_seconds := greatest(0, least(3600, floor(extract(epoch from (ended_at - old.started_at)))::integer));
  new.completed_duration_seconds := elapsed_seconds;
  if new.status = 'completed' and public.present_dad_session_counts_toward_score(elapsed_seconds) then
    new.completed_at := ended_at;
  else
    -- Under five minutes is retained as a stopped session but never enters
    -- the canonical score query, which only includes completed sessions.
    new.status := 'cancelled';
    new.completed_at := null;
    new.notification_attempted_at := null;
    new.notification_sent_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_present_dad_session_timing on public.present_dad_sessions;
create trigger enforce_present_dad_session_timing
before insert or update on public.present_dad_sessions
for each row execute function public.enforce_present_dad_session_timing();

-- Do not replay completion screens for sessions completed before this UI existed.
update public.present_dad_sessions
set completion_acknowledged_at = coalesce(completed_at, started_at)
where status = 'completed' and completion_acknowledged_at is null;

alter table public.present_dad_sessions enable row level security;
drop policy if exists "Users can CRUD own present_dad_sessions" on public.present_dad_sessions;
drop policy if exists "Users can cancel own present_dad_sessions" on public.present_dad_sessions;
drop policy if exists "Users can read own present_dad_sessions" on public.present_dad_sessions;
create policy "Users can read own present_dad_sessions"
  on public.present_dad_sessions for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users can start own present_dad_sessions" on public.present_dad_sessions;
create policy "Users can start own present_dad_sessions"
  on public.present_dad_sessions for insert to authenticated
  with check (auth.uid() = user_id and status = 'active' and completed_at is null);
revoke all on public.present_dad_sessions from public, anon, authenticated;
grant select, insert on public.present_dad_sessions to authenticated;
grant all on public.present_dad_sessions to service_role;

create or replace function public.finish_present_dad_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.present_dad_sessions%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Not authenticated';
  end if;

  update public.present_dad_sessions
  set status = 'completed'
  where id = p_session_id and user_id = v_user_id and status = 'active'
  returning * into v_session;

  if not found then
    select * into v_session
    from public.present_dad_sessions
    where id = p_session_id and user_id = v_user_id
      and status in ('completed', 'cancelled');
    if not found then
      raise exception using errcode = 'P0002', message = 'Present Dad session not found';
    end if;
  end if;

  return to_jsonb(v_session);
end;
$$;
revoke all on function public.finish_present_dad_session(uuid) from public, anon;
grant execute on function public.finish_present_dad_session(uuid) to authenticated, service_role;

create or replace function public.acknowledge_present_dad_completion(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Not authenticated';
  end if;
  update public.present_dad_sessions
  set completion_acknowledged_at = coalesce(completion_acknowledged_at, statement_timestamp())
  where id = p_session_id and user_id = v_user_id and status = 'completed';
  return found;
end;
$$;
revoke all on function public.acknowledge_present_dad_completion(uuid) from public, anon;
grant execute on function public.acknowledge_present_dad_completion(uuid) to authenticated;

commit;
