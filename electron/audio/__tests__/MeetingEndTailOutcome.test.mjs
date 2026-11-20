// Item 2 (2026-11-20): the transcript tail when a meeting ends, through the production
// AppState.endMeeting (extracted from electron/main.ts by mainMeetingFixture) with real REST
// providers on both channels: Groq (RestSTT) and a custom OpenAI-compatible endpoint
// (OpenAIStreamingSTT, always REST). Uploads go to a stub outbound client that never answers until
// the test says so, so no request leaves the process and no credential is read; timers are mocked.
//   (a) the last batch was already uploading when End was clicked and fails while the capture
//       devices are still being released: the launcher gets the notice for that channel only;
//   (b) one channel's tail succeeds and the other's takes longer than the 5 s budget: only the
//       late channel is reported (timed out) and the successful side's text is kept;
//   (c) a voiced tail shorter than the 4000-byte minimum is padded with silence and uploaded;
//   (d) a pure-silence tail is not uploaded and raises no notice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';
import { mainFixture } from './mainMeetingFixture.mjs';

const require = createRequire(import.meta.url);
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const quiet = { log() {}, warn() {}, error() {} };
// Timers resolve through globalThis at call time, so the test's mocked clock drives the providers too.
const timers = {
  setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: id => globalThis.clearTimeout(id),
  setInterval: (...args) => globalThis.setInterval(...args), clearInterval: id => globalThis.clearInterval(id),
};
const load = (file, requireFn = require) => {
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(`${REPO}/${file}`, 'utf8')), {
    module, exports: module.exports, console: quiet, Buffer, require: requireFn, ...timers,
    Promise, Error, Set, Map, WeakMap, Date, Array, Object, Math, DOMException,
    Int16Array, Uint8Array, Float32Array, JSON, Number, String, NaN, Infinity,
  });
  return module.exports;
};

// Every upload waits for the test; `channel` is the lane whose provider started it.
const uploads = [];
let uploading = null;
const post = () => new Promise((resolve, reject) => {
  uploads.push({ channel: uploading.channel, bytes: uploading.bytes,
    reply: text => resolve({ data: { text } }), fail: error => reject(error) });
});
const realOutbound = require('../../../dist-electron/electron/services/outbound.js');
const outbound = { openAiSttEndpoint: realOutbound.openAiSttEndpoint, outboundAxios: { post } };
const languages = require('../../../dist-electron/electron/config/languages.js');
const restBatches = load('electron/audio/restBatches.ts');
class NoSocket extends EventEmitter {
  static OPEN = 1;
  constructor() { super(); throw new Error('REST mode must not open a WebSocket'); }
}
const resolveFor = id => {
  if (id === '../services/outbound') return outbound;
  if (id === '../config/languages') return languages;
  if (id === './restBatches') return restBatches;
  if (id === 'ws') return NoSocket;
  if (id === './dnsHelpers') return { streamingStttWsOptions: () => ({}) };
  if (id === './openaiTranscriptTurnCoalescer') return require('../../../dist-electron/electron/audio/openaiTranscriptTurnCoalescer.js');
  return require(id);
};
const { RestSTT } = load('electron/audio/RestSTT.ts', resolveFor);
const { OpenAIStreamingSTT } = load('electron/audio/OpenAIStreamingSTT.ts', resolveFor);
const noticeLib = load('src/lib/meetingEndNotice.ts');

const PROVIDERS = {
  'Groq': { make: () => new RestSTT('groq', 'synthetic-only'), upload: 'uploadAudio' },
  'custom OpenAI REST': { make: () => new OpenAIStreamingSTT('synthetic-only', 'https://stt.invalid/v1'), upload: '_restUpload' },
};

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
/** Loud 16 kHz mono PCM, above the silence threshold. */
function speech(bytes = 16000) {
  const pcm = Buffer.alloc(bytes);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 4 ? 3000 : -3000, i);
  return pcm;
}

async function meeting(t, name) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  uploads.length = 0;
  const stts = {};
  const notices = [];
  const f = mainFixture({
    sttProvider: channel => {
      const stt = PROVIDERS[name].make();
      const method = PROVIDERS[name].upload;
      const upload = stt[method].bind(stt);
      stt[method] = wav => { uploading = { channel, bytes: wav.length }; return upload(wav); };
      stts[channel] = stt;
      t.after(() => stt.stop());
      return stt;
    },
    captureFailed: payload => notices.push(payload),
  });
  await f.start();
  assert.ok(stts.user && stts.interviewer, 'both lanes run the provider under test');
  for (const stt of Object.values(stts)) { stt.setSampleRate(16000); stt.setAudioChannelCount(1); }
  let drainBudget;
  const drain = f.session.drain;
  f.session.drain = ms => { drainBudget = ms; return drain(ms); };
  const ending = () => {
    let done = false;
    const promise = f.state.endMeeting().finally(() => { done = true; });
    return { promise, get done() { return done; } };
  };
  const text = speaker => f.transcripts.filter(row => row.speaker === speaker && row.final).map(row => row.text);
  return { f, stts, notices, ending, text, get drainBudget() { return drainBudget; },
    advance: async ms => { t.mock.timers.tick(ms); await flush(); },
    /** Runs due timers (without moving the clock) until endMeeting returns. */
    settled: async end => { for (let i = 0; i < 50 && !end.done; i++) { t.mock.timers.tick(0); await flush(); } return end.promise; } };
}

/** What the launcher shows for the notices main sent, through the launcher's own helper. */
const launcherText = notices => notices.map(payload => noticeLib.meetingEndNotice(payload)).filter(Boolean);

for (const name of Object.keys(PROVIDERS)) {
  test(`${name} (a): an in-flight last batch that fails while devices are released is reported for its channel`, async t => {
    const m = await meeting(t, name);
    m.stts.user.write(speech());
    m.stts.user.notifySpeechEnded();
    m.stts.interviewer.write(speech());
    m.stts.interviewer.notifySpeechEnded();
    await flush();
    assert.deepEqual(uploads.map(upload => upload.channel), ['user', 'interviewer'], 'both last batches are uploading before End');
    // The capture devices take a while to release; both in-flight uploads settle during it.
    const detach = m.f.state.meetingAudio.detachAndDestroy.bind(m.f.state.meetingAudio);
    m.f.state.meetingAudio.detachAndDestroy = async () => {
      uploads[0].fail(new Error('synthetic upload failure'));
      uploads[1].reply('interviewer last sentence');
      await flush();
      return detach();
    };
    const end = m.ending();
    await m.settled(end);
    assert.equal(m.notices.length, 1, 'the launcher is told');
    const [notice] = m.notices;
    assert.equal(notice.kind, 'transcript-tail-incomplete');
    assert.deepEqual([...notice.failedChannels], ['user']);
    assert.deepEqual({ ...notice.channelOutcomes }, { user: 'failed', interviewer: 'success' });
    assert.equal(notice.timedOut, false);
    assert.deepEqual(launcherText(m.notices), ['The last part of the transcript was not completed.']);
    assert.deepEqual(m.text('interviewer'), ['interviewer last sentence'], 'the successful side keeps its text');
    assert.deepEqual(m.text('user'), []);
    assert.equal(uploads.length, 2, 'nothing else to upload');
  });

  test(`${name} (b): one side succeeds, the other exceeds the 5 s budget: only the late side is reported`, async t => {
    const m = await meeting(t, name);
    m.stts.user.write(speech());
    m.stts.interviewer.write(speech());
    const end = m.ending();
    await m.advance(0);
    assert.equal(m.drainBudget, 5000, 'endMeeting keeps the 5 s total budget');
    assert.deepEqual(uploads.map(upload => upload.channel).sort(), ['interviewer', 'user'], 'both tails are uploaded');
    uploads.find(upload => upload.channel === 'user').reply('user last sentence');
    await m.advance(1000);
    assert.equal(end.done, false, 'the interviewer tail is still within the budget');
    await m.advance(3999);
    assert.equal(end.done, false);
    assert.equal(m.notices.length, 0);
    await m.advance(1);
    await m.settled(end);
    assert.equal(m.notices.length, 1);
    const [notice] = m.notices;
    assert.equal(notice.kind, 'transcript-tail-incomplete');
    assert.deepEqual([...notice.failedChannels], ['interviewer'], 'the successful user side is not marked failed');
    assert.deepEqual({ ...notice.channelOutcomes }, { user: 'success', interviewer: 'timed-out' });
    assert.equal(notice.timedOut, true);
    assert.deepEqual(launcherText(m.notices), ['The last part of the transcript was not completed.']);
    assert.deepEqual(m.text('user'), ['user last sentence'], 'the successful side keeps its text');
    uploads.find(upload => upload.channel === 'interviewer').reply('too late');
    await flush();
    assert.deepEqual(m.text('interviewer'), [], 'a result after the deadline is discarded');
  });

  test(`${name} (c): a voiced tail shorter than the minimum is padded with silence and uploaded`, async t => {
    const m = await meeting(t, name);
    m.stts.user.write(speech(1600)); // 50 ms of a last word, well under 4000 bytes
    const end = m.ending();
    await m.advance(0);
    assert.equal(uploads.length, 1, 'the short voiced tail is uploaded');
    assert.equal(uploads[0].channel, 'user');
    assert.equal(uploads[0].bytes, 44 + 4000, 'padded with silence to the 4000-byte minimum');
    uploads[0].reply('yes');
    await m.advance(0);
    await m.settled(end);
    assert.deepEqual(m.notices, []);
    assert.deepEqual(m.text('user'), ['yes']);
  });

  test(`${name} (d): a pure-silence tail is not uploaded and raises no notice`, async t => {
    const m = await meeting(t, name);
    m.stts.user.write(Buffer.alloc(16000));
    m.stts.interviewer.write(Buffer.alloc(1600));
    const end = m.ending();
    await m.settled(end);
    assert.equal(uploads.length, 0, 'silence is never uploaded');
    assert.deepEqual(m.notices, [], 'no notice');
  });
}
