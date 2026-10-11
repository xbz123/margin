// Phase 9 — source-level wiring tests. (The Phase 4 hybrid mode-retrieval
// checks were removed with the mode system, PLAN.md AG-13.)
// Phase 9: stopMeeting must early-return when meetingRetention is 'never'
//          OR when meeting metadata has doNotPersist === true.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('Phase 9 — Retention & doNotPersist gate in MeetingPersistence', () => {
  test('SettingsManager exposes meetingRetention setting', () => {
    const src = read('electron/services/SettingsManager.ts');
    assert.match(src, /meetingRetention\?:\s*['"]forever['"]\s*\|\s*['"]7d['"]\s*\|\s*['"]30d['"]\s*\|\s*['"]never['"]/);
  });

  test('stopMeeting short-circuits when meetingRetention is never', () => {
    const src = read('electron/MeetingPersistence.ts');
    // The gate reads the setting and the meta toggle, then early-returns.
    assert.match(src, /SettingsManager\.getInstance\(\)\.get\(['"]meetingRetention['"]\)/);
    assert.match(src, /retention\s*===\s*['"]never['"]/, 'must check for "never" retention');
    // Per-meeting toggle.
    assert.match(src, /doNotPersist/, 'must support per-meeting doNotPersist');
    // Early-return code path: no DB save.
    const window = src.slice(src.indexOf('public async stopMeeting'), src.indexOf('public async stopMeeting') + 3000);
    assert.match(window, /this\.session\.reset\(\);\s*\n\s*return null;/, 'do-not-persist path must reset and return null without saving');
  });

});
