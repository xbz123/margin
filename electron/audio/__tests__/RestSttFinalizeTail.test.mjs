// H2 Groq tail (2026-11-19): ending a meeting right after speaking dropped the last sentence.
// RestSTT.finalize() fired its flush without returning it, and with an upload in flight it only
// queued the tail, so the meeting drain's 1.5 s grace ran out, stop() bumped the upload epoch and
// the late transcript was discarded. finalize() now resolves only after the in-flight upload and
// the queued tail have emitted their transcripts, and rejects when one of them failed, so the drain
// reports that channel incomplete instead of a complete save. RestSTT and MeetingSttSession are
// compiled from source; uploads go to a stub outbound client, so no request leaves the process.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const quiet = { log() {}, warn() {}, error() {} };
const load = (file, requireFn = require) => {
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(`${REPO}/${file}`, 'utf8')), {
    module, exports: module.exports, console: quiet, Buffer, require: requireFn,
    setTimeout, clearTimeout, setInterval, clearInterval, Promise, Error, Set, Map, Date, Array, Object, DOMException,
  });
  return module.exports;
};

// Each upload waits until the test releases it, then answers with its transcript.
const uploads = [];
const outbound = { outboundAxios: { post: () => new Promise((resolve, reject) => {
  uploads.push({ reply: text => resolve({ data: { text } }), fail: error => reject(error) });
}) } };
const restBatches = load('electron/audio/restBatches.ts');
const { RestSTT } = load('electron/audio/RestSTT.ts', id => {
  if (id === '../services/outbound') return outbound;
  if (id === '../config/languages') return require('../../../dist-electron/electron/config/languages.js');
  if (id === './restBatches') return restBatches;
  return require(id);
});
const { MeetingSttSession } = load('electron/audio/MeetingSttSession.ts');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function watch(promise) {
  const state = { done: false };
  promise.then(value => { state.value = value; state.done = true; }, error => { state.error = error; state.done = true; });
  return state;
}
/** 0.25 s of loud 16 kHz mono PCM, well above the silence and minimum-size thresholds. */
function speech() {
  const pcm = Buffer.alloc(8000);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 4 ? 3000 : -3000, i);
  return pcm;
}
function groq(t) {
  uploads.length = 0;
  const stt = new RestSTT('groq', 'synthetic-only');
  const texts = [];
  stt.on('transcript', event => texts.push(event.text));
  stt.on('error', () => {});
  stt.start();
  t.after(() => stt.stop());
  return { stt, texts };
}
function meetingTwoChannels(t) {
  uploads.length = 0;
  const texts = [];
  const errors = [];
  const stts = {};
  const session = new MeetingSttSession({
    create: channel => {
      const stt = new RestSTT('groq', 'synthetic-only');
      stt.start();
      stts[channel] = stt;
      t.after(() => stt.stop());
      return stt;
    },
    onTranscript: event => texts.push([event.channel, event.text]),
    onError: (channel, error) => errors.push([channel, error.message]),
  });
  session.begin('meeting-2');
  session.ensure('user');
  session.ensure('interviewer');
  return { session, stts, texts, errors };
}
function meeting(t) {
  uploads.length = 0;
  const texts = [];
  let stt;
  const session = new MeetingSttSession({
    create: () => {
      stt = new RestSTT('groq', 'synthetic-only');
      stt.start();
      return stt;
    },
    onTranscript: event => texts.push(event.text),
  });
  session.begin('meeting-1');
  session.ensure('user');
  t.after(() => stt.stop());
  return { session, stt, texts };
}

test('finalize resolves only after the tail transcript is emitted', async t => {
  const { stt, texts } = groq(t);
  stt.write(speech());
  const finalizing = watch(Promise.resolve(stt.finalize()));
  await settle();
  assert.equal(uploads.length, 1, 'the tail is uploaded');
  assert.equal(finalizing.done, false, 'finalize waits for the tail upload');
  uploads[0].reply('the last sentence');
  await settle();
  assert.equal(finalizing.done, true);
  assert.deepEqual(texts, ['the last sentence']);
});

test('an in-flight upload and the tail queued behind it both complete before finalize resolves', async t => {
  const { stt, texts } = groq(t);
  stt.write(speech());
  stt.notifySpeechEnded();
  await settle();
  assert.equal(uploads.length, 1, 'an earlier sentence is in flight');
  stt.write(speech());
  const finalizing = watch(Promise.resolve(stt.finalize()));
  await settle();
  assert.equal(uploads.length, 1, 'the tail waits behind the in-flight upload');
  uploads[0].reply('earlier sentence');
  await settle();
  assert.equal(uploads.length, 2, 'the queued tail is uploaded next');
  assert.equal(finalizing.done, false, 'finalize still waits for the tail');
  uploads[1].reply('last sentence');
  await settle();
  assert.equal(finalizing.done, true);
  assert.deepEqual(texts, ['earlier sentence', 'last sentence']);
});

test('a failed tail upload makes finalize reject', async t => {
  const { stt, texts } = groq(t);
  stt.write(speech());
  const finalizing = watch(Promise.resolve(stt.finalize()));
  await settle();
  uploads[0].fail(new Error('synthetic upload failure'));
  await settle();
  assert.equal(finalizing.done, true);
  assert.match(String(finalizing.error?.message), /tail upload failed/);
  assert.deepEqual(texts, []);
});

test('an earlier batch succeeds and the queued last batch fails: finalize rejects, earlier text kept', async t => {
  const { stt, texts } = groq(t);
  stt.write(speech());
  stt.notifySpeechEnded();
  await settle();
  stt.write(speech());
  const finalizing = watch(Promise.resolve(stt.finalize()));
  await settle();
  uploads[0].reply('earlier sentence');
  await settle();
  assert.equal(uploads.length, 2);
  assert.equal(finalizing.done, false);
  uploads[1].fail(new Error('synthetic upload failure'));
  await settle();
  assert.equal(finalizing.done, true);
  assert.ok(finalizing.error, 'the failed last batch is reported');
  assert.deepEqual(texts, ['earlier sentence']);
});

test('an upload that failed before finalize was reported live; a later successful tail resolves', async t => {
  const { stt, texts } = groq(t);
  stt.write(speech());
  stt.notifySpeechEnded();
  await settle();
  uploads[0].fail(new Error('synthetic upload failure'));
  await settle();
  stt.write(speech());
  const finalizing = watch(Promise.resolve(stt.finalize()));
  await settle();
  uploads[1].reply('last sentence');
  await settle();
  assert.equal(finalizing.done, true);
  assert.equal(finalizing.error, undefined);
  assert.deepEqual(texts, ['last sentence']);
});

test('a meeting drain keeps a tail slower than the grace but within the deadline', async t => {
  const { session, stt, texts } = meeting(t);
  stt.write(speech());
  stt.notifySpeechEnded();
  await settle();
  stt.write(speech());
  const draining = session.drain(1000, 20);
  await delay(60);
  assert.equal(uploads.length, 1, 'the tail is still queued behind the in-flight upload after the grace');
  uploads[0].reply('earlier sentence');
  await settle();
  await delay(40);
  uploads[1].reply('the last sentence');
  const result = await draining;
  assert.equal(result.timedOut, false);
  assert.deepEqual([...result.failedChannels], []);
  assert.deepEqual(texts, ['earlier sentence', 'the last sentence']);
});

test('a tail slower than the drain deadline reports a timeout', async t => {
  const { session, stt, texts } = meeting(t);
  stt.write(speech());
  const result = await session.drain(60, 10);
  assert.equal(result.timedOut, true, 'the existing timeout notice path fires');
  assert.deepEqual([...result.failedChannels], ['user']);
  uploads[0].reply('too late');
  await settle();
  assert.deepEqual(texts, [], 'a result after the deadline is discarded');
});

test('a meeting drain whose last user batch fails reports only that channel; other text is kept', async t => {
  const { session, stts, texts, errors } = meetingTwoChannels(t);
  stts.user.write(speech());
  stts.user.notifySpeechEnded();
  await settle();
  assert.equal(uploads.length, 1, 'an earlier user sentence is in flight');
  stts.user.write(speech());
  stts.interviewer.write(speech());
  const draining = session.drain(1000, 20);
  await settle();
  assert.equal(uploads.length, 2, 'the interviewer tail is uploaded; the user tail waits');
  uploads[0].reply('my earlier sentence');
  uploads[1].reply('their last sentence');
  await settle();
  assert.equal(uploads.length, 3, 'the queued user tail is uploaded next');
  uploads[2].fail(new Error('synthetic upload failure'));
  const result = await draining;
  assert.equal(result.timedOut, false);
  assert.deepEqual([...result.failedChannels], ['user']);
  assert.deepEqual(texts, [['user', 'my earlier sentence'], ['interviewer', 'their last sentence']]);
  assert.deepEqual(errors, [], 'the drain reports the failure; no live error notice is raised');
});

test('slow tails on both channels inside the budget drain with no failure', async t => {
  const { session, stts, texts } = meetingTwoChannels(t);
  stts.user.write(speech());
  stts.interviewer.write(speech());
  const draining = session.drain(1000, 20);
  await delay(60);
  assert.equal(uploads.length, 2);
  uploads[1].reply('their last sentence');
  await delay(40);
  uploads[0].reply('my last sentence');
  const result = await draining;
  assert.equal(result.timedOut, false);
  assert.deepEqual([...result.failedChannels], []);
  assert.deepEqual(texts, [['interviewer', 'their last sentence'], ['user', 'my last sentence']]);
});

test('an error event during the drain whose finalize completes does not mark the channel incomplete', async t => {
  // Only a lost tail (finalize rejects) is reported; an unrelated provider error while the
  // drain flushes is not a missing last sentence.
  const { session, stts, texts, errors } = meetingTwoChannels(t);
  stts.interviewer.write(speech());
  const draining = session.drain(1000, 20);
  await settle();
  stts.user.emit('error', new Error('synthetic provider error'));
  uploads[0].reply('their last sentence');
  const result = await draining;
  assert.equal(result.timedOut, false);
  assert.deepEqual([...result.failedChannels], []);
  assert.deepEqual(texts, [['interviewer', 'their last sentence']]);
  assert.deepEqual(errors, [], 'no live error notice while the meeting ends');
});

test('a provider whose finalize rejects while flushing its tail is reported incomplete', async t => {
  const { EventEmitter } = await import('node:events');
  const provider = (fail) => Object.assign(new EventEmitter(), {
    write() {}, stop() {},
    async finalize() { if (fail) { this.emit('error', new Error('tail lost')); throw new Error('tail lost'); } },
  });
  const session = new MeetingSttSession({ create: channel => provider(channel === 'interviewer'), onTranscript() {} });
  session.begin('meeting-3');
  session.ensure('user');
  session.ensure('interviewer');
  const result = await session.drain(5000, 0);
  assert.equal(result.timedOut, false);
  assert.deepEqual([...result.failedChannels], ['interviewer']);
});
