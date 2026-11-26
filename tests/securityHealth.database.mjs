// Opt-in, disposable local PostgreSQL only; never accepts a URL or production host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const container = 'dadhealth-security-health-test';
const enabled = process.env.RUN_SECURITY_HEALTH_DB === '1';
const file = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const database = 'security_health_' + process.pid;
function sql(text, db = database) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function connection(text) {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1']);
  let output = '', error = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { error += chunk; });
  const finished = new Promise(resolve => child.on('close', code => resolve({ code, output, error })));
  child.stdin.write(text + '\n');
  return { child, finished, output: () => output };
}
const owner = '00000000-0000-0000-0000-000000000001';
const link = '10000000-0000-0000-0000-000000000001';
const member = `set role authenticated; set request.jwt.claim.sub='${owner}';`;
const upload = `select sync_native_health_daily_data('apple_health','${link}','[]','[]',true);`;
async function locked(client) {
  for (let i = 0; i < 100; i++) {
    if (client.output().includes('LOCKED')) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Fixture connection failed to acquire lock');
}
test('isolated security and health database acceptance', { skip: !enabled }, async t => {
  sql(`create database ${database}`, 'postgres');
  const fixture = file('supabase/tests/security_health_fixture.sql').replace(
    'create role anon; create role authenticated; create role service_role bypassrls;',
    () => "do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; create role authenticated; create role service_role bypassrls; end if; end $$;",
  );
  sql(fixture);
  sql(file('supabase/migrations/20261126120000_security_least_privilege.sql'));
  sql(file('supabase/migrations/20261126121000_health_sync_boundaries.sql'));
  await t.test('effective grants, inherited PUBLIC, six wrappers, owner guards and manual corrections', () => {
    assert.match(sql(file('supabase/tests/security_health_assertions.sql')), /assertions passed/);
  });
  await t.test('repository workout and recipe policies retain guest weekly reads and Pro restrictions', () => {
    sql(`alter table workouts add primary key(id); alter table workouts add column source text; alter table workouts add column user_id uuid;
      create function user_has_pro_access(uuid) returns boolean language sql stable security definer as
      $$select $1='00000000-0000-0000-0000-000000000002'::uuid$$;
      alter table recipes add column cook_together boolean;
      create table free_weekly_recipe_assignments(week_start date,recipe_id uuid);
      grant select on free_weekly_recipe_assignments to anon,authenticated;
      alter table recipes enable row level security;`);
    sql(file('supabase/migrations/20261016150000_weekly_free_workout_assignment.sql'));
    const recipe = file('supabase/migrations/20261016160000_cook_together_weekly_access.sql');
    sql(recipe.slice(recipe.indexOf('create or replace function public.can_access_cook_together_recipe'), recipe.indexOf('create or replace function public.admin_set_free_weekly_recipe')));
    for (const name of ['Read eligible Cook Together recipes', 'Restrict Cook Together recipe reads to Pro or weekly assignment']) {
      const definition = recipe.match(new RegExp('create policy "' + name + '"[\\s\\S]*?;'));
      assert.ok(definition);
      sql(definition[0]);
    }
    sql(file('supabase/migrations/20261126120000_security_least_privilege.sql'));
    sql(`insert into workouts values('30000000-0000-0000-0000-000000000001','admin',null),('30000000-0000-0000-0000-000000000002','admin',null);
      insert into free_weekly_workout_assignments(week_start,workout_id) values(date_trunc('week',current_date)::date,'30000000-0000-0000-0000-000000000001');
      insert into recipes values('40000000-0000-0000-0000-000000000001',true),('40000000-0000-0000-0000-000000000002',true);
      insert into free_weekly_recipe_assignments values(date_trunc('week',current_date)::date,'40000000-0000-0000-0000-000000000001');`);
    for (const table of ['workouts', 'recipes']) {
      assert.equal(sql(`set role anon; select count(*) from ${table}`), '1', 'guest weekly selection');
      assert.equal(sql(member + `select count(*) from ${table}`), '1', 'Free weekly selection');
      assert.equal(sql(`set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'; select count(*) from ${table}`), '2', 'Pro access');
    }
  });
  await t.test('actual community helpers preserve blocks, private circles and anonymous attribution', () => {
    sql(`alter table posts add column circle_id uuid; alter table comments add column post_id uuid;
      create table circles(id uuid primary key,visibility text);
      create table circle_members(circle_id uuid,user_id uuid);
      create table community_blocks(user_id uuid,blocked_user_id uuid);
      create table anonymous_post_owners(post_id uuid,user_id uuid);
      create function is_circle_member(uuid) returns boolean language sql stable security definer as
      $$select exists(select 1 from circle_members where circle_id=$1 and user_id=auth.uid())$$;`);
    const original = file('supabase/migrations/20261119120000_community_report_block.sql');
    for (const name of ['community_target_author', 'community_author_visible', 'can_read_community_post', 'can_read_community_comment']) {
      const definition = original.match(new RegExp('create (?:or replace )?function public\\.' + name + '\\([\\s\\S]*?\\$\\$;'));
      assert.ok(definition, name);
      sql(definition[0]);
    }
    const target = '00000000-0000-0000-0000-000000000002';
    const circle = '20000000-0000-0000-0000-000000000001';
    const names = `select count(*) from get_comment_author_names(array['${target}'::uuid]);`;
    sql(`insert into circles values('${circle}','private'); update posts set circle_id='${circle}';`);
    assert.equal(sql(member + names), '0', 'private circle hidden');
    sql(`insert into circle_members values('${circle}','${owner}');`);
    assert.equal(sql(member + names), '1', 'membership permits name');
    sql(`insert into community_blocks values('${owner}','${target}');`);
    assert.equal(sql(member + names), '0', 'blocked author hidden');
    sql(`delete from community_blocks; update posts set anonymous=true;`);
    assert.equal(sql(member + names), '0', 'anonymous author stays private');
    sql(`insert into comments(id,user_id,removed_at,visible,post_id) select gen_random_uuid(),'${target}',null,true,id from posts;`);
    assert.equal(sql(member + names), '1', 'named visible comment permits attribution');
    sql(`insert into community_blocks values('${owner}','${target}');`);
    assert.equal(sql(member + names), '0', 'blocked comment author hidden');
  });
  await t.test('disconnect committing first rejects waiting upload', async () => {
    const disconnect = connection(`begin; delete from user_integrations where id='${link}'; select 'LOCKED';`);
    await locked(disconnect);
    const uploadClient = connection(member + upload);
    uploadClient.child.stdin.end();
    disconnect.child.stdin.end('commit;\n');
    assert.equal((await disconnect.finished).code, 0);
    const result = await uploadClient.finished;
    assert.notEqual(result.code, 0);
    assert.match(result.error, /integration_not_connected/);
    sql(`insert into user_integrations values('${link}','${owner}','apple_health',null)`);
  });
  await t.test('upload committing first serializes disconnect; all later uploads fail', async () => {
    const uploadClient = connection(`begin; ${member}${upload} select 'LOCKED';`);
    await locked(uploadClient);
    const disconnect = connection(`delete from user_integrations where id='${link}';`);
    disconnect.child.stdin.end();
    uploadClient.child.stdin.end('commit;\n');
    assert.equal((await uploadClient.finished).code, 0);
    assert.equal((await disconnect.finished).code, 0);
    assert.equal(sql(`select count(*) from user_integrations where id='${link}'`), '0');
  });
  await t.test('Auth cascade removes imported daily data and preserves other owner', () => {
    sql(`insert into body_metrics values('00000000-0000-0000-0000-000000000002','steps',42,now(),'manual'); delete from auth.users where id='${owner}';`);
    assert.equal(sql(`select count(*) from body_metrics where user_id='${owner}'`), '0');
    assert.equal(sql(`select count(*) from sleep_logs where user_id='${owner}'`), '0');
    assert.equal(sql('select count(*) from body_metrics'), '1');
  });
  // Retain failed fixtures for diagnosis; successful fixture database is disposable.
  sql(`drop database ${database}`, 'postgres');
});
