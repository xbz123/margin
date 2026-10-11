const serialize = v => JSON.parse(JSON.stringify(v));
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const requireFromRepo = createRequire(new URL('../../package.json', import.meta.url));
const ts = requireFromRepo('typescript');

test('a declined provider factory stays absent without inventing a configured provider', () => {
  const { session } = fixture(() => null);
  session.begin('synthetic');
  assert.equal(session.ensure('user'), null);
  assert.equal(session.ensure('interviewer'), null);
});

test('retired provider errors cannot crash or re-enter the session', async () => {
  const { session, events } = fixture();
  session.begin('synthetic');
  const provider = session.ensure('user');
  await session.cancel();
  assert.doesNotThrow(() => provider.emit('error', Error('late close')));
  assert.equal(events.length, 0);
});

function fixture(createProvider) {
  const source = fs.readFileSync(new URL('../MeetingSttSession.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, setTimeout, clearTimeout, Promise, Error, Set, Map, Date, Array, Object });
  const events = [];
  const makeProvider = createProvider ?? (() => {
    const emitter = new EventEmitter();
    emitter.writes = [];
    emitter.write = chunk => emitter.writes.push(chunk);
    emitter.stop = () => {};
    emitter.finalize = () => {};
    return emitter;
  });
  const session = new exports.MeetingSttSession({
    create: makeProvider,
    onTranscript: event => events.push(event),
  });
  return { session, events, MeetingSttSession: exports.MeetingSttSession };
}

test('interleaved provider item IDs retain identity and monotone revisions', () => {
  const { session, events } = fixture();
  session.begin('meeting-1');
  const provider = session.ensure('interviewer');
  provider.emit('transcript', { itemId: 'a', text: 'answer', isFinal: false });
  provider.emit('transcript', { itemId: 'b', text: 'interleaved', isFinal: false });
  provider.emit('transcript', { itemId: 'a', text: 'answer A', isFinal: true, speakerId: 'speaker_1' });
  assert.deepEqual(events.map(e => [e.segmentId, e.revision, e.final]), [
    ['interviewer:1:a', 1, false],
    ['interviewer:1:b', 1, false],
    ['interviewer:1:a', 2, true],
  ]);
  assert.equal(events[2].speakerId, 'speaker_1');
});

test('equal-text unkeyed final utterances are distinct; channels stay distinct', () => {
  const { session, events } = fixture();
  session.begin('meeting-1');
  const interviewer = session.ensure('interviewer');
  const user = session.ensure('user');
  interviewer.emit('transcript', { text: 'ok', isFinal: true });
  interviewer.emit('transcript', { text: 'ok', isFinal: true });
  user.emit('transcript', { text: 'ok', isFinal: true });
  assert.equal(events.length, 3);
  assert.equal(new Set(events.map(e => e.segmentId)).size, 3);
});

test('stop accepts trailing finals, releases listeners, and restart excludes stale provider', async () => {
  const { session, events } = fixture();
  session.begin('meeting-1');
  const oldProvider = session.ensure('user');
  const drainPromise = session.drain(200, 50);
  oldProvider.emit('transcript', { text: 'trailing final', isFinal: true });
  oldProvider.emit('transcript', { text: 'ignored interim', isFinal: false });
  assert.deepEqual(serialize(await drainPromise), { timedOut: false, failedChannels: [] });
  assert.equal(events.length, 1);
  assert.equal(events[0].text, 'trailing final');
  assert.equal(oldProvider.listenerCount('transcript'), 0);

  session.begin('meeting-2');
  const newProvider = session.ensure('user');
  oldProvider.emit('transcript', { text: 'stale after restart', isFinal: true });
  newProvider.emit('transcript', { text: 'fresh session', isFinal: true });
  assert.equal(events.length, 2);
  assert.equal(events[1].text, 'fresh session');
});

test('reconfigure changes provider identity and detaches old listeners', async () => {
  const { session, events } = fixture();
  session.begin('meeting-1');
  const first = session.ensure('user');
  first.emit('transcript', { itemId: 'same', text: 'one', isFinal: true });
  const second = new EventEmitter();
  second.stop = () => {};
  session.set('user', second);
  assert.equal(first.listenerCount('transcript'), 0);
  second.emit('transcript', { itemId: 'same', text: 'two', isFinal: true });
  assert.notEqual(events[0].segmentId, events[1].segmentId);
  await session.cancel();
});

test('cancel while provider stop hangs is bounded and blocks late events', async () => {
  const { session, events } = fixture(() => {
    const emitter = new EventEmitter();
    emitter.stop = () => new Promise(() => {});
    return emitter;
  });
  session.begin('meeting-1');
  const provider = session.ensure('user');
  const beginTimestamp = Date.now();
  await session.cancel(50);
  assert.ok(Date.now() - beginTimestamp < 250);
  provider.emit('transcript', { text: 'after cancel', isFinal: true });
  assert.equal(events.length, 0);
});

test('provider stub item IDs link interim and final events', () => {
  const { session, events } = fixture();
  session.begin('meeting-1');
  const provider = session.ensure('user');
  provider.emit('transcript', { itemId: 'item_1', text: 'chunk 1', isFinal: false });
  provider.emit('transcript', { itemId: 'item_1', text: 'chunk 1 finalized', isFinal: true });
  assert.equal(events.length, 2);
  assert.equal(events[0].segmentId, events[1].segmentId);
  assert.equal(events[1].final, true);
});

test('finalize and stop share one bounded drain budget', async () => {
  const { session } = fixture(() => {
    const emitter = new EventEmitter();
    emitter.finalize = () => new Promise(res => setTimeout(res, 30));
    emitter.stop = () => new Promise(res => setTimeout(res, 30));
    return emitter;
  });
  session.begin('meeting-1');
  session.ensure('user');
  const outcome = await session.drain(20, 10);
  assert.equal(outcome.timedOut, true);
});

test('drain reports provider failure without inventing a timeout', async () => {
  const { session } = fixture(() => {
    const emitter = new EventEmitter();
    emitter.stop = () => Promise.reject(new Error('fail'));
    return emitter;
  });
  session.begin('meeting-1');
  session.ensure('user');
  const outcome = await session.drain(100, 0);
  assert.deepEqual(serialize(outcome), { timedOut: false, failedChannels: ['user'] });
});

test('stable IDs accept final corrections while duplicate and stale interim events are ignored', () => {
  const { session, events } = fixture();
  session.begin('meeting-1');
  const provider = session.ensure('interviewer');
  provider.emit('transcript', { segmentId: 'seg_1', text: 'interim 1', isFinal: false });
  provider.emit('transcript', { segmentId: 'seg_1', text: 'interim 1', isFinal: false });
  assert.equal(events.length, 1);
  provider.emit('transcript', { segmentId: 'seg_1', text: 'final text', isFinal: true });
  assert.equal(events.length, 2);
  provider.emit('transcript', { segmentId: 'seg_1', text: 'stale interim', isFinal: false });
  assert.equal(events.length, 2);
  provider.emit('transcript', { segmentId: 'seg_1', text: 'final correction', isFinal: true });
  assert.equal(events.length, 3);
  assert.equal(events[2].text, 'final correction');
});

test('queued callback from a replaced provider cannot enter the same session', async () => {
  const { session, events } = fixture();
  session.begin('meeting-1');
  let queuedCallback;
  const first = new EventEmitter();
  first.stop = () => {};
  first.on = (evt, fn) => { if (evt === 'transcript') queuedCallback = fn; };
  session.set('user', first);
  const second = new EventEmitter();
  second.stop = () => {};
  session.set('user', second);
  queuedCallback({ text: 'late', isFinal: true });
  session.get('user').emit('transcript', { text: 'current', isFinal: true });
  assert.deepEqual(events.map(e => e.text), ['current']);
  await session.cancel();
});

test('Aliyun mock stub sentence IDs reach session for interim, final and corrected final', async () => {
  class MockAliyunStt extends EventEmitter {
    stop() {}
    finalize() {}
    sendSentence(id, text, isEnd) {
      this.emit('transcript', { itemId: `aliyun-${id}`, text, isFinal: isEnd });
    }
  }
  const { session, events } = fixture();
  session.begin('meeting-1');
  const provider = new MockAliyunStt();
  session.set('interviewer', provider);
  provider.sendSentence(0, 'first', false);
  provider.sendSentence(0, 'second', true);
  provider.sendSentence(0, 'corrected', true);
  assert.equal(events.length, 3);
  assert.equal(events[0].segmentId, events[1].segmentId);
  assert.equal(events[1].segmentId, events[2].segmentId);
  await session.cancel();
});

test('Doubao mock stub start-time identity keeps final corrections in one segment', async () => {
  class MockDoubaoStt extends EventEmitter {
    stop() {}
    finalize() {}
    sendUtterance(startTime, text, isDefinite) {
      this.emit('transcript', { itemId: `doubao-${startTime}`, text, isFinal: isDefinite });
    }
  }
  const { session, events } = fixture();
  session.begin('meeting-1');
  const provider = new MockDoubaoStt();
  session.set('user', provider);
  provider.sendUtterance(0, 'one', false);
  provider.sendUtterance(0, 'two', true);
  provider.sendUtterance(0, 'corrected', true);
  assert.equal(events.length, 3);
  assert.equal(events[0].segmentId, events[1].segmentId);
  assert.equal(events[1].segmentId, events[2].segmentId);
  await session.cancel();
});
