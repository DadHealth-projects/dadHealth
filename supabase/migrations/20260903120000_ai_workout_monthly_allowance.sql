-- Free members can generate three AI workouts per UTC calendar month.
-- Claims are service-role-only so deleting a generated workout cannot restore
-- allowance, and the advisory lock prevents concurrent fourth generations.

create table if not exists public.ai_workout_generation_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  request_key text not null check (char_length(request_key) between 8 and 128),
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  workout_id uuid references public.workouts(id) on delete set null,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, usage_month, request_key),
  check (
    (status = 'completed' and workout_id is not null and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create index if not exists idx_ai_workout_generation_claims_user_month_status
on public.ai_workout_generation_claims(user_id, usage_month, status);

alter table public.ai_workout_generation_claims enable row level security;
revoke all on table public.ai_workout_generation_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_workout_generation_claims to service_role;

create or replace function public.claim_ai_workout_generation(
  p_user_id uuid,
  p_request_key text
)
returns table (
  claim_id uuid,
  outcome text,
  workout_id uuid,
  used_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'UTC')::date;
  v_request_key text := btrim(p_request_key);
  v_existing public.ai_workout_generation_claims%rowtype;
  v_used integer;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  if char_length(v_request_key) < 8 or char_length(v_request_key) > 128 then
    raise exception 'request_key must be between 8 and 128 characters';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || v_month::text, 0)
  );

  update public.ai_workout_generation_claims
  set status = 'failed'
  where user_id = p_user_id
    and usage_month = v_month
    and status = 'pending'
    and claimed_at < now() - interval '10 minutes';

  select c.*
  into v_existing
  from public.ai_workout_generation_claims c
  where c.user_id = p_user_id
    and c.usage_month = v_month
    and c.request_key = v_request_key;

  select count(*)::integer
  into v_used
  from public.ai_workout_generation_claims c
  where c.user_id = p_user_id
    and c.usage_month = v_month
    and c.status in ('pending', 'completed');

  if v_existing.id is not null and v_existing.status = 'completed' then
    return query select v_existing.id, 'duplicate'::text, v_existing.workout_id, v_used;
    return;
  end if;

  if v_existing.id is not null and v_existing.status = 'pending' then
    return query select v_existing.id, 'in_progress'::text, null::uuid, v_used;
    return;
  end if;

  if v_used >= 3 then
    return query select null::uuid, 'limit_reached'::text, null::uuid, v_used;
    return;
  end if;

  if v_existing.id is not null then
    update public.ai_workout_generation_claims
    set status = 'pending', claimed_at = now(), workout_id = null, completed_at = null
    where id = v_existing.id;

    return query select v_existing.id, 'claimed'::text, null::uuid, v_used + 1;
    return;
  end if;

  insert into public.ai_workout_generation_claims (
    user_id,
    usage_month,
    request_key
  ) values (
    p_user_id,
    v_month,
    v_request_key
  )
  returning id into claim_id;

  outcome := 'claimed';
  workout_id := null;
  used_count := v_used + 1;
  return next;
end;
$$;

create or replace function public.complete_ai_workout_generation(
  p_claim_id uuid,
  p_title text,
  p_duration_mins integer,
  p_equipment text,
  p_focus text,
  p_exercises jsonb
)
returns public.workouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.ai_workout_generation_claims%rowtype;
  v_workout public.workouts%rowtype;
begin
  select c.*
  into v_claim
  from public.ai_workout_generation_claims c
  where c.id = p_claim_id
  for update;

  if v_claim.id is null then
    raise exception 'AI workout generation claim was not found';
  end if;

  if v_claim.status = 'completed' and v_claim.workout_id is not null then
    select w.* into v_workout from public.workouts w where w.id = v_claim.workout_id;
    return v_workout;
  end if;

  if v_claim.status <> 'pending' then
    raise exception 'AI workout generation claim is not pending';
  end if;

  insert into public.workouts (
    user_id,
    title,
    duration_mins,
    equipment,
    focus,
    exercises,
    source
  ) values (
    v_claim.user_id,
    p_title,
    p_duration_mins,
    p_equipment,
    p_focus,
    p_exercises,
    'ai_generated'
  )
  returning * into v_workout;

  update public.ai_workout_generation_claims
  set status = 'completed', workout_id = v_workout.id, completed_at = now()
  where id = v_claim.id;

  return v_workout;
end;
$$;

create or replace function public.fail_ai_workout_generation(p_claim_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_workout_generation_claims
  set status = 'failed'
  where id = p_claim_id
    and status = 'pending';

  return found;
end;
$$;

revoke all on function public.claim_ai_workout_generation(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_ai_workout_generation(uuid, text, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_ai_workout_generation(uuid) from public, anon, authenticated;

grant execute on function public.claim_ai_workout_generation(uuid, text) to service_role;
grant execute on function public.complete_ai_workout_generation(uuid, text, integer, text, text, jsonb) to service_role;
grant execute on function public.fail_ai_workout_generation(uuid) to service_role;
