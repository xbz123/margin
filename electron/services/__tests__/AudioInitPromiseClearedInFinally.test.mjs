import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from '../../audio/__tests__/meetingAudioFixture.mjs';

test('initialization slot clears after success and failure without leaking native handles', async () => {
  for (const fails of [false, true]) {
    const f = fixture({ capability: async () => { if (fails) throw Error('probe failed'); return { effectiveDenied: false }; } });
    f.pipeline.begin({});
    const init = f.pipeline._audioInitPromise;
    f.flush(0);
    if (fails) await assert.rejects(init, /probe failed/);
    else await init;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.pipeline._audioInitPromise, null);
    assert.equal(f.events.some(([name]) => name === 'capture-failed'), fails);
    await f.pipeline.abortInit();
    await f.pipeline.detachAndDestroy();
  }
});
