begin;
-- Provider-derived aliases must never overlap another current or deleted owner.
-- No identity lookup by email, name or device is permitted.
create function public.analytics_identity_aliases_safe(p_owner uuid,p_aliases jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_owner is null or jsonb_typeof(p_aliases)<>'array' or not (p_aliases ? p_owner::text)
 or jsonb_array_length(p_aliases)>2000 then return false; end if;
 if exists(select 1 from jsonb_array_elements(p_aliases) a where jsonb_typeof(a)<>'string' or length(a#>>'{}') not between 1 and 512) then return false; end if;
 return not exists(select 1 from jsonb_array_elements_text(p_aliases) a(id) join auth.users u on u.id::text=lower(a.id) where u.id<>p_owner)
 and not exists(select 1 from jsonb_array_elements_text(p_aliases) a(id) join public.account_deletion_tombstones t on t.user_id::text=lower(a.id) where t.user_id<>p_owner);
end $$;
revoke all on function public.analytics_identity_aliases_safe(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.analytics_identity_aliases_safe(uuid,jsonb) to service_role;
commit;
