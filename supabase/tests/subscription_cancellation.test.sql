-- ISOLATED LOCAL DATABASE ONLY. Requires the applied Phase 04 migration and
-- 20261113120000_apple_cancellation_ordering_and_membership_read.sql (apply/reapply locally).
-- Requires existing canonical entitlement schema/functions and pgTAP.
-- All fixtures and extension creation below roll back. Never run on production.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values
 ('64000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cancellation-a@example.test','',now(),now(),now()),
 ('64000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cancellation-b@example.test','',now(),now(),now());
insert into public.user_profile(user_id) values ('64000000-0000-4000-8000-000000000001'),('64000000-0000-4000-8000-000000000002') on conflict(user_id) do nothing;
create temporary table cancellation_fixture(snapshot jsonb, subscription_id uuid);
insert into cancellation_fixture(snapshot) values(jsonb_build_object(
 'p_user_id','64000000-0000-4000-8000-000000000001', 'p_provider','apple',
 'p_provider_subscription_id','phase04-isolated-apple','p_status','trialing','p_plan','monthly',
 'p_current_period_end',now()+interval '30 days','p_trial_end',now()+interval '7 days',
 'p_auto_renews',false,'p_environment','sandbox','p_last_verified_at',now()));
update cancellation_fixture set subscription_id=public.upsert_subscription_with_cancellation_evidence(snapshot,null);
select is((select count(*) from public.subscription_cancellation_evidence where subscription_id=(select subscription_id from cancellation_fixture)),0::bigint,'false auto-renew alone does not backfill evidence');
select ok(public.user_has_pro_access('64000000-0000-4000-8000-000000000001'),'trial canonical access remains valid');
select ok(not has_table_privilege('authenticated','public.subscription_cancellation_feedback','SELECT'),'ordinary users cannot read feedback');
select ok(not has_table_privilege('anon','public.subscription_cancellation_feedback','SELECT'),'anonymous users cannot read feedback');
select ok(not has_table_privilege('authenticated','public.subscription_cancellation_feedback','INSERT'),'no direct client feedback writes');
select ok((select relrowsecurity from pg_class where oid='public.subscription_cancellation_feedback'::regclass),'feedback RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.subscription_cancellation_evidence'::regclass),'evidence RLS enabled');
select ok(not has_function_privilege('authenticated','public.save_subscription_cancellation_feedback(uuid,uuid,uuid,text,text)','EXECUTE'),'feedback RPC server only');
select ok(not has_function_privilege('authenticated','public.upsert_subscription_with_cancellation_evidence(jsonb,jsonb)','EXECUTE'),'evidence RPC server only');
select ok(not has_function_privilege('authenticated','public.cleanup_subscription_cancellation_feedback()','EXECUTE'),'cleanup server only');
select lives_ok($q$select public.save_subscription_cancellation_feedback(p_request_id => '64000000-0000-4000-8000-000000000010',p_user_id => '64000000-0000-4000-8000-000000000001',p_subscription_id => (select subscription_id from cancellation_fixture),p_reason => 'other',p_details => '')$q$,'empty optional text accepted');
select lives_ok($q$select public.save_subscription_cancellation_feedback(p_request_id => '64000000-0000-4000-8000-000000000010',p_user_id => '64000000-0000-4000-8000-000000000001',p_subscription_id => (select subscription_id from cancellation_fixture),p_reason => 'other',p_details => '')$q$,'identical retry succeeds with void return');
select is((select count(*) from public.subscription_cancellation_feedback where user_id='64000000-0000-4000-8000-000000000001' and request_id='64000000-0000-4000-8000-000000000010'),1::bigint,'one stored submission');
select throws_ok($q$select public.save_subscription_cancellation_feedback(p_request_id => '64000000-0000-4000-8000-000000000010',p_user_id => '64000000-0000-4000-8000-000000000001',p_subscription_id => (select subscription_id from cancellation_fixture),p_reason => 'too_expensive',p_details => '')$q$,'23505','Feedback request already used','edited retry cannot overwrite');
select throws_ok($q$select public.save_subscription_cancellation_feedback(p_request_id => '64000000-0000-4000-8000-000000000011',p_user_id => '64000000-0000-4000-8000-000000000002',p_subscription_id => (select subscription_id from cancellation_fixture),p_reason => 'other',p_details => '')$q$,'42501','Subscription unavailable','different owner blocked');
select throws_ok($q$select public.save_subscription_cancellation_feedback(p_request_id => '64000000-0000-4000-8000-000000000011',p_user_id => '64000000-0000-4000-8000-000000000001',p_subscription_id => (select subscription_id from cancellation_fixture),p_reason => 'other',p_details => repeat('x',1001))$q$,'22023','Invalid feedback','server length limit');
select is((select retain_until from public.subscription_cancellation_feedback where user_id='64000000-0000-4000-8000-000000000001' and request_id='64000000-0000-4000-8000-000000000010'),(select submitted_at+interval '12 months' from public.subscription_cancellation_feedback where user_id='64000000-0000-4000-8000-000000000001' and request_id='64000000-0000-4000-8000-000000000010'),'server timestamp defines 12 months');
select is(public.cleanup_subscription_cancellation_feedback(),0::bigint,'fresh feedback retained');
update public.subscription_cancellation_feedback set submitted_at=now()-interval '12 months',retain_until=now() where user_id='64000000-0000-4000-8000-000000000001' and request_id='64000000-0000-4000-8000-000000000010';
select is(public.cleanup_subscription_cancellation_feedback(),1::bigint,'deadline removes expired feedback');
select is(public.cleanup_subscription_cancellation_feedback(),0::bigint,'cleanup idempotent');
-- The new feedback/evidence path is Apple-only; legacy providers keep their old RPC.
insert into public.subscription_entitlements(id,user_id,provider,provider_subscription_id,status,current_period_end)
values('64000000-0000-4000-8000-000000000020','64000000-0000-4000-8000-000000000001','stripe','phase04-legacy-stripe','active',now()+interval '30 days');
select throws_ok($q$select public.save_subscription_cancellation_feedback(p_request_id => '64000000-0000-4000-8000-000000000021',p_user_id => '64000000-0000-4000-8000-000000000001',p_subscription_id => '64000000-0000-4000-8000-000000000020',p_reason => 'other',p_details => '')$q$,'42501','Subscription unavailable','new feedback does not add Stripe cancellation');
select lives_ok($q$select public.upsert_subscription_with_cancellation_evidence(snapshot||jsonb_build_object('p_provider','stripe'),null) from cancellation_fixture$q$,'legacy updates remain compatible without evidence');
-- Provider-event time and server verification time are independent.
select public.upsert_subscription_with_cancellation_evidence(snapshot||jsonb_build_object('p_last_verified_at',now()+interval '1 second'),jsonb_build_object('source','apple_renewal_disabled','scheduledEndAt',now()+interval '30 days')) from cancellation_fixture;
select is((select source from public.subscription_cancellation_evidence where subscription_id=(select subscription_id from cancellation_fixture)),'apple_renewal_disabled','explicit event records cancellation');
select public.upsert_subscription_with_cancellation_evidence(snapshot||jsonb_build_object('p_last_verified_at',now()+interval '12 seconds','p_auto_renews',true),null) from cancellation_fixture;
select is((select snapshot_verified_at from public.subscription_cancellation_evidence where subscription_id=(select subscription_id from cancellation_fixture)),now()+interval '1 second','restore does not change provider watermark');
select is((select evidence->>'source' from public.read_apple_membership_snapshot('64000000-0000-4000-8000-000000000001')),'apple_renewal_disabled','ordinary verification preserves cancellation');
-- Delayed event is newer than evidence, older than the restore snapshot.
select public.upsert_subscription_with_cancellation_evidence(snapshot||jsonb_build_object('p_last_verified_at',now()+interval '4 seconds','p_auto_renews',true),'{"source":"apple_renewal_enabled"}'::jsonb) from cancellation_fixture;
select is((select source from public.subscription_cancellation_evidence where subscription_id=(select subscription_id from cancellation_fixture)),'apple_renewal_enabled','delayed enabled event clears scheduled state using retained marker');
select is((select last_verified_at from public.subscription_entitlements where id=(select subscription_id from cancellation_fixture)),now()+interval '12 seconds','delayed event never rolls back canonical snapshot');
select ok(public.user_has_pro_access('64000000-0000-4000-8000-000000000001'),'reactivation preserves canonical Pro');
select public.upsert_subscription_with_cancellation_evidence(snapshot||jsonb_build_object('p_last_verified_at',now()+interval '3 seconds'),'{"source":"apple_renewal_disabled"}'::jsonb) from cancellation_fixture;
select public.upsert_subscription_with_cancellation_evidence(snapshot||jsonb_build_object('p_last_verified_at',now()+interval '4 seconds'),'{"source":"apple_renewal_disabled"}'::jsonb) from cancellation_fixture;
select is((select source from public.subscription_cancellation_evidence where subscription_id=(select subscription_id from cancellation_fixture)),'apple_renewal_enabled','old/equal events cannot resurrect cancellation');
select public.upsert_subscription_with_cancellation_evidence(snapshot||jsonb_build_object('p_last_verified_at',now()+interval '5 seconds'),jsonb_build_object('source','apple_renewal_disabled','scheduledEndAt',now()+interval '30 days')) from cancellation_fixture;
select is((select source from public.subscription_cancellation_evidence where subscription_id=(select subscription_id from cancellation_fixture)),'apple_renewal_disabled','newer provider cancellation accepted despite newer restore time');
select throws_ok($q$select public.upsert_subscription_with_cancellation_evidence(snapshot||jsonb_build_object('p_last_verified_at',now()+interval '13 seconds','p_status','expired'),'{"source":"invalid_source"}'::jsonb) from cancellation_fixture$q$,'22023','Invalid cancellation evidence','invalid evidence rolls back snapshot atomically');
select is((select last_verified_at from public.subscription_entitlements where id=(select subscription_id from cancellation_fixture)),now()+interval '12 seconds','failed evidence rolled back entitlement');
select is((select source from public.subscription_cancellation_evidence where subscription_id=(select subscription_id from cancellation_fixture)),'apple_renewal_disabled','failed evidence preserved prior evidence');
select public.upsert_subscription_with_cancellation_evidence(snapshot||jsonb_build_object('p_last_verified_at',now()+interval '13 seconds','p_status','revoked'),'{"source":"apple_terminal"}'::jsonb) from cancellation_fixture;
select is((select source from public.subscription_cancellation_evidence where subscription_id=(select subscription_id from cancellation_fixture)),'apple_terminal','revocation records terminal watermark');
select ok(not public.user_has_pro_access('64000000-0000-4000-8000-000000000001'),'canonical revoked access unchanged');
select public.upsert_subscription_with_cancellation_evidence(snapshot||jsonb_build_object('p_last_verified_at',now()+interval '6 seconds'),'{"source":"apple_renewal_disabled"}'::jsonb) from cancellation_fixture;
select is((select source from public.subscription_cancellation_evidence where subscription_id=(select subscription_id from cancellation_fixture)),'apple_terminal','old cancellation cannot overwrite terminal marker');
select throws_ok($q$select public.upsert_subscription_with_cancellation_evidence(snapshot||jsonb_build_object('p_user_id','64000000-0000-4000-8000-000000000002','p_last_verified_at',now()+interval '14 seconds'),'{"source":"apple_renewal_enabled"}'::jsonb) from cancellation_fixture$q$,'23505',null,'cross-account evidence update rejected');
select is((select count(*) from public.read_apple_membership_snapshot('64000000-0000-4000-8000-000000000002')),0::bigint,'membership read is account scoped');
select is((select subscription->>'status' from public.read_apple_membership_snapshot('64000000-0000-4000-8000-000000000001')),'revoked','joined read contains current canonical snapshot');
select is((select evidence->>'source' from public.read_apple_membership_snapshot('64000000-0000-4000-8000-000000000001')),'apple_terminal','joined read contains matching committed evidence');
select ok(not has_function_privilege('authenticated','public.read_apple_membership_snapshot(uuid)','EXECUTE'),'joined read is service only');
select is((select provolatile::text from pg_proc where oid='public.read_apple_membership_snapshot(uuid)'::regprocedure),'s','reader uses calling statement snapshot');
select public.upsert_subscription_with_cancellation_evidence(snapshot||jsonb_build_object('p_last_verified_at',now()+interval '15 seconds','p_status','expired'),'{"source":"apple_terminal"}'::jsonb) from cancellation_fixture;
select is((select subscription->>'status' from public.read_apple_membership_snapshot('64000000-0000-4000-8000-000000000001')),'expired','expiry is reflected without inventing cancellation');
select * from finish();
rollback;
