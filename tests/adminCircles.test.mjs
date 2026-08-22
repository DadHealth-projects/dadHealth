import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("admin portal exposes Circle catalogue CRUD with visible request failures", async () => {
  const page = await source("src/app/admin/page.tsx");

  for (const expected of [
    '| "circles"',
    'id: "circles", label: "Circles"',
    'function CirclesTab()',
    'adminFetch("/api/admin/circles"',
    'title="Dad Circles"',
    'role="alert"',
    'members_count',
    'Member count is managed automatically.',
    '{editId ? null : loading ? (',
  ]) {
    assert.ok(page.includes(expected), `Missing Circles admin UI contract: ${expected}`);
  }
});

test("Circle API accepts only name and icon and never exposes member count writes", async () => {
  const route = await source("src/app/api/admin/[resource]/route.ts");

  assert.match(route, /case "circles": \{[\s\S]*?\.from\("circles"\)[\s\S]*?\.select\("id, name, icon, members_count"\)/);
  assert.match(route, /const allowedKeys = new Set\(requireId \? \["id", "name", "icon"\] : \["name", "icon"\]\)/);
  assert.match(route, /if \(resource === "circles"\) \{[\s\S]*?parseCircleWrite\(body, true\)/);
  assert.match(route, /parseCircleId\(body\)/);
  assert.match(route, /This Circle no longer exists\./);
  assert.equal(route.includes('members_count: body.members_count'), false);
  assert.equal(route.includes('members_count: record.members_count'), false);
});

test("Circles RLS is isolated, mirrored, and covered by role regression tests", async () => {
  const [migration, schema, policies, regression] = await Promise.all([
    source("supabase/migrations/20260821081000_circles_rls.sql"),
    source("supabase/schema.sql"),
    source("supabase/rls-policies.sql"),
    source("supabase/tests/circles_rls_test.sql"),
  ]);

  const reviewedPolicy = /alter table public\.circles enable row level security;[\s\S]*?revoke all privileges[\s\S]*?on table public\.circles[\s\S]*?from anon, authenticated;[\s\S]*?grant select[\s\S]*?on table public\.circles[\s\S]*?to anon, authenticated;[\s\S]*?create policy "Anyone can read circles"[\s\S]*?for select[\s\S]*?to anon, authenticated[\s\S]*?using \(true\);/;

  for (const sql of [migration, schema, policies]) {
    assert.match(sql, reviewedPolicy);
  }

  const migrationTables = [...migration.matchAll(/public\.([a-z_]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(migrationTables)], ["circles"]);

  for (const expected of [
    "set local role anon",
    "set local role authenticated",
    "set local role service_role",
    "anonymous clients can read circles",
    "authenticated clients can read circles",
    "anonymous clients cannot insert circles",
    "authenticated clients cannot update circles",
    "service role can delete circles",
    "membership insert increments members_count",
    "membership delete decrements members_count",
  ]) {
    assert.ok(regression.includes(expected), `Missing Circles RLS regression contract: ${expected}`);
  }
});
