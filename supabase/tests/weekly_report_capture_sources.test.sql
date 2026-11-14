-- Network-isolated fixture database only. Every change rolls back.
begin;
do $$
declare uid uuid:='79000000-0000-4000-8000-000000000001';
 wk date; r jsonb; canonical record; item record;
begin
 for wk in select unnest(array['2026-11-16'::date,'2026-11-23'::date]) loop
   for item in select * from (values
     ('mood_logs','date,mood_value,energy_level,connection_level',quote_literal((wk+6)::text)||',4,4,4'),
     ('sleep_logs','date,hours',quote_literal((wk+6)::text)||',7'),
     ('activity_logs','activity_date,pillar,category,duration_minutes',quote_literal((wk+6)::text)||',''mind'',''mindfulness'',10'),
     ('mind_reset_sessions','activity_date,completed_at',quote_literal((wk+6)::text)||','||quote_literal((wk+6)::text||'T12:00Z')),
     ('journal_entries','created_at',quote_literal((wk+6)::text||'T12:00Z')),
     ('workout_sessions','performed_at',quote_literal((wk+6)::text||'T12:00Z')),
     ('body_metrics','recorded_at,metric_type,value',quote_literal((wk+6)::text||'T12:00Z')||',''steps'',5000'),
     ('bond_logs','created_at,quality',quote_literal((wk+6)::text||'T12:00Z')||',4'),
     ('present_dad_sessions','completed_at,status',quote_literal((wk+6)::text||'T12:00Z')||',''completed'''),
     ('co_parenting_schedules','custody_dates','array['||quote_literal((wk+6)::text)||'::date]')
   ) as x(tab,cols,vals) loop
     execute format('insert into public.%I(user_id,%s) values(%L,%s)',item.tab,item.cols,uid,item.vals);
     r:=public.build_weekly_report_candidate(uid,wk,(wk+6)::timestamp at time zone 'UTC'+interval '18 hours');
     if r->>'state'<>'available' then raise exception 'source rejected: % %',item.tab,r; end if;
     select * into canonical from public.calculate_dad_score_period(uid,wk,wk+7,wk::timestamp at time zone 'UTC',(wk+7)::timestamp at time zone 'UTC');
     if (r#>>'{snapshot,pillars,mind,score,value}')::numeric<>canonical.mind_score
       or (r#>>'{snapshot,pillars,body,score,value}')::numeric<>canonical.body_score
       or (r#>>'{snapshot,pillars,bond,score,value}')::numeric<>canonical.bond_score then
       raise exception 'canonical mismatch: %',item.tab;
     end if;
     execute format('delete from public.%I where user_id=%L',item.tab,uid);
   end loop;
 end loop;
 insert into public.workout_sessions(user_id,performed_at) values(uid,'2026-11-29T19:00Z');
 if public.build_weekly_report_candidate(uid,'2026-11-23','2026-11-29T18:00Z')->>'reason'<>'future_contribution' then raise exception 'future accepted'; end if;
 update public.workout_sessions set performed_at='2026-11-29T17:00Z' where user_id=uid;
 if public.build_weekly_report_candidate(uid,'2026-11-23','2026-11-29T18:00Z')->>'state'<>'available' then raise exception 'edited source rejected'; end if;
end $$;
rollback;
