import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import OpenAI from 'openai';

const require = createRequire(import.meta.url);
const built = path.resolve(import.meta.dirname, '../../../dist-electron/electron/LLMHelper.js');
const electronId = require.resolve('electron', { paths: [path.dirname(built)] });
const previous = require.cache[electronId];
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => os.tmpdir(), isPackaged: true, getVersion: () => '0.0.0' } } };
let LLMHelper, WhatToAnswerLLM, ProcessingHelper, IntelligenceEngine, SessionTracker;
try {
  ({ LLMHelper } = require(built));
  ({ WhatToAnswerLLM } = require(path.resolve(import.meta.dirname, '../../../dist-electron/electron/llm/WhatToAnswerLLM.js')));
  ({ ProcessingHelper } = require(path.resolve(import.meta.dirname, '../../../dist-electron/electron/ProcessingHelper.js')));
  ({ IntelligenceEngine } = require(path.resolve(import.meta.dirname, '../../../dist-electron/electron/IntelligenceEngine.js')));
  ({ SessionTracker } = require(path.resolve(import.meta.dirname, '../../../dist-electron/electron/SessionTracker.js')));
} finally { if (previous) require.cache[electronId] = previous; else delete require.cache[electronId]; }

const packet = (text = 'answer', finishReason = 'STOP') => ({ text, candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] });
const collect = async source => { let text = ''; for await (const chunk of source) text += chunk; return text; };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const target = (model = 'gemini-a') => ({ provider: 'gemini', protocol: 'gemini', model });
const policy = backupModel => ({ backupModel, interviewFirstTokenSeconds: 10, interviewTotalSeconds: 60, writtenTotalSeconds: 180 });
const selector = model => `llm-target:gemini:gemini:${model}`;
const expired = () => Object.assign(Error('structured cache error'), { status: 404, error: { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'CACHED_CONTENT_EXPIRED' }] } });
function helper(onSend, scopes = {}) {
  const requests = [];
  const client = { models: {
    generateContent: async args => { requests.push(args); return onSend?.(args, requests.length) ?? packet(); },
    generateContentStream: async args => {
      requests.push(args); const result = await (onSend?.(args, requests.length) ?? packet());
      return result?.[Symbol.asyncIterator] ? result : (async function* () { yield result; })();
    },
  }, caches: { create: async () => ({ name: 'cachedContents/explicit' }) } };
  const self = Object.assign(Object.create(LLMHelper.prototype), {
    client, selectedTarget: target(), currentModelId: 'gemini-a', geminiModel: 'gemini-a',
    generationPolicy: policy(), personaPrompt: '', customNotes: '', aiResponseLanguage: 'auto', codexCliConfig: { enabled: false },
    rateLimiters: { gemini: { acquire: async () => {} } }, getProviderScopePolicy: () => scopes,
    injectLanguageInstruction: value => value, processResponse: value => value, logScopeFallback: () => {},
    geminiPromptCache: { getOrCreate: async () => null, invalidate() {} },
    processImage: async imagePath => ({ mimeType: 'image/png', data: Buffer.from(imagePath).toString('base64') }),
  });
  return { self, requests, client, scopes };
}

for (const entry of ['chatWithGemini', 'generateContentStructured', 'generateMeetingSummary', 'streamChat']) test(`${entry}: transient failure uses only explicit backup and at most two sends`, async () => {
  const { self, requests } = helper((args, number) => { if (number === 1) throw Object.assign(Error('unavailable'), { status: 503 }); return packet('backup'); });
  self.setGenerationPolicy(policy(selector('gemini-b')));
  const answer = entry === 'generateMeetingSummary' ? await self[entry]('SYSTEM', 'TRANSCRIPT') : entry === 'streamChat' ? await collect(self[entry]('QUESTION')) : await self[entry]('QUESTION');
  assert.equal(answer, 'backup'); assert.deepEqual(requests.map(r => r.model), ['gemini-a', 'gemini-b']);
});

for (const state of ['SAFETY', 'MAX_TOKENS', 'EMPTY', 'AUTH', 'CONFIG', 'PARTIAL']) test(`real answer interface: ${state} terminates without backup`, async () => {
  const { self, requests } = helper(() => {
    if (state === 'AUTH') throw Object.assign(Error('auth'), { status: 401 });
    if (state === 'CONFIG') throw Object.assign(Error('not found'), { status: 404 });
    if (state === 'PARTIAL') return (async function* () { yield packet('partial', null); throw Object.assign(Error('network'), { code: 'ECONNRESET' }); })();
    return packet(state === 'EMPTY' ? '' : 'partial', state === 'EMPTY' ? 'STOP' : state);
  });
  self.setGenerationPolicy(policy(selector('gemini-b')));
  const output = [];
  await assert.rejects(async () => { for await (const chunk of new WhatToAnswerLLM(self).generateStream('QUESTION')) output.push(chunk); });
  assert.equal(requests.length, 1); if (state === 'PARTIAL') assert.equal(output.join(''), 'partial');
});

test('WhatToSay actual prompt entry sends every original image directly, with no generative preanalysis', async () => {
  const { self, requests } = helper();
  assert.equal(await collect(new WhatToAnswerLLM(self).generateStream('QUESTION', undefined, undefined, ['original-1', 'original-2'])), 'answer');
  assert.equal(requests.length, 1);
  const inline = requests[0].contents.filter(p => p.inlineData).map(p => Buffer.from(p.inlineData.data, 'base64').toString());
  assert.deepEqual(inline, ['original-1', 'original-2']);
  assert.match(JSON.stringify(requests[0].contents), /screen_direct_vision_instruction/);
});

test('snapshot survives hot client/model/backup changes during image preparation', async () => {
  const { self, requests } = helper((_, n) => { if (n === 1) throw { status: 503 }; return packet('old backup'); });
  self.setGenerationPolicy(policy(selector('gemini-b')));
  const ready = deferred(); self.processImage = async () => { await ready.promise; return { mimeType: 'image/png', data: 'AAAA' }; };
  const stream = self.streamChat('QUESTION', ['image']); const pending = collect(stream);
  self.client = { models: { generateContentStream: () => { throw Error('hot client must not run'); } } };
  self.selectedTarget = target('gemini-hot'); self.generationPolicy = policy(selector('gemini-hot-backup'));
  ready.resolve(); assert.equal(await pending, 'old backup');
  assert.deepEqual(requests.map(r => r.model), ['gemini-a', 'gemini-b']);
});

for (const waiting of ['limiter', 'image', 'cache', 'retry-after']) test(`permission revoked during ${waiting} stops all later sends`, async () => {
  const { self, requests, scopes } = helper((_, n) => { if (waiting === 'retry-after' && n === 1) { scopes.transcript = false; throw { status: 429, headers: { 'retry-after': '0' } }; } return packet(); });
  self.setGenerationPolicy(policy(selector('gemini-b')));
  if (waiting === 'limiter') self.rateLimiters.gemini.acquire = async () => { scopes.transcript = false; };
  if (waiting === 'image') self.processImage = async () => { scopes.screenshots = false; return { mimeType: 'image/png', data: 'AAAA' }; };
  if (waiting === 'cache') self.geminiPromptCache.getOrCreate = async () => { scopes.transcript = false; return 'cachedContents/test'; };
  await assert.rejects(() => collect(self.streamChat('QUESTION', waiting === 'image' ? ['image'] : undefined)), { name: 'ProviderScopeError' });
  assert.equal(requests.length, waiting === 'retry-after' ? 1 : 0);
});

for (const second of ['valid', 'invalid']) test(`explicit cache recovery ${second}: same model, full original content, only two sends`, async () => {
  const { self, requests } = helper((args, n) => { if (n === 1 || second === 'invalid') throw expired(); return packet(); });
  self.geminiPromptCache.getOrCreate = async () => 'cachedContents/explicit';
  self.setGenerationPolicy(policy(selector('gemini-b')));
  const run = () => collect(self.streamChat('QUESTION', ['original-image'], undefined, 'ORIGINAL SYSTEM'));
  if (second === 'valid') assert.equal(await run(), 'answer'); else await assert.rejects(run);
  assert.deepEqual(requests.map(r => r.model), ['gemini-a', 'gemini-a']);
  assert.equal(requests[0].config.cachedContent, 'cachedContents/explicit');
  assert.equal(requests[1].config.cachedContent, undefined);
  assert.deepEqual(requests[1].contents, requests[0].contents);
  assert.match(JSON.stringify(requests[1].config.systemInstruction), /ORIGINAL SYSTEM/);
});

for (const mode of ['cancel', 'switch', 'consumer-return']) test(`${mode} aborts underlying generation before first text and ignores late results`, async () => {
  const late = deferred(); const entered = deferred(); let transportSignal;
  const { self, requests } = helper(async args => { transportSignal = args.config.abortSignal; entered.resolve(); return late.promise; });
  const controller = new AbortController(); const stream = self.streamChat('QUESTION', undefined, undefined, undefined, false, false, [], controller.signal);
  const pending = stream.next(); await entered.promise;
  let returned;
  if (mode === 'switch') self.setModel(selector('gemini-new'));
  else if (mode === 'cancel') controller.abort(new DOMException('cancel', 'AbortError'));
  else returned = stream.return();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(transportSignal.aborted, true);
  if (returned) await returned;
  late.resolve(packet('late')); assert.equal(requests.length, 1);
});

test('reselecting the same canonical target through qualified or raw model id keeps active transport alive', async () => {
  const late = deferred(); const entered = deferred(); let transportSignal;
  const { self, requests } = helper(async args => { transportSignal = args.config.abortSignal; entered.resolve(); return late.promise; });
  self.providerConfigurations = { gemini: target() };
  const answer = collect(self.streamChat('QUESTION'));
  await entered.promise;
  self.setModel(selector('gemini-a'));
  self.setModel('gemini-a');
  assert.equal(transportSignal.aborted, false, 'renderer default-model restatement must not cancel generation');
  late.resolve(packet('kept'));
  assert.equal(await answer, 'kept');
  assert.equal(requests.length, 1);
});

test('application quit cancels existing tasks and refuses all later generation entries before any send', async () => {
  const { self, requests } = helper();
  self.rateLimiters.gemini.destroy = () => {};
  self.modelVersionManager = { stopScheduler() {} };
  const task = self.beginGenerationTask('background');
  self.scrubKeys();
  assert.equal(task.signal.aborted, true);
  assert.equal(task.signal.reason.name, 'AbortError');
  task.close();
  assert.throws(() => self.beginGenerationTask('background'), { name: 'AbortError' });
  assert.throws(() => self.streamChat('QUESTION'), { name: 'AbortError' });
  await assert.rejects(() => self.chatWithGemini('QUESTION'), { name: 'AbortError' });
  await assert.rejects(() => self.generateContentStructured('QUESTION'), { name: 'AbortError' });
  await assert.rejects(() => self.generateMeetingSummary('SYSTEM', 'TRANSCRIPT'), { name: 'AbortError' });
  assert.equal(requests.length, 0);
});

test('real OpenAI SDK loopback dropped socket is transient, with SDK retries disabled', async t => {
  let requests = 0;
  const server = http.createServer((req, res) => { requests++; if (requests === 1) req.socket.destroy(); else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }] })); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const { self } = helper(); self.selectedTarget = { provider: 'openai', protocol: 'chat-completions', model: 'test' }; self.currentModelId = 'test';
  self.openaiClient = new OpenAI({ apiKey: 'synthetic-loopback', baseURL: `http://127.0.0.1:${server.address().port}/v1`, maxRetries: 0 });
  assert.equal(await self.chatWithGemini('QUESTION'), 'recovered'); assert.equal(requests, 2);
});

test('model switch cannot select configured backup and preserves previous primary/task state', () => {
  const { self } = helper(); self.setGenerationPolicy(policy(selector('gemini-b')));
  const task = self.beginGenerationTask();
  try { assert.throws(() => self.setModel(selector('gemini-b')), /must differ/); assert.equal(self.currentModelId, 'gemini-a'); assert.equal(task.signal.aborted, false); }
  finally { task.close(); }
});

test('Groq fast mode preserves the explicitly selected model for both text and images', async () => {
  const { self } = helper(); const requests = [];
  self.groqClient = { chat: { completions: { create: async args => { requests.push(args); return { choices: [{ message: { content: 'fast' }, finish_reason: 'stop' }] }; } } } };
  self.selectedTarget = { provider: 'groq', protocol: 'chat-completions', model: 'groq-other' }; self.currentModelId = 'groq-other'; self.groqFastTextMode = true;
  assert.equal(await self.chatWithGemini('QUESTION'), 'fast');
  assert.equal(requests[0].model, 'groq-other');
  assert.equal(requests[0].max_tokens, 8192); assert.equal(requests[0].temperature, 0.4);
  assert.equal(await self.chatWithGemini('QUESTION', ['image']), 'fast');
  assert.equal(requests[1].model, 'groq-other');
});

test('saved provider connection test ignores the answer backup and sends its own failed target only once', async () => {
  const { self, requests } = helper(() => { throw Object.assign(Error('overloaded'), { status: 503 }); });
  self.providerConfigurations = { gemini: target() };
  self.setGenerationPolicy(policy(selector('gemini-b')));
  await assert.rejects(() => self.testProviderConnection('gemini'));
  assert.deepEqual(requests.map(request => request.model), ['gemini-a']);
});

test('the configured answer backup can itself be connection-tested once without a primary/backup conflict', async () => {
  const { self, requests } = helper();
  self.setGenerationPolicy(policy(selector('gemini-b')));
  self.providerConfigurations = { gemini: target('gemini-b') };
  assert.equal(await self.testProviderConnection('gemini'), 'answer');
  assert.deepEqual(requests.map(request => request.model), ['gemini-b']); assert.equal(self.selectedTarget.model, 'gemini-a');
});

test('actual separately bundled Engine and LLMHelper share the supplied logical task and reset aborts its transport', async () => {
  const entered = deferred(); const late = deferred(); let transportSignal;
  const { self, requests } = helper(async args => { transportSignal = args.config.abortSignal; entered.resolve(); return late.promise; });
  const session = new SessionTracker();
  session.addTranscript({ speaker: 'interviewer', text: 'What should I answer?', timestamp: Date.now(), final: true });
  const engine = new IntelligenceEngine(self, session); engine.on('error', () => {});
  const task = self.beginGenerationTask();
  const pending = self.runGeneration(() => engine.runWhatShouldISay('QUESTION', 0.8, undefined, { skipCooldown: true }), 'interview', undefined, task);
  await entered.promise;
  assert.equal(engine.activeGenerationTask, task, 'the Engine obtains ALS context from its own helper, not another bundle');
  assert.equal(task.sends, 1);
  engine.reset();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(transportSignal.aborted, true);
  late.resolve(packet('late')); assert.equal(requests.length, 1);
});

for (const consumeFirstBudget of [false, true]) test(`actual debug ProcessingHelper shares the two-send budget: first-step retry ${consumeFirstBudget}`, async () => {
  const { self, requests } = helper((args, number) => {
    if (consumeFirstBudget && number === 1) throw Object.assign(Error('overloaded'), { status: 503 });
    return packet(JSON.stringify({ solution: { code: 'synthetic solution' } }));
  });
  const events = []; let debugged = false;
  const processing = Object.assign(Object.create(ProcessingHelper.prototype), { llmHelper: self, appState: {
    getMainWindow: () => ({ webContents: { send: (...args) => events.push(args) } }), getView: () => 'solutions',
    getScreenshotHelper: () => ({ getExtraScreenshotQueue: () => ['original-image'] }),
    getProblemInfo: () => ({ problem: 'synthetic problem' }), setHasDebugged: value => { debugged = value; },
    PROCESSING_EVENTS: { DEBUG_START: 'start', DEBUG_SUCCESS: 'success', DEBUG_ERROR: 'error' },
  } });
  await processing.processScreenshots();
  assert.equal(requests.length, 2, 'the workflow never sends a third generation');
  assert.equal(debugged, !consumeFirstBudget);
  assert.equal(events.at(-1)[0], consumeFirstBudget ? 'error' : 'success');
  if (!consumeFirstBudget) assert.ok(requests[1].contents.some(part => part.inlineData));
});

for (const visible of [false, true]) test(`actual Engine TTFT clears only at displayed body, not a held sentinel prefix: visible ${visible}`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });
  const waiting = deferred(); const release = deferred();
  const { self, requests } = helper(() => (async function* () {
    yield packet(visible ? 'Actual answer body ' : 'Nothing ', null);
    waiting.resolve(); await release.promise; yield packet('late', 'STOP');
  })());
  self.setGenerationPolicy(policy(selector('gemini-b')));
  const session = new SessionTracker(); session.addTranscript({ speaker: 'interviewer', text: 'QUESTION', timestamp: Date.now(), final: true });
  const engine = new IntelligenceEngine(self, session); const tokens = []; engine.on('error', () => {});
  engine.on('suggested_answer_token', token => tokens.push(token));
  const task = self.beginGenerationTask();
  const pending = self.runGeneration(() => engine.runWhatShouldISay('QUESTION', 0.8, undefined, { skipCooldown: true }), 'interview', undefined, task);
  await waiting.promise;
  assert.equal(task.hasText, true, 'received content conservatively prevents retry');
  assert.deepEqual(tokens, visible ? ['Actual answer body '] : []);
  t.mock.timers.tick(10_001);
  if (visible) {
    task.check(); assert.equal(task.signal.aborted, false, 'displayed body disables only TTFT');
    engine.reset(); await assert.rejects(pending, { name: 'AbortError' });
  } else await assert.rejects(pending, { name: 'GenerationTimeoutError', deadline: 'first-token' });
  assert.equal(requests.length, 1, 'timeout or cancellation never buys backup time'); release.resolve();
});

test('compression starts an independent background task inside an interview context and closes that supplied task', async () => {
  const { RecapLLM } = require(path.resolve(import.meta.dirname, '../../../dist-electron/electron/llm/RecapLLM.js'));
  let inner;
  const { self } = helper(() => { inner = self.getCurrentGenerationTask(); return packet('- synthetic summary'); });
  const outer = self.beginGenerationTask();
  await self.runGeneration(async () => {
    assert.equal(await new RecapLLM(self).generateCompression('TRANSCRIPT'), '- synthetic summary');
    assert.notEqual(inner, outer); assert.equal(inner.firstTokenDeadline, undefined);
    assert.equal(inner.totalDeadline - inner.startedAt, 180_000); assert.equal(inner.signal.aborted, true);
    assert.equal(outer.signal.aborted, false); assert.equal(outer.sends, 0); assert.equal(inner.sends, 1);
  }, 'interview', undefined, outer);
  assert.equal(outer.signal.aborted, true);
});

test('actual prompt entry snapshots language and prompt tier before assembly starts', async () => {
  const { self, requests } = helper(); delete self.injectLanguageInstruction;
  self.aiResponseLanguage = 'English';
  const stream = new WhatToAnswerLLM(self).generateStream('QUESTION');
  self.aiResponseLanguage = 'Swedish'; self.currentModelId = 'qwen3.5:4b';
  self.selectedTarget = target('gemini-hot');
  assert.equal(await collect(stream), 'answer');
  assert.equal(requests[0].model, 'gemini-a');
  const system = JSON.stringify(requests[0].config.systemInstruction);
  assert.doesNotMatch(system, /Swedish/);
  const { UNIVERSAL_WHAT_TO_ANSWER_PROMPT } = require(path.resolve(import.meta.dirname, '../../../dist-electron/electron/llm/prompts.js'));
  assert.ok(system.includes(JSON.stringify(UNIVERSAL_WHAT_TO_ANSWER_PROMPT).slice(1, -1)));
});

test('image metadata reflects actual send and screenshot omission, not the validated input list', async () => {
  for (const denied of [true, false]) {
    const { self, requests } = helper(undefined, denied ? { screenshots: false } : {});
    const task = self.beginGenerationTask();
    try {
      await self.runGeneration(() => collect(self.streamChat('QUESTION', ['image'])), 'interview', undefined, task);
      const metadata = self.getTaskMetadata(task);
      assert.equal(metadata.usedImageInput, !denied); assert.equal(metadata.imageCount, denied ? 0 : 1);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].contents.some(part => part.inlineData), !denied);
    } finally { task.close(); }
  }
});

test('backup updates and selected provider reconfiguration reject identical targets without changing active state', () => {
  const { self } = helper();
  assert.throws(() => self.setGenerationPolicy(policy(selector('gemini-a'))), /must differ/);
  self.setGenerationPolicy(policy(selector('gemini-b'))); const client = self.client;
  assert.throws(() => self.configureProvider(target('gemini-b'), 'synthetic-not-used'), /must differ/);
  assert.equal(self.client, client); assert.equal(self.selectedTarget.model, 'gemini-a');
});

test('explicit Codex selector clears stale API selection and snapshots its configured fast model', () => {
  const { self } = helper(); self.codexCliConfig = { enabled: true, model: 'ordinary', fastModel: 'fast', path: 'synthetic-not-executed' }; self.groqFastTextMode = true;
  self.setModel('codex-cli'); assert.equal(self.selectedTarget, undefined);
  const task = self.beginGenerationTask();
  try { assert.equal(self.getTaskMetadata(task).provider, 'codex-cli'); assert.equal(task.primary.target.model, 'fast'); }
  finally { task.close(); }
});
