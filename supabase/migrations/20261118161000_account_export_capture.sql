begin;
create table public.account_export_artifacts (
 operation_id uuid primary key references public.account_privacy_operations(id) on delete cascade,
 user_id uuid not null,
 payload jsonb not null,
 created_at timestamptz not null default statement_timestamp(),
 expires_at timestamptz not null default statement_timestamp()+interval '24 hours'
);
alter table public.account_export_artifacts enable row level security;
revoke all on public.account_export_artifacts from public,anon,authenticated;
grant select,delete on public.account_export_artifacts to service_role;

-- A callback can beat the HTTP send response. Retain only message identity and
-- failure classification so either arrival order yields the same result.
create table public.account_privacy_delivery_failures (
 message_id text primary key, failure_type text not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.account_privacy_delivery_failures enable row level security;
revoke all on public.account_privacy_delivery_failures from public,anon,authenticated,service_role;
create function public.record_privacy_email_failure(p_message_id text,p_type text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_type not in ('email.bounced','email.failed','email.complained') or p_message_id is null or length(p_message_id)>200 then raise exception 'Invalid event'; end if;
 perform pg_advisory_xact_lock(hashtextextended('privacy-email:'||p_message_id,0));
 insert into public.account_privacy_delivery_failures(message_id,failure_type) values(p_message_id,p_type) on conflict do nothing;
 update public.account_privacy_operations set state='delivery_failed',failure_code=p_type,updated_at=clock_timestamp()
 where kind='export' and provider_message_id=p_message_id and state='sent_for_delivery';
end $$;
create function public.record_privacy_email_result(p_id uuid,p_lease uuid,p_message_id text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare failure text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('privacy-email:'||p_message_id,0));
 select failure_type into failure from public.account_privacy_delivery_failures where message_id=p_message_id;
 update public.account_privacy_operations set state=case when failure is null then 'sent_for_delivery' else 'delivery_failed' end,
 failure_code=failure,provider_message_id=p_message_id,completed_at=clock_timestamp(),updated_at=clock_timestamp(),lease_token=null,lease_until=null
 where id=p_id and kind='export' and lease_token=p_lease;
 return found;
end $$;
revoke all on function public.record_privacy_email_failure(text,text),public.record_privacy_email_result(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_privacy_email_failure(text,text),public.record_privacy_email_result(uuid,uuid,text) to service_role;

-- STABLE: every source read uses the calling statement's MVCC snapshot.
-- No LIMIT/offset pagination of live owner tables. Paging, if needed, is over
-- the immutable captured artifact only. Explicit keys preserve JSON nulls.
create function public.account_export_dataset(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare spec record; rows jsonb; result jsonb:='{}'; projection text; missing text; ordering text;
begin
 for spec in select * from (values
 ('user_profile',array['id','display_name','timezone','goals','pillar_order','onboarding_complete','push_notifications_enabled','parent_type','pronouns','custody_arrangement','custody_pattern','kids_ages','child_age_band','challenge','current_support','dad_years','notification_times','commitment','created_at','updated_at']),
 ('mood_logs',array['id','date','mood_value','mood_scale_version','stress_level','energy_level','connection_level','created_at']),
 ('sleep_logs',array['id','date','hours','quality','source','created_at']),
 ('journal_entries',array['id','content','mood_value','tag','prompt','created_at']),
 ('activity_logs',array['id','pillar','category','activity_type','other_activity_text','duration_minutes','intensity','contact_day','activity_date','logged_at','backdated_at','notes']),
 ('workout_sessions',array['id','exercise_name','duration_minutes','calories','exercises_completed','performed_at','created_at']),
 ('workout_completions',array['id','workout_id','completed_at']),
 ('workouts',array['id','title','duration_mins','equipment','focus','exercises','source']),
 ('body_metrics',array['id','metric_type','value','weight_kg','recorded_at','source']),
 ('bond_logs',array['id','activity_type','quality','minutes','created_at']),
 ('present_dad_sessions',array['id','started_at','ends_at','status','completed_at','completed_duration_seconds']),
 ('present_dad_preferences',array['user_id','intro_seen_at']),
 ('mind_reset_sessions',array['id','activity_date','active_seconds','completed_at']),
 ('meal_plans',array['id','day','name','kcal','source','plan','grocery_list','preferences','adults','created_at']),
 ('mind_plans',array['id','version','copy_status','variant','actions','created_at','started_on']),
 ('mind_plan_completions',array['action_number','completed_on','completed_at','timezone']),
 ('daily_tasks',array['id','title','category','status','date']),
 ('earned_badges',array['badge_id','earned_at']),
 ('user_saved_recipes',array['recipe_id','saved_at']),
 ('user_streaks',array['streak_count','last_activity_date']),
 ('user_streak_freezes',array['week_start','missed_date']),
 ('weekly_report_snapshots',array['reporting_week_start','delivery_at','captured_at','payload']),
 ('scoring_timezone_history',array['timezone','effective_week_start','effective_at']),
 ('milestones',array['id','date','text','tag','created_at']),
 ('dad_day_searches',array['id','budget','radius','child_age','result_count','searched_at']),
 ('likes',array['id','post_id','created_at']),
 ('comment_likes',array['comment_id','created_at']),
 ('saved_posts',array['id','post_id','created_at']),
 ('user_circles',array['circle_id']),
 ('weekly_challenge_participants',array['challenge_id','joined_at','completed_at']),
 ('notification_preferences',array['notification_type','enabled','send_time']),
 ('notification_inbox_events',array['id','type','created_at','read_at']),
 ('subscription_entitlements',array['provider','product_id','plan','status','current_period_end','trial_end','auto_renews']),
 ('subscription_cancellation_feedback',array['request_id','reason','details','submitted_at']),
 ('user_integrations',array['provider','connected_at'])
 ) as catalogue(table_name,fields)
 loop
  select f into missing from unnest(spec.fields) f where not exists
   (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=spec.table_name and c.column_name=f) limit 1;
  if missing is not null then raise exception 'Export schema mismatch: %.%',spec.table_name,missing using errcode='42703'; end if;
  select string_agg(format('%L,to_jsonb(t)->%L',f,f),',') into projection from unnest(spec.fields) f;
  -- The actual primary key provides unique ordering, even when projected rows
  -- happen to have identical values. Fail closed if the schema lacks a key.
  select string_agg(format('t.%I',a.attname),',' order by k.ordinality) into ordering
   from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum,ordinality)
   join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
   where i.indrelid=format('public.%I',spec.table_name)::regclass and i.indisprimary;
  if ordering is null then raise exception 'Export primary key missing: %',spec.table_name; end if;
  execute format('select coalesce(jsonb_agg(jsonb_build_object(%s) order by %s),''[]''::jsonb)
   from public.%I t where t.user_id=$1',projection,ordering,spec.table_name)
   into rows using p_user_id;
  result:=result||jsonb_build_object(spec.table_name,rows);
 end loop;
 -- Export only saved personal suggestions. Shared admin catalogue rows are excluded.
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'icon',d.icon,'name',d.name,
  'age_range',d.age_range,'budget',d.budget,'duration_minutes',d.duration_minutes,
  'time_of_day',d.time_of_day,'source',d.source,'booking_url',d.booking_url,
  'address',d.address,'requires_booking',d.requires_booking,'description',d.description,'distance_miles',d.distance_miles) order by d.id),'[]')
 into rows from public.dad_dates d where d.user_id=p_user_id and d.source='ai_search';
 result:=result||jsonb_build_object('dad_dates',rows);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'content',p.content,'tag',p.tag,'anonymous',p.anonymous,'created_at',p.created_at) order by p.created_at,p.id),'[]')
 into rows from public.posts p where p.user_id=p_user_id or exists(select 1 from public.anonymous_post_owners a where a.post_id=p.id and a.user_id=p_user_id);
 result:=result||jsonb_build_object('posts',rows);
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'postId',c.post_id,'content',c.content,'createdAt',c.created_at) order by c.created_at,c.id),'[]')
 into rows from public.comments c where c.user_id=p_user_id;
 result:=result||jsonb_build_object('comments',rows);
 -- Shared-calendar notes can belong to the other parent: deliberately excluded.
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'role',case when s.user_id=p_user_id then 'owner' else 'invited_parent' end) order by s.id),'[]')
 into rows from public.co_parenting_schedules s where s.user_id=p_user_id or s.co_parent_user_id=p_user_id;
 result:=result||jsonb_build_object('sharedCalendars',rows);
 select coalesce(jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'path',o.name,'createdAt',o.created_at) order by o.bucket_id,o.name,o.id),'[]')
 into rows from storage.objects o where o.owner_id=p_user_id::text
 or (o.bucket_id in ('profile-photos','milestone-photos') and split_part(o.name,'/',1)=p_user_id::text);
 return jsonb_build_object('formatVersion',1,'generatedAt',statement_timestamp(),
 'fieldExplanations',jsonb_build_object('null','No saved value','scores','Saved reports are immutable snapshots; no current scores are recalculated.',
 'photos','Manifest only; image files are not included.','drafts','Unsynced device-only drafts are not included.',
 'sharedCalendars','Only your association is included; shared notes and the other parent''s private information are excluded.'),
 'sections',result||jsonb_build_object('photoManifest',rows));
end $$;

create function public.capture_account_export(p_id uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.account_privacy_operations;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into o from public.account_privacy_operations where id=p_id;
 if not found then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('account-privacy:'||o.user_id::text,0));
 select * into o from public.account_privacy_operations where id=p_id for update;
 if o.kind<>'export' or o.state<>'processing' or o.lease_token is distinct from p_lease or o.lease_until<=clock_timestamp()
 or exists(select 1 from public.account_deletion_tombstones where user_id=o.user_id) then return false; end if;
 if o.export_captured_at is not null then
  if exists(select 1 from public.account_export_artifacts where operation_id=o.id and expires_at>clock_timestamp()) then return true; end if;
  raise exception 'Captured export expired' using errcode='22023';
 end if;
 insert into public.account_export_artifacts(operation_id,user_id,payload)
 select o.id,o.user_id,public.account_export_dataset(o.user_id) on conflict(operation_id) do nothing;
 update public.account_privacy_operations set export_captured_at=clock_timestamp() where id=o.id;
 return true;
end $$;

create function public.authorize_account_export_send(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.account_privacy_operations; destination text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into o from public.account_privacy_operations where id=p_id;
 if not found then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended('account-privacy:'||o.user_id::text,0));
 select * into o from public.account_privacy_operations where id=p_id for update;
 if o.state<>'processing' or o.lease_token is distinct from p_lease or o.lease_until<=clock_timestamp()
 or exists(select 1 from public.account_deletion_tombstones where user_id=o.user_id)
 or not exists(select 1 from public.account_export_artifacts where operation_id=o.id and expires_at>clock_timestamp()) then return null; end if;
 select email into destination from auth.users where id=o.user_id and email_confirmed_at is not null for share;
 if destination is null or destination is distinct from o.destination then
  if o.handoff_at is not null then
   -- An uncertain prior handoff must never be retargeted or resubmitted with
   -- changed parameters. Its original destination and idempotency key remain
   -- intact for provider reconciliation; a negative lookup is not proof of no send.
   update public.account_privacy_operations set state='failed',failure_code='delivery_reconciliation_required',
    completed_at=clock_timestamp(),lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=o.id;
   return null;
  end if;
  update public.account_privacy_operations set state='reconfirmation_required',lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=o.id;
  delete from public.account_privacy_confirmations where operation_id=o.id;
  return null;
 end if;
 -- Durable boundary: an authorized in-flight send may still arrive after deletion.
 update public.account_privacy_operations set handoff_at=coalesce(handoff_at,clock_timestamp()) where id=o.id;
 return jsonb_build_object('destination',destination,'handoffAt',coalesce(o.handoff_at,clock_timestamp()));
end $$;
revoke all on function public.account_export_dataset(uuid) from public,anon,authenticated,service_role;
revoke all on function public.capture_account_export(uuid,uuid),public.authorize_account_export_send(uuid,uuid) from public,anon,authenticated;
grant execute on function public.capture_account_export(uuid,uuid),public.authorize_account_export_send(uuid,uuid) to service_role;
create function public.read_account_export(p_id uuid,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||p_user_id::text,0));
 if exists(select 1 from public.account_deletion_tombstones where user_id=p_user_id) then return null; end if;
 select payload into result from public.account_export_artifacts where operation_id=p_id and user_id=p_user_id and expires_at>clock_timestamp();
 return result;
end $$;
revoke all on function public.read_account_export(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_account_export(uuid,uuid) to service_role;
-- Bounded transport over the immutable artifact. Every chunk independently
-- checks owner, expiry and the deletion barrier; no bearer/public download URL.
create function public.read_account_export_chunk(p_id uuid,p_user_id uuid,p_offset integer default 0,p_limit integer default 65536)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_offset<0 or p_limit<0 or p_limit>65536 then raise exception 'Invalid chunk' using errcode='22023'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||p_user_id::text,0));
 if exists(select 1 from public.account_deletion_tombstones where user_id=p_user_id) then return null; end if;
 select jsonb_build_object('text',substring(payload::text from p_offset+1 for p_limit),
  'length',length(payload::text),'bytes',octet_length(payload::text),'expiresAt',expires_at)
 into result from public.account_export_artifacts
 where operation_id=p_id and user_id=p_user_id and expires_at>clock_timestamp();
 return result;
end $$;
revoke all on function public.read_account_export_chunk(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.read_account_export_chunk(uuid,uuid,integer,integer) to service_role;
commit;
