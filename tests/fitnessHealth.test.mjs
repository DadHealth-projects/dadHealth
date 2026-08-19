import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

for (const file of ['src/app/fitness/page.tsx', 'src/components/home/DadStrengthSection.tsx']) {
  test(`${file} aligns health metrics with their displayed date`, async () => {
    const source = await readFile(new URL(file, root), 'utf8');

    assert.match(source, /workouts\[0\]\?\.performed_at, bodyMetrics\[0\]\?\.recorded_at/);
    assert.match(source, /m\.metric_type === "active_mins" && m\.recorded_at\.slice\(0, 10\) === todayKey/);
  });
}
