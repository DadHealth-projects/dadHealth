-- Forward-only. Guest reads and existing authenticated CRUD remain intact.
-- Does not change RLS policies, scheduler roles/schedules or extension placement.
begin;

do $$
declare t text; r text; privilege text; guest_read boolean;
begin
  foreach t in array array['circle_prompts','comment_likes','comments','likes','posts',
    'recipes','saved_posts','user_saved_recipes','workouts'] loop
    guest_read := has_table_privilege('anon', 'public.' || t, 'SELECT');
    -- Preserve effective CRUD even when it previously came from PUBLIC.
    foreach r in array array['authenticated','service_role'] loop
      foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE'] loop
        if has_table_privilege(r,'public.' || t,privilege) then
          execute format('grant %s on table public.%I to %I',privilege,t,r);
        end if;
      end loop;
    end loop;
    execute format('revoke all privileges on table public.%I from public, anon',t);
    if guest_read then execute format('grant select on table public.%I to anon',t); end if;
  end loop;
end $$;

-- Keep the other five helpers: guest recipe/community/workout policies use them,
-- including nested dependencies. No new grants or permissive policies are added.
revoke execute on function public.can_save_recipe(uuid) from public, anon;

create or replace function public.complete_task(p_user_id uuid,p_title text)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role'
    and (auth.uid() is null or auth.uid() is distinct from p_user_id) then
    raise exception 'Not authorised' using errcode='42501';
  end if;
  insert into public.daily_tasks(user_id,title,date,status)
    values(p_user_id,p_title,current_date,'done')
    on conflict(user_id,title,date) do update set status='done';
end $$;
revoke execute on function public.complete_task(uuid,text) from public,anon;
grant execute on function public.complete_task(uuid,text) to authenticated,service_role;

create or replace function public.handle_daily_checkin(p_user_id uuid,p_mood int,p_sleep numeric)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role'
    and (auth.uid() is null or auth.uid() is distinct from p_user_id) then
    raise exception 'Not authorised' using errcode='42501';
  end if;
  insert into public.mood_logs(user_id,date,mood_value) values(p_user_id,current_date,p_mood)
    on conflict(user_id,date) do update set mood_value=excluded.mood_value;
  insert into public.sleep_logs(user_id,date,hours) values(p_user_id,current_date,p_sleep)
    on conflict(user_id,date) do update set hours=excluded.hours;
  perform public.update_streak(p_user_id);
end $$;
revoke execute on function public.handle_daily_checkin(uuid,integer,numeric) from public,anon;
grant execute on function public.handle_daily_checkin(uuid,integer,numeric) to authenticated,service_role;

create or replace function public.get_comment_author_names(p_user_ids uuid[])
returns table(user_id uuid,display_name text)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null then raise exception 'Not authorised' using errcode='42501'; end if;
  if p_user_ids is null or cardinality(p_user_ids)>200 then
    raise exception 'Invalid author request' using errcode='22023';
  end if;
  return query
  select u.id,coalesce(nullif(btrim(p.display_name),''),
    nullif(btrim(coalesce(u.raw_user_meta_data->>'display_name',
      u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name')),''),'Dad')
  from auth.users u left join public.user_profile p on p.user_id=u.id
  where u.id=any(p_user_ids) and (
    exists(select 1 from public.comments c where c.user_id=u.id and c.removed_at is null
      and c.anonymous is not true
      and public.can_read_community_comment(c.id))
    or exists(select 1 from public.posts post where post.user_id=u.id
      and post.anonymous is not true and post.removed_at is null
      and public.can_read_community_post(post.id))
  );
end $$;
revoke all on function public.get_comment_author_names(uuid[]) from public,anon;
grant execute on function public.get_comment_author_names(uuid[]) to authenticated;

-- All six approved wrappers execute as postgres. No direct net access is needed
-- by anon/authenticated. Extension upgrades must be followed by an ACL check.
do $$
begin
  if exists(select 1 from pg_namespace where nspname='net') then
    revoke usage on schema net from public,anon,authenticated;
    revoke all privileges on all tables in schema net from public,anon,authenticated;
    revoke all privileges on all sequences in schema net from public,anon,authenticated;
    revoke execute on all functions in schema net from public,anon,authenticated;
  end if;
end $$;
commit;
