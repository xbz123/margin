// Startup single-instance lock (rewritten in PLAN.md AG-17). The baseline version
// also required an ensureNativeModuleAbi() step that rebuilds or relaunches when a
// native module's ABI does not match. The baseline never had that step, and Margin
// builds native modules only through the reviewed `setup:native` (AG-08), so those
// assertions were dropped. What remains is the part that matters at startup: one
// lock request, made before any await, and a losing instance that exits at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

test('main requests the single-instance lock once', () => {
  assert.equal((mainSource.match(/requestSingleInstanceLock\s*\(/g) || []).length, 1);
});

test('the lock is taken before the first await of startup and a losing instance exits', () => {
  const initIndex = mainSource.indexOf('async function initializeApp()');
  const lockIndex = mainSource.indexOf('app.requestSingleInstanceLock()');
  const readyIndex = mainSource.indexOf('await app.whenReady()', initIndex);
  assert.ok(initIndex >= 0 && lockIndex > initIndex && readyIndex > lockIndex, 'lock must come before await app.whenReady()');
  assert.doesNotMatch(mainSource.slice(initIndex, lockIndex), /\bawait\b/, 'nothing may be awaited before the lock');
  assert.match(mainSource.slice(lockIndex, readyIndex), /if\s*\(\s*!gotLock\s*\)\s*\{[\s\S]*?app\.exit\(0\);\s*return;/);
  assert.match(mainSource, /\ninitializeApp\(\)\.catch\(/, 'initializeApp runs at module load');
});
