-- Live RLS audit 2026-11-25 (read-only MCP): two confirmed weaknesses. Forward-only.
--
-- S1 (High) Co-parent calendar cross-account read. The co-parent read policies
--    also matched when the READER's own user_profile.co_parent_id equalled the
--    schedule's co_parent_user_id. Members can update their own co_parent_id, so
--    anyone who knew a co-parent's user id could read that family's schedule and
--    events. The only legitimate link is co_parent_user_id, set by the invite
--    accept API; the owner already reads through the owner policy. Exposure at
--    audit time: 0 linked schedules.
-- S2 (Medium) Anonymous name lookup. get_comment_author_names was executable by
--    anon and fell back to the email local part. Now signed-in only, no email.
--
-- Pre-check (read-only):
--   select policyname, qual from pg_policies where policyname like 'Co-parent can read linked%';
-- Rollback: re-create the two policies with the qual returned by the pre-check,
--   re-run the previous get_comment_author_names definition, and
--   grant execute on function public.get_comment_author_names(uuid[]) to anon;
begin;

drop policy if exists "Co-parent can read linked co_parenting_schedules" on public.co_parenting_schedules;
create policy "Co-parent can read linked co_parenting_schedules" on public.co_parenting_schedules
  for select to authenticated
  using (co_parent_user_id = (select auth.uid()));

drop policy if exists "Co-parent can read linked co_parenting_events" on public.co_parenting_events;
create policy "Co-parent can read linked co_parenting_events" on public.co_parenting_events
  for select to authenticated
  using (exists (
    select 1 from public.co_parenting_schedules s
    where s.id = co_parenting_events.schedule_id and s.co_parent_user_id = (select auth.uid())
  ));

create or replace function public.get_comment_author_names(p_user_ids uuid[])
returns table(user_id uuid, display_name text)
language sql security definer set search_path to 'public' as $function$
  select u.id, coalesce(
    nullif(trim(p.display_name), ''),
    nullif(trim(coalesce(
      u.raw_user_meta_data->>'display_name',
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name'
    )), ''),
    'Dad'
  )
  from auth.users u left join public.user_profile p on p.user_id = u.id
  where u.id = any(p_user_ids);
$function$;
revoke all on function public.get_comment_author_names(uuid[]) from public, anon;
grant execute on function public.get_comment_author_names(uuid[]) to authenticated;

commit;
