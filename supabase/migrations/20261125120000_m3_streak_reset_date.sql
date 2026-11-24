-- Milestone 3 brief 02: Free dads who miss a day see a calm reset message.
-- The server now says when a running streak was last reset ("resetOn"), so the
-- app never guesses. Additive only: counting, freezes, receipts, activation and
-- history are unchanged. The value fills in at the next reconciliation.
-- Rollback: re-run build_checkin_streak and apply_checkin_streak from
-- 20261114130000_checkin_streak_reconciliation.sql and read_checkin_streak_status
-- from 20261114140000_item02_delivery_integration.sql; the nullable column can stay.
begin;

alter table public.streak_reconciliation_state add column if not exists last_reset_date date;

create or replace function public.build_checkin_streak(uid uuid, observed timestamptz)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare s public.streak_reconciliation_state%rowtype; day date; today date; ending timestamptz;
  n integer; last_day date; through_day date; protected date[]; week date; eligible boolean;
  reset_day date;
begin
  select * into s from public.streak_reconciliation_state where user_id=uid;
  if not found then return jsonb_build_object('state','pending','reason','activation_missing'); end if;
  n:=s.baseline_count; last_day:=s.baseline_last_date;
  select coalesce(array_agg(missed_date order by missed_date),'{}'::date[]) into protected
    from public.user_streak_freezes where user_id=uid and missed_date<s.start_date;
  if observed<s.activation_at then
    return jsonb_build_object('state','scheduled','count',n,'lastDate',last_day,'through',null,'protected',protected);
  end if;
  if last_day>=s.start_date then
    return jsonb_build_object('state','pending','reason','baseline_date_conflict','count',n,
      'lastDate',last_day,'through',null,'protected',protected,'pendingDate',s.start_date);
  end if;
  today:=public.scoring_date_at(uid,observed);
  through_day:=s.start_date-1;
  for day in select generate_series(s.start_date::timestamp,today::timestamp,interval '1 day')::date loop
    ending:=public.streak_day_end(uid,day);
    if exists(select 1 from public.mood_logs m join public.streak_checkin_receipts r
      on r.user_id=m.user_id and r.checkin_date=m.date
      where m.user_id=uid and m.date=day and r.received_at<=observed
        and r.received_at<=ending+interval '48 hours') then
      n:=n+1; last_day:=day;
    elsif ending<=observed then
      eligible:=public.streak_access_at(uid,ending);
      if eligible is null then
        return jsonb_build_object('state','pending','reason','eligibility_unknown','count',n,
          'lastDate',last_day,'through',through_day,'protected',protected,'pendingDate',day);
      end if;
      week:=date_trunc('week',day)::date;
      if n>0 and eligible and not exists(select 1 from unnest(protected) d where d>=week and d<week+7) then
        protected:=array_append(protected,day);
      else
        -- Record when a running streak was reset; counting is unchanged.
        if n>0 then reset_day:=day; end if;
        n:=0;
      end if;
    end if;
    if ending<=observed then through_day:=day; end if;
  end loop;
  return jsonb_build_object('state','current','count',n,'lastDate',last_day,'through',through_day,'protected',protected,'resetOn',reset_day);
end;
$$;

create or replace function public.apply_checkin_streak(uid uuid, observed timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare s public.streak_reconciliation_state%rowtype; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('streak:'||uid::text,0));
  select * into s from public.streak_reconciliation_state where user_id=uid for update;
  if not found then return jsonb_build_object('state','pending','reason','activation_missing'); end if;
  result:=public.build_checkin_streak(uid,observed);
  if result->>'state'='scheduled' then return result; end if;
  -- Unknown results do not overwrite established outputs or consume protection.
  if result->>'state'='current' then
    delete from public.user_streak_freezes where user_id=uid and missed_date>=s.start_date
      and not exists(select 1 from jsonb_array_elements_text(result->'protected') d where d::date=missed_date);
    insert into public.user_streak_freezes(user_id,week_start,missed_date)
      select uid,date_trunc('week',d::date)::date,d::date
      from jsonb_array_elements_text(result->'protected') d where d::date>=s.start_date
      on conflict(user_id,week_start) do nothing;
    insert into public.user_streaks(user_id,streak_count,last_activity_date,updated_at)
      values(uid,(result->>'count')::integer,(result->>'lastDate')::date,clock_timestamp())
      on conflict(user_id) do update set streak_count=excluded.streak_count,
        last_activity_date=excluded.last_activity_date,updated_at=excluded.updated_at;
  end if;
  update public.streak_reconciliation_state set baseline_closed=true,state=result->>'state',
    pending_date=(result->>'pendingDate')::date,reconciled_through=(result->>'through')::date,observed_at=observed,
    last_reset_date=case when result->>'state'='current' then (result->>'resetOn')::date else last_reset_date end
    where user_id=uid;
  return result;
end;
$$;

create or replace function public.read_checkin_streak_status(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb; today date; monday date;
begin
  result:=public.read_checkin_streak_status_before_item02(p_user_id); -- retains owner check
  today:=public.scoring_date_at(p_user_id,statement_timestamp());
  monday:=date_trunc('week',today)::date;
  return result||jsonb_build_object('currentDate',today,'weekStart',monday,
    'calendarDays',(select jsonb_agg(monday+n order by n) from generate_series(0,6) n),
    'resetOn',case when result->>'state'='current'
      then (select s.last_reset_date from public.streak_reconciliation_state s where s.user_id=p_user_id) end);
end $$;
revoke all on function public.read_checkin_streak_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_checkin_streak_status(uuid) to authenticated,service_role;

commit;
