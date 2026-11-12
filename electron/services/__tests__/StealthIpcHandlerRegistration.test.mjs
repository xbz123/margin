// Regression test for the stealth-tap IPC registration helper introduced in
// the fix for the PR #250 senior-review m1 finding.
//
// Context — what bug we are guarding against:
//   electron/main.ts registers six `stealth-tap:*` IPC channels at app.ready.
//   Electron's `ipcMain.handle(channel, fn)` throws "Attempted to register a
//   second handler for '<channel>'" when the same channel is registered twice.
//   In normal production startup this never fires, but two real paths can:
//     • Single-instance second-launch — when a second invocation hits the
//       existing process, our `second-instance` handler runs but `app.ready`
//       has already fired; in dev HMR setups the registration block has been
//       observed to re-execute via the requestSingleInstanceLock path.
//     • Manual `app.emit('ready')` during integration testing or future
//       service-bootstrap refactors.
//   When the duplicate throw propagates, the renderer's `stealthTapAvailable()`
//   invoke rejects, `isCgEventTapAvailableRef` silently stays at its safe-false
//   default, and the chat input quietly stops gating stealth typing — the
//   exact silent-failure mode PR #250 set out to eliminate.
//
//   The m1 fix wraps every registration in `registerStealthHandler(channel, fn)`
//   which prepends `ipcMain.removeHandler(channel)`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

// ── Structural assertions on the real electron/main.ts ──
//
// These assertions ensure the
// production call sites actually USE the helper. If someone re-introduces a
// bare ipcMain.handle('stealth-tap:…') call, this fails and surfaces it.

test('every stealth-tap:* registration in main.ts goes through registerStealthHandler', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');

  // Make sure the helper exists and prepends removeHandler.
  const helper = main.match(
    /const registerStealthHandler = \([\s\S]*?\) => \{[\s\S]*?ipcMain\.removeHandler\([\s\S]*?ipcMain\.handle\([\s\S]*?\};/,
  );
  assert.ok(
    helper,
    'registerStealthHandler helper missing or no longer calls removeHandler before handle — this is the m1 contract',
  );

  // Find every line that registers a stealth-tap channel via the bare
  // ipcMain.handle path. There should be zero.
  const bareHandles = [
    ...main.matchAll(/ipcMain\.handle\(['"]stealth-tap:[^'"]+['"]/g),
  ];
  assert.deepEqual(
    bareHandles.map((m) => m[0]),
    [],
    'No stealth-tap channel may be registered via bare ipcMain.handle — use registerStealthHandler so a duplicate app.ready does not throw',
  );

  // And there must be at least the six expected helper call sites per platform
  // branch (12 total across darwin + non-darwin branches).
  const helperCalls = [
    ...main.matchAll(/registerStealthHandler\(['"]stealth-tap:[^'"]+['"]/g),
  ];
  assert.ok(
    helperCalls.length >= 12,
    `expected at least 12 registerStealthHandler('stealth-tap:*') call sites (6 per platform branch), found ${helperCalls.length}`,
  );
});
