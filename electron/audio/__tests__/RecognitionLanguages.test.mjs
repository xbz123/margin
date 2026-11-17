// Recognition and answer languages are Auto (Chinese & English), English and Chinese.
// Saved values from older builds are read as English or auto. Switching to auto during a
// meeting reaches each provider as auto: Soniox gets Chinese and English hints, the OpenAI
// and Groq Whisper paths send no language so the service detects it. Providers are compiled
// from source with stub sockets and a stub outbound client; nothing leaves the process.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const quiet = { log() {}, warn() {}, error() {} };
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const read = file => fs.readFileSync(`${REPO}/${file}`, 'utf8');
const languages = require('../../../dist-electron/electron/config/languages.js');

test('only Auto (Chinese & English), English and Chinese are offered', () => {
  assert.deepEqual(Object.keys(languages.RECOGNITION_LANGUAGES), ['auto', 'english-us', 'chinese']);
  assert.equal(languages.RECOGNITION_LANGUAGES['english-us'].iso639, 'en');
  assert.equal(languages.RECOGNITION_LANGUAGES.chinese.bcp47, 'zh-CN');
  assert.deepEqual(languages.RECOGNITION_LANGUAGES.auto.alternates, ['zh-CN', 'en-US']);
  assert.deepEqual(languages.AI_RESPONSE_LANGUAGES.map(option => option.code), ['auto', 'English', 'Chinese']);
});

test('saved recognition languages from older builds read as English or auto', () => {
  for (const legacy of ['english-uk', 'english-in', 'english-au', 'english-ca']) {
    assert.equal(languages.normalizeRecognitionLanguage(legacy), 'english-us', legacy);
  }
  for (const removed of ['japanese', 'russian', 'ukrainian', 'klingon']) {
    assert.equal(languages.normalizeRecognitionLanguage(removed), 'auto', removed);
  }
  for (const valid of ['auto', 'english-us', 'chinese']) assert.equal(languages.normalizeRecognitionLanguage(valid), valid);
  assert.equal(languages.normalizeRecognitionLanguage(undefined), 'english-us', 'a never-saved value keeps the English default');
});

test('saved answer languages outside Auto, English and Chinese read as auto', () => {
  for (const removed of ['Japanese', 'Russian', 'english', 'chinese', '', undefined]) {
    assert.equal(languages.normalizeAnswerLanguage(removed), 'auto', String(removed));
  }
  for (const valid of ['auto', 'English', 'Chinese']) assert.equal(languages.normalizeAnswerLanguage(valid), valid);
});

function provider(name) {
  const sockets = [], timers = [], bodies = [];
  class Socket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 0;
    sent = [];
    constructor() { super(); sockets.push(this); }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; }
    terminate() { this.readyState = 3; }
    removeAllListeners() { return super.removeAllListeners(); }
  }
  const schedule = fn => { const timer = { fn, unref() {} }; timers.push(timer); return timer; };
  const outbound = {
    ...require('../../../dist-electron/electron/services/outbound.js'),
    outboundAxios: { post: async (_url, form) => { bodies.push(form.getBuffer().toString('latin1')); return { data: { text: 'synthetic' } }; } },
  };
  const module = { exports: {} };
  vm.runInNewContext(compile(read(`electron/audio/${name}.ts`)), {
    exports: module.exports, module, console: quiet, Buffer, Date, process: { env: {}, cwd: () => '/synthetic' },
    setTimeout: schedule, setInterval: schedule, clearTimeout() {}, clearInterval() {},
    require(id) {
      if (id === 'ws') return Socket;
      if (id === '../config/languages') return languages;
      if (id === './dnsHelpers') return { streamingStttWsOptions: () => ({}) };
      if (id === '../services/outbound') return outbound;
      if (id === './openaiTranscriptTurnCoalescer') return require('../../../dist-electron/electron/audio/openaiTranscriptTurnCoalescer.js');
      if (id === './restBatches') return require('../../../dist-electron/electron/audio/restBatches.js');
      return require(id);
    },
  });
  return { Class: module.exports[name], sockets, timers, bodies };
}

const sentJson = socket => socket.sent.filter(data => typeof data === 'string').map(data => JSON.parse(data));

test('Soniox: auto sends Chinese and English hints, including after a live switch from English', () => {
  const loaded = provider('SonioxStreamingSTT');
  const stt = new loaded.Class('synthetic-only');
  stt.setRecognitionLanguage('english-us'); stt.start();
  loaded.sockets[0].readyState = 1; loaded.sockets[0].emit('open');
  const first = sentJson(loaded.sockets[0]).find(message => message.model);
  assert.deepEqual(first.language_hints, ['en']);
  assert.equal(first.enable_language_identification, true);

  stt.setRecognitionLanguage('auto'); for (const timer of [...loaded.timers]) timer.fn();
  const socket = loaded.sockets.at(-1);
  assert.notEqual(socket, loaded.sockets[0], 'the live switch restarts the session');
  socket.readyState = 1; socket.emit('open');
  const restarted = sentJson(socket).find(message => message.model);
  assert.deepEqual(restarted.language_hints, ['zh', 'en']);
  assert.equal(restarted.enable_language_identification, true);
  stt.stop(false);
});

test('OpenAI streaming: auto sends no language, including after a live switch from English', () => {
  const loaded = provider('OpenAIStreamingSTT');
  const stt = new loaded.Class('synthetic-only');
  stt.setRecognitionLanguage('english-us'); stt.start();
  loaded.sockets[0].readyState = 1; loaded.sockets[0].emit('open');
  const transcription = socket => sentJson(socket).find(message => message.type === 'session.update').session.audio.input.transcription;
  assert.equal(transcription(loaded.sockets[0]).language, 'en');

  stt.setRecognitionLanguage('auto'); const socket = loaded.sockets.at(-1);
  assert.notEqual(socket, loaded.sockets[0], 'the live switch reconnects the session');
  socket.readyState = 1; socket.emit('open');
  assert.equal('language' in transcription(socket), false);
  stt.stop(false);
});

test('OpenAI and Groq uploads: auto sends no language field, English and Chinese send their code', async () => {
  for (const name of ['openai', 'groq']) {
    const loaded = provider('RestSTT');
    const stt = new loaded.Class(name, 'synthetic-only');
    for (const [key, expected] of [['english-us', 'en'], ['auto', null], ['chinese', 'zh'], ['english-uk', 'en'], ['japanese', null]]) {
      stt.setRecognitionLanguage(key); await stt.uploadAudio(Buffer.alloc(64));
      const body = loaded.bodies.at(-1);
      if (expected) assert.match(body, new RegExp(`name="language"\\r\\n\\r\\n${expected}\\r\\n`), `${name} ${key}`);
      else assert.doesNotMatch(body, /name="language"/, `${name} ${key}`);
    }
  }
});
