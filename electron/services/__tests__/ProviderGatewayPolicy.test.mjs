import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

function loadHelper() {
  const require = createRequire(import.meta.url);
  const id = require.resolve('electron');
  const previous = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports: { app: { getPath: () => os.tmpdir(), isPackaged: false } } };
  try { return require('../../../dist-electron/electron/LLMHelper.js').LLMHelper; }
  finally { if (previous) require.cache[id] = previous; else delete require.cache[id]; }
}

test('LLM SDK construction and key updates preserve explicitly configured env endpoints', () => {
  const LLMHelper = loadHelper();
  for (const [provider, variable, setter] of [['groq', 'GROQ_BASE_URL', 'setGroqApiKey'], ['openai', 'OPENAI_BASE_URL', 'setOpenaiApiKey'], ['claude', 'ANTHROPIC_BASE_URL', 'setClaudeApiKey']]) {
    const before = process.env[variable];
    try {
      process.env[variable] = 'https://explicit.invalid/v1';
      const self = new LLMHelper(undefined, 'synthetic-only', 'synthetic-only', 'synthetic-only');
      assert.equal(self[`${provider}Client`].baseURL, 'https://explicit.invalid/v1');
      process.env[variable] = 'http://127.0.0.1:1234/v1'; self[setter]('synthetic-only');
      assert.equal(self[`${provider}Client`].baseURL, 'http://127.0.0.1:1234/v1');
      process.env[variable] = 'https://key@wrong.invalid';
      assert.throws(() => self[setter]('synthetic-only'));
    } finally { if (before === undefined) delete process.env[variable]; else process.env[variable] = before; }
  }
});

for (const entry of ['streamWithGeminiModel', 'collectStreamResponse']) {
  test(`${entry}: revocation during image processing prevents cache and generation`, async () => {
    const LLMHelper = loadHelper();
    const policy = {};
    const sends = [];
    const self = Object.assign(Object.create(LLMHelper.prototype), {
      getProviderScopePolicy: () => policy,
      rateLimiters: { gemini: { acquire: async () => {} } },
      processImage: async () => { policy.screenshots = false; return { mimeType: 'image/png', data: 'synthetic' }; },
      geminiPromptCache: new (createRequire(import.meta.url)('../../../dist-electron/electron/llm/GeminiPromptCache.js').GeminiPromptCache)(),
      client: { caches: { create: async () => { sends.push('cache'); return { name: 'cached/test' }; } }, models: { generateContent: async () => { sends.push('generate'); return { text: 'ok' }; }, generateContentStream: async () => { sends.push('stream'); return []; } } },
    });
    const invoke = async () => {
      if (entry === 'streamWithGeminiModel') {
        for await (const chunk of self[entry]('synthetic transcript', 'test', [import.meta.filename], 'synthetic system '.repeat(400))) { void chunk; }
      } else await self[entry]('synthetic transcript', 'test', [import.meta.filename], undefined, 'synthetic system '.repeat(400));
    };
    await assert.rejects(invoke, { name: 'ProviderScopeError' });
    assert.deepEqual(sends, [], 'a cache creation is an outbound request too');
  });
}

for (const entry of ['streamWithGeminiModel', 'collectStreamResponse']) {
  test(`${entry}: allowed cache, cache-inflight revocation and expired-cache retry`, async () => {
    const LLMHelper = loadHelper();
    const { GeminiPromptCache } = createRequire(import.meta.url)('../../../dist-electron/electron/llm/GeminiPromptCache.js');
    for (const stage of ['allowed', 'cache-wait', 'expired']) {
      const policy = {}, sends = [];
      const generate = async () => {
        sends.push('generation');
        if (stage === 'expired') { policy.transcript = false; throw Error('cached content expired'); }
        return entry === 'collectStreamResponse' ? { text: 'allowed' } : [];
      };
      const self = Object.assign(Object.create(LLMHelper.prototype), {
        getProviderScopePolicy: () => policy, rateLimiters: { gemini: { acquire: async () => {} } },
        geminiPromptCache: new GeminiPromptCache(), client: {
          caches: { create: async () => { sends.push('cache'); await Promise.resolve(); if (stage === 'cache-wait') policy.transcript = false; return { name: 'cached/test' }; } },
          models: { generateContent: generate, generateContentStream: generate },
        },
      });
      const invoke = async () => {
        if (entry === 'streamWithGeminiModel') for await (const chunk of self[entry]('synthetic', 'test', undefined, 'synthetic system '.repeat(400))) { void chunk; }
        else await self[entry]('synthetic', 'test', undefined, undefined, 'synthetic system '.repeat(400));
      };
      if (stage === 'allowed') await invoke(); else await assert.rejects(invoke, { name: 'ProviderScopeError' });
      assert.deepEqual(sends, stage === 'cache-wait' ? ['cache'] : ['cache', 'generation']);
    }
  });
}

async function loadRouter() {
  const routerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/ProviderRouter.js');
  return import(pathToFileURL(routerPath).href);
}

test('assertProviderDataScopes throws ProviderScopeError when a denied scope is requested', async () => {
  const { assertProviderDataScopes, ProviderScopeError } = await loadRouter();

  assert.throws(
    () => assertProviderDataScopes('openai', ['transcript'], { transcript: false }),
    (err) => err instanceof ProviderScopeError && err.deniedScopes.includes('transcript')
  );
});

test('assertProviderDataScopes is a no-op when scopes are allowed or unset', async () => {
  const { assertProviderDataScopes } = await loadRouter();

  assert.doesNotThrow(() => assertProviderDataScopes('openai', ['transcript'], { transcript: true }));
  assert.doesNotThrow(() => assertProviderDataScopes('openai', ['transcript'], {}));
  assert.doesNotThrow(() => assertProviderDataScopes('openai', ['transcript'], undefined));
  assert.doesNotThrow(() => assertProviderDataScopes('openai', [], { transcript: false }));
});

test('routeLLMProviders marks all providers unavailable when scope is denied', async () => {
  const { routeLLMProviders } = await loadRouter();

  const attempts = routeLLMProviders({
    capability: 'chat',
    availability: { hasOpenAI: true, hasGroq: true, hasGemini: true },
    dataScopes: ['transcript'],
    scopePolicy: { transcript: false },
  });

  for (const attempt of attempts) {
    assert.equal(attempt.status, 'unavailable', `${attempt.provider} should be unavailable`);
    assert.equal(attempt.unavailableReason, 'disabled');
  }
});

test('routeLLMProviders keeps providers available when scopes are allowed', async () => {
  const { routeLLMProviders } = await loadRouter();

  const attempts = routeLLMProviders({
    capability: 'chat',
    availability: { hasOpenAI: true, hasGroq: true, hasGemini: true },
    dataScopes: ['transcript'],
    scopePolicy: { transcript: true },
  });

  const available = attempts.filter(a => a.status === 'available');
  assert.ok(available.length > 0, 'expected at least one provider to be available');
});

for (const [entry, provider, args] of [
  ['generateWithGroq', 'groq', ['synthetic']], ['generateWithOpenai', 'openai', ['synthetic']],
  ['generateWithClaude', 'claude', ['synthetic']], ['generateWithDeepseek', 'deepseek', ['synthetic']],
  ['generateWithPro', 'gemini', ['synthetic']], ['generateWithFlash', 'gemini', ['synthetic']],
  ['generateWithGroqMultimodal', 'groq', ['synthetic', []]],
  ['streamWithGroq', 'groq', ['synthetic']], ['streamWithOpenai', 'openai', ['synthetic']],
  ['streamWithClaude', 'claude', ['synthetic']], ['streamWithDeepseek', 'deepseek', ['synthetic']],
  ['streamWithGroqMultimodal', 'groq', ['synthetic', []]],
  ['streamWithOpenaiMultimodal', 'openai', ['synthetic', []]], ['streamWithClaudeMultimodal', 'claude', ['synthetic', []]],
  ['streamWithGeminiModel', 'gemini', ['synthetic', 'test']],
]) {
  test(`${entry}: final send rechecks after limiter wait, with allowed control`, async () => {
    const LLMHelper = loadHelper();
    for (const revoke of [false, true]) {
      const policy = {};
      let sends = 0;
      const send = () => { sends++; throw Error('synthetic-send-reached'); };
      const self = Object.assign(Object.create(LLMHelper.prototype), {
        getProviderScopePolicy: () => policy, currentModelId: 'gpt-5.4', aiResponseLanguage: 'auto',
        rateLimiters: { [provider]: { acquire: async () => { if (revoke) policy.transcript = false; } } },
        withRetry: fn => fn(), withTimeout: promise => promise,
        groqClient: { chat: { completions: { create: send } } }, openaiClient: { chat: { completions: { create: send } } },
        deepseekClient: { chat: { completions: { create: send } } }, claudeClient: { messages: { create: send, stream: send } },
        client: { models: { generateContent: send, generateContentStream: send } },
      });
      const invoke = async () => {
        const result = self[entry](...args);
        if (result[Symbol.asyncIterator]) for await (const chunk of result) { void chunk; }
        else await result;
      };
      await assert.rejects(invoke, revoke ? { name: 'ProviderScopeError' } : /synthetic-send-reached/);
      assert.equal(sends, revoke ? 0 : 1);
    }
  });
}

test('LLMHelper passes data scopes and policy to routeLLMProviders for fallback rotation', () => {
  const src = read('electron/LLMHelper.ts');

  assert.match(src, /dataScopes: this\.scopesForPayload\(cloudUserContent, cloudImagePaths\)/);
  assert.match(src, /scopePolicy,/);
});

test('SettingsManager exposes providerDataScopes setting', () => {
  const src = read('electron/services/SettingsManager.ts');

  assert.match(src, /providerDataScopes\?:\s*\{[\s\S]+transcript\?: boolean;/);
  assert.match(src, /post_call_summary\?: boolean;/);
});

test('IPC handlers expose get/set provider-data-scopes and broadcast updates', () => {
  const ipc = read('electron/ipcHandlers.ts');

  assert.match(ipc, /safeHandle\(['"]get-provider-data-scopes['"]/);
  assert.match(ipc, /safeHandle\(['"]set-provider-data-scopes['"]/);
  assert.match(ipc, /webContents\.send\('provider-data-scopes-changed', sanitized\)/);
  assert.match(ipc, /SettingsManager\.getInstance\(\)\.set\('providerDataScopes'/);
});

test('preload and renderer types expose provider data scope controls', () => {
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(preload, /getProviderDataScopes:/);
  assert.match(preload, /setProviderDataScopes:/);
  assert.match(preload, /onProviderDataScopesChanged:/);
  assert.match(preload, /ipcRenderer\.invoke\('get-provider-data-scopes'\)/);
  assert.match(preload, /ipcRenderer\.invoke\('set-provider-data-scopes', scopes\)/);

  assert.match(types, /getProviderDataScopes:\s*\(\)\s*=>\s*Promise/);
  assert.match(types, /setProviderDataScopes:\s*\(scopes:/);
});

test('AIProvidersSettings renders cloud provider data scope controls wired to real IPC', () => {
  const src = read('src/components/settings/AIProvidersSettings.tsx');

  assert.match(src, /Cloud provider data scopes/);
  assert.match(src, /getProviderDataScopes\?\.\(\)\.then\(setProviderDataScopes\)/);
  assert.match(src, /setProviderDataScopes\?\.\(next\)/);
  assert.match(src, /onProviderDataScopesChanged\(setProviderDataScopes\)/);
});
