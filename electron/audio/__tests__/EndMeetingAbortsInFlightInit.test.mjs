import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainFixture } from './mainMeetingFixture.mjs';
import { deferred } from './meetingAudioFixture.mjs';

test('production endMeeting joins an in-flight permission probe before releasing capture', async () => {
  const permission = deferred(), entered = deferred();
  const f = mainFixture({ capability: () => { entered.resolve(); return permission.promise; } });
  await f.state.startMeeting();
  f.audio.flush(0);
  await entered.promise;
  let stopped = false;
  const stop = f.state.endMeeting().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false);
  permission.resolve({ effectiveDenied: false });
  await stop;
  assert.equal(f.audio.microphones.length, 0);
  assert.equal(f.audio.systems.length, 0);
  assert.equal(f.state._isDraining, false);
  assert.equal(f.order.includes('audio-error'), false);
});
