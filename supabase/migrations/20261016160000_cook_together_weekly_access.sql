begin;

do $$
begin
  if to_regclass('public.recipes') is null
    or to_regclass('public.user_saved_recipes') is null
    or to_regclass('public.bond_logs') is null
    or to_regclass('public.body_metrics') is null then
    raise exception 'Cook Together base tables are missing; apply compatible schema prerequisites first.';
  end if;
  if to_regprocedure('public.user_has_pro_access(uuid)') is null
    or to_regprocedure('public.update_streak(uuid)') is null
    or to_regprocedure('public.complete_cook_together_recipe(uuid)') is null then
    raise exception 'Canonical entitlement or Cook Together functions are missing; verify backend prerequisites first.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recipes' and column_name = 'cook_together'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recipes' and column_name = 'prep_mins'
  ) then
    raise exception 'Cook Together recipe columns are missing; verify backend schema before applying.';
  end if;
end;
$$;

-- One Admin-selected Cook Together recipe per Monday-starting week.
create table if not exists public.free_weekly_recipe_assignments (
  week_start date primary key,
  recipe_id uuid not null references public.recipes(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint free_weekly_recipe_assignments_monday_chk
    check (extract(isodow from week_start) = 1)
);

create index if not exists free_weekly_recipe_assignments_recipe_id_idx
  on public.free_weekly_recipe_assignments(recipe_id);

alter table public.free_weekly_recipe_assignments enable row level security;
alter table public.recipes enable row level security;
alter table public.user_saved_recipes enable row level security;
revoke all on table public.free_weekly_recipe_assignments from public, anon, authenticated;
grant select on table public.free_weekly_recipe_assignments to anon, authenticated;
grant select, insert, update, delete on table public.free_weekly_recipe_assignments to service_role;

create or replace function public.can_access_cook_together_recipe(p_recipe_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.recipes recipe
    where recipe.id = p_recipe_id
      and recipe.cook_together = true
      and (
        (auth.uid() is not null and public.user_has_pro_access(auth.uid()))
        or exists (
          select 1
          from public.free_weekly_recipe_assignments assignment
          where assignment.recipe_id = recipe.id
            and assignment.week_start = date_trunc('week', current_date::timestamp)::date
        )
      )
  );
$$;

revoke all on function public.can_access_cook_together_recipe(uuid) from public;
grant execute on function public.can_access_cook_together_recipe(uuid) to anon, authenticated, service_role;

create or replace function public.can_save_recipe(p_recipe_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.recipes recipe
    where recipe.id = p_recipe_id
      and (recipe.cook_together is not true or public.can_access_cook_together_recipe(recipe.id))
  );
$$;

revoke all on function public.can_save_recipe(uuid) from public;
grant execute on function public.can_save_recipe(uuid) to authenticated, service_role;

create or replace function public.admin_set_free_weekly_recipe(
  p_week_start date,
  p_recipe_id uuid
)
returns public.free_weekly_recipe_assignments
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  saved_assignment public.free_weekly_recipe_assignments;
  current_week_start date := date_trunc('week', current_date::timestamp)::date;
begin
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'Week start must be a Monday.' using errcode = '22023';
  end if;
  if p_week_start < current_week_start then
    raise exception 'Past weeks cannot be rescheduled.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.recipes recipe
    where recipe.id = p_recipe_id and recipe.cook_together = true
  ) then
    raise exception 'Choose an existing Cook Together recipe.' using errcode = '22023';
  end if;

  insert into public.free_weekly_recipe_assignments (week_start, recipe_id)
  values (p_week_start, p_recipe_id)
  on conflict (week_start) do update
    set recipe_id = excluded.recipe_id
  returning * into saved_assignment;

  return saved_assignment;
end;
$$;

revoke all on function public.admin_set_free_weekly_recipe(date, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_free_weekly_recipe(date, uuid) to service_role;

drop policy if exists "Anyone can read cook together recipes" on public.recipes;
drop policy if exists "Read eligible Cook Together recipes" on public.recipes;
create policy "Read eligible Cook Together recipes"
on public.recipes for select to anon, authenticated
using (cook_together = true and public.can_access_cook_together_recipe(id));

drop policy if exists "Restrict Cook Together recipe reads to Pro or weekly assignment" on public.recipes;
create policy "Restrict Cook Together recipe reads to Pro or weekly assignment"
on public.recipes as restrictive for select to anon, authenticated
using (cook_together is not true or public.can_access_cook_together_recipe(id));

drop policy if exists "Read current weekly recipe assignment" on public.free_weekly_recipe_assignments;
create policy "Read current weekly recipe assignment"
on public.free_weekly_recipe_assignments for select to anon, authenticated
using (week_start = date_trunc('week', current_date::timestamp)::date);

drop policy if exists "Users can CRUD own saved recipes" on public.user_saved_recipes;
drop policy if exists "Users can read own saved recipe ids" on public.user_saved_recipes;
drop policy if exists "Users can save accessible recipes" on public.user_saved_recipes;
drop policy if exists "Users can update own accessible saved recipes" on public.user_saved_recipes;
drop policy if exists "Users can delete own saved recipes" on public.user_saved_recipes;
drop policy if exists "Restrict saved recipe access" on public.user_saved_recipes;
drop policy if exists "Restrict reading own saved recipe ids" on public.user_saved_recipes;
drop policy if exists "Restrict saving accessible recipes" on public.user_saved_recipes;
drop policy if exists "Restrict updating accessible saved recipes" on public.user_saved_recipes;
drop policy if exists "Restrict deleting own saved recipes" on public.user_saved_recipes;
create policy "Users can read own saved recipe ids"
on public.user_saved_recipes for select to authenticated
using (auth.uid() = user_id);
create policy "Users can save accessible recipes"
on public.user_saved_recipes for insert to authenticated
with check (auth.uid() = user_id and public.can_save_recipe(recipe_id));
create policy "Users can update own accessible saved recipes"
on public.user_saved_recipes for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id and public.can_save_recipe(recipe_id));
create policy "Users can delete own saved recipes"
on public.user_saved_recipes for delete to authenticated
using (auth.uid() = user_id);
create policy "Restrict reading own saved recipe ids"
on public.user_saved_recipes as restrictive for select to authenticated
using (auth.uid() = user_id);
create policy "Restrict saving accessible recipes"
on public.user_saved_recipes as restrictive for insert to authenticated
with check (auth.uid() = user_id and public.can_save_recipe(recipe_id));
create policy "Restrict updating accessible saved recipes"
on public.user_saved_recipes as restrictive for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id and public.can_save_recipe(recipe_id));
create policy "Restrict deleting own saved recipes"
on public.user_saved_recipes as restrictive for delete to authenticated
using (auth.uid() = user_id);

-- Keep saved rows intact. Recipe RLS hides inaccessible details after downgrade;
-- the rows become readable again if Pro access returns.
create or replace function public.complete_cook_together_recipe(p_recipe_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_recipe recipes%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into v_recipe
  from recipes
  where id = p_recipe_id
    and cook_together = true
    and public.can_access_cook_together_recipe(id);

  if not found then
    raise exception 'Recipe unavailable.' using errcode = '42501';
  end if;

  insert into bond_logs (user_id, recipe_id, activity_type, quality, minutes)
  values (v_user_id, p_recipe_id, 'cook_together_recipe', 4, v_recipe.prep_mins);

  insert into body_metrics (user_id, metric_type, value, recorded_at)
  values (v_user_id, 'active_mins', v_recipe.prep_mins, now());

  perform update_streak(v_user_id);
end;
$$;

revoke all on function public.complete_cook_together_recipe(uuid) from public, anon;
grant execute on function public.complete_cook_together_recipe(uuid) to authenticated, service_role;

comment on table public.free_weekly_recipe_assignments is
  'Admin-selected Free Cook Together recipe. One assignment per Monday-starting week; only current assignment is client-readable.';

commit;
