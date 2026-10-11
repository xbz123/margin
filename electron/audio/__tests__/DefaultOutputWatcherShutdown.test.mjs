import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainFixture } from './mainMeetingFixture.mjs';
import { deferred } from './meetingAudioFixture.mjs';

test('production shutdown cancels the route interval and releases both captures', async () => {
  const f = mainFixture();
  await f.start();
  assert.equal(f.audio.intervals.length, 1);
  await f.state.shutdownAudio();
  assert.ok(f.audio.intervals.every(timer => timer.cancelled));
  assert.equal(f.audio.pipeline.microphoneCapture, null);
  assert.equal(f.audio.pipeline.systemAudioCapture, null);
  assert.equal(f.state._isQuitting, true);
});
