import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './meetingAudioFixture.mjs';

test('quitting prevents both route polling and direct reconstruction', async () => {
  let nativeReads = 0;
  const f = fixture({ defaultOutputId: () => { nativeReads++; return 'default'; } });
  await f.begin();
  const before = nativeReads;
  f.setSnapshot({ quitting: true });
  for (const timer of f.intervals) timer.callback();
  await f.pipeline.handleDefaultOutputChanged('changed');
  assert.equal(nativeReads, before);
  assert.equal(f.systems.length, 1);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});
