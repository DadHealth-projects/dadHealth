-- No scoring changes, history rewrites, retention or new source precedence.
begin;
create function public.write_health_daily_totals(
 p_connection_id uuid,p_metrics jsonb,p_sleep jsonb,p_complete boolean default false
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare connection public.user_integrations; owner_id uuid; metrics_written int; sleep_written int;
 sleep_cleared int; synced_at timestamptz;
begin
 select user_id into owner_id from public.user_integrations where id=p_connection_id;
 if owner_id is null then raise exception 'integration_not_connected' using errcode='42501'; end if;
 if coalesce(auth.role(),'')<>'service_role' and auth.uid() is distinct from owner_id then
   raise exception 'Not authorised' using errcode='42501';
 end if;
 -- Same lock ordering as account privacy: privacy lock before connection lock.
 perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||owner_id::text,0));
 if not public.privacy_current_account_available() and coalesce(auth.role(),'')<>'service_role' then
   raise exception 'Account unavailable' using errcode='42501';
 end if;
 select * into connection from public.user_integrations where id=p_connection_id and user_id=owner_id for update;
 if not found then raise exception 'integration_not_connected' using errcode='42501'; end if;
 if coalesce(auth.role(),'')<>'service_role' and connection.provider not in ('apple_health','health_connect') then
   raise exception 'Not authorised' using errcode='42501';
 end if;
 if jsonb_typeof(p_metrics) is distinct from 'array' or jsonb_typeof(p_sleep) is distinct from 'array'
   or jsonb_array_length(p_metrics)>100 or jsonb_array_length(p_sleep)>40 then
   raise exception 'Invalid health totals' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_to_recordset(p_metrics) as m(metric_type text,value numeric,recorded_at timestamptz)
   where m.metric_type is null or m.metric_type not in ('steps','active_mins','resting_hr')
   or (m.metric_type='resting_hr' and connection.provider in ('apple_health','health_connect'))
   or m.value is null or m.value<0 or m.value::text in ('NaN','Infinity','-Infinity') or m.recorded_at is null)
 or exists(select 1 from jsonb_to_recordset(p_sleep) as s(date date,hours numeric)
   where s.date is null or s.hours is null or s.hours<0 or s.hours>24 or s.hours::text in ('NaN','Infinity','-Infinity')) then
   raise exception 'Invalid health totals' using errcode='22023';
 end if;
 with written as (
  insert into public.body_metrics(user_id,metric_type,value,recorded_at,source)
  select owner_id,m.metric_type,m.value,m.recorded_at,connection.provider
  from jsonb_to_recordset(p_metrics) as m(metric_type text,value numeric,recorded_at timestamptz)
  where not exists(select 1 from public.body_metrics b where b.user_id=owner_id
    and b.metric_type=m.metric_type and b.recorded_at::date=m.recorded_at::date and b.source='manual')
  on conflict(user_id,metric_type,recorded_at) do update set value=excluded.value,source=excluded.source
  where body_metrics.source<>'manual' returning 1
 ) select count(*) into metrics_written from written;
 with written as (
  insert into public.sleep_logs(user_id,date,hours,source)
  select owner_id,s.date,s.hours,connection.provider
  from jsonb_to_recordset(p_sleep) as s(date date,hours numeric) where s.hours>0
  on conflict(user_id,date) do update set hours=excluded.hours,source=excluded.source
  where sleep_logs.source<>'manual' returning 1
 ) select count(*) into sleep_written from written;
 with cleared as (
  delete from public.sleep_logs b using jsonb_to_recordset(p_sleep) as s(date date,hours numeric)
  where s.hours=0 and b.user_id=owner_id and b.date=s.date and b.source=connection.provider returning 1
 ) select count(*) into sleep_cleared from cleared;
 if p_complete then
  synced_at:=clock_timestamp();
  update public.user_integrations set last_sync_at=synced_at where id=p_connection_id;
 end if;
 return jsonb_build_object('metrics_written',metrics_written,'sleep_written',sleep_written,
   'sleep_cleared',sleep_cleared,'synced_at',synced_at);
end $$;
revoke all on function public.write_health_daily_totals(uuid,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.write_health_daily_totals(uuid,jsonb,jsonb,boolean) to authenticated,service_role;

create function public.sync_native_health_daily_data(p_provider text,p_connection_id uuid,
 p_metrics jsonb default '[]',p_sleep jsonb default '[]',p_complete boolean default false)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or p_provider not in ('apple_health','health_connect') or p_provider is null
   or not exists(select 1 from public.user_integrations where id=p_connection_id
     and user_id=auth.uid() and provider=p_provider) then
   raise exception 'integration_not_connected' using errcode='42501';
 end if;
 return public.write_health_daily_totals(p_connection_id,p_metrics,p_sleep,p_complete);
end $$;
revoke all on function public.sync_native_health_daily_data(text,uuid,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.sync_native_health_daily_data(text,uuid,jsonb,jsonb,boolean) to authenticated;

-- Old builds keep their API, now with the same serialization and manual protection.
create or replace function public.upsert_apple_health_daily_data(p_metrics jsonb default '[]',p_sleep jsonb default '[]')
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare connection_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select id into connection_id from public.user_integrations where user_id=auth.uid() and provider='apple_health';
 return public.sync_native_health_daily_data('apple_health',connection_id,p_metrics,p_sleep,false);
end $$;
create or replace function public.upsert_health_connect_daily_data(p_metrics jsonb default '[]',p_sleep jsonb default '[]')
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare connection_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select id into connection_id from public.user_integrations where user_id=auth.uid() and provider='health_connect';
 return public.sync_native_health_daily_data('health_connect',connection_id,p_metrics,p_sleep,false);
end $$;
revoke all on function public.upsert_apple_health_daily_data(jsonb,jsonb),public.upsert_health_connect_daily_data(jsonb,jsonb) from public,anon;
grant execute on function public.upsert_apple_health_daily_data(jsonb,jsonb),public.upsert_health_connect_daily_data(jsonb,jsonb) to authenticated;
commit;
