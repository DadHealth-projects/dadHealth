import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Community avatar RPC only resolves specific visible non-anonymous contributions for signed-in users', async () => {
  const [migration, schema, sqlTests] = await Promise.all([
    read('../supabase/migrations/20261030130000_community_author_avatar_lookup.sql'),
    read('../supabase/schema.sql'),
    read('../supabase/tests/community_author_avatars.test.sql'),
  ]);
  for (const source of [migration, schema]) {
    assert.match(source, /create or replace function public\.get_community_author_avatars/);
    assert.match(source, /auth\.uid\(\) is not null/);
    assert.match(source, /post\.anonymous is false/);
    assert.match(source, /comment\.anonymous is false/);
    assert.match(source, /post\.id = any\(coalesce\(p_post_ids/);
    assert.match(source, /comment\.id = any\(coalesce\(p_comment_ids/);
    assert.match(source, /grant execute on function public\.get_community_author_avatars\(uuid\[\], uuid\[\]\)\s+to authenticated/);
    assert.match(source, /public\.can_read_community_post\(post\.id\)/);
    assert.match(source, /public\.can_read_community_post\(comment\.post_id\)/);
  }
  for (const scenario of ['authenticated users can resolve Community author photos', 'anonymous database role cannot execute the avatar lookup', 'visible non-anonymous post resolves its author\'s photo by contribution ID', 'anonymous comment never resolves its author\'s photo, even if that author has another public post', 'private-circle post photo is hidden from nonmembers', 'authors without a photo return no avatar row', 'joined members can resolve a visible private-circle post photo', 'joined members can resolve a visible private-circle comment photo']) {
    assert.ok(sqlTests.includes(scenario), `missing SQL coverage: ${scenario}`);
  }
});
