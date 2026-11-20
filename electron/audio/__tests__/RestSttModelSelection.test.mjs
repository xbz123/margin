// Groq model selection (2026-11-20): the settings page saved plain whisper-large-v3, but main.ts
// built RestSTT with it and then called setRecognitionLanguage(), which rebuilt the provider config
// and reset the model to whisper-large-v3-turbo. Every rebuild now keeps the saved model. RestSTT is
// compiled from source; uploads go to a stub outbound client and a stub form, so no request leaves
// the process and the test reads the model field each upload would send.
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

const requests = [];
class Form {
  constructor() { this.fields = {}; }
  append(key, value) { if (key !== 'file') this.fields[key] = value; }
  getHeaders() { return {}; }
}
const outbound = { outboundAxios: { post: async (url, form) => { requests.push({ url, ...form.fields }); return { data: { text: 'ok' } }; } } };
const languages = require('../../../dist-electron/electron/config/languages.js');
const restBatches = load('electron/audio/restBatches.ts');
const { RestSTT } = load('electron/audio/RestSTT.ts', id => {
  if (id === '../services/outbound') return outbound;
  if (id === 'form-data') return { __esModule: true, default: Form };
  if (id === '../config/languages') return languages;
  if (id === './restBatches') return restBatches;
  return require(id);
});

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function speech() {
  const pcm = Buffer.alloc(8000);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 4 ? 3000 : -3000, i);
  return pcm;
}
/** The same steps main.ts createSTTProvider takes for Groq: saved model, then the saved language. */
function startGroq(t, savedModel, language) {
  const stt = new RestSTT('groq', 'synthetic-only', savedModel);
  stt.setTermPrompt('');
  stt.setRecognitionLanguage(language);
  stt.on('error', () => {});
  stt.start();
  t.after(() => stt.stop());
  return stt;
}
async function upload(stt) {
  const before = requests.length;
  stt.write(speech());
  await stt.finalize();
  await settle();
  assert.equal(requests.length, before + 1, 'one upload per call');
  return requests.at(-1);
}

for (const model of ['whisper-large-v3', 'whisper-large-v3-turbo']) {
  test(`${model} selected: meeting start and zh/en switches all send ${model}`, async t => {
    requests.length = 0;
    const stt = startGroq(t, model, 'chinese');
    assert.equal(stt.getModel(), model);
    const first = await upload(stt);
    assert.equal(first.model, model, 'meeting start');
    stt.setRecognitionLanguage('english-us');
    const english = await upload(stt);
    assert.equal(english.model, model, 'after switching to English');
    stt.setRecognitionLanguage('chinese');
    const chinese = await upload(stt);
    assert.equal(chinese.model, model, 'after switching back to Chinese');
    stt.setApiKey('synthetic-rotated');
    const rotated = await upload(stt);
    assert.equal(rotated.model, model, 'after a key change');
    // The language field still follows the switch, and survives the key change.
    assert.equal(english.language, languages.transcriptionLanguage('english-us'));
    assert.equal(chinese.language, languages.transcriptionLanguage('chinese'));
    assert.equal(rotated.language, languages.transcriptionLanguage('chinese'));
    assert.notEqual(english.language, chinese.language);
  });
}

test('no saved model falls back to Turbo', async t => {
  requests.length = 0;
  const stt = startGroq(t, undefined, 'english-us');
  assert.equal((await upload(stt)).model, 'whisper-large-v3-turbo');
});

test('main.ts builds Groq RestSTT with the saved model before applying the language', () => {
  const main = fs.readFileSync(`${REPO}/electron/main.ts`, 'utf8');
  const groq = main.slice(main.indexOf("sttProvider === 'groq'"), main.indexOf('stt.setRecognitionLanguage(sttLanguage)'));
  assert.match(groq, /const modelOverride = CredentialsManager\.getInstance\(\)\.getGroqSttModel\(\)/);
  assert.match(groq, /new RestSTT\(sttProvider, apiKey, modelOverride\)/);
});
