// A custom OpenAI-compatible endpoint always runs OpenAIStreamingSTT in REST mode. Its finalize()
// used to fire the tail upload without returning it, so a tail upload that failed during meeting end
// only emitted 'error' (ignored while draining) and the meeting was saved as complete. finalize() now
// settles after the uploads it waits for and rejects when one of them failed, like RestSTT.
// OpenAIStreamingSTT and MeetingSttSession are compiled from source; uploads go to a stub outbound
// client, so no request leaves the process and no credential is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
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
    setTimeout, clearTimeout, setInterval, clearInterval, Promise, Error, Set, Map, WeakMap, Date, Array, Object, Math, DOMException,
    Int16Array, Uint8Array, Float32Array, JSON, Number, String, NaN, Infinity,
  });
  return module.exports;
};

// Each upload waits until the test releases it, then answers with its transcript.
const uploads = [];
const realOutbound = require('../../../dist-electron/electron/services/outbound.js');
const outbound = {
  openAiSttEndpoint: realOutbound.openAiSttEndpoint,
  outboundAxios: { post: () => new Promise((resolve, reject) => {
    uploads.push({ reply: text => resolve({ data: { text } }), fail: error => reject(error) });
  }) },
};
class NoSocket extends EventEmitter {
  static OPEN = 1;
  constructor() { super(); throw new Error('REST mode must not open a WebSocket'); }
}
const restBatches = load('electron/audio/restBatches.ts');
const { OpenAIStreamingSTT } = load('electron/audio/OpenAIStreamingSTT.ts', id => {
  if (id === 'ws') return NoSocket;
  if (id === '../services/outbound') return outbound;
  if (id === '../config/languages') return require('../../../dist-electron/electron/config/languages.js');
  if (id === './dnsHelpers') return { streamingStttWsOptions: () => ({}) };
  if (id === './openaiTranscriptTurnCoalescer') return require('../../../dist-electron/electron/audio/openaiTranscriptTurnCoalescer.js');
  if (id === './restBatches') return restBatches;
  return require(id);
});
const { MeetingSttSession } = load('electron/audio/MeetingSttSession.ts');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
/** Loud PCM, well above the silence and minimum-size thresholds. */
function speech() {
  const pcm = Buffer.alloc(16000);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 4 ? 3000 : -3000, i);
  return pcm;
}
const custom = () => new OpenAIStreamingSTT('synthetic-only', 'https://stt.invalid/v1');

function meeting(t) {
  uploads.length = 0;
  const texts = [];
  const errors = [];
  let stt;
  const session = new MeetingSttSession({
    create: () => {
      stt = custom();
      stt.start();
      return stt;
    },
    onTranscript: event => texts.push(event.text),
    onError: (channel, error) => errors.push([channel, error.message]),
  });
  session.begin('meeting-openai-rest');
  session.ensure('user');
  t.after(() => stt.stop());
  return { session, stt, texts, errors };
}

test('a custom endpoint runs in REST mode and finalize returns a promise', async t => {
  uploads.length = 0;
  const stt = custom();
  stt.on('error', () => {});
  stt.start();
  t.after(() => stt.stop());
  assert.equal(stt.mode, 'rest');
  stt.write(speech());
  const finalizing = stt.finalize();
  assert.equal(typeof finalizing?.then, 'function');
  await settle();
  uploads[0].reply('done');
  await finalizing;
});

test('a failed tail upload: the drain reports the channel, earlier text is kept', async t => {
  const { session, stt, texts, errors } = meeting(t);
  stt.write(speech());
  stt.notifySpeechEnded();
  await settle();
  uploads[0].reply('earlier sentence');
  await settle();
  stt.write(speech());
  const draining = session.drain(1000, 20);
  await settle();
  assert.equal(uploads.length, 2, 'the tail is uploaded');
  uploads[1].fail(new Error('synthetic upload failure'));
  const result = await draining;
  assert.equal(result.timedOut, false);
  assert.deepEqual([...result.failedChannels], ['user']);
  assert.deepEqual(texts, ['earlier sentence']);
  assert.deepEqual(errors, [], 'the drain reports the failure; no live error notice is raised');
});

test('a tail queued behind an in-flight upload fails: the drain reports the channel', async t => {
  const { session, stt, texts } = meeting(t);
  stt.write(speech());
  stt.notifySpeechEnded();
  await settle();
  stt.write(speech());
  const draining = session.drain(1000, 20);
  await settle();
  assert.equal(uploads.length, 1, 'the tail waits behind the in-flight upload');
  uploads[0].reply('earlier sentence');
  await settle();
  assert.equal(uploads.length, 2, 'the queued tail is uploaded next');
  uploads[1].fail(new Error('synthetic upload failure'));
  const result = await draining;
  assert.equal(result.timedOut, false);
  assert.deepEqual([...result.failedChannels], ['user']);
  assert.deepEqual(texts, ['earlier sentence']);
});

test('a tail slower than the grace but within the budget succeeds with no failure', async t => {
  const { session, stt, texts } = meeting(t);
  stt.write(speech());
  const draining = session.drain(1000, 20);
  await delay(80);
  assert.equal(uploads.length, 1);
  uploads[0].reply('the last sentence');
  const result = await draining;
  assert.equal(result.timedOut, false);
  assert.deepEqual([...result.failedChannels], []);
  assert.deepEqual(texts, ['the last sentence']);
});

test('an earlier live failure followed by a successful tail reports no failure', async t => {
  const { session, stt, texts, errors } = meeting(t);
  stt.write(speech());
  stt.notifySpeechEnded();
  await settle();
  uploads[0].fail(new Error('synthetic upload failure'));
  await settle();
  assert.equal(errors.length, 1, 'the earlier failure was reported live');
  stt.write(speech());
  const draining = session.drain(1000, 20);
  await settle();
  uploads[1].reply('last sentence');
  const result = await draining;
  assert.equal(result.timedOut, false);
  assert.deepEqual([...result.failedChannels], []);
  assert.deepEqual(texts, ['last sentence']);
});
