\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.reject(command text,code text,label text) returns void language plpgsql as $$begin
 begin execute command; exception when others then if sqlstate=code then raise notice 'PASS: %',label; return; end if; raise; end;
 raise exception 'FAIL: % unexpectedly succeeded',label; end $$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('b3000000-0000-4000-8000-000000000001','publisher@example.invalid',now(),'{}'),
 ('b3000000-0000-4000-8000-000000000002','member@example.invalid',null,'{}');
select pg_temp.reject($q$insert into community_publishers(user_id) values('b3000000-0000-4000-8000-000000000002')$q$,'42501','unverified publisher denied');
insert into posts(id,user_id,content,tag) values('b3000000-0000-4000-8000-000000000050','b3000000-0000-4000-8000-000000000001','historical','general');
insert into comments(id,user_id,post_id,content) values('b3000000-0000-4000-8000-000000000051','b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000050','historical reply');
insert into community_publishers(user_id) values('b3000000-0000-4000-8000-000000000001');
update posts set content='edited history',official_author=true where id='b3000000-0000-4000-8000-000000000050';
update comments set content='edited reply',official_author=true where id='b3000000-0000-4000-8000-000000000051';
select pg_temp.expect((select not official_author from posts where id='b3000000-0000-4000-8000-000000000050'),'grant plus edit cannot brand historical post');
select pg_temp.expect((select not official_author from comments where id='b3000000-0000-4000-8000-000000000051'),'grant plus edit cannot brand historical comment');

select pg_temp.expect(not has_table_privilege('authenticated','community_publishers','INSERT'),'client cannot grant publishing');
select pg_temp.expect(not has_function_privilege('authenticated','import_community_prompts(jsonb,uuid)','EXECUTE'),'client cannot import prompts');
set local role authenticated;
select set_config('request.jwt.claim.sub','b3000000-0000-4000-8000-000000000001',true);
insert into posts(id,user_id,content,tag,author_name,created_at) values('b3000000-0000-4000-8000-000000000020',auth.uid(),'fixture official','general','Client name',now()-interval '2 hours');
select pg_temp.expect((select official_author and author_name='Dad Health' from posts where id='b3000000-0000-4000-8000-000000000020'),'existing composer receives server official presentation');
insert into posts(id,user_id,content,tag,anonymous,official_author,created_at) values('b3000000-0000-4000-8000-000000000021',null,'fixture anonymous','general',true,true,now()-interval '1 hour');
select pg_temp.expect((select not official_author from posts where id='b3000000-0000-4000-8000-000000000021'),'anonymous publisher has no identifying badge');
select set_config('request.jwt.claim.sub','b3000000-0000-4000-8000-000000000002',true);
insert into posts(id,user_id,content,tag,author_name,official_author) values('b3000000-0000-4000-8000-000000000022',auth.uid(),'forgery fixture','general','Dad Health',true);
select pg_temp.expect((select not official_author from posts where id='b3000000-0000-4000-8000-000000000022'),'display name and forged flag do not grant official status');
select pg_temp.expect((select count(*)=1 from get_community_official_authors(array['b3000000-0000-4000-8000-000000000020','b3000000-0000-4000-8000-000000000021','b3000000-0000-4000-8000-000000000022']::uuid[],'{}')),'badge lookup returns only verified visible contribution');
insert into comments(id,user_id,post_id,content,official_author) values('b3000000-0000-4000-8000-000000000030',auth.uid(),'b3000000-0000-4000-8000-000000000020','forged reply',true);
select pg_temp.expect((select not official_author from comments where id='b3000000-0000-4000-8000-000000000030'),'comment cannot forge badge');
select block_community_author('post','b3000000-0000-4000-8000-000000000020');
select pg_temp.expect((select count(*)=0 from get_community_official_authors(array['b3000000-0000-4000-8000-000000000020']::uuid[],'{}')),'official lookup respects blocking');
reset role;
-- Existing named circles are reused. Fixture creates only absent names in this rollback transaction.
insert into circles(name,icon,visibility) select name,'community','public' from (values('New Dad Crew'),('Single Dads'),('Dad Strength'),('Every Kind of Dad')) n(name)
where not exists(select 1 from circles c where lower(btrim(c.name))=lower(n.name));
create temp table original_catalogue as select count(*) n from circle_prompts;
create temp table fixture_prompts(value jsonb);
grant select on fixture_prompts to service_role;
insert into fixture_prompts values($prompts$[
  {
    "seedKey": "jamie-2026-11-19:new-dad-crew:1",
    "circle": "New Dad Crew",
    "prompt": "What's the one thing nobody told you about the first few weeks?"
  },
  {
    "seedKey": "jamie-2026-11-19:new-dad-crew:2",
    "circle": "New Dad Crew",
    "prompt": "How are you actually sleeping, and what's keeping you going?"
  },
  {
    "seedKey": "jamie-2026-11-19:new-dad-crew:3",
    "circle": "New Dad Crew",
    "prompt": "What's one small win from this week?"
  },
  {
    "seedKey": "jamie-2026-11-19:new-dad-crew:4",
    "circle": "New Dad Crew",
    "prompt": "What's the hardest part of the night shift, and any tricks that help?"
  },
  {
    "seedKey": "jamie-2026-11-19:new-dad-crew:5",
    "circle": "New Dad Crew",
    "prompt": "When did you last do something just for you?"
  },
  {
    "seedKey": "jamie-2026-11-19:new-dad-crew:6",
    "circle": "New Dad Crew",
    "prompt": "What would you tell yourself on day one?"
  },
  {
    "seedKey": "jamie-2026-11-19:single-dads:1",
    "circle": "Single Dads",
    "prompt": "What does a good day look like for you and your kids right now?"
  },
  {
    "seedKey": "jamie-2026-11-19:single-dads:2",
    "circle": "Single Dads",
    "prompt": "How do you switch off when the house finally goes quiet?"
  },
  {
    "seedKey": "jamie-2026-11-19:single-dads:3",
    "circle": "Single Dads",
    "prompt": "What's one thing you've learned doing this on your own?"
  },
  {
    "seedKey": "jamie-2026-11-19:single-dads:4",
    "circle": "Single Dads",
    "prompt": "How do you handle the handover days?"
  },
  {
    "seedKey": "jamie-2026-11-19:single-dads:5",
    "circle": "Single Dads",
    "prompt": "Who's in your corner, and who do you wish was?"
  },
  {
    "seedKey": "jamie-2026-11-19:single-dads:6",
    "circle": "Single Dads",
    "prompt": "What's one thing you're proud of this week?"
  },
  {
    "seedKey": "jamie-2026-11-19:dad-strength:1",
    "circle": "Dad Strength",
    "prompt": "What did you train this week, even if it was a 20-minute session?"
  },
  {
    "seedKey": "jamie-2026-11-19:dad-strength:2",
    "circle": "Dad Strength",
    "prompt": "How do you fit exercise in around the kids?"
  },
  {
    "seedKey": "jamie-2026-11-19:dad-strength:3",
    "circle": "Dad Strength",
    "prompt": "What's the one habit keeping you consistent?"
  },
  {
    "seedKey": "jamie-2026-11-19:dad-strength:4",
    "circle": "Dad Strength",
    "prompt": "What's the best kid-friendly workout you've done together?"
  },
  {
    "seedKey": "jamie-2026-11-19:dad-strength:5",
    "circle": "Dad Strength",
    "prompt": "What do you do on the days motivation is nowhere?"
  },
  {
    "seedKey": "jamie-2026-11-19:dad-strength:6",
    "circle": "Dad Strength",
    "prompt": "What's your current goal, and what's getting in the way?"
  },
  {
    "seedKey": "jamie-2026-11-19:every-kind-of-dad:1",
    "circle": "Every Kind of Dad",
    "prompt": "What kind of dad are you, in your own words?"
  },
  {
    "seedKey": "jamie-2026-11-19:every-kind-of-dad:2",
    "circle": "Every Kind of Dad",
    "prompt": "What does being a good dad mean to you?"
  },
  {
    "seedKey": "jamie-2026-11-19:every-kind-of-dad:3",
    "circle": "Every Kind of Dad",
    "prompt": "What's one thing you do differently from how you were raised?"
  },
  {
    "seedKey": "jamie-2026-11-19:every-kind-of-dad:4",
    "circle": "Every Kind of Dad",
    "prompt": "What do you wish people understood about your situation?"
  },
  {
    "seedKey": "jamie-2026-11-19:every-kind-of-dad:5",
    "circle": "Every Kind of Dad",
    "prompt": "What's something about being a dad that surprised you?"
  },
  {
    "seedKey": "jamie-2026-11-19:every-kind-of-dad:6",
    "circle": "Every Kind of Dad",
    "prompt": "Who's a dad you look up to, and why?"
  }
]
$prompts$);
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select pg_temp.expect(jsonb_array_length(preview_community_prompt_import((select value from fixture_prompts),'b3000000-0000-4000-8000-000000000001'))=24,'preview resolves 24 prompts to existing circle UUIDs');
reset role;
select pg_temp.expect((select count(*)=0 from community_prompt_seeds),'preview performs no publishing');
set local role service_role;
select import_community_prompts((select value from fixture_prompts),'b3000000-0000-4000-8000-000000000001');
select import_community_prompts((select value from fixture_prompts),'b3000000-0000-4000-8000-000000000001');
reset role;
select pg_temp.expect((select count(*)=24 from community_prompt_seeds),'duplicate-safe reimport inserts exactly 24');
select pg_temp.expect(not exists(select 1 from jsonb_array_elements((select value from fixture_prompts)) v left join community_prompt_seeds seed on seed.seed_key=v->>'seedKey' left join posts p on p.id=seed.post_id where p.content is distinct from v->>'prompt'),'all supplied copy preserved verbatim');
select pg_temp.expect((select count(*)=4 from (select circle_id from community_prompt_seeds group by circle_id having count(*)=6) c),'six prompts per circle');
set local role service_role;
select pg_temp.reject($q$select import_community_prompts(jsonb_set((select value from fixture_prompts),'{0,prompt}','"rewritten"'),'b3000000-0000-4000-8000-000000000001')$q$,'22023','reimport never rewrites historical seeded copy');
select pg_temp.reject($q$select import_community_prompts('[]','b3000000-0000-4000-8000-000000000001')$q$,'22023','incomplete import rejected');
reset role;
select pg_temp.expect((select count(*) from circle_prompts)=(select n from original_catalogue),'existing prompt catalogue unchanged');
select pg_temp.expect((select count(*)=24 from posts p join community_prompt_seeds s on p.id=s.post_id where p.official_author and p.user_id='b3000000-0000-4000-8000-000000000001'),'24 ordinary official discussion posts');
select pg_temp.expect(not has_table_privilege('authenticated','community_prompt_seeds','INSERT'),'clients cannot create seed receipts');
select pg_temp.expect(not has_table_privilege('authenticated','community_prompt_seeds','UPDATE'),'clients cannot edit seed receipts');
set local role service_role;
select pg_temp.expect(not exists(select 1 from jsonb_array_elements(preview_community_prompt_import((select value from fixture_prompts),'b3000000-0000-4000-8000-000000000001')) r where r->>'action'<>'existing'),'exact reimport preview is no-op');
select pg_temp.reject($q$select preview_community_prompt_import((select value from fixture_prompts),'b3000000-0000-4000-8000-000000000002')$q$,'42501','unverified nonpublisher cannot import');
select pg_temp.reject($q$select preview_community_prompt_import(jsonb_set((select value from fixture_prompts),'{0,circleId}','"00000000-0000-4000-8000-000000000000"'),'b3000000-0000-4000-8000-000000000001')$q$,'22023','changed circle UUID requires review');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','b3000000-0000-4000-8000-000000000001',true);
select pg_temp.reject($q$insert into posts(user_id,content,tag) values(auth.uid(),'manual hourly fixture','general')$q$,'23505','publisher manual posts retain hourly limit');
select pg_temp.reject($q$insert into posts(user_id,content,tag,seeded_prompt) values(auth.uid(),'forged seed','general',true)$q$,'23505','forged seed flag cannot bypass hourly limit');
update posts set seeded_prompt=true where id='b3000000-0000-4000-8000-000000000050';
select pg_temp.expect((select not seeded_prompt from posts where id='b3000000-0000-4000-8000-000000000050'),'normal post edit cannot acquire seed exemption');
reset role;
update posts set seeded_prompt=false where id in(select post_id from community_prompt_seeds);
select pg_temp.expect((select count(*)=24 from posts where seeded_prompt),'later edits preserve seed provenance');
-- Deleted seed receipt survives without raw content and cannot republish the post.
delete from posts where id=(select post_id from community_prompt_seeds order by seed_key limit 1);
set local role service_role;
select import_community_prompts((select value from fixture_prompts),'b3000000-0000-4000-8000-000000000001');
reset role;
select pg_temp.expect((select count(*)=23 from posts where seeded_prompt),'reimport never resurrects deleted seeded posts');

delete from community_publishers where user_id='b3000000-0000-4000-8000-000000000001';
update posts set content='normal edit',official_author=false where id='b3000000-0000-4000-8000-000000000020';
select pg_temp.expect((select official_author from posts where id='b3000000-0000-4000-8000-000000000020'),'normal edit after revocation preserves historical official stamp');
set local role authenticated;
select set_config('request.jwt.claim.sub','b3000000-0000-4000-8000-000000000001',true);
insert into comments(id,user_id,post_id,content) values('b3000000-0000-4000-8000-000000000031',auth.uid(),'b3000000-0000-4000-8000-000000000020','after revocation');
select pg_temp.expect((select not official_author from comments where id='b3000000-0000-4000-8000-000000000031'),'revoked publisher cannot create new official content');
reset role;
update posts set user_id=null,content='',removed_at=clock_timestamp() where id='b3000000-0000-4000-8000-000000000020';
select pg_temp.expect((select not official_author from posts where id='b3000000-0000-4000-8000-000000000020'),'deletion placeholder never retains official identity');
-- Phase 1 deletion must be able to remove both post and publisher references.
select set_config('request.jwt.claim.role','service_role',true);
select confirm_account_privacy_operation('b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000090','delete',repeat('c',64),null,now()+interval '5 minutes');
select request_account_privacy_operation('b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000090','delete',repeat('c',64),repeat('d',64));
select pg_temp.expect(public.cleanup_account_private_records(id,lease_token),'Phase 1 cleanup succeeds with imported posts') from public.claim_account_privacy_operations(1);
delete from auth.users where id='b3000000-0000-4000-8000-000000000001';
select pg_temp.expect((select count(*)=24 from community_prompt_seeds where publisher_id is null and post_id is null),'Phase 1 removal clears seed identity without losing deduplication receipts');
rollback;
