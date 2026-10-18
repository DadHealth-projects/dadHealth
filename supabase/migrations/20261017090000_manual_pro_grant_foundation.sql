begin;

-- Separate trusted manual grants from legacy is_pro compatibility state.
-- This migration does not change entitlement decisions.
alter table public.user_profile
  add column if not exists manual_pro_grant boolean not null default false;

create or replace function public.protect_user_profile_subscription_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.is_pro is distinct from false
        or new.manual_pro_grant is distinct from false
        or new.stripe_customer_id is not null
        or new.stripe_subscription_id is not null
        or new.subscription_status is not null then
        raise exception 'Subscription fields are server managed' using errcode = '42501';
      end if;
    elsif new.is_pro is distinct from old.is_pro
      or new.manual_pro_grant is distinct from old.manual_pro_grant
      or new.stripe_customer_id is distinct from old.stripe_customer_id
      or new.stripe_subscription_id is distinct from old.stripe_subscription_id
      or new.subscription_status is distinct from old.subscription_status then
      raise exception 'Subscription fields are server managed' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

commit;
