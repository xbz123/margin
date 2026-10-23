import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(fs.readFileSync(new URL('../modelFetcher.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const capabilities = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../../src/types/modelCapabilities.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: capabilities, URL });
function fixture(replies) {
  const calls = [], exports = {};
  vm.runInNewContext(code, { exports, require(id) {
    if (id.endsWith('/outbound')) return { outboundAxios: { async get(url, options) {
      calls.push({ url, options });
      const value = replies.shift();
      if (value instanceof Error) throw value;
      return { data: value };
    } } };
    if (id.endsWith('/modelCapabilities')) return capabilities;
    if (id.includes('/types/')) return { LLM_PRESETS: {} };
    return { effectiveProviderConfiguration: value => ({ ...value, custom: !!value.custom }), validateGatewayConfiguration: value => value };
  } });
  return { calls, fetch: (provider, extra = {}) => exports.fetchProviderModels(provider, 'synthetic-key', {
    provider, protocol: provider === 'gemini' ? 'gemini' : provider === 'claude' ? 'messages' : 'chat-completions', ...extra,
  }), gateway: value => exports.fetchGatewayModels(value, 'synthetic-key') };
}

test('official Claude discovery keeps upstream IDs and reads all pages', async () => {
  const f = fixture([
    { data: [{ id: 'claude-sonnet-4-6', display_name: 'Sonnet' }], has_more: true, last_id: 'cursor-1' },
    { data: [{ id: 'claude-opus-5-5', display_name: 'Opus' }], has_more: false },
  ]);
  const models = await f.fetch('claude');
  assert.deepEqual(Array.from(models, m => m.id).sort(), ['claude-opus-5-5', 'claude-sonnet-4-6']);
  assert.equal(f.calls[1].options.params.after_id, 'cursor-1');
});

test('official Gemini discovery follows pages and keeps credentials out of the URL', async () => {
  const f = fixture([
    { models: [{ name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'next' },
    { models: [{ name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }] },
  ]);
  assert.deepEqual(Array.from(await f.fetch('gemini'), m => m.id), ['gemini-3.1-flash-lite']);
  assert.equal(f.calls[1].options.params.pageToken, 'next');
  for (const call of f.calls) {
    assert.equal(call.options.headers['x-goog-api-key'], 'synthetic-key');
    assert.equal(call.url.includes('synthetic-key'), false);
  }
});

test('Groq speech discovery still lists upstream IDs without the answer catalogue filter', async () => {
  const provider = 'groq';
  const f = fixture([{ data: [{ id: 'gpt-4.1' }, { id: 'o5' }, { id: 'future-upstream-model' }] }]);
  assert.deepEqual(Array.from(await f.fetch(provider), m => m.id), ['future-upstream-model', 'gpt-4.1', 'o5']);
  await assert.rejects(fixture([{}]).fetch(provider), /Invalid model list/);
});

test('DeepSeek discovery never substitutes preset models for errors or empty results', async () => {
  const valid = fixture([{ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-v4-flash' }] }]);
  assert.deepEqual(Array.from(await valid.fetch('deepseek'), m => m.id), ['deepseek-v4-flash']);
  assert.equal((await fixture([{ data: [] }]).fetch('deepseek')).length, 0);
  await assert.rejects(fixture([Error('synthetic service failure')]).fetch('deepseek'), /synthetic service failure/);
  await assert.rejects(fixture([{}]).fetch('deepseek'), /Invalid model list/);
});

test('S49 official discovery intersects account access, exact reviewed IDs and the selected protocol', async () => {
  const cases = [
    ['openai', ['gpt-5.3-codex', 'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini-2026-03-17', 'gpt-image-2', 'gpt-99-future'], ['gpt-5.4', 'gpt-5.4-mini-2026-03-17']],
    ['claude', ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-5', 'claude-sonnet-5-5', 'claude-opus-99'], ['claude-haiku-4-5-20251001', 'claude-opus-4-5', 'claude-sonnet-5-5']],
    ['deepseek', ['deepseek-chat', 'deepseek-reasoner', 'deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro'], ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro']],
  ];
  for (const [provider, ids, expected] of cases) {
    const f = fixture([{ data: ids.map(id => ({ id })), has_more: false }]);
    assert.deepEqual(Array.from(await f.fetch(provider), m => m.id), expected);
  }
  const pro = fixture([{ data: [{ id: 'gpt-5.4-pro' }, { id: 'gpt-5.5-pro' }, { id: 'gpt-5.5-pro-2026-04-23' }] }]);
  assert.deepEqual(Array.from(await pro.fetch('openai', { protocol: 'responses' }), m => m.id), ['gpt-5.4-pro']);
  assert.equal((await fixture([{ data: [] }]).fetch('openai')).length, 0, 'never append catalogue models the account did not list');
  await assert.rejects(fixture([{}]).fetch('openai'), /Invalid model list/);
});

test('S49 Gemini discovery removes pre-3.1, specialised, retired and undocumented IDs without changing pagination', async () => {
  const ids = ['gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3.1-flash-image',
    'gemini-3.8-live', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-4-argon', 'gemini-4-unknown'];
  const f = fixture([{ models: ids.map(id => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })) }]);
  assert.deepEqual(Array.from(await f.fetch('gemini'), m => m.id), ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-4-argon']);
});

test('S49 gateway and development discovery retain their own model list, even for old or same-name models', async () => {
  const rows = { data: [{ id: 'gpt-4.1' }, { id: 'opaque' }] };
  const f = fixture([rows, rows]);
  const gateway = { id: 'gw', protocol: 'responses', baseUrl: 'https://gateway.invalid/v1', model: 'opaque' };
  assert.deepEqual(Array.from(await f.gateway(gateway), m => m.id), ['gpt-4.1', 'opaque']);
  assert.deepEqual(Array.from(await f.fetch('openai', { custom: true, baseUrl: 'http://127.0.0.1:9999/v1' }), m => m.id), ['gpt-4.1', 'opaque']);
});

test('repeated cursors fail instead of publishing an incomplete upstream list', async () => {
  for (const provider of ['claude', 'gemini']) {
    const response = provider === 'claude' ? { data: [], has_more: true, last_id: 'same' } : { models: [], nextPageToken: 'same' };
    const f = fixture([response, response]);
    await assert.rejects(f.fetch(provider), /Incomplete model list/);
    assert.equal(f.calls.length, 2);
  }
});
