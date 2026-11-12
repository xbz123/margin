// Regression test for the input-focus / mouse-down guard chain in
// src/components/NativelyInterface.tsx — the heart of PR #250 (issue #246,
// "Windows chat input unclickable in stealth mode") plus the M1 / M2 senior-
// review fixes.
//
// The guard chain lives in two places that MUST stay symmetric:
//
//   1. blockInputFocus (src/components/NativelyInterface.tsx ~line 3281)
//        const blockInputFocus = useCallback((e) => {
//          if (!stealthAutoEngageOkRef.current) return;
//          if (!isCgEventTapAvailableRef.current) return;     // M1
//          e.preventDefault();
//          if (document.activeElement === textInputRef.current) {
//            textInputRef.current?.blur();
//          }
//        }, []);
//
//   2. mount-effect onMouseDown (same file, ~line 3223)
//        const onMouseDown = (e) => {
//          if (stealthTapActiveRef.current) return;
//          if (!stealthAutoEngageOkRef.current) return;
//          if (!isCgEventTapAvailableRef.current) return;     // M2
//          ...
//          window.electronAPI.stealthTapStart().catch(...);
//        };
//

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const NATIVELY_INTERFACE = path.join(
  root,
  'src/components/NativelyInterface.tsx',
);

// ── Structural assertions on the real source ────────────────────────────
//
// These assertions guard the
// *implementation* against silent removal — if the production code stops
// checking isCgEventTapAvailableRef in either gate, the file changes and we
// surface it loud.

describe('NativelyInterface.tsx: guard implementation must keep checking both refs', () => {
  const source = fs.readFileSync(NATIVELY_INTERFACE, 'utf8');

  test('isCgEventTapAvailableRef defaults to false (M1 safe default)', () => {
    // The ref declaration must initialise to false. A `useRef<boolean>(true)`
    // would re-introduce the M1 hazard: input trapped until the IPC resolves.
    const refDecl = source.match(
      /const isCgEventTapAvailableRef\s*=\s*useRef<boolean>\(([^)]+)\)/,
    );
    assert.ok(refDecl, 'isCgEventTapAvailableRef declaration not found');
    assert.equal(
      refDecl[1].trim(),
      'false',
      'isCgEventTapAvailableRef must default to false so the input is clickable until availability is confirmed (M1)',
    );
  });

  test('blockInputFocus checks isCgEventTapAvailableRef before preventDefault', () => {
    // Pull the blockInputFocus body. We assert both the availability check
    // and that it sits BEFORE e.preventDefault().
    const body = source.match(
      /const blockInputFocus = useCallback\([\s\S]*?\}, \[\]\);/,
    );
    assert.ok(body, 'blockInputFocus callback not found');
    const idxAvailCheck = body[0].indexOf('isCgEventTapAvailableRef.current');
    const idxPreventDefault = body[0].indexOf('e.preventDefault()');
    assert.ok(
      idxAvailCheck >= 0,
      'blockInputFocus must consult isCgEventTapAvailableRef (M1 guard)',
    );
    assert.ok(
      idxPreventDefault >= 0,
      'blockInputFocus must call e.preventDefault() in the happy path',
    );
    assert.ok(
      idxAvailCheck < idxPreventDefault,
      'isCgEventTapAvailableRef check must precede e.preventDefault() — otherwise focus is blocked before the guard runs',
    );
  });

  test('mount-effect onMouseDown checks isCgEventTapAvailableRef before stealthTapStart (M2)', () => {
    // The chat-input click-to-engage listener. Find the onMouseDown that
    // sits inside the same useEffect as stealthTapStart and assert it
    // short-circuits when the ref is false.
    const effectMatch = source.match(
      /useEffect\(\(\) => \{[\s\S]*?stealthTapShouldAutoEngage[\s\S]*?stealthTapAvailable[\s\S]*?const onMouseDown[\s\S]*?stealthTapStart\([\s\S]*?\}, \[\]\);/,
    );
    assert.ok(
      effectMatch,
      'click-to-engage mount effect (stealthTapAvailable + onMouseDown + stealthTapStart) not found',
    );
    assert.match(
      effectMatch[0],
      /if \(!isCgEventTapAvailableRef\.current\) return;/,
      'M2: mount-effect onMouseDown must short-circuit when isCgEventTapAvailableRef is false (symmetric with blockInputFocus)',
    );
  });

  test('stealthTapStart() failure is logged, not swallowed (m5)', () => {
    // The m5 fix replaced `.catch(() => {})` with a console.warn so failures
    // surface in dev tools instead of silently ignoring.
    assert.match(
      source,
      /stealthTapStart\(\)\.catch\(\(err\) => \{[\s\S]*?console\.warn\(['"]\[stealth\] tap start IPC failed['"], err\);[\s\S]*?\}\);/,
      'm5: stealthTapStart failure must be logged via console.warn, not silently swallowed',
    );
  });

  test('onStealthTapState flips isCgEventTapAvailableRef to false on permission revoke and true on active', () => {
    // M1 contract: the state listener must update isCgEventTapAvailableRef in
    // both directions.
    const stateHandler = source.match(
      /const unsubState = window\.electronAPI\.onStealthTapState\(\(\{[\s\S]*?\}\) => \{[\s\S]*?\}\);/,
    );
    assert.ok(stateHandler, 'onStealthTapState handler not found');
    // false branch on permission revoke
    assert.match(
      stateHandler[0],
      /reason === 'permission'[\s\S]*?isCgEventTapAvailableRef\.current = false;/,
      'M1: onStealthTapState({active:false, reason:"permission"}) must flip isCgEventTapAvailableRef to false',
    );
    // true branch on active=true
    assert.match(
      stateHandler[0],
      /if \(active\) \{[\s\S]*?isCgEventTapAvailableRef\.current = true;[\s\S]*?\}/,
      'M1: onStealthTapState({active:true}) must promote isCgEventTapAvailableRef to true',
    );
  });

  test('window.focus listener calls stealthTapRefreshIme (M3)', () => {
    // M3 contract: refresh IME on window focus so mid-session input-source
    // changes don't silently break CJK composition.
    assert.match(
      source,
      /window\.addEventListener\(['"]focus['"], onFocusRefresh\)/,
      'M3: must register a window focus listener that refreshes IME state',
    );
    assert.match(
      source,
      /stealthTapRefreshIme\?\.\(\)/,
      'M3: focus listener must call stealthTapRefreshIme',
    );
    // And the cleanup must remove the listener — otherwise we leak a handler
    // on every component remount (HMR, route changes, etc.).
    assert.match(
      source,
      /window\.removeEventListener\(['"]focus['"], onFocusRefresh\)/,
      'M3: focus listener cleanup must remove the listener to avoid leaks across remounts',
    );
  });
});

// ── Dead-IPC removal assertion (m5 / M5) ──────────────────────────────────

describe('dead stealth IPCs are fully removed across renderer surface', () => {
  test('no caller of stealthTapPermissionGranted, stealthTapRequestPermission, or stealthTapIsActive remains', () => {
    function walk(dir, acc = []) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            entry.name === 'node_modules' ||
            entry.name === '__tests__' ||
            entry.name === 'dist-electron' ||
            entry.name === 'dist'
          ) continue;
          walk(full, acc);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.tsx') ||
            entry.name.endsWith('.ts') ||
            entry.name.endsWith('.js'))
        ) {
          acc.push(full);
        }
      }
      return acc;
    }
    const files = [
      ...walk(path.join(root, 'src')),
      ...walk(path.join(root, 'electron')),
    ];
    const dead = [
      'stealthTapPermissionGranted',
      'stealthTapRequestPermission',
      'stealthTapIsActive',
    ];
    const offenders = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const name of dead) {
        if (text.includes(name)) {
          offenders.push(`${path.relative(root, file)} — ${name}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Dead stealth IPCs must have zero callers (M5 removed them):\n${offenders.join('\n')}`,
    );
  });
});
