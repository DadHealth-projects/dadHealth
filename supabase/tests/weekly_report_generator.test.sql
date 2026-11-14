-- Isolated database only; run as migration owner. No production execution.
-- Requires complete canonical schema and both candidate migrations.
begin;
insert into auth.users(id) values('79000000-0000-4000-8000-000000000002');
insert into public.user_profile(user_id,timezone,created_at)
values('79000000-0000-4000-8000-000000000002','UTC','1990-01-01');
do $$
declare a jsonb; b jsonb;
begin
 a:=public.capture_weekly_report_candidate('79000000-0000-4000-8000-000000000002','2000-01-03');
 if a->>'state'<>'available' then raise exception 'capture failed: %',a; end if;
 b:=public.capture_weekly_report_candidate('79000000-0000-4000-8000-000000000002','2000-01-03');
 if a is distinct from b then raise exception 'retry changed immutable report'; end if;
 if (select count(*) from public.weekly_report_snapshots where user_id='79000000-0000-4000-8000-000000000002')<>1 then
   raise exception 'duplicate publication';
 end if;
 if has_function_privilege('service_role','public.capture_weekly_report_candidate(uuid,date)','EXECUTE') then
   raise exception 'candidate publication permission exposed';
 end if;
 begin
   perform public.capture_weekly_report_candidate('79000000-0000-4000-8000-000000000002','2000-01-10');
   raise exception 'synthetic failure' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;
 end;
 if exists(select 1 from public.weekly_report_snapshots where user_id='79000000-0000-4000-8000-000000000002' and reporting_week_start='2000-01-10') then
   raise exception 'failed transaction left report';
 end if;
end $$;
rollback;
