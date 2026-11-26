-- Disposable PostgreSQL fixture only. Never run against an application database.
-- Models affected tables/roles; net is a permission fixture, not installed pg_net.
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema net;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select current_user::text$$;
grant usage on schema auth to public;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
create table public.user_profile(user_id uuid primary key,display_name text);
create table public.user_integrations(id uuid primary key,user_id uuid references auth.users on delete cascade,provider text,last_sync_at timestamptz);
create table public.body_metrics(user_id uuid references auth.users on delete cascade,metric_type text,value numeric,recorded_at timestamptz,source text,unique(user_id,metric_type,recorded_at));
create table public.sleep_logs(user_id uuid references auth.users on delete cascade,date date,hours numeric,source text default 'manual',unique(user_id,date));
create table public.daily_tasks(user_id uuid,title text,date date,status text,unique(user_id,title,date));
create table public.mood_logs(user_id uuid,date date,mood_value int,unique(user_id,date));
create table public.posts(id uuid,user_id uuid,anonymous boolean,removed_at timestamptz,visible boolean);
create table public.comments(id uuid,user_id uuid,removed_at timestamptz,visible boolean,anonymous boolean default false);
create function public.can_read_community_post(uuid) returns boolean language sql stable security definer as $$select coalesce((select visible from public.posts where id=$1),false)$$;
create function public.can_read_community_comment(uuid) returns boolean language sql stable security definer as $$select coalesce((select visible from public.comments where id=$1),false)$$;
create function public.can_save_recipe(uuid) returns boolean language sql as $$select auth.uid() is not null$$;
create function public.update_streak(uuid) returns void language sql as $$select$$;
create function public.privacy_current_account_available() returns boolean language sql as $$select true$$;
do $$declare t text; begin
 foreach t in array array['circle_prompts','comment_likes','likes','recipes','saved_posts','user_saved_recipes','workouts'] loop
  execute format('create table public.%I(id uuid)',t);
 end loop;
 foreach t in array array['user_integrations','body_metrics','sleep_logs','daily_tasks','mood_logs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy owner on public.%I to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid())',t);
 end loop;
end $$;
grant all on all tables in schema public to public;
create table net.http_request_queue(id bigint generated always as identity,url text);
create function net.http_post(text) returns bigint language sql as $$insert into net.http_request_queue(url) values($1) returning id$$;
grant usage on schema net to public;
grant all on all tables in schema net to public;
grant all on all sequences in schema net to public;
do $$declare n text; begin
 foreach n in array array['invoke_analytics_worker','invoke_moderation_worker','invoke_notification_dispatch','invoke_notification_event','invoke_privacy_worker','invoke_wearable_sync'] loop
  execute format('create function public.%I() returns bigint language sql security definer set search_path=pg_catalog,public as %L',n,'select net.http_post(''fixture'')');
  execute format('revoke all on function public.%I() from public,anon,authenticated',n);
 end loop;
end $$;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into public.user_integrations values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','apple_health',null);
create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end$$;
