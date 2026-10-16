begin;

-- One admin-selected Free workout per Monday-starting week.
create table if not exists public.free_weekly_workout_assignments (
  week_start date primary key,
  workout_id uuid not null references public.workouts(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint free_weekly_workout_assignments_monday_chk
    check (extract(isodow from week_start) = 1)
);

create index if not exists free_weekly_workout_assignments_workout_id_idx
  on public.free_weekly_workout_assignments(workout_id);

alter table public.free_weekly_workout_assignments enable row level security;
alter table public.workouts enable row level security;
grant select on table public.workouts to anon, authenticated;
revoke all on table public.free_weekly_workout_assignments from public, anon, authenticated;
grant select on table public.free_weekly_workout_assignments to anon, authenticated;
grant select, insert, update, delete on table public.free_weekly_workout_assignments to service_role;

create or replace function public.current_user_has_pro_workout_access()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and public.user_has_pro_access(auth.uid());
$$;

revoke all on function public.current_user_has_pro_workout_access() from public;
grant execute on function public.current_user_has_pro_workout_access() to anon, authenticated, service_role;

drop policy if exists "Users can read admin and own workouts" on public.workouts;
drop policy if exists "Read eligible workouts" on public.workouts;
drop policy if exists "Restrict workout reads to Pro or weekly assignment" on public.workouts;
create policy "Read eligible workouts"
on public.workouts for select to anon, authenticated
using (
  (
    source = 'admin'
    and (
      public.current_user_has_pro_workout_access()
      or exists (
        select 1
        from public.free_weekly_workout_assignments assignment
        where assignment.workout_id = workouts.id
          and assignment.week_start = date_trunc('week', current_date::timestamp)::date
      )
    )
  )
  or (auth.uid() is not null and auth.uid() = user_id)
);

-- Restrictive guard prevents another permissive policy from widening reads.
create policy "Restrict workout reads to Pro or weekly assignment"
on public.workouts as restrictive for select to anon, authenticated
using (
  (
    source = 'admin'
    and (
      public.current_user_has_pro_workout_access()
      or exists (
        select 1
        from public.free_weekly_workout_assignments assignment
        where assignment.workout_id = workouts.id
          and assignment.week_start = date_trunc('week', current_date::timestamp)::date
      )
    )
  )
  or (auth.uid() is not null and auth.uid() = user_id)
);

drop policy if exists "Read current weekly workout assignment" on public.free_weekly_workout_assignments;
create policy "Read current weekly workout assignment"
on public.free_weekly_workout_assignments for select to anon, authenticated
using (week_start = date_trunc('week', current_date::timestamp)::date);

create or replace function public.admin_set_free_weekly_workout(
  p_week_start date,
  p_workout_id uuid
)
returns public.free_weekly_workout_assignments
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  saved_assignment public.free_weekly_workout_assignments;
  current_week_start date := date_trunc('week', current_date::timestamp)::date;
begin
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'Week start must be a Monday.' using errcode = '22023';
  end if;
  if p_week_start < current_week_start then
    raise exception 'Past weeks cannot be rescheduled.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workouts workout
    where workout.id = p_workout_id
      and workout.source = 'admin'
      and workout.user_id is null
  ) then
    raise exception 'Choose an existing Admin workout.' using errcode = '22023';
  end if;

  insert into public.free_weekly_workout_assignments (week_start, workout_id)
  values (p_week_start, p_workout_id)
  on conflict (week_start) do update
    set workout_id = excluded.workout_id
  returning * into saved_assignment;

  return saved_assignment;
end;
$$;

revoke all on function public.admin_set_free_weekly_workout(date, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_free_weekly_workout(date, uuid) to service_role;

comment on table public.free_weekly_workout_assignments is
  'Admin-selected Free workout. One assignment per Monday-starting week; only current week is client-readable.';

commit;
