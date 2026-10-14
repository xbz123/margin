import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(fs.readFileSync(new URL('../modelFetcher.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(replies) {
  const calls = [], exports = {};
  vm.runInNewContext(code, { exports, require(id) {
    if (id.endsWith('/outbound')) return { outboundAxios: { async get(url, options) {
      calls.push({ url, options });
      const value = replies.shift();
      if (value instanceof Error) throw value;
      return { data: value };
    } } };
    if (id.includes('/types/')) return { LLM_PRESETS: {} };
    return { effectiveProviderConfiguration: value => ({ ...value, custom: false }) };
  } });
  return { calls, fetch: provider => exports.fetchProviderModels(provider, 'synthetic-key', { provider }) };
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
  assert.equal((await f.fetch('gemini')).length, 2);
  assert.equal(f.calls[1].options.params.pageToken, 'next');
  for (const call of f.calls) {
    assert.equal(call.options.headers['x-goog-api-key'], 'synthetic-key');
    assert.equal(call.url.includes('synthetic-key'), false);
  }
});

for (const provider of ['openai', 'groq']) test(`${provider} lists upstream IDs without a version allowlist and rejects invalid shape`, async () => {
  const f = fixture([{ data: [{ id: 'gpt-4.1' }, { id: 'o5' }, { id: 'future-upstream-model' }] }]);
  assert.deepEqual(Array.from(await f.fetch(provider), m => m.id), ['future-upstream-model', 'gpt-4.1', 'o5']);
  await assert.rejects(fixture([{}]).fetch(provider), /Invalid model list/);
});

test('DeepSeek discovery never substitutes preset models for errors or empty results', async () => {
  const valid = fixture([{ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-v4-flash' }] }]);
  assert.deepEqual(Array.from(await valid.fetch('deepseek'), m => m.id), ['deepseek-chat', 'deepseek-v4-flash']);
  assert.equal((await fixture([{ data: [] }]).fetch('deepseek')).length, 0);
  await assert.rejects(fixture([Error('synthetic service failure')]).fetch('deepseek'), /synthetic service failure/);
  await assert.rejects(fixture([{}]).fetch('deepseek'), /Invalid model list/);
});

test('repeated cursors fail instead of publishing an incomplete upstream list', async () => {
  for (const provider of ['claude', 'gemini']) {
    const response = provider === 'claude' ? { data: [], has_more: true, last_id: 'same' } : { models: [], nextPageToken: 'same' };
    const f = fixture([response, response]);
    await assert.rejects(f.fetch(provider), /Incomplete model list/);
    assert.equal(f.calls.length, 2);
  }
});
