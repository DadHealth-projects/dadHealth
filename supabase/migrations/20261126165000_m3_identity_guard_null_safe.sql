-- Reconcile analytics_identity_aliases_safe with production (read-only comparison, 27 Nov 2026).
--
-- Production already runs this definition: 20261126132000 was applied by hand with one
-- correction. In the committed version a NULL p_aliases made every check evaluate to NULL, so the
-- function fell through and returned TRUE ("safe"), which would let remote erasure proceed
-- without a verified alias set. Here a missing or non-array input returns FALSE (fail closed).
-- Same signature, owner, security definer, search_path and grants as 20261126132000. On
-- production this is a no-op by behaviour (the live body is identical, comment- and
-- whitespace-insensitive fingerprint 2637bfa95a77).

create or replace function public.analytics_identity_aliases_safe(p_owner uuid, p_aliases jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then
  raise exception 'Forbidden' using errcode='42501';
 end if;

 if p_owner is null
 or p_aliases is null
 or jsonb_typeof(p_aliases) is distinct from 'array' then
  return false;
 end if;

 if not (p_aliases ? p_owner::text)
 or jsonb_array_length(p_aliases)>2000 then
  return false;
 end if;

 if exists (
  select 1
  from jsonb_array_elements(p_aliases) a
  where jsonb_typeof(a)<>'string'
     or length(a#>>'{}') not between 1 and 512
 ) then
  return false;
 end if;

 return not exists (
  select 1
  from jsonb_array_elements_text(p_aliases) a(id)
  join auth.users u on u.id::text=lower(a.id)
  where u.id<>p_owner
 )
 and not exists (
  select 1
  from jsonb_array_elements_text(p_aliases) a(id)
  join public.account_deletion_tombstones t
    on t.user_id::text=lower(a.id)
  where t.user_id<>p_owner
 );
end $$;
revoke all on function public.analytics_identity_aliases_safe(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.analytics_identity_aliases_safe(uuid, jsonb) to service_role;
