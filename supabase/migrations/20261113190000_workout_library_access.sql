-- Explicit library access. Existing workouts stay Pro; weekly access is independent.
begin;
alter table public.workouts
  add column if not exists access_level text not null default 'pro';
alter table public.workouts drop constraint if exists workouts_access_level_check;
alter table public.workouts add constraint workouts_access_level_check
  check (access_level in ('free', 'pro') and (source = 'admin' or access_level = 'pro'));

-- Preserve both restrictive and permissive guards, weekly access and owned AI rules.
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
      or (auth.uid() is not null and access_level = 'free')
      or exists (
        select 1 from public.free_weekly_workout_assignments assignment
        where assignment.workout_id = workouts.id
          and assignment.week_start = date_trunc('week', current_date::timestamp)::date
      )
    )
  )
  or (
    source = 'ai_generated'
    and auth.uid() is not null
    and auth.uid() = user_id
    and public.current_user_has_pro_access()
  )
);
create policy "Restrict workout reads to Pro or weekly assignment"
on public.workouts as restrictive for select to anon, authenticated
using (
  (
    source = 'admin'
    and (
      public.current_user_has_pro_workout_access()
      or (auth.uid() is not null and access_level = 'free')
      or exists (
        select 1 from public.free_weekly_workout_assignments assignment
        where assignment.workout_id = workouts.id
          and assignment.week_start = date_trunc('week', current_date::timestamp)::date
      )
    )
  )
  or (
    source = 'ai_generated'
    and auth.uid() is not null
    and auth.uid() = user_id
    and public.current_user_has_pro_access()
  )
);

commit;
