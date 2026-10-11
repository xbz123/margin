import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from '../../audio/__tests__/meetingAudioFixture.mjs';

test('permission is rechecked with existing captures and denial releases the system side', async () => {
  let denied = false, probes = 0;
  const f = fixture({ capability: async () => { probes++; return { effectiveDenied: denied }; } });
  await f.begin();
  const previous = f.systems[0];
  denied = true;
  await f.pipeline.reconfigureAudio();
  assert.equal(probes, 2);
  assert.equal(previous.destroyed, true);
  assert.equal(f.pipeline.systemAudioCapture, null);
  assert.equal(f.microphones.at(-1).started, true);
  assert.ok(f.events.some(([name]) => name === 'permission-denied'));
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});
