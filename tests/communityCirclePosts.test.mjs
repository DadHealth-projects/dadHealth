import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('Circle post migration preserves global rows and enforces private related-data visibility', async () => {
  const sql = await source('supabase/migrations/20261012130000_community_circle_posts.sql');
  for (const required of [
    "add column if not exists visibility text not null default 'public'",
    'add column if not exists circle_id uuid',
    'on delete restrict',
    'create policy "Anyone can browse Circle directory"',
    'circle_id is null or public.can_read_community_post(id)',
    'public.can_read_community_post(post_id)',
    'auth.uid() = user_id and public.can_read_community_post(post_id)',
    'public.can_read_community_comment(comment_id)',
    'Read prompts for public or joined Circles',
    'where p.circle_id is null or public.is_circle_member(p.circle_id)',
    'public.get_community_global_feed',
    'and public.is_circle_member(c.id)',
    'public.get_trending_circle_posts',
    'order by (e.likes_count * 2 + e.replies_count * 3) desc',
  ]) assert.ok(sql.includes(required), `Missing SQL privacy contract: ${required}`);
  assert.match(sql, /circle_id is null or public\.is_circle_member\(p\.circle_id\)/);
});

test('Circle posts preserve notification safety and anonymous deletion/moderation paths', async () => {
  const [events, schema, rls, migration] = await Promise.all([
    source('src/app/api/notifications/events/route.ts'),
    source('supabase/schema.sql'),
    source('supabase/rls-policies.sql'),
    source('supabase/tests/community_circle_visibility_test.sql'),
  ]);
  assert.match(events, /canNotifyPrivateCircleMember/);
  assert.match(events, /user_circles/);
  assert.match(schema, /delete_own_community_post/);
  assert.match(schema, /capture_anonymous_post_owner/);
  assert.match(rls, /public\.can_read_community_post/);
  for (const scenario of ['Circle directory stays discoverable without exposing private posts', 'legacy null-Circle post remains globally readable', 'main feed keeps global posts and excludes undiscovered public Circle posts', 'main trending previews exclude Circles anon has not joined', 'main feed includes global posts and posts from both joined Circles', 'main trending previews include joined public and private Circles', 'private Circle members see only their own saved-post data', 'nonmember cannot read private replies', 'member can post anonymously to private Circle', 'leaving private Circle removes post access immediately', 'moderation service role retains access']) {
    assert.ok(migration.includes(scenario), `Missing database regression case: ${scenario}`);
  }
});
