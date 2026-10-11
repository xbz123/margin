import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './meetingAudioFixture.mjs';

test('a route probe from the stopped epoch cannot populate the next session', async () => {
  const pending = deferred(), entered = deferred();
  const f = fixture({ capability: reason => {
    if (reason === 'default output route change') { entered.resolve(); return pending.promise; }
    return Promise.resolve({ effectiveDenied: false });
  } });
  await f.begin();
  const route = f.pipeline.handleDefaultOutputChanged('new');
  await entered.promise;
  const stop = f.pipeline.abortInit();
  pending.resolve({ effectiveDenied: false });
  await Promise.all([route, stop]);
  assert.equal(f.systems.length, 1);
  await f.pipeline.detachAndDestroy();
  await f.begin();
  assert.equal(f.systems.length, 2);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});
