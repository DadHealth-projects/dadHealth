-- Read-only production definition supplied by the owner, 2026-11-20.
-- Disposable fixture only; NOT a production migration.
create table public.subscription_trial_periods (
 subscription_id uuid not null, user_id uuid not null,
 started_at timestamptz not null, ends_at timestamptz not null,
 recorded_at timestamptz not null default now(),
 constraint subscription_trial_periods_pkey primary key(subscription_id),
 constraint subscription_trial_periods_check check(ends_at>started_at),
 constraint subscription_trial_periods_subscription_id_user_id_fkey foreign key(subscription_id,user_id)
 references public.subscription_entitlements(id,user_id) on delete cascade
);
alter table public.subscription_trial_periods enable row level security;
revoke all on public.subscription_trial_periods from public,anon,authenticated;
grant all on public.subscription_trial_periods to service_role;
create policy privacy_deleted_session on public.subscription_trial_periods as restrictive for all to authenticated
 using(public.privacy_current_account_available()) with check(public.privacy_current_account_available());
create trigger account_privacy_write before insert or update on public.subscription_trial_periods
 for each row execute function public.guard_account_privacy_write('user_id');
