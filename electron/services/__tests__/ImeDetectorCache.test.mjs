// Regression test for electron/services/ImeDetector.ts.
//
// This module is the M3 / IME-fix backbone behind PR #250's senior-review
// remediation. It exports two functions:
//
//   shouldAutoEngageStealthTap(): boolean
//     • macOS: shells `defaults read com.apple.HIToolbox` once, caches the
//       inverted boolean. True ⇒ no IME present ⇒ tap is safe to engage.
//     • Non-macOS: always returns true unconditionally. The non-darwin
//       `stealth-tap:should-auto-engage` IPC returns true for the same reason:
//       on Windows/Linux there is no CGEventTap so this gate is irrelevant
//       and the actual stealth typing path is decided by isCgEventTapAvailable.
//
//   refreshImeDetection(): void
//     • Clears the cache so the next call re-probes. The renderer calls this
//       on `window.focus` (M3 fix) — users who add Pinyin/Hangul mid-session
//       would otherwise stay on the stale cached value and silently break
//       composition the next time the tap auto-engages.
//
// We load the compiled CommonJS output from dist-electron, matching the
// pattern used by the other dist-electron service tests. The
// `process.platform` read happens at call time (line 68 of the source), so
// per-test mutation works without module-level mocking.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// Local stand-in for `defaults read com.apple.HIToolbox` (PLAN.md AG-17 review). The
// isolation guard blocks child processes, and the real output depends on the host's
// input sources, so the darwin branch is tested against fixed outputs. The compiled
// module reads `execFileSync` from the shared child_process object at call time.
const childProcess = createRequire(import.meta.url)('node:child_process');
const realExecFileSync = childProcess.execFileSync;
const defaultsCalls = [];
let defaultsResult = '';
childProcess.execFileSync = (cmd, args, opts) => {
  if (cmd !== 'defaults') return realExecFileSync(cmd, args, opts);
  defaultsCalls.push(args);
  if (defaultsResult instanceof Error) throw defaultsResult;
  return defaultsResult;
};
const ASCII_ONLY = '{\n    AppleEnabledInputSources = (\n        {\n            InputSourceKind = "Keyboard Layout";\n            "KeyboardLayout Name" = "U.S.";\n        }\n    );\n}\n';
const WITH_PINYIN = '{\n    AppleEnabledInputSources = (\n        {\n            "Bundle ID" = "com.apple.inputmethod.SCIM";\n            InputSourceKind = "Keyboard Input Method";\n        }\n    );\n}\n';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const COMPILED = path.join(
  root,
  'dist-electron/electron/services/ImeDetector.js',
);

// If the compiled artifact is missing (someone ran `node --test` without the
// usual `npm test` wrapper which runs build:electron first), fail loud with
// a hint instead of an opaque ERR_MODULE_NOT_FOUND.
if (!fs.existsSync(COMPILED)) {
  throw new Error(
    `Compiled ImeDetector.js missing at ${COMPILED}. ` +
      `Run 'npm run build:electron' before this test, or use 'npm test' which does it for you.`,
  );
}

const mod = await import(pathToFileURL(COMPILED).href);
const { shouldAutoEngageStealthTap, refreshImeDetection } = mod;

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(value) {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  // Always start each test with a freshly-cleared cache and the real platform
  // restored so leakage between tests can't mask a regression.
  refreshImeDetection();
  setPlatform(ORIGINAL_PLATFORM);
});

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM);
  refreshImeDetection();
});

describe('ImeDetector module surface', () => {
  test('exports both expected functions', () => {
    assert.equal(
      typeof shouldAutoEngageStealthTap,
      'function',
      'shouldAutoEngageStealthTap must be exported',
    );
    assert.equal(
      typeof refreshImeDetection,
      'function',
      'refreshImeDetection must be exported — M3 depends on it',
    );
  });
});

describe('shouldAutoEngageStealthTap: platform branching', () => {
  test('returns true on win32 (no CGEventTap → gate irrelevant)', () => {
    setPlatform('win32');
    assert.equal(
      shouldAutoEngageStealthTap(),
      true,
      'Windows must always report auto-engage OK; the actual gate is isCgEventTapAvailable',
    );
  });

  test('returns true on linux (no CGEventTap → gate irrelevant)', () => {
    setPlatform('linux');
    assert.equal(shouldAutoEngageStealthTap(), true);
  });

  test('non-darwin path does NOT shell out to `defaults` (would 100ms-stall on every call)', () => {
    // The non-darwin branch must short-circuit BEFORE probeOnce().
    setPlatform('linux');
    defaultsCalls.length = 0;
    shouldAutoEngageStealthTap();
    setPlatform('win32');
    shouldAutoEngageStealthTap();
    assert.deepEqual(defaultsCalls, [], 'non-darwin path must not run `defaults`');
  });

  test('darwin with only keyboard layouts: probes `defaults` once and allows auto-engage', () => {
    setPlatform('darwin');
    defaultsResult = ASCII_ONLY;
    defaultsCalls.length = 0;
    assert.equal(shouldAutoEngageStealthTap(), true);
    assert.deepEqual(defaultsCalls, [['read', 'com.apple.HIToolbox']]);
  });

  test('darwin with an input method enabled: does not auto-engage', () => {
    setPlatform('darwin');
    defaultsResult = WITH_PINYIN;
    assert.equal(shouldAutoEngageStealthTap(), false);
  });

  test('darwin probe failure fails open (auto-engage allowed)', () => {
    setPlatform('darwin');
    defaultsResult = new Error('defaults: domain does not exist');
    assert.equal(shouldAutoEngageStealthTap(), true);
  });

  test('darwin result is cached until refreshImeDetection(), then re-probed (M3)', () => {
    setPlatform('darwin');
    defaultsResult = ASCII_ONLY;
    defaultsCalls.length = 0;
    assert.equal(shouldAutoEngageStealthTap(), true);
    defaultsResult = WITH_PINYIN; // the user adds Pinyin mid-session
    assert.equal(shouldAutoEngageStealthTap(), true, 'cached value is used until a refresh');
    assert.equal(defaultsCalls.length, 1);
    refreshImeDetection();
    assert.equal(shouldAutoEngageStealthTap(), false, 'refresh must re-probe and see the new input method');
    assert.equal(defaultsCalls.length, 2);
  });
});

describe('refreshImeDetection: cache invalidation', () => {
  test('does not throw when called with no prior probe', () => {
    setPlatform('linux');
    assert.doesNotThrow(() => refreshImeDetection());
  });

  test('does not throw when called after a probe', () => {
    setPlatform('linux');
    shouldAutoEngageStealthTap(); // populate (though non-darwin doesn't actually cache)
    assert.doesNotThrow(() => refreshImeDetection());
  });

  test('repeated invalidation is safe', () => {
    setPlatform('linux');
    for (let i = 0; i < 10; i += 1) {
      assert.doesNotThrow(() => refreshImeDetection());
    }
  });

  test('M3 contract: refresh + shouldAutoEngage still returns boolean on every platform', () => {
    // Mirrors the renderer call shape:
    //   stealthTapRefreshIme().then((ok) => stealthAutoEngageOkRef.current = !!ok);
    // The IPC body is `refreshImeDetection(); return shouldAutoEngageStealthTap();`.
    // Both halves must succeed on every platform.
    for (const plat of ['darwin', 'win32', 'linux']) {
      setPlatform(plat);
      refreshImeDetection();
      const result = shouldAutoEngageStealthTap();
      assert.equal(
        typeof result,
        'boolean',
        `platform=${plat}: refresh + auto-engage chain must return boolean`,
      );
    }
  });
});

describe('IPC wire-up sanity — the renderer + main code paths reference these exports', () => {
  // Defensive: the renderer calls window.electronAPI.stealthTapRefreshIme(),
  // which main.ts dispatches into refreshImeDetection() + shouldAutoEngageStealthTap().
  // Verify the main-process handler still references both names so that a
  // future "let's inline this" refactor doesn't silently strip the refresh.
  test('main.ts stealth-tap:refresh-ime handler still calls both ImeDetector exports', () => {
    const main = fs.readFileSync(
      path.join(root, 'electron/main.ts'),
      'utf8',
    );
    // Grab the refresh-ime handler block; must include both calls.
    const block = main.match(
      /registerStealthHandler\('stealth-tap:refresh-ime',[\s\S]*?\}\);/,
    );
    assert.ok(block, 'stealth-tap:refresh-ime registration not found in main.ts');
    assert.match(
      block[0],
      /refreshImeDetection\(\)/,
      'M3: refresh-ime handler must call refreshImeDetection() to invalidate the cache',
    );
    assert.match(
      block[0],
      /shouldAutoEngageStealthTap\(\)/,
      'M3: refresh-ime handler must return the refined value via shouldAutoEngageStealthTap()',
    );
  });
});
