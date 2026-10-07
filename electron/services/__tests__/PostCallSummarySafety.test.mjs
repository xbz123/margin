import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..', '..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('MeetingPersistence no longer iterates reference file bodies inline for summary', () => {
  const src = read('electron/MeetingPersistence.ts');

  // The legacy inline iteration used a per-file MAX_FILE_CHARS / MAX_TOTAL_CHARS
  // pair plus a getReferenceFiles call directly inside processAndSaveMeeting().
  assert.doesNotMatch(src, /const MAX_FILE_CHARS = 12_000;/);
  assert.doesNotMatch(src, /const MAX_TOTAL_CHARS = 40_000;/);
  assert.doesNotMatch(src, /getReferenceFiles\(/);
});

// PLAN.md AG-13: the summary prompt carries no mode or reference-file context and
// always uses the fixed sections a fresh install seeded for its General mode.
test('MeetingPersistence summary uses the fixed default sections and no mode context', () => {
  const src = read('electron/MeetingPersistence.ts');

  assert.doesNotMatch(src, /modeSnapshot|modeContextBlock/);
  assert.match(src, /const noteSections = DEFAULT_SUMMARY_SECTIONS;/);
  assert.match(src, /\{ title: 'Summary', +description: 'High-level summary of the conversation\.' \}/);
  assert.match(src, /\{ title: 'Action items', +description: 'Tasks and follow-ups identified\.' \}/);
  assert.match(src, /\{ title: 'Key points', +description: 'Important points discussed\.' \}/);
});
