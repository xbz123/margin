import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainFixture } from './mainMeetingFixture.mjs';

// S48 C3: the session reasoning override ends with a meeting that finished (saved or nothing to save),
// and stays while its record failed to save and is still pending.
for (const [name, stopped, clears] of [['saved', { status: 'saved', id: 'meeting-1' }, 1], ['empty', undefined, 1], ['failed', { status: 'failed', id: 'meeting-1', reason: 'synthetic' }, 0]]) {
  test(`S48 production endMeeting ${clears ? 'clears' : 'keeps'} the session override when the meeting record is ${name}`, async () => {
    const f = mainFixture();
    await f.start();
    f.state.intelligenceManager.stopMeeting = async () => { f.order.push('archive-save'); return stopped; };
    await f.state.endMeeting();
    assert.ok(f.order.includes('archive-save'));
    assert.equal(f.reasoningClears, clears);
  });
}

test('S48 a meeting that ends before audio started (denied start) also clears the session override', async () => {
  const f = mainFixture({ microphonePermission: async () => false });
  await assert.rejects(f.state.startMeeting(), /permission denied/);
  await f.state.endMeeting();
  assert.equal(f.order.includes('archive-save'), false);
  assert.equal(f.reasoningClears, 1);
});
