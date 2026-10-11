import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from '../../audio/__tests__/meetingAudioFixture.mjs';
import { mainFixture } from '../../audio/__tests__/mainMeetingFixture.mjs';
test('production stop clears draining and display state even when saving rejects', async () => {
  const f = mainFixture();
  await f.start();
  f.state.intelligenceManager.stopMeeting = async () => { throw Error('synthetic save failure'); };
  await assert.rejects(f.state.endMeeting(), /save failure/);
  assert.equal(f.state._isDraining, false);
  assert.equal(f.state.activeAudioSession, null);
  assert.ok(f.order.includes('display-clear'));
  assert.equal(f.audio.pipeline.hasMicCapture(), false);
});
