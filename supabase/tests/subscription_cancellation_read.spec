# PostgreSQL isolationtester spec. ISOLATED LOCAL DATABASE ONLY.
# Requires both Phase 04 migrations. Not a pgTAP file; never run in production.
# Fixtures commit so two sessions can observe them; teardown removes only these IDs.
setup
{
  set request.jwt.claim.role = 'service_role';
  insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
    values('65000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cancellation-isolation@example.test',now(),now());
  insert into public.user_profile(user_id) values('65000000-0000-4000-8000-000000000001') on conflict(user_id) do nothing;
  select public.upsert_subscription_with_cancellation_evidence(
    '{"p_user_id":"65000000-0000-4000-8000-000000000001","p_provider":"apple","p_provider_subscription_id":"phase04-isolation","p_status":"active","p_current_period_end":"2099-01-01T00:00:00Z","p_environment":"sandbox","p_last_verified_at":"2026-11-13T10:00:00Z"}',
    '{"source":"apple_renewal_disabled","scheduledEndAt":"2099-01-01T00:00:00Z"}');
}
teardown
{
  delete from auth.users where id='65000000-0000-4000-8000-000000000001';
}

session "writer"
setup { set request.jwt.claim.role = 'service_role'; }
step "begin_update" { begin; }
step "enable"
{
  select public.upsert_subscription_with_cancellation_evidence(
    '{"p_user_id":"65000000-0000-4000-8000-000000000001","p_provider":"apple","p_provider_subscription_id":"phase04-isolation","p_status":"active","p_current_period_end":"2099-02-01T00:00:00Z","p_environment":"sandbox","p_last_verified_at":"2026-11-13T11:00:00Z"}',
    '{"source":"apple_renewal_enabled"}');
}
step "commit_update" { commit; }
step "rollback_update" { rollback; }

session "reader"
setup { set request.jwt.claim.role = 'service_role'; }
step "read_old"
{
  do $$
  declare r record;
  begin
    select * into strict r from public.read_apple_membership_snapshot('65000000-0000-4000-8000-000000000001');
    if r.subscription->>'last_verified_at' is null
       or (r.subscription->>'last_verified_at')::timestamptz <> '2026-11-13T10:00:00Z'::timestamptz
       or r.evidence->>'source' is distinct from 'apple_renewal_disabled' then
      raise exception 'Read mixed or uncommitted membership';
    end if;
  end $$;
}
step "read_new"
{
  do $$
  declare r record;
  begin
    select * into strict r from public.read_apple_membership_snapshot('65000000-0000-4000-8000-000000000001');
    if r.subscription->>'last_verified_at' is null
       or (r.subscription->>'last_verified_at')::timestamptz <> '2026-11-13T11:00:00Z'::timestamptz
       or r.evidence->>'source' is distinct from 'apple_renewal_enabled' then
      raise exception 'Committed reactivation returned stale evidence';
    end if;
  end $$;
}
# A read during the uncommitted update sees the entire old snapshot. The next
# statement after commit must see the entire new one, never a mixed pair.
permutation "begin_update" "enable" "read_old" "commit_update" "read_new"
permutation "read_old" "begin_update" "enable" "commit_update" "read_new"
permutation "begin_update" "enable" "rollback_update" "read_old"
