import test from 'node:test';
import assert from 'node:assert/strict';
import { mainFixture } from './mainMeetingFixture.mjs';

test('missing STT configuration fails before permission, captures, or meeting state changes', async () => {
  let permissions = 0;
  const f = mainFixture({ requireSttConfigured() { throw Error('STT is not configured'); },
    microphonePermission: async () => { permissions++; return true; } });
  await assert.rejects(f.state.startMeeting(), /STT is not configured/);
  assert.equal(permissions, 0);
  assert.equal(f.audio.microphones.length, 0);
  assert.equal(f.audio.systems.length, 0);
  assert.equal(f.state.isMeetingActive, false);
});
