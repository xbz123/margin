import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { generateOnce } = require(path.join(root, 'dist-electron/electron/llm/generateOnce.js'));
const { GenerationResultError } = require(path.join(root, 'dist-electron/electron/llm/generateContract.js'));
const { GeminiPromptCache } = require(path.join(root, 'dist-electron/electron/llm/GeminiPromptCache.js'));
const { HARD_SYSTEM_PROMPT, DEFAULT_ANSWER_PROMPT_SUFFIX } = require(path.join(root, 'dist-electron/electron/llm/prompts.js'));
const { runStreamingVisionFallback, DEFAULT_VISION_FALLBACK_CONFIG } = require(path.join(root, 'dist-electron/electron/llm/visionStreamFallback.js'));
const built = path.join(root, 'dist-electron/electron/LLMHelper.js');
const electronId = require.resolve('electron', { paths: [path.dirname(built)] });
const previousElectron = require.cache[electronId];
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true,
  exports: { app: { getPath: () => os.tmpdir(), isPackaged: false, getVersion: () => '0.0.0' } } };
let LLMHelper;
try { ({ LLMHelper } = require(built)); }
finally { if (previousElectron) require.cache[electronId] = previousElectron; else delete require.cache[electronId]; }

const packet = (text = 'ok', finishReason = 'STOP') => ({
  candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }],
  text,
});
const request = (extra = {}) => ({ protocol: 'gemini', purpose: 'answer', model: 'test',
  contents: [{ text: 'USER' }], systemInstruction: 'SYSTEM', maxOutputTokens: 200,
  temperature: 0.3, dataScopes: ['transcript'], stream: false, ...extra });
const drain = async (events) => { const result = []; for await (const event of events) result.push(event); return result; };
const helper = (client, policy = {}, extra = {}) => Object.assign(Object.create(LLMHelper.prototype), {
  client, getProviderScopePolicy: () => policy, personaPrompt: '', customNotes: '',
  selectedTarget: { provider: 'gemini', protocol: 'gemini', model: 'gemini-test' },
  currentModelId: 'gemini-test', aiResponseLanguage: 'auto', codexCliConfig: { enabled: false },
  groqFastTextMode: false, rateLimiters: { gemini: { acquire: async () => {} } },
  geminiPromptCache: new GeminiPromptCache(), withTimeout: value => value,
  injectLanguageInstruction: text => text, processResponse: text => text, logScopeFallback: () => {},
  ...extra,
});

for (const [response, expected] of [
  [packet(), 'completed'], [packet('partial', 'MAX_TOKENS'), 'incomplete'],
  [packet('unconfirmed', null), 'incomplete'], [packet('', 'STOP'), 'empty'],
  [packet('blocked', 'SAFETY'), 'refused'], [{ promptFeedback: { blockReason: 'OTHER' } }, 'refused'],
]) {
  test(`single response preserves ${expected} (${response.candidates?.[0]?.finishReason ?? 'no finish'})`, async () => {
    let sends = 0;
    const events = await drain(generateOnce(request(), { beforeSend() {}, client: { models: {
      generateContent: async () => { sends++; return response; },
    } } }));
    assert.equal(sends, 1);
    assert.equal(events.at(-1).status, expected);
    assert.equal(events.filter(event => event.type === 'finish').length, 1);
    if (expected === 'refused') assert.equal(events.filter(event => event.type === 'delta').length, 0);
  });
}

test('stream separates system and user/image data, filters thoughts and preserves real finish', async () => {
  let sent;
  const events = await drain(generateOnce(request({ stream: true, contents: [{ text: 'NOTES TRANSCRIPT' },
    { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] }), {
    beforeSend() {}, client: { models: { generateContentStream: async args => {
      sent = args;
      return (async function* () {
        yield { candidates: [{ content: { parts: [{ thought: true, text: 'private thought' }, { text: 'A' }, { text: 'B' }] } }] };
        yield { candidates: [{ finishReason: 'STOP' }], usageMetadata: { candidatesTokenCount: 2 } };
      })();
    } } },
  }));
  assert.equal(events.filter(event => event.type === 'delta').map(event => event.text).join(''), 'AB');
  assert.equal(events.at(-1).status, 'completed');
  assert.deepEqual(events.at(-1).usage, { candidatesTokenCount: 2 });
  assert.deepEqual(sent.config.systemInstruction, { parts: [{ text: 'SYSTEM' }] });
  assert.equal(sent.contents[0].text, 'NOTES TRANSCRIPT');
  assert.equal(sent.contents[1].inlineData.data, 'AAAA');
});

test('final scope refusal retains the original object and never sends', async () => {
  const denied = Object.assign(Error('scope refused'), { name: 'ProviderScopeError' });
  let sends = 0;
  await assert.rejects(() => drain(generateOnce(request(), { beforeSend() { throw denied; },
    client: { models: { generateContent: async () => { sends++; } } } })), error => error === denied);
  assert.equal(sends, 0);
});

test('cancel before start and late response cannot produce deltas', async () => {
  for (const before of [true, false]) {
    const controller = new AbortController();
    let sends = 0;
    if (before) controller.abort();
    const events = await drain(generateOnce(request({ signal: controller.signal }), { beforeSend() {},
      client: { models: { generateContent: async args => {
        sends++; controller.abort(); assert.equal(args.config.abortSignal.aborted, true); return packet('late');
      } } } }));
    assert.equal(sends, before ? 0 : 1);
    assert.deepEqual(events, [{ type: 'finish', status: 'cancelled' }]);
  }
});

test('Gemini legacy streams never turn partial failure/refusal/incomplete into success or another provider', async () => {
  for (const state of ['failed', 'refused', 'incomplete', 'empty']) {
    let sends = 0;
    const self = helper({ models: { generateContentStream: async () => {
      sends++;
      return (async function* () {
        if (state !== 'empty') yield packet('partial', null);
        if (state === 'failed') throw Error('cached content expired after partial');
        yield packet('', { refused: 'SAFETY', incomplete: 'MAX_TOKENS', empty: 'STOP' }[state]);
      })();
    } } });
    const output = [];
    await assert.rejects(async () => { for await (const text of self.streamChat('QUESTION')) output.push(text); },
      error => error.name === 'GenerationResultError' && error.status === state);
    assert.deepEqual(output, state === 'empty' ? [] : ['partial']);
    assert.equal(sends, 1);
  }
});

test('terminal errors cross separately bundled vision fallback without health penalty or swallowed partial', async () => {
  for (const partial of [false, true]) {
    const error = new GenerationResultError(partial ? 'incomplete' : 'refused', partial);
    let attempts = 0;
    const health = new Map();
    const providers = ['primary', 'backup'].map(id => ({ id, name: id, priority: 0, isLocal: false,
      open: async function* () { attempts++; if (partial) yield 'partial'; throw error; } }));
    await assert.rejects(() => drain(runStreamingVisionFallback(providers, DEFAULT_VISION_FALLBACK_CONFIG, health)), e => e === error);
    assert.equal(attempts, 1);
    if (!partial) assert.equal(health.size, 0);
    for (const entry of health.values()) assert.equal(entry.consecutiveFails, 0, 'terminal result is not a health penalty');
  }
});

test('actual prompt wrappers propagate terminal results without adding a fallback answer; engine rejects instead of returning an answer', async () => {
  for (const state of ['incomplete', 'refused']) {
    const terminal = new GenerationResultError(state, true);
    const fakeHelper = {
      getCapabilities: () => ({ outputBudgetTokens: 2000, supportsImages: true }),
      fitContextForCurrentModel: text => text, getPromptTier: () => 'standard', deniedDataScopes: () => [],
      chat: async () => { throw terminal; },
      streamChat: async function* () { yield 'partial'; throw terminal; },
    };
    for (const name of ['WhatToAnswer', 'Answer', 'Assist', 'Brainstorm', 'CodeHint', 'Clarify', 'FollowUp', 'FollowUpQuestions', 'Recap']) {
      const className = `${name}LLM`;
      const Class = require(path.join(root, `dist-electron/electron/llm/${className}.js`))[className];
      const wrapper = new Class(fakeHelper);
      const output = [];
      const method = typeof wrapper.generateStream === 'function' ? 'generateStream' : 'generate';
      const args = name === 'CodeHint' ? [undefined, 'QUESTION', 'transcript', 'CONTEXT'] : ['QUESTION'];
      await assert.rejects(async () => {
        const value = wrapper[method](...args);
        if (value[Symbol.asyncIterator]) for await (const chunk of value) output.push(chunk);
        else await value;
      }, error => error === terminal, className);
      if (method === 'generateStream') assert.deepEqual(output, ['partial'], className);
    }
    const { IntelligenceEngine } = require(path.join(root, 'dist-electron/electron/IntelligenceEngine.js'));
    const { AnswerLLM } = require(path.join(root, 'dist-electron/electron/llm/AnswerLLM.js'));
    const events = [];
    const engine = Object.assign(Object.create(IntelligenceEngine.prototype), {
      session: { getFormattedContext: () => 'CONTEXT' }, answerLLM: new AnswerLLM(fakeHelper),
      emit: (...args) => events.push(args), setMode: mode => events.push(['mode', mode]),
    });
    await assert.rejects(() => engine.runWhatShouldISay('QUESTION'), error => error === terminal);
    assert.deepEqual(events, [['mode', 'what_to_say'], ['error', terminal, 'what_to_say'], ['mode', 'idle']]);
  }
});

test('Flash empty then Pro error/empty rejects; empty then valid backup still works', async () => {
  for (const outcome of ['failed', 'empty', 'completed']) {
    const calls = [];
    const self = helper({}, {}, { collectStreamResponse: async (_, model) => {
      calls.push(model);
      if (calls.length === 1 || outcome === 'empty') return '';
      if (outcome === 'failed') throw Error('provider failed');
      return 'backup';
    } });
    const run = () => drain(self.streamWithGeminiFallback('QUESTION'));
    if (outcome === 'completed') assert.equal((await run()).join(''), 'backup');
    else await assert.rejects(run, /Both Gemini models failed/);
    assert.equal(calls.length, 2);
  }
});

test('cache guard refusal is not swallowed and a stale cache can fall back to system without cachedContent', async () => {
  const policy = {}, requests = [];
  const self = helper({ caches: { create: async () => ({ name: 'cached/test' }) }, models: {
    generateContent: async args => { requests.push(args); if (args.config.cachedContent) throw Error('cached content expired'); return packet(); },
  } }, policy);
  const system = 'SYSTEM '.repeat(1000);
  assert.equal(await self.collectStreamResponse('QUESTION', 'test', undefined, undefined, system), 'ok');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].config.cachedContent, undefined);
  assert.deepEqual(requests[1].config.systemInstruction, { parts: [{ text: system }] });
  const denied = Object.assign(Error('refused'), { name: 'ProviderScopeError' });
  await assert.rejects(() => new GeminiPromptCache().getOrCreate(self.client, 'test', system, () => { throw denied; }), error => error === denied);
  assert.equal(requests.length, 2);
});

test('suggestion and screenshot wrappers reach the physical Gemini entry with separated content', async () => {
  const requests = [];
  const self = helper({ models: { generateContentStream: async args => {
    requests.push(args); return (async function* () { yield packet('answer'); })();
  } } }, {}, { customNotes: 'NOTES', processImage: async () => ({ mimeType: 'image/jpeg', data: 'AAAA' }),
    streamVisionWithFallback: async function* (input, signal) {
      yield* this.streamWithGeminiModel(input.userContent, 'test', input.imagePaths, input.systemPrompt, signal);
    },
  });
  assert.equal(await self.generateSuggestion('TRANSCRIPT', 'QUESTION'), 'answer');
  assert.match(requests[0].contents[0].text, /NOTES/);
  assert.match(requests[0].contents[0].text, /TRANSCRIPT/);
  assert.doesNotMatch(JSON.stringify(requests[0].config), /NOTES|TRANSCRIPT/);
  // Preserve the existing suggestion + streamChat suffix layering; prompt policy is AG-33.
  assert.equal(requests[0].config.systemInstruction.parts[0].text,
    `${HARD_SYSTEM_PROMPT}\n\n## ACTIVE MODE\n${DEFAULT_ANSWER_PROMPT_SUFFIX}\n\n## ACTIVE MODE\n${DEFAULT_ANSWER_PROMPT_SUFFIX}`);
  await drain(self.streamChat('QUESTION', [import.meta.filename], undefined, 'SYSTEM', true, true));
  assert.equal(requests[1].contents[1].inlineData.data, 'AAAA');
});

test('context scopes survive limiter wait and denied context is omitted before Gemini sending', async () => {
  const policy = {}, sent = [];
  const self = helper({ models: { generateContentStream: async args => { sent.push(args); return (async function* () { yield packet(); })(); } } }, policy);
  const context = 'MEETING: saved\nSUMMARY:\nPRIVATE_HISTORY';
  self.rateLimiters.gemini.acquire = async () => { policy.profile_history = false; };
  await assert.rejects(() => drain(self.streamChat('QUESTION', undefined, context)), { name: 'ProviderScopeError' });
  assert.equal(sent.length, 0);
  self.rateLimiters.gemini.acquire = async () => {};
  await drain(self.streamChat('QUESTION', undefined, context));
  assert.equal(sent.length, 1);
  assert.doesNotMatch(JSON.stringify(sent[0]), /PRIVATE_HISTORY/);
});

test('real Gemini SDK loopback: one 503 send, STOP/partial status and transport cancellation', { timeout: 10000 }, async () => {
  const requests = [], responses = new Set();
  let mode = 'ok';
  let notifyHold;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body)); responses.add(res); res.on('close', () => responses.delete(res));
    if (mode === '503') { res.writeHead(503); res.end(JSON.stringify({ error: { code: 503, message: 'mock unavailable' } })); return; }
    if (mode === 'hold') { notifyHold(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify(packet('wire', mode === 'partial' ? 'MAX_TOKENS' : 'STOP'))}\n\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new GoogleGenAI({ apiKey: 'synthetic-only', httpOptions: {
      baseUrl: `http://127.0.0.1:${server.address().port}`, apiVersion: 'v1alpha', retryOptions: { attempts: 1 },
    } });
    for (const [value, status] of [['ok', 'completed'], ['partial', 'incomplete'], ['503', 'failed']]) {
      mode = value; const before = requests.length;
      const events = await drain(generateOnce(request({ stream: true }), { client, beforeSend() {} }));
      assert.equal(events.at(-1).status, status);
      assert.equal(requests.length - before, 1, 'no SDK retry');
    }
    assert.equal(requests[0].systemInstruction.parts[0].text, 'SYSTEM');
    assert.equal(requests[0].contents[0].parts[0].text, 'USER');
    mode = 'hold';
    const controller = new AbortController();
    const holdArrived = new Promise(resolve => { notifyHold = resolve; });
    const before = requests.length;
    const pending = drain(generateOnce(request({ stream: true, signal: controller.signal }), { client, beforeSend() {} }));
    await holdArrived;
    controller.abort();
    const events = await pending;
    assert.equal(requests.length - before, 1);
    assert.equal(events.at(-1).status, 'cancelled');
    assert.equal(events.filter(event => event.type === 'delta').length, 0);
  } finally {
    for (const response of responses) response.destroy();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
