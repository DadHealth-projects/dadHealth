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
    'description: string | null',
    'Add a description for this Dad Circle',
    'Member count is managed automatically.',
    '{editId ? null : loading ? (',
  ]) {
    assert.ok(page.includes(expected), `Missing Circles admin UI contract: ${expected}`);
  }
});

test("Circle API accepts Admin-managed descriptions and never exposes member count writes", async () => {
  const route = await source("src/app/api/admin/[resource]/route.ts");

  assert.match(route, /case "circles": \{[\s\S]*?\.from\("circles"\)[\s\S]*?\.select\("id, name, description, icon, members_count"\)/);
  assert.match(route, /const allowedKeys = new Set\(requireId \? \["id", "name", "icon", "description"\] : \["name", "icon", "description"\]\)/);
  assert.match(route, /description = typeof record\.description === "string" \? record\.description\.trim\(\) \|\| null : null/);
  assert.match(route, /if \(resource === "circles"\) \{[\s\S]*?parseCircleWrite\(body, true\)/);
  assert.match(route, /parseCircleId\(body\)/);
  assert.match(route, /This Circle no longer exists\./);
  assert.equal(route.includes('members_count: body.members_count'), false);
  assert.equal(route.includes('members_count: record.members_count'), false);
});

test("circle descriptions migrate additively without changing circle access policies or live data", async () => {
  const [migration, schema, policies] = await Promise.all([
    source("supabase/migrations/20260928150000_change08_present_dad_and_circle_descriptions.sql"),
    source("supabase/schema.sql"),
    source("supabase/rls-policies.sql"),
  ]);

  const reviewedPolicy = /alter table public\.circles enable row level security;[\s\S]*?revoke all privileges[\s\S]*?on table public\.circles[\s\S]*?from anon, authenticated;[\s\S]*?grant select[\s\S]*?on table public\.circles[\s\S]*?to anon, authenticated;[\s\S]*?create policy "Anyone can read circles"[\s\S]*?for select[\s\S]*?to anon, authenticated[\s\S]*?using \(true\);/;
  assert.match(schema, reviewedPolicy);
  assert.match(policies, reviewedPolicy);
  assert.match(migration, /alter table public\.circles\s+add column if not exists description text/);
  assert.equal(/update\s+public\.circles/i.test(migration), false, 'Existing Admin descriptions are not overwritten');
});
