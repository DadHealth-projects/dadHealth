import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const container = process.env.ANALYTICS_EXPORT_TEST_CONTAINER;
test('maintenance scheduler uses authenticated POST, starts inactive and preserves existing jobs', { skip: !container }, () => {
  assert.match(container, /^dadhealth-analytics-(?:export-)?local-/);
  const database = `maintenance_${Date.now()}`;
  const sql = input => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At'], { input, encoding: 'utf8' }).trim();
  execFileSync('docker', ['exec', container, 'createdb', '-U', 'postgres', database]);
  try {
    // Real PostgreSQL permissions/function execution; pg_net is a recording fixture,
    // not a network call. No real Vault values or scheduler jobs are used.
    sql(`create schema vault; create schema net; create schema cron;
      create table vault.decrypted_secrets(name text, decrypted_secret text);
      insert into vault.decrypted_secrets values
        ('analytics_worker_url','https://www.dadhealth.co.uk/api/analytics/process'),
        ('analytics_worker_secret','fixture-only');
      create table net.calls(url text, headers jsonb, body jsonb);
      create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
        returns bigint language plpgsql as $$begin insert into net.calls values(url,headers,body);return 1;end $$;
      create table cron.job(jobid bigint generated always as identity,jobname text,schedule text,command text,active boolean default true);
      create function cron.schedule(job_name text,expression text,statement text) returns bigint language plpgsql as $$
        declare id bigint;begin insert into cron.job(jobname,schedule,command) values(job_name,expression,statement) returning jobid into id;return id;end $$;
      create function cron.alter_job(id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;
      insert into cron.job(jobname,schedule,command,active) values
        ('optional-analytics-worker','* * * * *','delivery',false),('account-privacy-worker','* * * * *','privacy',true);
      do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;create role anon;create role authenticated;end if;end $$;`);
    const setup = readFileSync('supabase/analytics-maintenance-scheduler.sql', 'utf8');
    sql(setup); sql(setup);
    assert.equal(sql(`select count(*) from cron.job where jobname='optional-analytics-maintenance' and not active and schedule='0 * * * *';`), '1');
    assert.equal(sql(`select count(*) from cron.job where (jobname='optional-analytics-worker' and not active) or (jobname='account-privacy-worker' and active);`), '2');
    assert.equal(sql(`select count(*) from net.calls;`), '0');
    assert.equal(sql(`select has_function_privilege('service_role','public.invoke_analytics_maintenance()','EXECUTE');`), 'f');
    sql(`select public.invoke_analytics_maintenance();`);
    assert.equal(sql(`select count(*) from net.calls where url='https://www.dadhealth.co.uk/api/analytics/maintenance' and headers->>'Authorization'='Bearer fixture-only' and body='{}'::jsonb;`), '1');
    sql(`update vault.decrypted_secrets set decrypted_secret='https://untrusted.invalid/' where name='analytics_worker_url';`);
    assert.throws(() => sql(`select public.invoke_analytics_maintenance();`));
    assert.equal(sql(`select count(*) from net.calls;`), '1');
  } finally { execFileSync('docker', ['exec', container, 'dropdb', '-U', 'postgres', database]); }
});
