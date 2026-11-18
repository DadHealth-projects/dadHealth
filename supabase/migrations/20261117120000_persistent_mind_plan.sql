begin;

create table public.mind_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  id uuid not null unique default gen_random_uuid(),
  version text not null,
  copy_status text not null check (copy_status='draft'),
  variant text not null check (variant in ('balanced','gentle','presence')),
  actions jsonb not null check (jsonb_typeof(actions)='array' and jsonb_array_length(actions)=7),
  created_at timestamptz not null,
  started_on date not null
);
create table public.mind_plan_completions (
  user_id uuid not null references public.mind_plans(user_id) on delete cascade,
  action_number integer not null check (action_number between 1 and 7),
  completed_on date not null,
  completed_at timestamptz not null,
  timezone text not null,
  primary key(user_id,action_number),
  unique(user_id,completed_on)
);
alter table public.mind_plans enable row level security;
alter table public.mind_plan_completions enable row level security;
revoke all on public.mind_plans,public.mind_plan_completions from public,anon,authenticated,service_role;
grant select on public.mind_plans,public.mind_plan_completions to service_role;

-- Catalogue is private, versioned and copied once, never read dynamically by GET.
create function public.mind_plan_actions_v1(p_variant text)
returns jsonb language sql immutable set search_path=pg_catalog,public as $$
  select jsonb_agg(jsonb_build_object('id',id,'title',title,'instruction',instruction,'route',route)
    order by case when p_variant='presence' and n=1 then 2 when p_variant='presence' and n=2 then 1 else n end)
  from (values
    (1,'reset-start','Take five minutes','Try the five-minute Mind Reset: one minute of 4-4-4 breathing, then four minutes of on-screen guidance.','BreathingSession'),
    (2,'journal-space','Make a little space',case p_variant
      when 'gentle' then 'What''s one thing in your control today?'
      when 'presence' then 'When would you like to be more present today?'
      else 'What''s on your mind right now?' end,'Journal'),
    (3,'journal-step','Choose a small step','What''s one small next step that feels manageable?','Journal'),
    (4,'reset-pause','Pause and reset','Make room for the five-minute Mind Reset at a time that suits you.','BreathingSession'),
    (5,'journal-support','Notice support','Who or what helped you this week?','Journal'),
    (6,'reset-return','Return to your reset','Try the five-minute Mind Reset again. Finish after breathing if that is enough today.','BreathingSession'),
    (7,'journal-forward','Carry one thing forward','What''s one thing you want to carry into tomorrow?','Journal')
  ) a(n,id,title,instruction,route);
$$;
revoke all on function public.mind_plan_actions_v1(text) from public,anon,authenticated,service_role;

create function public.mind_plan_operation(p_user_id uuid,p_operation text,p_plan_id uuid default null,p_action_number integer default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  at_time timestamptz; today date; zone text; access boolean; goals jsonb;
  variant text; p public.mind_plans%rowtype; done integer; last_day date;
  receipt jsonb := null; result jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if p_user_id is null or p_operation is null or p_operation not in ('read','start','complete')
    or (p_operation<>'complete' and (p_plan_id is not null or p_action_number is not null))
    or (p_operation='complete' and (p_plan_id is null or p_action_number is null or p_action_number not between 1 and 7)) then
    raise exception 'Invalid plan operation' using errcode='22023';
  end if;
  if p_operation<>'read' then
    perform pg_advisory_xact_lock(hashtextextended('mind-plan:'||p_user_id::text,0));
  end if;
  at_time := clock_timestamp();
  select profile.goals into goals from public.user_profile profile where user_id=p_user_id;
  if not found then return jsonb_build_object('state','unavailable','reason','profile_unavailable'); end if;
  access := public.user_has_pro_access(p_user_id);
  if access is null then return jsonb_build_object('state','unavailable','reason','entitlement_unavailable'); end if;
  if not access then return jsonb_build_object('state','locked'); end if;
  select public.scoring_date_at(p_user_id,at_time),public.scoring_timezone_at(p_user_id,at_time) into today,zone;
  if today is null or zone is null then return jsonb_build_object('state','unavailable','reason','calendar_unavailable'); end if;
  select * into p from public.mind_plans where user_id=p_user_id;
  if not found and p_operation='start' then
    variant := case
      when goals ? 'I''m struggling and not saying so' or goals ? 'I''m going through a tough chapter' then 'gentle'
      when goals ? 'I want to be more present' then 'presence' else 'balanced' end;
    insert into public.mind_plans(user_id,version,copy_status,variant,actions,created_at,started_on)
    values(p_user_id,'mind-plan-v1','draft',variant,public.mind_plan_actions_v1(variant),at_time,today)
    returning * into p;
  end if;
  if p.id is null then return jsonb_build_object('state','not_started'); end if;
  if p_operation='complete' then
    if p_plan_id<>p.id then return jsonb_build_object('state','conflict','reason','plan_mismatch'); end if;
    select jsonb_build_object('actionNumber',action_number,'completedOn',completed_on,'completedAt',completed_at,'timezone',timezone)
      into receipt from public.mind_plan_completions where user_id=p_user_id and action_number=p_action_number;
    if receipt is null then
      select count(*),max(completed_on) into done,last_day from public.mind_plan_completions where user_id=p_user_id;
      if p_action_number<>done+1 then return jsonb_build_object('state','conflict','reason','action_out_of_order'); end if;
      if last_day is not null and today<=last_day then return jsonb_build_object('state','conflict','reason','daily_limit'); end if;
      insert into public.mind_plan_completions values(p_user_id,p_action_number,today,at_time,zone)
      returning jsonb_build_object('actionNumber',action_number,'completedOn',completed_on,'completedAt',completed_at,'timezone',timezone) into receipt;
    end if;
  end if;
  -- One statement snapshot for plan plus ledger; GET never updates anything.
  select jsonb_build_object('state','available','currentDate',today,'timezone',zone,'receipt',receipt,
    'plan',jsonb_build_object('id',plan.id,'version',plan.version,'copyStatus',plan.copy_status,
      'variant',plan.variant,'createdAt',plan.created_at,'startedOn',plan.started_on,'actions',plan.actions,
      'completions',c.history,'completed',c.n=7,'nextAction',case when c.n<7 then c.n+1 else null end,
      'canComplete',c.n<7 and (c.last_date is null or today>c.last_date))) into result
  from public.mind_plans plan cross join lateral (
    select count(*) n,max(completed_on) last_date,
      coalesce(jsonb_agg(jsonb_build_object('actionNumber',action_number,'completedOn',completed_on,
        'completedAt',completed_at,'timezone',timezone) order by action_number),'[]'::jsonb) history
    from public.mind_plan_completions where user_id=plan.user_id
  ) c where plan.user_id=p_user_id;
  return result;
end;
$$;
revoke all on function public.mind_plan_operation(uuid,text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.mind_plan_operation(uuid,text,uuid,integer) to service_role;
commit;
