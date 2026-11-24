-- Milestone 3 brief 07: the nine badges, awarded only by the server.
-- Forward-only. Prospective: members earn badges from their next qualifying
-- action. A separate, approved backfill can award past activity.
--  * badges.award_key gives each catalogue badge a stable identity. Existing
--    rows with a matching name are keyed in place, never duplicated.
--  * earned_badges becomes read-only for members (security finding F7): rows
--    are written only by the award triggers below.
--  * An award never blocks the check-in, log or session that triggered it.
-- Pre-check (read-only): select id,name,icon from public.badges order by name;
-- Rollback: drop the triggers and functions named here, restore the earlier
-- "Users can CRUD own earned_badges" policy and grants, and keep award_key
-- (an unused nullable column is harmless).
begin;

alter table public.badges add column if not exists award_key text;
create unique index if not exists badges_award_key_unique on public.badges(award_key) where award_key is not null;

with catalogue(award_key,name,icon,sort_order) as (values
  ('first_checkin','First check-in','✅',1),
  ('streak_7','7-day streak','🔥',2),
  ('streak_14','14-day streak','💪',3),
  ('streak_30','30-day streak','🏆',4),
  ('first_workout','First workout','🏋️',5),
  ('first_bond_log','First Bond log','🤝',6),
  ('first_present_dad','First Present Dad session','📵',7),
  ('first_cook_together','First Cook Together','🍳',8),
  ('first_mini_partners','First Mini Partners session','🧒',9)
), keyed as (
  update public.badges b set award_key=c.award_key
  from catalogue c
  where b.award_key is null and lower(trim(b.name))=lower(c.name)
    and not exists(select 1 from public.badges other where other.award_key=c.award_key)
  returning b.award_key
)
insert into public.badges(award_key,name,icon)
select c.award_key,c.name,c.icon from catalogue c
where not exists(select 1 from public.badges b where b.award_key=c.award_key)
  and not exists(select 1 from keyed k where k.award_key=c.award_key)
order by c.sort_order;

-- Members read only their own earned badges; the catalogue stays readable.
alter table public.earned_badges enable row level security;
drop policy if exists "Users can CRUD own earned_badges" on public.earned_badges;
drop policy if exists earned_badges_read_own on public.earned_badges;
create policy earned_badges_read_own on public.earned_badges for select to authenticated
  using (user_id=(select auth.uid()));
revoke insert,update,delete,truncate on public.earned_badges from public,anon,authenticated;
grant select on public.earned_badges to authenticated;
grant all on public.earned_badges to service_role;

create or replace function public.award_badge(p_user_id uuid,p_award_key text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare badge uuid;
begin
  if p_user_id is null then return; end if;
  select id into badge from public.badges where award_key=p_award_key;
  if badge is null then return; end if;
  insert into public.earned_badges(user_id,badge_id) values(p_user_id,badge)
    on conflict(user_id,badge_id) do nothing;
exception when others then
  -- Never fail the member's own action because of a badge.
  raise warning 'badge award skipped: % (%)',p_award_key,sqlstate;
end $$;
revoke all on function public.award_badge(uuid,text) from public,anon,authenticated;
grant execute on function public.award_badge(uuid,text) to service_role;

create or replace function public.award_badges_from_activity()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if tg_table_name='mood_logs' then
    perform public.award_badge(new.user_id,'first_checkin');
  elsif tg_table_name='user_streaks' then
    if coalesce(new.streak_count,0)>=7 then perform public.award_badge(new.user_id,'streak_7'); end if;
    if coalesce(new.streak_count,0)>=14 then perform public.award_badge(new.user_id,'streak_14'); end if;
    if coalesce(new.streak_count,0)>=30 then perform public.award_badge(new.user_id,'streak_30'); end if;
  elsif tg_table_name='workout_sessions' then
    perform public.award_badge(new.user_id,'first_workout');
  elsif tg_table_name='activity_logs' then
    if new.pillar='body' then perform public.award_badge(new.user_id,'first_workout'); end if;
    if new.pillar='bond' then perform public.award_badge(new.user_id,'first_bond_log'); end if;
    if new.pillar='bond' and new.activity_type='mini_partners' then
      perform public.award_badge(new.user_id,'first_mini_partners'); end if;
  elsif tg_table_name='bond_logs' then
    if new.activity_type='cook_together_recipe' then
      perform public.award_badge(new.user_id,'first_cook_together');
    else
      perform public.award_badge(new.user_id,'first_bond_log');
    end if;
  elsif tg_table_name='present_dad_sessions' then
    if new.status='completed' and (tg_op='INSERT' or old.status is distinct from 'completed') then
      perform public.award_badge(new.user_id,'first_present_dad');
    end if;
  end if;
  return null;
end $$;
revoke all on function public.award_badges_from_activity() from public,anon,authenticated;

drop trigger if exists award_badges on public.mood_logs;
create trigger award_badges after insert on public.mood_logs
  for each row execute function public.award_badges_from_activity();
drop trigger if exists award_badges on public.user_streaks;
create trigger award_badges after insert or update of streak_count on public.user_streaks
  for each row when (coalesce(new.streak_count,0)>=7) execute function public.award_badges_from_activity();
drop trigger if exists award_badges on public.workout_sessions;
create trigger award_badges after insert on public.workout_sessions
  for each row execute function public.award_badges_from_activity();
drop trigger if exists award_badges on public.activity_logs;
create trigger award_badges after insert on public.activity_logs
  for each row when (new.pillar in ('body','bond')) execute function public.award_badges_from_activity();
drop trigger if exists award_badges on public.bond_logs;
create trigger award_badges after insert on public.bond_logs
  for each row execute function public.award_badges_from_activity();
drop trigger if exists award_badges on public.present_dad_sessions;
create trigger award_badges after insert or update of status on public.present_dad_sessions
  for each row when (new.status='completed') execute function public.award_badges_from_activity();

commit;
