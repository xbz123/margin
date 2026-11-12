const serialize = v => JSON.parse(JSON.stringify(v));
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const requireFromRepo = createRequire(new URL('../../package.json', import.meta.url));
const ts = requireFromRepo('typescript');

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function watch(promise) {
  const state = { value: undefined, error: undefined, done: false };
  promise.then(value => { state.value = value; state.done = true; }, error => { state.error = error; state.done = true; });
  return state;
}
function clock(t) { t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 }); return async ms => { t.mock.timers.tick(ms); await settle(); }; }
function meeting(t) {
  const advance = clock(t);
  const made = fixture();
  made.session.begin('meeting-1');
  return { ...made, advance, user: made.session.ensure('user'), interviewer: made.session.ensure('interviewer') };
}

test('S42-03 an already cancelled action does not flush either provider', async t => {
  const { session, user, interviewer } = meeting(t);
  let calls = 0;
  user.seal = interviewer.seal = () => { calls++; return undefined; };
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => session.collect({ cutoffAt: 0, deadline: 10_000, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('S42-03 dictation fails if an interim active at Answer is evicted without another update', async t => {
  const { session, user, interviewer, advance } = meeting(t);
  user.emit('transcript', { segmentId: 'dictation-opening', text: 'My unfinished opening', isFinal: false });
  await advance(10);
  const dictation = session.markDictation(Date.now());
  await advance(10);
  // Only unrelated interviewer fragments arrive; the active user fragment is never revised.
  for (let i = 0; i < 2000; i++) interviewer.emit('transcript', { segmentId: `other-${i}`, text: `Other turn ${i}`, isFinal: true });
  assert.throws(() => session.collect({ cutoffAt: Date.now(), deadline: 10_000, signal: new AbortController().signal, dictation }),
    { name: 'DictationOverflowError', message: 'Dictation is too long to collect completely' });
});

test('S42-03 renderer receipt at 45 ends the receipt window; a pending channel freezes at 3045, never on a provider ack', async t => {
  const { session, interviewer, advance } = meeting(t);
  interviewer.emit('transcript', { segmentId: 'q', text: 'what is', isFinal: false });
  await advance(40);
  const controller = new AbortController();
  const collector = session.collect({ cutoffAt: 0, deadline: 10_000, signal: controller.signal });
  const frozen = watch(collector.frozen);
  await advance(5);
  collector.setStage1End(45);
  collector.setStage1End(1e12); // a future timestamp cannot extend anything
  await advance(2000);
  interviewer.emit('transcript', { segmentId: 'q', text: 'what is a heap', isFinal: false });
  await advance(999);
  assert.equal(frozen.done, false);
  await advance(1);
  assert.equal(Date.now(), 3045);
  assert.equal(frozen.done, true);
  assert.deepEqual(serialize(frozen.value.channels.interviewer.segments.map(item => [item.text, item.final])), [['what is a heap', false]]);
  assert.equal(frozen.value.channels.interviewer.reason, 'deadline');
});

test('S42-03 a begin received at 900 classifies at once against cutoff+750 and freezes at 3750; channels wait in parallel', async t => {
  const { session, user, interviewer, advance } = meeting(t);
  user.emit('transcript', { segmentId: 'u', text: 'mine', isFinal: false });
  interviewer.emit('transcript', { segmentId: 'i', text: 'theirs', isFinal: false });
  await advance(900);
  const collector = session.collect({ cutoffAt: 0, deadline: 10_000, signal: new AbortController().signal });
  const frozen = watch(collector.frozen);
  collector.setStage1End(5000);
  await advance(2849);
  assert.equal(frozen.done, false);
  await advance(1);
  assert.equal(Date.now(), 3750, 'two pending channels end together, not one after the other');
  assert.equal(frozen.done, true);
});

test('S42-03 no receipt keeps the 750 ms boundary; a confirmed final waits 1 s, an unknown channel 3 s, and the deadline caps both', async t => {
  const { session, user, interviewer, advance } = meeting(t);
  interviewer.emit('transcript', { segmentId: 'i', text: 'final question', isFinal: true });
  await advance(10);
  let collector = session.collect({ cutoffAt: 0, deadline: 10_000, signal: new AbortController().signal });
  let frozen = watch(collector.frozen);
  await advance(1740);
  assert.equal(frozen.done, false, 'the empty microphone channel is unknown, not empty');
  await advance(2000);
  assert.equal(frozen.done, true);
  assert.equal(Date.now(), 3750);
  assert.deepEqual(serialize(frozen.value.channels.interviewer.segments.map(item => item.text)), ['final question']);

  // A final alone is not evidence that the provider has no pending input.
  user.seal = interviewer.seal = () => ({ scopes: [], pending: false, done: Promise.resolve('unknown') });
  user.emit('transcript', { segmentId: 'u2', text: 'mine', isFinal: true });
  interviewer.emit('transcript', { segmentId: 'i2', text: 'theirs', isFinal: true });
  const cut = Date.now();
  collector = session.collect({ cutoffAt: cut, deadline: cut + 10_000, signal: new AbortController().signal });
  frozen = watch(collector.frozen);
  await advance(750);
  collector.setStage1End(cut + 750); // preload's receipt timeout, not a provider acknowledgement
  await advance(999);
  assert.equal(frozen.done, false);
  await advance(1);
  assert.equal(frozen.done, true);

  // The first-token deadline caps every wait.
  user.emit('transcript', { segmentId: 'u3', text: 'still talking', isFinal: false });
  const late = Date.now();
  collector = session.collect({ cutoffAt: late, deadline: late + 500, signal: new AbortController().signal });
  frozen = watch(collector.frozen);
  await advance(500);
  assert.equal(frozen.done, true);
  assert.equal(frozen.value.channels.user.reason, 'deadline');
});

test('S42-03 scoped seals: fast empty ends early, unknown is not empty, and an unrelated final is not completion', async t => {
  const { session, user, interviewer, advance } = meeting(t);
  user.seal = () => ({ scopes: [], done: Promise.resolve('no-pending') });
  interviewer.seal = () => ({ scopes: [], done: Promise.resolve('no-pending') });
  let frozen = watch(session.collect({ cutoffAt: 0, deadline: 10_000, signal: new AbortController().signal }).frozen);
  await advance(0);
  assert.equal(frozen.done, true, 'both channels proved nothing is pending');
  assert.equal(frozen.value.channels.user.reason, 'complete');

  user.seal = () => ({ scopes: [], done: Promise.resolve('unknown') });
  delete interviewer.seal;
  const cut = Date.now();
  frozen = watch(session.collect({ cutoffAt: cut, deadline: cut + 10_000, signal: new AbortController().signal }).frozen);
  await advance(100);
  interviewer.emit('transcript', { segmentId: 'later', text: 'new turn', isFinal: true });
  user.emit('transcript', { segmentId: 'later-u', text: 'unrelated', isFinal: true });
  await advance(3000);
  assert.equal(frozen.done, false, 'neither unknown nor an unrelated final ends the wait');
  await advance(650);
  assert.equal(frozen.done, true);
  assert.equal(frozen.value.channels.user.segments.length + frozen.value.channels.interviewer.segments.length, 0, 'post-cut segments are excluded');
});

test('S42-03 a seal admits its scoped result and completes; the receipt-window final is kept', async t => {
  const { session, user, interviewer, advance } = meeting(t);
  let complete;
  user.seal = () => ({ scopes: ['rest:b1'], done: new Promise(resolve => { complete = resolve; }) });
  interviewer.emit('transcript', { segmentId: 'i', text: 'tell me', isFinal: false });
  const frozen = watch(session.collect({ cutoffAt: 0, deadline: 10_000, signal: new AbortController().signal }).frozen);
  await advance(300);
  interviewer.emit('transcript', { segmentId: 'i', text: 'tell me about it', isFinal: true });
  user.emit('transcript', { segmentId: 'rest:b1', scope: 'rest:b1', text: 'sealed audio', isFinal: true });
  complete('complete');
  await advance(0);
  assert.equal(frozen.done, false, 'the interviewer channel has no seal and still waits');
  await advance(3449);
  assert.equal(frozen.done, false, 'a final without pending-state evidence remains unknown');
  await advance(1);
  assert.equal(frozen.done, true);
  assert.equal(frozen.value.channels.user.reason, 'complete');
  assert.deepEqual(serialize(frozen.value.channels.user.segments.map(item => item.text)), ['sealed audio']);
  assert.deepEqual(serialize(frozen.value.channels.interviewer.segments.map(item => [item.text, item.final])), [['tell me about it', true]]);
});

test('S42-03 an old final with an unknown provider still gets the pending tail', async t => {
  const { session, user, interviewer, advance } = meeting(t);
  user.emit('transcript', { segmentId: 'old', text: 'old final', isFinal: true });
  interviewer.seal = () => ({ scopes: [], done: Promise.resolve('no-pending') });
  const collector = session.collect({ cutoffAt: 0, deadline: 10_000, signal: new AbortController().signal });
  collector.setStage1End(0);
  const frozen = watch(collector.frozen);
  await advance(1000);
  assert.equal(frozen.done, false);
  await advance(2000);
  assert.equal(frozen.done, true);
});

test('S42-03 a completed channel cannot absorb another revision even in the same millisecond', async t => {
  const { session, user, interviewer, events, advance } = meeting(t);
  let complete;
  user.seal = () => ({ scopes: [], done: new Promise(resolve => { complete = resolve; }) });
  user.emit('transcript', { segmentId: 'u', text: 'first', isFinal: false });
  interviewer.emit('transcript', { segmentId: 'i', text: 'still speaking', isFinal: false });
  const collector = session.collect({ cutoffAt: 0, deadline: 10_000, signal: new AbortController().signal });
  collector.setStage1End(0);
  await advance(400);
  user.emit('transcript', { segmentId: 'u', text: 'frozen final', isFinal: true });
  complete('complete');
  await advance(0);
  user.emit('transcript', { segmentId: 'u', text: 'same millisecond late correction', isFinal: true });
  await advance(2600);
  assert.equal((await collector.frozen).channels.user.segments[0].text, 'frozen final');
  assert.equal(events.at(-1).text, 'same millisecond late correction');
});

for (const deliveredAt of [3500, 4500]) test(`S42-03 continuation at ${deliveredAt} reads revisions only through the actual 3045 deadline`, async t => {
  const { session, user, advance } = meeting(t);
  user.emit('transcript', { segmentId: 'u', text: 'initial', isFinal: false });
  await advance(40);
  const collector = session.collect({ cutoffAt: 0, deadline: 10_000, signal: new AbortController().signal });
  await advance(2960);
  user.emit('transcript', { segmentId: 'u', text: 'eligible revision', isFinal: false });
  await advance(400);
  user.emit('transcript', { segmentId: 'u', text: 'too late revision', isFinal: false });
  await advance(deliveredAt - 3400);
  collector.setStage1End(45);
  const frozen = await collector.frozen;
  assert.equal(frozen.frozenAt, 3045);
  assert.equal(frozen.channels.user.segments[0].text, 'eligible revision');
  assert.equal(Object.isFrozen(frozen.channels.user.segments[0]), true);
});

test('S42-03 the pending ledger is bounded but a long dictated question is not silently cut to three minutes', async t => {
  const { session, user, advance } = meeting(t);
  for (let index = 0; index < 2001; index++) user.emit('transcript', { segmentId: String(index), text: 'pending', isFinal: false });
  let collector = session.collect({ cutoffAt: 0, deadline: 10_000, signal: new AbortController().signal });
  collector.setStage1End(0);
  await advance(3000);
  assert.equal((await collector.frozen).channels.user.segments.length, 2000);
  session.begin('dictation');
  const mark = session.markDictation(Date.now());
  await advance(1);
  user.emit('transcript', { segmentId: 'first', text: 'beginning of long dictation', isFinal: true });
  await advance(200_000);
  user.emit('transcript', { segmentId: 'last', text: 'end of dictation', isFinal: true });
  const cut = Date.now();
  collector = session.collect({ cutoffAt: cut, deadline: cut + 10_000, signal: new AbortController().signal, dictation: mark });
  collector.setStage1End(cut);
  await advance(3000);
  assert.equal((await collector.frozen).dictation, 'beginning of long dictation end of dictation');
});

test('S42-03 empty speech start updates the ledger only; epochs keep reconnect IDs apart', async t => {
  const { session, events, user, advance } = meeting(t);
  user.emit('transcript', { segmentId: 's1', text: '', started: true, epoch: '1' });
  assert.equal(events.length, 0, 'no chat row');
  assert.equal(session.record('user:1:1:s1').state, 'started');
  user.emit('transcript', { segmentId: 's1', text: 'hello', isFinal: true, epoch: '1' });
  user.emit('transcript', { segmentId: 's1', text: 'again', isFinal: true, epoch: '2' });
  assert.deepEqual(events.map(event => event.segmentId), ['user:1:1:s1', 'user:1:2:s1']);
  assert.equal(events[0].revision, 1);
  await advance(0);
});

test('S42-03 dictation keeps the fragment open at its mark and excludes speech already final', async t => {
  const { session, user, advance } = meeting(t);
  user.emit('transcript', { segmentId: 'old', text: 'old words', isFinal: true });
  user.emit('transcript', { segmentId: 'open', text: 'ongo', isFinal: false });
  await advance(100);
  const mark = session.markDictation(100);
  await advance(50);
  user.emit('transcript', { segmentId: 'open', text: 'ongoing', isFinal: true });
  await advance(350);
  user.emit('transcript', { segmentId: 'next', text: 'question', isFinal: true });
  await advance(1500);
  const frozen = watch(session.collect({ cutoffAt: 2000, deadline: 12_000, signal: new AbortController().signal, dictation: mark }).frozen);
  await advance(1);
  user.emit('transcript', { segmentId: 'after', text: 'after stop', isFinal: true });
  await advance(4000);
  assert.equal(frozen.value.dictation, 'ongoing question');
  assert.deepEqual(serialize(frozen.value.dictationKeys), ['user:1:open', 'user:1:next']);
});

// Stop at the current time and wait out the unknown-provider tail; `tail` speaks after the stop.
async function stopDictation(session, advance, mark, tail = () => {}) {
  const cut = Date.now();
  const collector = session.collect({ cutoffAt: cut, deadline: cut + 10_000, signal: new AbortController().signal, dictation: mark });
  collector.setStage1End(cut);
  await advance(300);
  tail();
  await advance(3000);
  return collector.frozen;
}

test('S42-03 an interim never revised after Answer stays out of this and every later dictation', async t => {
  const { session, user, advance } = meeting(t);
  // Doubao left this utterance open and never sent its definite result.
  user.emit('transcript', { segmentId: '5120', epoch: 'req-1', text: '我上次说到一半的话', isFinal: false });
  await advance(20_000);
  let mark = session.markDictation(Date.now());
  assert.deepEqual(serialize(mark.open), ['user:1:req-1:5120'], 'the lone interim is still the newest microphone fragment');
  await advance(50);
  user.emit('transcript', { segmentId: '26000', epoch: 'req-1', text: '第一个问题是什么', isFinal: true });
  let frozen = await stopDictation(session, advance, mark);
  assert.equal(frozen.dictation, '第一个问题是什么');
  assert.deepEqual(serialize(frozen.dictationKeys), ['user:1:req-1:26000']);

  await advance(5000);
  mark = session.markDictation(Date.now());
  assert.deepEqual(serialize(mark.open), [], 'newer speech replaced the abandoned interim');
  await advance(50);
  user.emit('transcript', { segmentId: '36000', epoch: 'req-1', text: '第二个', isFinal: false });
  await advance(400);
  user.emit('transcript', { segmentId: '36000', epoch: 'req-1', text: '第二个问题', isFinal: true });
  frozen = await stopDictation(session, advance, mark);
  assert.equal(frozen.dictation, '第二个问题');
});

test('S42-03 an interim left by a closed connection is not dictated; the new connection final is', async t => {
  const { session, user, advance } = meeting(t);
  user.emit('transcript', { segmentId: '800', epoch: 'req-dropped', text: 'words cut off by the reconnect', isFinal: false });
  await advance(1000);
  const mark = session.markDictation(Date.now());
  await advance(50);
  user.emit('transcript', { segmentId: '0', epoch: 'req-new', text: 'how does a B tree split', isFinal: false });
  await advance(500);
  user.emit('transcript', { segmentId: '0', epoch: 'req-new', text: 'how does a B tree split a node', isFinal: true });
  const frozen = await stopDictation(session, advance, mark);
  assert.equal(frozen.dictation, 'how does a B tree split a node');
  assert.deepEqual(serialize(frozen.dictationKeys), ['user:1:req-new:0']);
});

test('S42-03 an interim replaced by a newer fragment is dropped while the open sentence crossing Answer joins whole', async t => {
  const { session, user, advance } = meeting(t);
  // The same sentence moved to a new start time; the first key is never revised again.
  user.emit('transcript', { segmentId: '1000', epoch: 'req-1', text: 'what is', isFinal: false });
  await advance(100);
  user.emit('transcript', { segmentId: '1040', epoch: 'req-1', text: 'what is a', isFinal: false });
  await advance(100);
  const mark = session.markDictation(Date.now());
  assert.deepEqual(serialize(mark.open), ['user:1:req-1:1040']);
  await advance(50);
  user.emit('transcript', { segmentId: '1040', epoch: 'req-1', text: 'what is a heap', isFinal: false });
  await advance(300);
  user.emit('transcript', { segmentId: '1040', epoch: 'req-1', text: 'what is a heap used for', isFinal: true });
  await advance(300);
  user.emit('transcript', { segmentId: '4000', epoch: 'req-1', text: 'give an example', isFinal: true });
  const frozen = await stopDictation(session, advance, mark);
  assert.equal(frozen.dictation, 'what is a heap used for give an example');
  assert.deepEqual(serialize(frozen.dictationKeys), ['user:1:req-1:1040', 'user:1:req-1:4000']);
});

// A provider that ends its request at each manual action (DomesticStreamingSTT): every seal scopes
// the current request; Answer itself seals nothing.
function sealsPerAction(user) {
  const calls = [];
  let request = 1;
  user.seal = at => { calls.push(at); return { scopes: ['req-' + request++], pending: true, done: new Promise(() => {}) }; };
  return calls;
}
const said = (user, scope, segmentId, text, isFinal = false) => user.emit('transcript', { segmentId, epoch: scope, scope, text, isFinal });

test('S42-03 Answer seals nothing; a request the previous Stop sealed stays out though its last result comes after the mark', async t => {
  const { session, user, advance } = meeting(t);
  const calls = sealsPerAction(user);
  let mark = session.markDictation(Date.now());
  said(user, 'req-1', '0', '第一个问题是什么');
  await advance(800);
  const first = watch(session.collect({ cutoffAt: Date.now(), deadline: Date.now() + 10_000, signal: new AbortController().signal, dictation: mark }).frozen);
  await advance(400);
  mark = session.markDictation(Date.now());
  assert.equal(calls.length, 1, 'only Stop sealed');
  assert.deepEqual(serialize(mark.open), [], 'the request the Stop ended is not open for the next dictation');
  await advance(300);
  // The last result of the first question arrives only after the second Answer, with a late split.
  said(user, 'req-1', '0', '第一个问题是什么？', true);
  said(user, 'req-1', '1', '还有', true);
  said(user, 'req-2', '0', '第二个问题');
  const frozen = await stopDictation(session, advance, mark, () => said(user, 'req-2', '0', '第二个问题？', true));
  assert.equal(first.value.dictation, '第一个问题是什么？ 还有', 'the first Stop keeps its own late results');
  assert.equal(frozen.dictation, '第二个问题？');
  assert.deepEqual(serialize(frozen.dictationKeys), ['user:1:req-2:0']);
  assert.deepEqual(serialize(frozen.channels.user.segments.map(segment => segment.text)), ['第一个问题是什么？', '还有', '第二个问题？'],
    'the first question stays in the background');
});

test('S42-03 the sentence being said at Answer joins whole; the Stop request splits a new key late and it joins too', async t => {
  const { session, user, advance } = meeting(t);
  sealsPerAction(user);
  said(user, 'req-1', '0', '上一轮的回答。', true);
  await advance(20_000);
  said(user, 'req-1', '1', '我主要');
  await advance(300);
  said(user, 'req-1', '1', '我主要负责');
  await advance(400);
  const mark = session.markDictation(Date.now());
  assert.deepEqual(serialize(mark.open), ['user:1:req-1:1']);
  await advance(600);
  said(user, 'req-1', '1', '我主要负责后端服务的');
  // The Stop seals req-1; its last result finalizes the sentence and splits the rest off under a new key.
  const frozen = await stopDictation(session, advance, mark, () => {
    said(user, 'req-1', '1', '我主要负责后端服务。', true);
    said(user, 'req-1', '2', '性能优化。', true);
  });
  assert.equal(frozen.dictation, '我主要负责后端服务。 性能优化。');
  assert.deepEqual(serialize(frozen.dictationKeys), ['user:1:req-1:1', 'user:1:req-1:2']);
});

test('S42-03 a seal without scopes (Soniox shape) leaves the general rule as it was', async t => {
  const { session, user, advance } = meeting(t);
  let finalizes = 0;
  user.seal = () => { finalizes++; return { scopes: [], pending: true, done: Promise.resolve('complete') }; };
  user.emit('transcript', { segmentId: 'u0', epoch: '1', text: '第一个问题', isFinal: false });
  await advance(500);
  let mark = session.markDictation(Date.now());
  assert.equal(finalizes, 0, 'Answer does not flush the provider');
  let frozen = await stopDictation(session, advance, mark, () => user.emit('transcript', { segmentId: 'u0', epoch: '1', text: '第一个问题？', isFinal: true }));
  assert.equal(finalizes, 1, 'Stop does');
  assert.equal(frozen.dictation, '第一个问题？');
  await advance(400);
  user.emit('transcript', { segmentId: 'u1', epoch: '1', text: '红黑树和AVL树的区别', isFinal: false });
  await advance(1200);
  mark = session.markDictation(Date.now());
  frozen = await stopDictation(session, advance, mark);
  assert.equal(frozen.dictation, '红黑树和AVL树的区别', 'a just-said interim never updated again is still dictated');
});

test('S42-03 a sentence open at Answer that is finalized only during the stop tail is kept', async t => {
  const { session, user, advance } = meeting(t);
  user.emit('transcript', { segmentId: 'leftover', epoch: 'req-0', text: 'stale leftover', isFinal: false });
  await advance(100);
  user.emit('transcript', { segmentId: 'open', epoch: 'req-1', text: 'tell me', isFinal: false });
  await advance(100);
  const mark = session.markDictation(Date.now());
  await advance(1500);
  const frozen = await stopDictation(session, advance, mark,
    () => user.emit('transcript', { segmentId: 'open', epoch: 'req-1', text: 'tell me about yourself', isFinal: true }));
  assert.equal(frozen.dictation, 'tell me about yourself');
});

test('S42-03 a fragment open at Answer keeps joining after three minutes of other dictated speech', async t => {
  const { session, user, advance } = meeting(t);
  user.emit('transcript', { segmentId: 'opening', text: 'so the first part', isFinal: false });
  await advance(10);
  const mark = session.markDictation(Date.now());
  await advance(10);
  user.emit('transcript', { segmentId: 'middle', text: 'and the long middle', isFinal: true });
  await advance(200_000);
  const frozen = await stopDictation(session, advance, mark,
    () => user.emit('transcript', { segmentId: 'opening', text: 'so the first part is done', isFinal: true }));
  assert.equal(frozen.dictation, 'so the first part is done and the long middle');
});

test('S42-03 an empty speech start before Answer does not displace the open fragment from the three-minute exemption', async t => {
  const { session, user, advance } = meeting(t);
  user.emit('transcript', { itemId: 'i1', text: 'so the first part', isFinal: false });
  await advance(10);
  user.emit('transcript', { itemId: 'i2', text: '', started: true });
  await advance(10);
  const mark = session.markDictation(Date.now());
  assert.deepEqual(serialize(mark.open), ['user:1:i1'], 'a speech start without text replaces nothing');
  await advance(10);
  user.emit('transcript', { itemId: 'i2', text: 'and the long middle', isFinal: true });
  await advance(200_000);
  const frozen = await stopDictation(session, advance, mark,
    () => user.emit('transcript', { itemId: 'i1', text: 'so the first part is done', isFinal: true }));
  assert.equal(frozen.dictation, 'so the first part is done and the long middle');
});

test('S42-03 an interim said just before Answer and never updated is dictated alone', async t => {
  const { session, user, advance } = meeting(t);
  user.emit('transcript', { segmentId: 'just-said', epoch: 'req-1', text: '红黑树和AVL树的区别', isFinal: false });
  await advance(1200);
  const mark = session.markDictation(Date.now());
  const frozen = await stopDictation(session, advance, mark);
  assert.equal(frozen.dictation, '红黑树和AVL树的区别');
  assert.deepEqual(serialize(frozen.dictationKeys), ['user:1:req-1:just-said']);
});

test('S42-03 an interim said just before Answer joins ahead of newer dictated speech', async t => {
  const { session, user, advance } = meeting(t);
  user.emit('transcript', { segmentId: 'just-said', epoch: 'req-1', text: '红黑树和AVL树的区别', isFinal: false });
  await advance(1200);
  const mark = session.markDictation(Date.now());
  await advance(300);
  user.emit('transcript', { segmentId: 'next', epoch: 'req-1', text: '各自适合什么场景', isFinal: false });
  await advance(400);
  user.emit('transcript', { segmentId: 'next', epoch: 'req-1', text: '各自适合什么场景', isFinal: true });
  const frozen = await stopDictation(session, advance, mark);
  assert.equal(frozen.dictation, '红黑树和AVL树的区别 各自适合什么场景');
  assert.deepEqual(serialize(frozen.dictationKeys), ['user:1:req-1:just-said', 'user:1:req-1:next']);
});

test('S42-03 an interim twenty seconds before Answer and never updated is not dictated', async t => {
  const { session, user, advance } = meeting(t);
  user.emit('transcript', { segmentId: 'stale', epoch: 'req-1', text: '很早之前的话', isFinal: false });
  await advance(20_000);
  const mark = session.markDictation(Date.now());
  assert.deepEqual(serialize(mark.open), ['user:1:req-1:stale']);
  const frozen = await stopDictation(session, advance, mark);
  assert.equal(frozen.dictation, '');
});

test('S42-03 an interim idle at Answer that the Stop seal only finalizes stays out; one that gains new words joins whole', async t => {
  for (const [last, expected] of [['好的，我明白了。', ''], ['好的，我明白了，为什么想离开现在的公司？', '好的，我明白了，为什么想离开现在的公司？']]) {
    const { session, user, advance } = meeting(t);
    sealsPerAction(user);
    said(user, 'req-1', '0', '好的，我明白了');
    await advance(20_000);
    const mark = session.markDictation(Date.now());
    assert.deepEqual(serialize(mark.open), ['user:1:req-1:0']);
    await advance(3000);
    // Nothing said after Answer was recognised; the seal's last result settles the idle sentence.
    const frozen = await stopDictation(session, advance, mark, () => said(user, 'req-1', '0', last, true));
    assert.equal(frozen.dictation, expected);
    t.mock.timers.reset();
  }
});

test('S42-03 words heard by the cutoff that the provider splits off under a new key stay in the action', async t => {
  const { session, interviewer, advance } = meeting(t);
  const heard = (segmentId, text, isFinal = false) => interviewer.emit('transcript', { segmentId, epoch: 'req-1', scope: 'req-1', text, isFinal });
  heard('0', '请解释一下数据库索引是怎么工作的？');
  await advance(5000);
  heard('0', '请解释一下数据库索引是怎么工作的？请你详细介绍一下你');
  await advance(200);
  const cut = Date.now();
  const collector = session.collect({ cutoffAt: cut, deadline: cut + 10_000, signal: new AbortController().signal });
  collector.setStage1End(cut);
  await advance(900);
  // Doubao settles the first sentence and moves the clicked words to the next key.
  heard('0', '请解释一下数据库索引是怎么工作的？', true);
  heard('1', '请你详细介绍一下你在上一家公司');
  await advance(500);
  heard('2', '后来才开始说的另一句');
  await advance(4000);
  const frozen = await collector.frozen;
  assert.deepEqual(serialize(frozen.channels.interviewer.segments.map(segment => segment.text)),
    ['请解释一下数据库索引是怎么工作的？', '请你详细介绍一下你在上一家公司']);
});

test('S42-03 a just-said interim joins only the dictation it preceded, not the next one', async t => {
  const { session, user, advance } = meeting(t);
  user.emit('transcript', { segmentId: 'just-said', epoch: 'req-1', text: '红黑树和AVL树的区别', isFinal: false });
  await advance(1200);
  let mark = session.markDictation(Date.now());
  let frozen = await stopDictation(session, advance, mark);
  assert.equal(frozen.dictation, '红黑树和AVL树的区别');

  await advance(2000);
  mark = session.markDictation(Date.now());
  assert.ok(mark.at - 0 > 5000, 'the interim (updated at 0) is now more than five seconds older than the mark');
  await advance(50);
  user.emit('transcript', { segmentId: 'second', epoch: 'req-1', text: '第二个问题', isFinal: true });
  frozen = await stopDictation(session, advance, mark);
  assert.equal(frozen.dictation, '第二个问题');
  assert.deepEqual(serialize(frozen.dictationKeys), ['user:1:req-1:second']);
});

test('S42-03 a finals-only provider dictates the finals after Answer and not an old corrected final', async t => {
  const { session, user, advance } = meeting(t);
  user.emit('transcript', { segmentId: 'rest:b0', scope: 'rest:b0', text: 'said before answer', isFinal: true });
  await advance(100);
  const mark = session.markDictation(Date.now());
  await advance(100);
  user.emit('transcript', { segmentId: 'rest:b0', scope: 'rest:b0', text: 'said before answer, corrected', isFinal: true });
  user.emit('transcript', { segmentId: 'rest:b1', scope: 'rest:b1', text: 'first batch', isFinal: true });
  await advance(1000);
  user.emit('transcript', { segmentId: 'rest:b2', scope: 'rest:b2', text: 'second batch', isFinal: true });
  const frozen = await stopDictation(session, advance, mark,
    () => user.emit('transcript', { segmentId: 'rest:b3', scope: 'rest:b3', text: 'after stop', isFinal: true }));
  assert.equal(frozen.dictation, 'first batch second batch');
});

test('S42-03 manual collection never finishes provider tasks; cancellation, a new session and drain release the collector', async t => {
  const { session, user, interviewer, advance } = meeting(t);
  let finishes = 0;
  user.finalize = interviewer.finalize = () => { finishes++; };
  const controller = new AbortController();
  const cancelled = watch(session.collect({ cutoffAt: 0, deadline: 10_000, signal: controller.signal }).frozen);
  assert.equal(finishes, 0);
  controller.abort();
  await advance(0);
  assert.equal(cancelled.error.name, 'AbortError');
  const draining = watch(session.collect({ cutoffAt: 0, deadline: 10_000, signal: new AbortController().signal }).frozen);
  const drained = session.drain(100, 0);
  await advance(100);
  await drained;
  assert.equal(draining.error.name, 'AbortError');
  assert.equal(finishes, 2, 'the meeting drain still finishes both tasks');
  await advance(20_000);
});

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
  const warnings = [];
  vm.runInNewContext(code, { exports, setTimeout, clearTimeout, Promise, Error, Set, Map, Date, Array, Object, DOMException,
    console: { warn: (...args) => warnings.push(args) } });
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
  return { session, events, warnings, MeetingSttSession: exports.MeetingSttSession };
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

test('S42-03 a dictation whose beginning left the bounded ledger fails explicitly instead of returning a truncated question', async t => {
  const { session, user, advance } = meeting(t);
  const mark = session.markDictation(0);
  await advance(10);
  for (let i = 0; i < 2001; i++) user.emit('transcript', { segmentId: 'd' + i, text: 'word' + i, isFinal: true });
  await advance(10);
  assert.throws(() => session.collect({ cutoffAt: Date.now(), deadline: Date.now() + 10_000, signal: new AbortController().signal, dictation: mark }),
    { name: 'DictationOverflowError' });
  // Collection without that dictation, or with a mark after the evicted speech, stays bounded and works.
  const later = session.markDictation(Date.now());
  await advance(10);
  user.emit('transcript', { segmentId: 'fresh', text: 'fresh question', isFinal: true });
  await advance(10);
  const frozen = watch(session.collect({ cutoffAt: Date.now(), deadline: Date.now() + 10_000, signal: new AbortController().signal, dictation: later }).frozen);
  await advance(4000);
  assert.equal(frozen.value.dictation, 'fresh question');
  assert.equal(session.record('user:1:d0'), undefined, 'the live ledger stays bounded');
});

test('silent Stop: interviewer speech updated within 15 s before the mark, or interim during dictation, is heard; older or none is not', async t => {
  const { session, interviewer, advance } = meeting(t);
  // (c) The interviewer finished 20 s before Answer and said nothing since.
  interviewer.emit('transcript', { segmentId: 'long-ago', text: 'What did you build last year?', isFinal: true });
  await advance(20_000);
  let mark = session.markDictation(Date.now());
  await advance(2000);
  let frozen = await stopDictation(session, advance, mark);
  assert.equal(frozen.dictation, '');
  assert.equal(frozen.interviewerHeard, false, 'speech older than 15 s before the mark is not this round');

  // (a) Interviewer words 10 s before Answer belong to this round.
  await advance(30_000);
  interviewer.emit('transcript', { segmentId: 'recent', text: 'How do you size a thread pool?', isFinal: true });
  await advance(10_000);
  mark = session.markDictation(Date.now());
  await advance(1500);
  frozen = await stopDictation(session, advance, mark);
  assert.equal(frozen.dictation, '');
  assert.equal(frozen.interviewerHeard, true);

  // An interviewer interim still open while recording counts as heard as well.
  await advance(60_000);
  mark = session.markDictation(Date.now());
  await advance(500);
  interviewer.emit('transcript', { segmentId: 'mid-sentence', text: 'and what about back', isFinal: false });
  await advance(500);
  frozen = await stopDictation(session, advance, mark);
  assert.equal(frozen.interviewerHeard, true, 'an unfinished interviewer sentence is heard');
});

test('silent Stop: no interviewer speech at all is not heard, and an action without a mark carries no flag', async t => {
  const { session, advance } = meeting(t);
  const mark = session.markDictation(Date.now());
  await advance(1000);
  const frozen = await stopDictation(session, advance, mark);
  assert.equal(frozen.dictation, '');
  assert.equal(frozen.interviewerHeard, false);
  const plain = session.collect({ cutoffAt: Date.now(), deadline: Date.now() + 10_000, signal: new AbortController().signal });
  await advance(4000);
  assert.equal('interviewerHeard' in await plain.frozen, false);
});
