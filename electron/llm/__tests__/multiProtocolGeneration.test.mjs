import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const require = createRequire(import.meta.url);
const id = require.resolve('electron');
const previous = require.cache[id];
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag31-unit-'));
require.cache[id] = { id, filename: id, loaded: true, exports: { app: { getPath: () => dataDir, isPackaged: false } } };
let LLMHelper, targetApi;
try {
  ({ LLMHelper } = require('../../../dist-electron/electron/LLMHelper.js'));
  targetApi = require('../../../dist-electron/electron/llm/llmTarget.js');
} finally { if (previous) require.cache[id] = previous; else delete require.cache[id]; }
const { generateOnce } = require('../../../dist-electron/electron/llm/generateOnce.js');
const { GeminiPromptCache } = require('../../../dist-electron/electron/llm/GeminiPromptCache.js');
const { outboundFetch } = require('../../../dist-electron/electron/services/outbound.js');
const { fetchProviderModels } = require('../../../dist-electron/electron/utils/modelFetcher.js');
const drain = async source => { const events = []; for await (const event of source) events.push(event); return events; };
const collect = async source => { let text = ''; for await (const chunk of source) text += chunk; return text; };
const request = (protocol, extra = {}) => ({ protocol, purpose: 'answer', model: 'opaque-model',
  contents: [{ text: 'USER' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }],
  systemInstruction: 'SYSTEM', maxOutputTokens: 128, dataScopes: ['transcript', 'screenshots'], stream: true, ...extra });
const fake = (protocol, send) => protocol === 'chat-completions' ? { chat: { completions: { create: send } } }
  : protocol === 'responses' ? { responses: { create: send } } : { messages: { create: send } };
const chat = (reason = 'stop', text = 'ANSWER', refusal = null) => [
  { choices: [{ delta: { content: text, refusal } }] }, { choices: [{ delta: {}, finish_reason: reason }], usage: { total_tokens: 2 } },
];
const responses = (status = 'completed', text = 'ANSWER') => [
  { type: 'response.output_text.delta', delta: text },
  { type: `response.${status}`, response: { status, output: [], usage: { total_tokens: 2 },
    ...(status === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    ...(status === 'failed' ? { error: { code: 'server_error', message: 'synthetic' } } : {}) } },
];
const messages = (reason = 'end_turn', text = 'ANSWER') => [
  { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  { type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 2 } }, { type: 'message_stop' },
];
for (const [protocol, cases] of [
  ['chat-completions', [[chat(), 'completed'], [chat('length'), 'incomplete'], [chat('tool_calls'), 'incomplete'],
    [chat('content_filter'), 'refused'], [chat('stop', '', 'REFUSAL'), 'refused'], [chat('stop', ''), 'empty'], [chat(null), 'incomplete']]],
  ['responses', [[responses(), 'completed'], [responses('incomplete'), 'incomplete'], [responses('failed'), 'failed'],
    [[{ type: 'response.refusal.delta', delta: 'NO' }, ...responses()], 'refused'], [responses('completed', ''), 'empty'],
    [[{ type: 'response.output_text.delta', delta: 'PARTIAL' }, { type: 'response.output_text.done', text: 'PARTIAL' }], 'incomplete']]],
  ['messages', [[messages(), 'completed'], [messages('stop_sequence'), 'completed'], [messages('max_tokens'), 'incomplete'],
    [messages('tool_use'), 'incomplete'], [messages('pause_turn'), 'incomplete'], [messages('refusal'), 'refused'],
    [messages('end_turn', ''), 'empty'], [messages().slice(0, -1), 'incomplete']]],
]) {
  for (const [chunks, status] of cases) test(`${protocol} preserves ${status} from actual protocol terminal`, async () => {
    let sends = 0;
    const events = await drain(generateOnce(request(protocol), { beforeSend() {}, client: fake(protocol, async () => { sends++; return chunks; }) }));
    assert.equal(sends, 1);
    assert.equal(events.at(-1).status, status);
    assert.equal(events.filter(event => event.type === 'finish').length, 1);
  });

  test(`${protocol} final scope and cancel checks happen before a physical send`, async () => {
    let sends = 0;
    const client = fake(protocol, async () => { sends++; });
    const denied = Object.assign(Error('denied'), { name: 'ProviderScopeError' });
    await assert.rejects(() => drain(generateOnce(request(protocol), { client, beforeSend() { throw denied; } })), error => error === denied);
    const controller = new AbortController();
    assert.deepEqual(await drain(generateOnce(request(protocol, { signal: controller.signal }), {
      client, beforeSend() { controller.abort(); },
    })), [{ type: 'finish', status: 'cancelled' }]);
    assert.equal(sends, 0);
  });

  test(`${protocol} late response and consumer return abort the transport`, async () => {
    const controller = new AbortController();
    let wireSignal;
    const chunks = protocol === 'messages' ? messages() : protocol === 'responses' ? responses() : chat();
    const cancelled = await drain(generateOnce(request(protocol, { signal: controller.signal }), {
      beforeSend() {}, client: fake(protocol, async (_args, options) => { wireSignal = options.signal; controller.abort(); return chunks; }),
    }));
    assert.deepEqual(cancelled, [{ type: 'finish', status: 'cancelled' }]);
    assert.equal(wireSignal.aborted, true);
    const stream = generateOnce(request(protocol), { beforeSend() {}, client: fake(protocol, async (_args, options) => { wireSignal = options.signal; return chunks; }) });
    assert.equal((await stream.next()).value.type, 'delta');
    await stream.return();
    assert.equal(wireSignal.aborted, true);
  });
}

async function serve(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const sse = (res, events, named = false) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of events) res.write(`${named ? `event: ${event.type}\n` : ''}data: ${JSON.stringify(event)}\n\n`);
  res.end();
};

test('real SDK text/image serialization, saved opaque target, test and model list share one API base', async () => {
  const observed = [];
  await serve(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    observed.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined });
    if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'opaque-model' }] })); return; }
    if (req.url.endsWith('/responses')) {
      if (JSON.parse(body).stream) sse(res, responses());
      else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ANSWER' }] }] })); }
    } else if (req.url.endsWith('/messages')) sse(res, messages(), true);
    else if (JSON.parse(body).stream) sse(res, chat());
    else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'ANSWER' }, finish_reason: 'stop' }] })); }
  }, async base => {
    for (const [provider, protocol] of [['openai', 'chat-completions'], ['openai', 'responses'], ['claude', 'messages'], ['groq', 'chat-completions'], ['deepseek', 'chat-completions']]) {
      const config = { provider, protocol, model: 'opaque-model', baseUrl: `${base}/v1/`, imageSupportConfirmedFor: JSON.stringify([provider, protocol, `${base}/v1`, 'opaque-model']) };
      const helper = new LLMHelper();
      helper.getProviderScopePolicy = () => ({});
      helper.configureProvider(config, `synthetic-${provider}`);
      helper.setModel(`llm-target:${provider}:${protocol}:opaque-model`);
      assert.equal(helper.getCurrentProvider(), provider);
      assert.equal(helper.getCurrentModel(), 'opaque-model');
      helper.setAiResponseLanguage('English');
      helper.processImage = async () => ({ mimeType: 'image/png', data: 'AAAA' });
      const task = helper.beginGenerationTask();
      assert.equal(await helper.runGeneration(() => collect(helper.streamChat('USER', ['synthetic-image'], undefined, 'SYSTEM', true, true)), 'interview', undefined, task), 'ANSWER');
      assert.equal(helper.getTaskMetadata(task).status, 'completed');
      assert.equal(await helper.testProviderConnection(provider), 'ANSWER');
      assert.deepEqual(await fetchProviderModels(provider, `synthetic-${provider}`, config), [{ id: 'opaque-model', label: 'opaque-model' }]);
      assert.equal(helper.modelVersionManager[`${provider === 'claude' ? 'claude' : provider}ApiKey`] ?? null, null);
      await helper.modelVersionManager.runDiscoveryAndUpgrade();
    }
  });
  assert.equal(observed.length, 15, 'no automatic official discovery or hidden retry');
  for (const row of observed) {
    assert.doesNotMatch(row.url, /\/v1\/v1/);
    if (!row.body) continue;
    assert.equal(row.body.model, 'opaque-model');
    assert.equal(row.body.prompt_cache_key, undefined);
    assert.equal(JSON.stringify(row.body).includes('cache_control'), false);
    if (row.url.endsWith('/responses')) { assert.equal(row.body.store, false); if (row.body.input[0].content.length > 1) assert.equal(row.body.instructions, 'SYSTEM'); }
  }
  const generations = observed.filter(row => row.body && JSON.stringify(row.body).includes('AAAA'));
  assert.equal(generations.length, 5, 'images were retained by every capable protocol adapter');
  for (const row of generations) assert.match(JSON.stringify(row.body), /SYSTEM/);
});

test('real OpenAI and Anthropic adapters disable SDK retry on 503 and never follow redirects', async () => {
  let forwarded = 0;
  await serve((_req, res) => { forwarded++; res.end('{}'); }, async other => {
    for (const status of [503, 307]) {
      let sends = 0;
      await serve((_req, res) => { sends++; res.writeHead(status, status === 307 ? { location: other } : { 'content-type': 'application/json' }); res.end('{"error":{"message":"synthetic"}}'); }, async base => {
        for (const protocol of ['chat-completions', 'responses', 'messages']) {
          const Client = protocol === 'messages' ? Anthropic : OpenAI;
          const events = await drain(generateOnce(request(protocol), { beforeSend() {}, client: new Client({ apiKey: 'synthetic-only', baseURL: base, fetch: outboundFetch, maxRetries: 0 }) }));
          assert.equal(events.at(-1).status, 'failed');
        }
      });
      assert.equal(sends, 3, 'each protocol sends exactly once');
    }
  });
  assert.equal(forwarded, 0);
});

test('an explicitly selected custom model is the wire model, while connection tests retain the saved model', async () => {
  const observed = [];
  await serve(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    observed.push({ url: req.url, body: JSON.parse(body) });
    res.setHeader('content-type', 'application/json');
    if (req.url.includes(':generateContent')) res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ANSWER' }] }, finishReason: 'STOP' }] }));
    else if (req.url.endsWith('/messages')) sse(res, messages(), true);
    else if (req.url.endsWith('/responses')) res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ANSWER' }] }] }));
    else res.end(JSON.stringify({ choices: [{ message: { content: 'ANSWER' }, finish_reason: 'stop' }] }));
  }, async base => {
    for (const [provider, protocol] of [['gemini', 'gemini'], ['openai', 'chat-completions'], ['openai', 'responses'],
      ['claude', 'messages'], ['groq', 'chat-completions'], ['deepseek', 'chat-completions']]) {
      const config = { provider, protocol, model: 'opaque-saved-model', baseUrl: protocol === 'gemini' ? base : base + '/v1' };
      const helper = new LLMHelper(); helper.getProviderScopePolicy = () => ({});
      helper.configureProvider(config, 'synthetic-only');
      helper.setModel(`llm-target:${provider}:${protocol}:opaque-selected-model`);
      assert.equal(helper.getCurrentModel(), 'opaque-selected-model');
      assert.equal(await helper.chatWithGemini('USER'), 'ANSWER');
      assert.equal(await helper.testProviderConnection(provider), 'ANSWER');
      const [generation, connection] = observed.slice(-2);
      if (provider === 'gemini') {
        assert.match(generation.url, /models\/opaque-selected-model:generateContent$/);
        assert.match(connection.url, /models\/opaque-saved-model:generateContent$/);
      } else {
        assert.equal(generation.body.model, 'opaque-selected-model');
        assert.equal(connection.body.model, 'opaque-saved-model');
      }
    }
  });
  assert.equal(observed.length, 12);
});

test('real three-protocol SDK terminal events remain incomplete/refused when the stream finishes normally', async () => {
  let sends = 0;
  await serve(async (req, res) => {
    sends++; let body = ''; for await (const part of req) body += part;
    const mode = JSON.parse(body).model;
    if (req.url.endsWith('/responses')) sse(res, mode === 'refused'
      ? [{ type: 'response.refusal.done', refusal: 'NO' }, ...responses()] : responses('incomplete'));
    else if (req.url.endsWith('/messages')) sse(res, messages(mode === 'refused' ? 'refusal' : 'max_tokens'), true);
    else sse(res, chat(mode === 'refused' ? 'content_filter' : 'length'));
  }, async base => {
    for (const protocol of ['chat-completions', 'responses', 'messages']) {
      const Client = protocol === 'messages' ? Anthropic : OpenAI;
      const client = new Client({ apiKey: 'synthetic-only', baseURL: base, fetch: outboundFetch, maxRetries: 0 });
      for (const status of ['incomplete', 'refused']) {
        const result = await drain(generateOnce(request(protocol, { model: status }), { client, beforeSend() {} }));
        assert.equal(result.at(-1).status, status);
      }
    }
  });
  assert.equal(sends, 6);
});

test('real SDK cancellation after the server receives the request suppresses all late deltas', async () => {
  for (const protocol of ['chat-completions', 'responses', 'messages']) {
    let arrived;
    const atServer = new Promise(resolve => { arrived = resolve; });
    await serve(async (req, _res) => { for await (const _ of req) {} arrived(); }, async base => {
      const Client = protocol === 'messages' ? Anthropic : OpenAI;
      const controller = new AbortController();
      const result = drain(generateOnce(request(protocol, { signal: controller.signal }), { beforeSend() {},
        client: new Client({ apiKey: 'synthetic-only', baseURL: base, fetch: outboundFetch, maxRetries: 0 }) }));
      await atServer;
      controller.abort();
      const events = await result;
      assert.equal(events.at(-1).status, 'cancelled');
      assert.equal(events.some(event => event.type === 'delta'), false);
    });
  }
});

test('Gemini custom target uses the same v1alpha prefix for generation, test and unfiltered model listing', async () => {
  const urls = [];
  await serve(async (req, res) => {
    urls.push(req.url);
    let body = ''; for await (const part of req) body += part;
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') res.end(JSON.stringify({ models: [{ name: 'models/opaque-model', displayName: 'Opaque' }] }));
    else res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ANSWER' }] }, finishReason: 'STOP' }] }));
  }, async base => {
    const config = { provider: 'gemini', protocol: 'gemini', model: 'opaque-model', baseUrl: `${base}/proxy/` };
    const helper = new LLMHelper(); helper.getProviderScopePolicy = () => ({});
    helper.configureProvider(config, 'synthetic-only');
    helper.setModel('llm-target:gemini:gemini:opaque-model');
    assert.equal(await helper.testProviderConnection('gemini'), 'ANSWER');
    assert.deepEqual(await fetchProviderModels('gemini', 'synthetic-only', config), [{ id: 'opaque-model', label: 'Opaque' }]);
    assert.equal(helper.modelVersionManager.geminiApiKey, null);
    assert.equal(await helper.chatWithGemini('USER'), 'ANSWER');
  });
  assert.deepEqual(urls, ['/proxy/v1alpha/models/opaque-model:generateContent', '/proxy/v1alpha/models', '/proxy/v1alpha/models/opaque-model:generateContent']);
});

test('structured generation never discovers an unselected OpenAI target, then uses explicitly selected Responses', async () => {
  let sends = 0;
  await serve(async (req, res) => {
    sends++;
    let body = ''; for await (const part of req) body += part;
    const payload = JSON.parse(body);
    assert.equal(req.url, '/v1/responses');
    assert.equal(payload.store, false);
    assert.equal(payload.model, 'opaque-model');
    assert.match(JSON.stringify(payload.input), /STRUCTURED_USER/);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'STRUCTURED' }] }] }));
  }, async base => {
    const helper = new LLMHelper(); helper.getProviderScopePolicy = () => ({});
    helper.configureProvider({ provider: 'openai', protocol: 'responses', model: 'opaque-model', baseUrl: `${base}/v1` }, 'synthetic-only');
    await assert.rejects(() => helper.generateContentStructured('STRUCTURED_USER'), /gemini client not initialized/);
    assert.equal(sends, 0, 'an unconfigured selected target cannot silently switch to another configured provider');
    helper.setModel('llm-target:openai:responses:opaque-model');
    assert.equal(await helper.generateContentStructured('STRUCTURED_USER'), 'STRUCTURED');
  });
  assert.equal(sends, 1);
});

test('legacy Groq environment host root keeps the SDK API prefix while saved API roots are used unchanged', async () => {
  const previous = process.env.GROQ_BASE_URL;
  const observed = [];
  try {
    await serve(async (req, res) => {
      let body = ''; for await (const part of req) body += part;
      observed.push(req.url);
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET') res.end(JSON.stringify({ data: [{ id: 'opaque-groq' }] }));
      else res.end(JSON.stringify({ choices: [{ message: { content: 'ANSWER' }, finish_reason: 'stop' }] }));
    }, async base => {
      process.env.GROQ_BASE_URL = base + '/';
      for (const saved of [false, true]) {
        const config = { provider: 'groq', protocol: 'chat-completions', model: 'opaque-groq', ...(saved ? { baseUrl: base + '/v1' } : {}) };
        const helper = new LLMHelper(); helper.getProviderScopePolicy = () => ({});
        helper.configureProvider(config, 'synthetic-only');
        helper.setModel('llm-target:groq:chat-completions:opaque-groq');
        assert.equal(await helper.chatWithGemini('USER'), 'ANSWER');
        assert.equal(await helper.testProviderConnection('groq'), 'ANSWER');
        assert.deepEqual(await fetchProviderModels('groq', 'synthetic-only', config), [{ id: 'opaque-groq', label: 'opaque-groq' }]);
      }
    });
    assert.deepEqual(observed, ['/openai/v1/chat/completions', '/openai/v1/chat/completions', '/openai/v1/models',
      '/v1/chat/completions', '/v1/chat/completions', '/v1/models']);
  } finally {
    if (previous === undefined) delete process.env.GROQ_BASE_URL;
    else process.env.GROQ_BASE_URL = previous;
  }
});

test('hot configuration changes keep active provider, protocol and wire model together', () => {
  const helper = new LLMHelper();
  const initial = { provider: 'openai', protocol: 'chat-completions', model: 'old-model', baseUrl: 'https://synthetic.invalid/v1' };
  helper.configureProvider(initial, 'synthetic-only');
  helper.setModel('llm-target:openai:chat-completions:old-model');
  helper.configureProvider({ ...initial, protocol: 'responses', model: 'new-model' }, 'synthetic-only');
  assert.equal(helper.getCurrentProvider(), 'openai');
  assert.equal(helper.getCurrentModel(), 'new-model');
  assert.equal(helper.getCurrentModelSelection(), 'llm-target:openai:responses:new-model');
  assert.throws(() => helper.setModel('llm-target:openai:chat-completions:old-model'), /protocol changed/);
});

test('saved Gemini base takes precedence over explicit environment base without adding a second API version', () => {
  const previous = process.env.GOOGLE_GEMINI_BASE_URL;
  try {
    process.env.GOOGLE_GEMINI_BASE_URL = 'https://environment.invalid/proxy';
    const config = { provider: 'gemini', protocol: 'gemini', model: 'opaque' };
    assert.equal(targetApi.effectiveProviderConfiguration(config).baseUrl, 'https://environment.invalid/proxy');
    assert.equal(targetApi.effectiveProviderConfiguration({ ...config, baseUrl: 'https://saved.invalid/root' }).baseUrl, 'https://saved.invalid/root');
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_GEMINI_BASE_URL;
    else process.env.GOOGLE_GEMINI_BASE_URL = previous;
  }
});

test('Gemini hot configuration clear never accepts an old in-flight cache', async () => {
  let release, sends = 0;
  const cache = new GeminiPromptCache();
  const old = cache.getOrCreate({ caches: { create: () => { sends++; return new Promise(resolve => { release = resolve; }); } } }, 'test', 'SYSTEM'.repeat(1000), () => {});
  cache.clear();
  const fresh = cache.getOrCreate({ caches: { create: async () => { sends++; return { name: 'cache/new' }; } } }, 'test', 'SYSTEM'.repeat(1000), () => {});
  release({ name: 'cache/old' });
  assert.equal(await old, null);
  assert.equal(await fresh, 'cache/new');
  assert.equal(await cache.getOrCreate({}, 'test', 'SYSTEM'.repeat(1000), () => {}), 'cache/new');
  assert.equal(sends, 2);
});

test('endpoint validation and explicit selection refuse wrong protocol, version and model ambiguity', () => {
  const config = { provider: 'gemini', protocol: 'gemini', model: 'opaque-model', baseUrl: 'https://compatible.invalid/v1beta' };
  assert.throws(() => targetApi.validateProviderConfiguration(config), /API version/);
  for (const baseUrl of ['https://key@invalid.test', 'https://invalid.test/?token=value', 'file:///tmp/x', 'https://invalid.test/#x']) {
    assert.throws(() => targetApi.validateProviderConfiguration({ provider: 'openai', protocol: 'responses', model: 'opaque', baseUrl }));
  }
  const helper = new LLMHelper();
  helper.configureProvider({ provider: 'openai', protocol: 'responses', model: 'same' });
  helper.configureProvider({ provider: 'claude', protocol: 'messages', model: 'same' });
  assert.throws(() => helper.setModel('same'), /ambiguous/);
  assert.throws(() => helper.setModel('gpt-arbitrary-not-configured'), /Unknown model/);
  helper.setModel('llm-target:claude:messages:same'); assert.equal(helper.getCurrentProvider(), 'claude');
});

test('S44 each protocol serializes its own reasoning fields through the real SDKs; retries keep them and a rejection is not downgraded', async () => {
  const observed = [];
  let mode = 'ok';
  await serve(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const payload = JSON.parse(body); observed.push({ url: req.url, body: payload });
    res.setHeader('content-type', 'application/json');
    if (mode === 'overload' && observed.filter(row => row.body.model === payload.model).length === 1) {
      res.writeHead(503); res.end('{"error":{"message":"synthetic overload"}}'); return;
    }
    if (mode === 'reject') { res.writeHead(400); res.end('{"error":{"type":"invalid_request_error","message":"synthetic unsupported reasoning"}}'); return; }
    if (req.url.includes(':generateContent')) res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ANSWER' }] }, finishReason: 'STOP' }] }));
    else if (req.url.endsWith('/messages')) sse(res, messages(), true);
    else if (req.url.endsWith('/responses')) res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ANSWER' }] }] }));
    else res.end(JSON.stringify({ choices: [{ message: { content: 'ANSWER' }, finish_reason: 'stop' }] }));
  }, async base => {
    const cases = [
      ['gemini', 'gemini', { effort: 'low' }, body => assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' })],
      ['openai', 'chat-completions', { effort: 'xhigh' }, body => assert.equal(body.reasoning_effort, 'xhigh')],
      ['openai', 'responses', { effort: 'minimal' }, body => assert.deepEqual(body.reasoning, { effort: 'minimal' })],
      ['claude', 'messages', { thinking: 'adaptive', effort: 'max' }, body => { assert.deepEqual(body.thinking, { type: 'adaptive' }); assert.deepEqual(body.output_config, { effort: 'max' }); assert.equal(body.temperature, undefined); }],
      ['groq', 'chat-completions', { effort: 'low' }, body => assert.equal(body.reasoning_effort, 'low')],
      ['deepseek', 'chat-completions', { effort: 'medium' }, body => assert.equal(body.reasoning_effort, 'medium')],
    ];
    for (const [provider, protocol, reasoning, check] of cases) {
      const config = { provider, protocol, model: 'opaque-model', baseUrl: protocol === 'gemini' ? base : base + '/v1', reasoning };
      assert.deepEqual(targetApi.validateProviderConfiguration(config).reasoning, reasoning);
      const helper = new LLMHelper(); helper.getProviderScopePolicy = () => ({});
      helper.configureProvider(config, 'synthetic-only');
      helper.setModel(`llm-target:${provider}:${protocol}:opaque-model`);
      // The Gemini SDK reports 503 without a status, so only the other adapters retry it here.
      mode = protocol === 'gemini' ? 'ok' : 'overload'; observed.length = 0;
      assert.equal(await helper.chatWithGemini('USER'), 'ANSWER');
      assert.equal(observed.length, protocol === 'gemini' ? 1 : 2, `${provider}/${protocol}: one transient retry`);
      for (const row of observed) check(row.body);
      mode = 'reject'; observed.length = 0;
      await assert.rejects(() => helper.chatWithGemini('USER'));
      assert.equal(observed.length, 1, 'a rejected setting is not resent without it');
      check(observed[0].body);
      mode = 'ok';
      helper.configureProvider({ ...config, reasoning: undefined }, 'synthetic-only');
      observed.length = 0;
      assert.equal(await helper.chatWithGemini('USER'), 'ANSWER');
      const body = observed[0].body;
      for (const field of ['reasoning_effort', 'reasoning', 'thinking', 'output_config']) assert.equal(Object.hasOwn(body, field), false, `${provider}/${protocol}: default request unchanged`);
      assert.equal(body.generationConfig?.thinkingConfig, undefined);
    }
  });
});

test('S44 a backup uses its own target settings, and official endpoints accept only documented values', async () => {
  const observed = [];
  await serve(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const payload = JSON.parse(body); observed.push({ url: req.url, body: payload });
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/chat/completions')) { res.writeHead(503); res.end('{"error":{"message":"synthetic overload"}}'); return; }
    sse(res, messages(), true);
  }, async base => {
    const helper = new LLMHelper(); helper.getProviderScopePolicy = () => ({});
    helper.configureProvider({ provider: 'openai', protocol: 'chat-completions', model: 'primary', baseUrl: base + '/v1', reasoning: { effort: 'high' } }, 'synthetic-only');
    helper.configureProvider({ provider: 'claude', protocol: 'messages', model: 'backup', baseUrl: base, reasoning: { effort: 'low' } }, 'synthetic-only');
    helper.setModel('llm-target:openai:chat-completions:primary');
    helper.setGenerationPolicy({ ...helper.getGenerationPolicy(), backupModel: 'llm-target:claude:messages:backup' });
    assert.equal(await helper.chatWithGemini('USER'), 'ANSWER');
    assert.deepEqual(observed.map(row => [row.body.model, row.body.reasoning_effort, row.body.output_config?.effort]), [['primary', 'high', undefined], ['backup', undefined, 'low']]);
  });
  const official = (provider, protocol, model, reasoning) => targetApi.validateProviderConfiguration({ provider, protocol, model, reasoning });
  assert.deepEqual(official('openai', 'responses', 'gpt-5.4', { effort: 'none' }).reasoning, { effort: 'none' });
  assert.throws(() => official('openai', 'responses', 'gpt-5.4', { effort: 'max' }), /not available/);
  assert.throws(() => official('claude', 'messages', 'claude-sonnet-4-6', { effort: 'xhigh' }), /not available/);
  assert.deepEqual(official('claude', 'messages', 'claude-sonnet-4-6', { thinking: 'disabled', effort: 'low' }).reasoning, { thinking: 'disabled', effort: 'low' });
  assert.throws(() => official('groq', 'chat-completions', 'llama-3.3-70b-versatile', { effort: 'low' }), /not available/);
  assert.deepEqual(official('groq', 'chat-completions', 'openai/gpt-oss-120b', { effort: 'high' }).reasoning, { effort: 'high' });
  assert.deepEqual(official('deepseek', 'chat-completions', 'deepseek-v4-flash', { thinking: 'disabled' }).reasoning, { thinking: 'disabled' });
  assert.throws(() => official('deepseek', 'chat-completions', 'deepseek-v4-flash', { thinking: 'disabled', effort: 'high' }), /thinking enabled/);
  assert.throws(() => official('deepseek', 'chat-completions', 'deepseek-v4-flash', { effort: 'medium' }), /not available/);
  assert.throws(() => official('gemini', 'gemini', 'gemini-3.1-pro-preview', { effort: 'minimal' }), /not available/);
  // A compatible gateway is limited to the protocol's own fields; vendor extensions are not assumed.
  assert.throws(() => targetApi.validateProviderConfiguration({ provider: 'deepseek', protocol: 'chat-completions', model: 'deepseek-v4-flash', baseUrl: 'https://gateway.invalid/v1', reasoning: { thinking: 'enabled' } }), /not available/);
  assert.deepEqual(targetApi.validateProviderConfiguration({ provider: 'openai', protocol: 'chat-completions', model: 'gpt-5.4', baseUrl: 'https://gateway.invalid/v1', reasoning: { effort: 'max' } }).reasoning, { effort: 'max' });
});
