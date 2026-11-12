// Regression test for B8 fix (2026-05-28): sendAudioCaptureFailed must
// route 'audio-capture-failed' to BOTH the launcher and overlay windows
// via sendToMeetingSurfaces.
//
// Pre-fix the helper used `this.sendToOverlay('audio-capture-failed', payload)`.
// If the overlay BrowserWindow had been destroyed by a race (meeting
// ended mid-recovery, window swap in-flight, transient teardown), the
// IPC vanished into the void and the user saw NO banner at all —
// "silent invisibility."
//
// Fix: route via sendToMeetingSurfaces, which fans out to launcher AND
// overlay and de-dupes by BrowserWindow.id (so when both surfaces are
// alive simultaneously the payload is delivered exactly once per win).
//
// Regression guarded: a contributor reverts to sendToOverlay (or
// removes the meeting-surfaces broadcast) and silently re-introduces
// the invisibility bug.
//
// Compatibility note: this test is intentionally consistent with
// electron/audio/__tests__/AudioStatusBroadcastTargeting.test.mjs.
// That test guards against GLOBAL-broadcast leaks (sendToAll /
// BrowserWindow.getAllWindows) for the audio-capture-failed channel.
// sendToMeetingSurfaces delivers ONLY to launcher+overlay (not to
// settings, cropper, or modelSelector windows), so the leak guard
// still passes.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const mainPath = path.join(root, 'electron/main.ts');
const source = fs.readFileSync(mainPath, 'utf8');

// Brace-balanced extractor — regex /[^}]+\}/ would stop at the first
// inner `}` and miss helpers that contain nested blocks. We mirror the
// pattern used in AudioStatusBroadcastTargeting.test.mjs.
function extractMethodBody(methodName) {
  const methodRe = new RegExp(`(?:private|public)\\s+${methodName}\\s*\\([^)]*\\)[^{]*\\{`);
  const match = methodRe.exec(source);
  assert.ok(match, `could not locate ${methodName} in electron/main.ts`);
  let i = match.index + match[0].length;
  const start = i;
  let depth = 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces while extracting ${methodName}`);
  return source.slice(start, i - 1);
}

describe('B8: audio-capture-failed must reach BOTH launcher and overlay surfaces', () => {
  it('sendToMeetingSurfaces does NOT leak to settings / cropper / modelSelector surfaces', () => {
    // Consistency with AudioStatusBroadcastTargeting.test.mjs: the
    // audio-capture-failed channel is restricted to meeting surfaces.
    // sendToMeetingSurfaces is the ONLY routing helper used for this
    // channel, so we assert it does not pull in unrelated window
    // getters.
    const body = extractMethodBody('sendToMeetingSurfaces');

    assert.ok(
      !/getSettingsWindow\s*\(/.test(body),
      'BUG: sendToMeetingSurfaces must not deliver to the settings window. ' +
        'audio-capture-failed is a meeting-surface concern; leaking it to settings violates the ' +
        'channel-targeting invariant in AudioStatusBroadcastTargeting.test.mjs.',
    );
    assert.ok(
      !/cropperWindowHelper|getCropperWindow/i.test(body),
      'BUG: sendToMeetingSurfaces must not deliver to the cropper window.',
    );
    assert.ok(
      !/modelSelectorWindowHelper|getModelSelectorWindow/i.test(body),
      'BUG: sendToMeetingSurfaces must not deliver to the model-selector window.',
    );
  });
});
