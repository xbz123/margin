// AG-10 check: the native module loads under the isolation guard and no longer
// exposes the removed license functions.
//   node scripts/margin/isolation/run-node.mjs --test scripts/margin/isolation/__tests__/native-exports.node.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('native module exports audio and window helpers but no license functions', () => {
  const native = require('../../../../native-module');
  const names = Object.keys(native);
  for (const kept of ['MicrophoneCapture', 'SystemAudioCapture', 'getInputDevices', 'getOutputDevices']) {
    assert.ok(names.includes(kept), `missing ${kept}`);
  }
  for (const removed of ['getHardwareId', 'verifyGumroadKey', 'verifyDodoKey', 'validateDodoKey', 'deactivateDodoKey']) {
    assert.ok(!names.includes(removed), `${removed} should be gone`);
  }
});
