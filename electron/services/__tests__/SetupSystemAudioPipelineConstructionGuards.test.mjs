import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from '../../audio/__tests__/meetingAudioFixture.mjs';

test('each capture construction failure is visible and does not suppress the other channel', async () => {
  for (const channel of ['mic', 'system']) {
    const f = fixture({ micError: () => channel === 'mic', systemError: () => channel === 'system' });
    await f.begin();
    const failure = f.events.find(([name]) => name === 'capture-failed');
    assert.equal(failure[1].channel, channel);
    assert.equal(failure[1].terminal, true);
    assert.equal(channel === 'mic' ? f.systems[0].started : f.microphones[0].started, true);
    await f.pipeline.abortInit();
    await f.pipeline.detachAndDestroy();
  }
});
test('provider creation failure is visible while the other capture still starts', async () => {
  const f = fixture();
  f.stt.ensure = channel => { if (channel === 'user') throw Error('synthetic provider failure'); return f.providers.interviewer; };
  await f.begin();
  assert.equal(f.events.find(([name]) => name === 'capture-failed')[1].channel, 'mic');
  assert.equal(f.systems[0].started, true);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});
