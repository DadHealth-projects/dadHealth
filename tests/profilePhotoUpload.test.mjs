import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const route = await readFile(new URL('../src/app/api/profile/photo/route.ts', import.meta.url), 'utf8');

test('profile photo API accepts up to 20 MB and validates actual JPEG, PNG, or HEIF content', () => {
  assert.match(route, /MAX_PHOTO_SIZE\s*=\s*20\s*\*\s*1024\s*\*\s*1024/);
  assert.match(route, /const declaredMimeType = file\.type\.toLowerCase\(\)/);
  assert.match(route, /"application\/octet-stream"/);
  assert.match(route, /if \(declaredMimeType && !ALLOWED_DECLARED_MIME_TYPES\.has\(declaredMimeType\)\)/);
  assert.match(route, /const metadata = await image\.metadata\(\)/);
  assert.match(route, /ALLOWED_IMAGE_TYPES\.has\(metadata\.format\)/);
  assert.match(route, /resize\(\{ width: 800, height: 800/);
  assert.match(route, /jpeg\(\{ quality: 84/);
});

test('profile photo API returns distinct validation and processing error codes, preserving storage behavior', () => {
  for (const code of ['missing_photo', 'invalid_image', 'photo_too_large', 'unsupported_image_format', 'image_processing_failed']) {
    assert.ok(route.includes(`error: "${code}"`), `missing API error ${code}`);
  }
  assert.match(route, /from\(BUCKET\)\.upload\(path, output[\s\S]*?upsert: true/);
  assert.match(route, /from\("user_profile"\)\.update\(\{ avatar_url: avatarUrl \}\)/);
});
