import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './meetingAudioFixture.mjs';

test('route switch joins an already-running recovery rather than opening another native handle', async () => {
  const permission = deferred(), entered = deferred();
  const f = fixture({ capability: reason => {
    if (reason === 'system audio recovery') { entered.resolve(); return permission.promise; }
    return Promise.resolve({ effectiveDenied: false });
  } });
  await f.begin();
  f.systems[0].emit('error', Error('device changed'));
  f.flush(1500);
  await entered.promise;
  const route = f.pipeline.handleDefaultOutputChanged('new');
  permission.resolve({ effectiveDenied: false });
  await route;
  assert.equal(f.systems.length, 2);
  assert.equal(f.systems[0].destroyed, true);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});
