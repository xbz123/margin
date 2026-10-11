import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAudioModule } from './mainMeetingFixture.mjs';
import { deferred } from './meetingAudioFixture.mjs';

const { MeetingLifecycleQueue } = loadAudioModule('meetingLifecycleQueue');

test('adjacent duplicate starts join while start-stop-start keeps its order', async () => {
  const queue = new MeetingLifecycleQueue(), gate = deferred(), order = [];
  const first = queue.start(async () => { order.push('start-1'); await gate.promise; });
  assert.equal(queue.start(async () => { throw Error('duplicate executed'); }), first);
  const stop = queue.stop(async () => { order.push('stop'); });
  const second = queue.start(async () => { order.push('start-2'); });
  await Promise.resolve();
  assert.deepEqual(order, ['start-1']);
  gate.resolve();
  await Promise.all([first, stop, second]);
  assert.deepEqual(order, ['start-1', 'stop', 'start-2']);
  assert.equal(queue.getState(), 'active');
});

test('failed transitions are reported without poisoning cleanup or a later start', async () => {
  const queue = new MeetingLifecycleQueue(), order = [];
  await assert.rejects(queue.start(async () => { throw Error('synthetic'); }), /synthetic/);
  assert.equal(queue.getState(), 'failed');
  await queue.stop(async () => { order.push('cleanup'); });
  await queue.start(async () => { order.push('retry'); });
  assert.deepEqual(order, ['cleanup', 'retry']);
});
