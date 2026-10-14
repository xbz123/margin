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

test('production address variables pause official SDK clients instead of redirecting their keys', () => {
  const LLMHelper = loadHelper();
  for (const [provider, variable, setter] of [['groq', 'GROQ_BASE_URL', 'setGroqApiKey'], ['openai', 'OPENAI_BASE_URL', 'setOpenaiApiKey'], ['claude', 'ANTHROPIC_BASE_URL', 'setClaudeApiKey']]) {
    const before = process.env[variable];
    try {
      process.env[variable] = 'https://explicit.invalid/v1';
      const self = new LLMHelper(undefined, 'synthetic-only', 'synthetic-only', 'synthetic-only');
      assert.equal(self[`${provider}Client`], null, `${variable} must not redirect ${provider}`);
      self[setter]('synthetic-only');
      assert.equal(self[`${provider}Client`], null);
      delete process.env[variable]; self[setter]('synthetic-only');
      assert.equal(self[`${provider}Client`].baseURL, provider === 'claude' ? 'https://api.anthropic.com'
        : provider === 'groq' ? 'https://api.groq.com' : 'https://api.openai.com/v1');
    } finally { if (before === undefined) delete process.env[variable]; else process.env[variable] = before; }
  }
});

const complete = (text = 'allowed') => ({ text, candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
const retryable = () => Object.assign(Error('overloaded'), { status: 503, headers: { 'retry-after': '0' } });
const expired = () => Object.assign(Error('explicit cache expired'), { status: 404, error: { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'CACHED_CONTENT_EXPIRED' }] } });
const invoke = async value => { if (!value?.[Symbol.asyncIterator]) return await value; let text = ''; for await (const chunk of value) text += chunk; return text; };
function helper(provider = 'gemini', onSend = () => complete(), policy = {}) {
  const LLMHelper = loadHelper();
  const model = { gemini: 'gemini-test', groq: 'llama-3.3-70b-versatile', openai: 'gpt-5.4', claude: 'claude-sonnet-4-6', deepseek: 'deepseek-v4-flash' }[provider];
  const protocol = provider === 'gemini' ? 'gemini' : provider === 'claude' ? 'messages' : 'chat-completions';
  const send = async body => {
    const result = await onSend(body);
    if (provider === 'gemini') return result;
    if (provider === 'claude') return { content: [{ type: 'text', text: 'allowed' }], stop_reason: 'end_turn' };
    return body.stream ? [{ choices: [{ delta: { content: 'allowed' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]
      : { choices: [{ message: { content: 'allowed' }, finish_reason: 'stop' }] };
  };
  const self = Object.assign(Object.create(LLMHelper.prototype), {
    selectedTarget: { provider, protocol, model, ...(provider === 'gemini' ? { imageSupportConfirmedFor: JSON.stringify([provider, protocol, 'https://generativelanguage.googleapis.com', model]) } : {}) }, currentModelId: model, aiResponseLanguage: 'auto',
    personaPrompt: '', customNotes: '', codexCliConfig: { enabled: false },
    getProviderScopePolicy: () => policy, logScopeFallback: () => {}, processResponse: text => text,
    rateLimiters: { [provider]: { acquire: async () => {} } },
    processImage: async () => ({ mimeType: 'image/png', data: 'AAAA' }),
    geminiPromptCache: new (createRequire(import.meta.url)('../../../dist-electron/electron/llm/GeminiPromptCache.js').GeminiPromptCache)(),
    client: { models: { generateContent: send, generateContentStream: async body => [await send(body)] } },
    [`${provider}Client`]: provider === 'claude' ? { messages: { create: send, stream: async body => { await onSend(body); return [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'allowed' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }]; } } } : { chat: { completions: { create: send } } },
  });
  return self;
}

for (const stream of [true, false]) {
  test(`selected Gemini ${stream ? 'stream' : 'nonstream'}: image-preparation revocation prevents cache and generation`, async () => {
    const policy = {}; const sends = []; const self = helper('gemini', () => { sends.push('generation'); return complete(); }, policy);
    self.processImage = async () => { policy.screenshots = false; return { mimeType: 'image/png', data: 'AAAA' }; };
    self.client.caches = { create: async () => { sends.push('cache'); return { name: 'cached/test' }; } };
    await assert.rejects(() => invoke(self.streamChat('synthetic transcript', [import.meta.filename], undefined, 'synthetic system '.repeat(400), true, true, [], undefined, stream)), { name: 'ProviderScopeError' });
    assert.deepEqual(sends, []);
  });
  test(`selected Gemini ${stream ? 'stream' : 'nonstream'}: cache allowed, inflight revocation and explicit expiry recovery`, async () => {
    for (const stage of ['allowed', 'cache-wait', 'expired']) {
      const policy = {}; const sends = [];
      const self = helper('gemini', () => { sends.push('generation'); if (stage === 'expired') { policy.transcript = false; throw expired(); } return complete(); }, policy);
      self.client.caches = { create: async () => { sends.push('cache'); await Promise.resolve(); if (stage === 'cache-wait') policy.transcript = false; return { name: 'cached/test' }; } };
      const run = () => invoke(self.streamChat('synthetic', undefined, undefined, 'synthetic system '.repeat(400), true, true, [], undefined, stream));
      if (stage === 'allowed') assert.equal(await run(), 'allowed'); else await assert.rejects(run, { name: 'ProviderScopeError' });
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

for (const provider of ['gemini', 'groq', 'openai', 'claude', 'deepseek']) for (const stream of [false, true]) {
  test(`selected ${provider} ${stream ? 'stream' : 'nonstream'}: final scope recheck after limiter wait`, async () => {
    for (const revoke of [false, true]) {
      const policy = {}; let sends = 0;
      const self = helper(provider, () => { sends++; throw Error('synthetic-send-reached'); }, policy);
      self.rateLimiters[provider].acquire = async () => { if (revoke) policy.transcript = false; };
      await assert.rejects(() => invoke(stream ? self.streamChat('synthetic') : self.chatWithGemini('synthetic')),
        revoke ? { name: 'ProviderScopeError' } : /synthetic-send-reached/);
      assert.equal(sends, revoke ? 0 : 1);
    }
  });
}
test('generateContent: final send rechecks after limiter wait', async () => {
  for (const revoke of [true, false]) {
    const policy = {}; let sends = 0; const self = helper('gemini', () => { sends++; throw Error('synthetic-send-reached'); }, policy);
    self.rateLimiters.gemini.acquire = async () => { if (revoke) policy.transcript = false; };
    await assert.rejects(() => self.generateContent([{ text: 'synthetic' }]), revoke ? { name: 'ProviderScopeError' } : /synthetic-send-reached/);
    assert.equal(sends, revoke ? 0 : 1);
  }
});
test('fixed generateContent: retry uses current permissions, with allowed control', async () => {
  for (const revoke of [true, false]) {
    const policy = {}; let sends = 0; const self = helper('gemini', () => {
      sends++; if (sends === 1) { if (revoke) policy.transcript = false; throw retryable(); } return complete();
    }, policy);
    const run = () => self.generateContent([{ text: 'synthetic' }]);
    if (revoke) await assert.rejects(run, { name: 'ProviderScopeError' }); else assert.equal(await run(), 'allowed');
    assert.equal(sends, revoke ? 1 : 2);
  }
});
test('structured generation: limiter, same-model retry and explicit backup all recheck scopes', async () => {
  for (const stage of ['limiter', 'retry', 'backup']) for (const revoke of [true, false]) {
    const policy = {}; const sends = [];
    const self = helper('gemini', body => {
      sends.push(body.model);
      if (stage !== 'limiter' && sends.length === 1) { if (revoke) policy.transcript = false; throw retryable(); }
      return complete();
    }, policy);
    if (stage === 'limiter') self.rateLimiters.gemini.acquire = async () => { if (revoke) policy.transcript = false; };
    if (stage === 'backup') self.setGenerationPolicy({ ...self.getGenerationPolicy(), backupModel: 'llm-target:gemini:gemini:backup' });
    const run = () => self.generateContentStructured('synthetic');
    if (revoke) await assert.rejects(run, { name: 'ProviderScopeError' }); else assert.equal(await run(), 'allowed');
    assert.equal(sends.length, stage === 'limiter' ? revoke ? 0 : 1 : revoke ? 1 : 2);
    if (!revoke && stage === 'backup') assert.deepEqual(sends, ['gemini-test', 'backup']);
  }
});
test('selected Groq stream: limiter and explicit Gemini backup preserve current permissions', async () => {
  for (const stage of ['limiter', 'backup']) for (const revoke of [true, false]) {
    const policy = {}; const sends = [];
    const self = helper('groq', () => { sends.push('groq'); if (stage === 'backup') { if (revoke) policy.transcript = false; throw retryable(); } return complete(); }, policy);
    self.rateLimiters.groq.acquire = async () => { if (stage === 'limiter' && revoke) policy.transcript = false; };
    self.client = { models: { generateContentStream: async () => { sends.push('gemini'); return [complete()]; } } };
    self.setGenerationPolicy({ ...self.getGenerationPolicy(), backupModel: 'llm-target:gemini:gemini:gemini-backup' });
    const run = () => invoke(self.streamChat('synthetic'));
    if (revoke) await assert.rejects(run, { name: 'ProviderScopeError' }); else assert.equal(await run(), 'allowed');
    assert.deepEqual(sends, stage === 'limiter' ? revoke ? [] : ['groq'] : revoke ? ['groq'] : ['groq', 'gemini']);
  }
});

test('SettingsManager exposes providerDataScopes setting', () => {
  const src = read('electron/services/SettingsManager.ts');

  assert.match(src, /providerDataScopes\?:\s*\{[\s\S]+transcript\?: boolean;/);
  assert.match(src, /profile_history\?: boolean;/);
  assert.doesNotMatch(src, /post_call_summary/, 'post-call summaries were removed (PLAN S33)');
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
