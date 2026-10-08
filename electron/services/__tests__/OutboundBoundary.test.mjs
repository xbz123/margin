import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
const { createOutboundFetch, installOutboundFetchPolicy, outboundFetch, outboundAxios, validateHttpEndpoint, regionalSttEndpoint, openAiSttEndpoint, googleSpeechUniverseDomain } = require('../../../dist-electron/electron/services/outbound.js');

test('explicit HTTP/HTTPS endpoints survive; ambiguous URL syntax is rejected', () => {
  for (const url of ['https://custom.invalid/v1', 'http://127.0.0.1:1234/v1', 'https://api.openai.com/v1']) assert.equal(validateHttpEndpoint(url), url);
  for (const url of ['file:///tmp/test', 'https://key@other.invalid/', 'https://other.invalid/#hidden', 'https://good.invalid\\@other.invalid/', ' https://other.invalid/']) assert.throws(() => validateHttpEndpoint(url));
  assert.equal(openAiSttEndpoint('https://custom.invalid/v1/'), 'https://custom.invalid/v1/audio/transcriptions');
  assert.equal(openAiSttEndpoint('http://127.0.0.1:1234'), 'http://127.0.0.1:1234/v1/audio/transcriptions');
});

test('regional STT builders reject authority injection before any request', () => {
  for (const provider of ['azure', 'ibmwatson']) {
    for (const region of ['other.invalid/path', 'user@other.invalid/path', 'other.invalid?', 'other.invalid#', 'eastus:443', 'east us', 'Ｅast-us', '']) assert.throws(() => regionalSttEndpoint(provider, region));
  }
  assert.equal(new URL(regionalSttEndpoint('azure', 'eastus')).hostname, 'eastus.stt.speech.microsoft.com');
  assert.equal(new URL(regionalSttEndpoint('ibmwatson', 'us-south')).hostname, 'api.us-south.speech-to-text.watson.cloud.ibm.com');
  assert.equal(googleSpeechUniverseDomain('configured.example'), 'configured.example');
  for (const value of ['other.invalid/path', 'user@other.invalid', 'other.invalid:443', 'other.invalid?']) assert.throws(() => googleSpeechUniverseDomain(value));
});

test('fetch wrapper is idempotent and preserves Request, signal, stream and receiver', async () => {
  const controller = new AbortController();
  const request = new Request('https://configured.invalid/', { method: 'POST', body: 'synthetic', signal: controller.signal });
  const receiver = {};
  let observed;
  const transport = function (input, init) { observed = { input, init, receiver: this }; return Promise.resolve(new Response('streamed')); };
  const wrapped = createOutboundFetch(transport);
  assert.equal(createOutboundFetch(wrapped), wrapped);
  assert.equal(await (await wrapped.call(receiver, request, { signal: controller.signal, redirect: 'follow' })).text(), 'streamed');
  assert.equal(observed.input, request);
  assert.equal(observed.init.signal, controller.signal);
  assert.equal(observed.init.redirect, 'error');
  assert.equal(observed.receiver, receiver);
});

test('real fetch, axios and Gemini SDK refuse 307 instead of forwarding content', async () => {
  let targetRequests = 0;
  const target = http.createServer((req, res) => { targetRequests++; res.end('{}'); });
  target.listen(0, '127.0.0.1'); await once(target, 'listening');
  const targetUrl = `http://127.0.0.1:${target.address().port}/unconfigured`;
  const initial = [];
  const server = http.createServer((req, res) => {
    initial.push(req.url);
    if (req.url === '/allowed') { res.end('allowed'); return; }
    if (req.url.includes('/models/allowed:')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'allowed' }] } }] })); return; }
    res.writeHead(307, { location: targetUrl }); res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const oldFetch = globalThis.fetch;
  const oldGeminiBase = process.env.GOOGLE_GEMINI_BASE_URL;
  try {
    installOutboundFetchPolicy();
    const installed = globalThis.fetch;
    installOutboundFetchPolicy(); assert.equal(globalThis.fetch, installed);
    assert.equal(await (await fetch(new URL('/allowed', base))).text(), 'allowed');
    await assert.rejects(fetch(base + '/redirect', { method: 'POST', body: 'synthetic', redirect: 'follow' }));
    await assert.rejects(outboundAxios.post(base + '/redirect', 'synthetic', { maxRedirects: 10 }));
    const { GoogleGenAI } = require('@google/genai');
    process.env.GOOGLE_GEMINI_BASE_URL = base;
    const gemini = new GoogleGenAI({ apiKey: 'synthetic-only' });
    assert.equal((await gemini.models.generateContent({ model: 'allowed', contents: 'synthetic' })).text, 'allowed');
    await assert.rejects(gemini.models.generateContent({ model: 'test', contents: 'synthetic' }));
    for (const [pkg, method] of [['openai', 'chat'], ['groq-sdk', 'chat'], ['@anthropic-ai/sdk', 'messages']]) {
      const Client = require(pkg).default;
      const client = new Client({ apiKey: 'synthetic-only', baseURL: base, maxRetries: 0, fetch: outboundFetch });
      if (method === 'chat') await assert.rejects(client.chat.completions.create({ model: 'test', messages: [{ role: 'user', content: 'synthetic' }] }));
      else await assert.rejects(client.messages.create({ model: 'test', max_tokens: 1, messages: [{ role: 'user', content: 'synthetic' }] }));
    }
    assert.equal(initial.length, 8, 'each explicit initial request reaches the configured service');
    assert.equal(targetRequests, 0, 'no secret or content is forwarded to the redirect target');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldGeminiBase === undefined) delete process.env.GOOGLE_GEMINI_BASE_URL; else process.env.GOOGLE_GEMINI_BASE_URL = oldGeminiBase;
    server.closeAllConnections(); target.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => target.close(resolve))]);
  }
});
