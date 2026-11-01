// Term hints (2026-11-01): the saved hint is sent as the Whisper `prompt` field with each
// Groq upload, a transcript that only echoes the hint is dropped, and the weighted length
// keeps the hint within Whisper's 224-token prompt. RestSTT is compiled from source with a
// stub outbound client, so no request leaves the process and no audio device is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const load = (file, requireFn = require) => {
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(`${REPO}/${file}`, 'utf8')), { module, exports: module.exports, console: { log() {}, warn() {}, error() {} }, Buffer, require: requireFn });
  return module.exports;
};

const bodies = [];
const outbound = { outboundAxios: { post: async (_url, form) => { bodies.push(form.getBuffer().toString('latin1')); return { data: { text: 'synthetic' } }; } } };
const { RestSTT } = load('electron/audio/RestSTT.ts', id => {
  if (id === '../services/outbound') return outbound;
  if (id === '../config/languages') return { RECOGNITION_LANGUAGES: { 'english-us': { iso639: 'en' } } };
  if (id === './restBatches') return require('../../../dist-electron/electron/audio/restBatches.js');
  return require(id);
});
const { STT_TERM_PROMPT_MAX_WEIGHT, sttTermPromptWeight } = load('src/types/sttTermPrompt.ts');

async function upload(stt) {
  await stt.uploadAudio(Buffer.alloc(64));
  return bodies.at(-1);
}

test('the saved term hint is sent as the Whisper prompt, and nothing is sent without one', async () => {
  const stt = new RestSTT('groq', 'synthetic-only');
  assert.doesNotMatch(await upload(stt), /name="prompt"/);
  stt.setTermPrompt('  Redis, Kubernetes, gRPC  ');
  assert.match(await upload(stt), /name="prompt"\r\n\r\nRedis, Kubernetes, gRPC\r\n/);
  stt.setTermPrompt('');
  assert.doesNotMatch(await upload(stt), /name="prompt"/);
});

test('a transcript that only repeats the term hint is treated as an echo', () => {
  const stt = new RestSTT('groq', 'synthetic-only');
  assert.equal(stt.echoesTermPrompt('Redis, Kubernetes.'), false, 'no hint, no echo');
  stt.setTermPrompt('Redis, Kubernetes, 哈希表');
  assert.equal(stt.echoesTermPrompt('redis kubernetes 哈希表。'), true);
  assert.equal(stt.echoesTermPrompt('We cache sessions in Redis.'), false);
});

test('the renderer counter uses the same limit the settings save enforces', () => {
  assert.equal(sttTermPromptWeight('a'.repeat(STT_TERM_PROMPT_MAX_WEIGHT)), STT_TERM_PROMPT_MAX_WEIGHT);
  assert.equal(sttTermPromptWeight('术'.repeat(100)), 300);
  assert.ok(sttTermPromptWeight('术'.repeat(101)) > STT_TERM_PROMPT_MAX_WEIGHT);
});
