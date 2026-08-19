begin;

alter table public.notification_delivery_claims
add column if not exists event_key text;

update public.notification_delivery_claims
set event_key = 'scheduled'
where event_key is null or btrim(event_key) = '';

alter table public.notification_delivery_claims
alter column event_key set default 'scheduled';

alter table public.notification_delivery_claims
alter column event_key set not null;

alter table public.notification_delivery_claims
drop constraint if exists notification_delivery_claims_user_id_type_local_day_key;

create unique index if not exists idx_notification_delivery_claims_identity
on public.notification_delivery_claims(user_id, type, local_day, event_key);

create or replace function public.claim_notification_delivery(
  p_user_id uuid,
  p_type text,
  p_timezone text,
  p_event_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  time_zone text := coalesce(nullif(p_timezone, ''), 'UTC');
  claim_event_key text := coalesce(nullif(btrim(p_event_key), ''), 'scheduled');
  claim_local_day date;
  existing_claim record;
  reserved_today int;
  legacy_sent_today int;
  claim_id uuid;
begin
  begin
    claim_local_day := (now() at time zone time_zone)::date;
  exception when invalid_parameter_value then
    time_zone := 'UTC';
    claim_local_day := (now() at time zone time_zone)::date;
  end;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select id, completed_at into existing_claim
  from public.notification_delivery_claims
  where user_id = p_user_id
    and type = p_type
    and notification_delivery_claims.local_day = claim_local_day
    and notification_delivery_claims.event_key = claim_event_key;

  if found then
    if existing_claim.completed_at is not null then return null; end if;
    return existing_claim.id;
  end if;

  select count(*) into reserved_today
  from public.notification_delivery_claims c
  where c.user_id = p_user_id and c.local_day = claim_local_day;

  select count(*) into legacy_sent_today
  from public.notification_log l
  where l.user_id = p_user_id
    and l.delivery_claim_id is null
    and (l.sent_at at time zone time_zone)::date = claim_local_day;

  if reserved_today + legacy_sent_today >= 3 then return null; end if;

  insert into public.notification_delivery_claims (user_id, type, local_day, event_key)
  values (p_user_id, p_type, claim_local_day, claim_event_key)
  returning id into claim_id;

  return claim_id;
end;
$$;

create or replace function public.claim_notification_delivery(
  p_user_id uuid,
  p_type text,
  p_timezone text
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.claim_notification_delivery(
    p_user_id,
    p_type,
    p_timezone,
    'scheduled'
  );
$$;

revoke all on function public.claim_notification_delivery(uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_notification_delivery(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_notification_delivery(uuid, text, text) to service_role;
grant execute on function public.claim_notification_delivery(uuid, text, text, text) to service_role;

commit;
