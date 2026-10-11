import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from '../../audio/__tests__/meetingAudioFixture.mjs';

test('mic recovery is bounded, reports terminal exhaustion once and ignores retired errors', async () => {
  const f = fixture();
  await f.begin();
  const retired = f.microphones[0];
  for (let i = 0; i < 3; i++) {
    f.microphones.at(-1).emit('error', Error('recover'));
    await f.settle();
  }
  const count = f.microphones.length;
  f.microphones.at(-1).emit('error', Error('exhausted'));
  f.microphones.at(-1).emit('error', Error('exhausted again'));
  retired.emit('error', Error('old callback'));
  assert.equal(f.microphones.length, count);
  const terminal = f.events.filter(([name]) => name === 'capture-failed');
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0][1].channel, 'mic');
  assert.equal(terminal[0][1].terminal, true);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});
