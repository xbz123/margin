import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from '../../audio/__tests__/meetingAudioFixture.mjs';
import { mainFixture } from '../../audio/__tests__/mainMeetingFixture.mjs';
test('production wake restores a full recovery budget and rejects pre-sleep delayed errors', async () => {
  const f = mainFixture();
  await f.start();
  for (let i = 0; i < 3; i++) {
    f.audio.microphones.at(-1).emit('error', Error('recover'));
    await f.audio.settle();
  }
  f.audio.systems.at(-1).emit('error', Error('pending pre-sleep recovery'));
  await f.state.suspendAudio();
  await f.state.restartCapturesAfterResume();
  const count = f.audio.microphones.length;
  f.audio.flush(1500);
  f.audio.microphones.at(-1).emit('error', Error('fresh post-wake recovery'));
  await f.audio.settle();
  assert.equal(f.audio.microphones.length, count + 1);
  assert.equal(f.audio.events.some(([name, payload]) => name === 'capture-failed' && payload.message.includes('exhausted')), false);
  await f.state.endMeeting();
});
