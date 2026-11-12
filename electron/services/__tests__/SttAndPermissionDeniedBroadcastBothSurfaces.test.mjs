// Regression test for B8b fix (2026-05-28): sendSttStatus and
// sendSystemAudioPermissionDenied must route their channels to BOTH the
// launcher and overlay windows via sendToMeetingSurfaces (the same
// dual-surface delivery that B8 introduced for sendAudioCaptureFailed).
//
// Pre-fix these helpers used `this.sendToOverlay(channel, payload)`. If
// the overlay BrowserWindow had been destroyed by a race (meeting ended
// mid-recovery, window swap in-flight, transient teardown), the IPC
// vanished into the void and the user saw NO status / NO permission
// banner at all — silent invisibility on the two most user-actionable
// diagnostic surfaces.
//
// Fix: route via sendToMeetingSurfaces, which fans out to launcher AND
// overlay and de-dupes by BrowserWindow.id.
//
// Regression guarded: a contributor reverts either sister method to
// sendToOverlay (or removes the dual-surface broadcast / changes the
// channel name).
//
// The sender side is checked by electron/audio/__tests__/AudioStatusBroadcastTargeting.test.mjs;
// this file keeps the renderer subscriber check.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const interfacePath = path.join(root, 'src/components/NativelyInterface.tsx');
const interfaceSource = fs.readFileSync(interfacePath, 'utf8');

describe('B8b: stt-status and system-audio-permission-denied must reach BOTH launcher and overlay surfaces', () => {
  it('subscriber side intact: NativelyInterface.tsx still subscribes to both channels', () => {
    // Structural confidence that the rendering paths match the sender
    // channels. If the subscriber side regresses, the broadcast still
    // succeeds but no UI updates.
    // Tolerate both `window.electronAPI.onX(...)` and the optional-chaining
    // variant `window.electronAPI?.onX?.(...)` — both are valid subscriber
    // call shapes used in the renderer.
    assert.match(
      interfaceSource,
      /window\.electronAPI\??\.onSttStatusChanged(?:\?\.)?\s*\(/,
      'BUG: NativelyInterface.tsx must still subscribe via ' +
        'window.electronAPI.onSttStatusChanged(...). Without this, the stt-status IPC ' +
        'is broadcast successfully but no renderer renders it.',
    );
    assert.match(
      interfaceSource,
      /window\.electronAPI\??\.onSystemAudioPermissionDenied(?:\?\.)?\s*\(/,
      'BUG: NativelyInterface.tsx must still subscribe via ' +
        'window.electronAPI.onSystemAudioPermissionDenied(...). Without this, the TCC ' +
        'permission banner IPC is broadcast successfully but no banner is rendered.',
    );
  });
});
