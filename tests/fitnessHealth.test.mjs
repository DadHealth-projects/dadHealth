import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('workout generation keeps basic mode free and personalised mode Pro-only', async () => {
  const source = await readFile(new URL('src/app/api/generate-workout/route.ts', root), 'utf8');

  assert.match(source, /const mode: WorkoutMode = body\.mode \?\? "personalised"/);
  assert.match(source, /if \(mode === "personalised"\) \{/);
  assert.match(source, /Personalised workouts are included with Dad Health Pro/);
  assert.match(source, /mode === "basic" \? BASIC_WORKOUT\.durationMins/);
  assert.match(source, /durationMins: 20/);
  assert.match(source, /equipment: "none"/);
  assert.match(source, /focus: "full_body"/);
  assert.match(source, /How the dad feels today/);
  assert.match(source, /"pro_required"/);
  assert.match(source, /"session_expired"/);
  assert.match(source, /"temporarily_unavailable"/);
});
