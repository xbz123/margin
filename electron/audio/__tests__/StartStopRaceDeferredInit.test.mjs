import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './meetingAudioFixture.mjs';

test('stop before the deferred initialization tick never acquires a capture', async () => {
  const f = fixture();
  f.pipeline.begin({});
  const stop = f.pipeline.abortInit();
  f.flush(0);
  await stop;
  assert.equal(f.microphones.length, 0);
  assert.equal(f.systems.length, 0);
  await f.begin();
  assert.equal(f.microphones.length, 1);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});
