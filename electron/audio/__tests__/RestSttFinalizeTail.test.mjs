// H2 Groq tail (2026-11-19): ending a meeting right after speaking dropped the last sentence.
// RestSTT.finalize() fired its flush without returning it, and with an upload in flight it only
// queued the tail, so the meeting drain's 1.5 s grace ran out, stop() bumped the upload epoch and
// the late transcript was discarded. finalize() now resolves only after the in-flight upload and
// the queued tail have emitted their transcripts (or failed). RestSTT and MeetingSttSession are
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

test('a failed tail upload still lets finalize resolve', async t => {
  const { stt, texts } = groq(t);
  stt.write(speech());
  const finalizing = watch(Promise.resolve(stt.finalize()));
  await settle();
  uploads[0].fail(new Error('synthetic upload failure'));
  await settle();
  assert.equal(finalizing.done, true);
  assert.equal(finalizing.error, undefined);
  assert.deepEqual(texts, []);
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
