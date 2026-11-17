begin;

create or replace function public.guard_notification_inbox()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
 if (to_jsonb(new) - 'read_at')
      is distinct from (to_jsonb(old) - 'read_at')
    or (
      old.read_at is not null
      and new.read_at is not null
      and new.read_at is distinct from old.read_at
    )
 then
  raise exception 'Inbox content is immutable' using errcode = '42501';
 end if;

 return new;
end;
$$;

create or replace function public.notification_inbox(
 p_action text default 'list',
 p_id uuid default null,
 p_before_at timestamptz default null,
 p_before_id uuid default null,
 p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
 owner uuid := auth.uid();
 at_time timestamptz;
 rows jsonb;
 total integer;
 event jsonb;
 today date;
begin
 if owner is null then
  raise exception 'Sign in required' using errcode = '42501';
 end if;

 if p_action is null
    or p_action not in ('list','get','read','read_all','unread_all','count')
    or p_limit is null
    or p_limit not between 1 and 50
    or ((p_before_at is null) <> (p_before_id is null))
    or (p_before_at is not null and not isfinite(p_before_at))
    or (p_action in ('get','read') and p_id is null)
    or (p_action in ('read_all','unread_all') and p_id is not null)
 then
  raise exception 'Invalid inbox request' using errcode = '22023';
 end if;

 if p_action in ('read','read_all','unread_all') then
  perform pg_advisory_xact_lock(hashtextextended(owner::text, 0));
  at_time := clock_timestamp();

  if p_action = 'read' and not exists (
   select 1 from public.notification_inbox_events
   where id = p_id and user_id = owner
  ) then
   raise exception 'Update unavailable' using errcode = 'P0002';
  end if;

  if p_action = 'unread_all' then
   update public.notification_inbox_events
   set read_at = null
   where user_id = owner
     and read_at is not null
     and created_at <= at_time;
  else
   update public.notification_inbox_events
   set read_at = at_time
   where user_id = owner
     and read_at is null
     and created_at <= at_time
     and (p_action = 'read_all' or id = p_id);
  end if;
 end if;

 at_time := coalesce(at_time, clock_timestamp());
 today := public.scoring_date_at(owner, at_time);

 with page as (
  select e.*,
   case
    when public.scoring_date_at(owner, e.created_at) = today then 'Today'
    when public.scoring_date_at(owner, e.created_at) = today - 1 then 'Yesterday'
    else 'Earlier'
   end as day_group
  from public.notification_inbox_events e
  where e.user_id = owner
    and (
     p_before_at is null
     or (e.created_at, e.id) < (p_before_at, p_before_id)
    )
  order by e.created_at desc, e.id desc
  limit p_limit
 )
 select
  coalesce((
   select jsonb_agg(to_jsonb(page) order by created_at desc, id desc)
   from page
  ), '[]'::jsonb),
  (
   select count(*) from public.notification_inbox_events
   where user_id = owner and read_at is null
  ),
  (
   select to_jsonb(e) from public.notification_inbox_events e
   where user_id = owner and id = p_id
  )
 into rows, total, event;

 return jsonb_build_object(
  'items', case when p_action = 'list' then rows else '[]'::jsonb end,
  'unreadCount', total,
  'event', event,
  'cutoff', at_time,
  'timezone', public.scoring_timezone_at(owner, at_time),
  'today', today
 );
end;
$$;

commit;