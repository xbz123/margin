import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import fs from 'node:fs';
import OpenAI from 'openai';

const require = createRequire(import.meta.url);
const built = path.resolve(import.meta.dirname, '../../../dist-electron/electron/LLMHelper.js');
const electronId = require.resolve('electron', { paths: [path.dirname(built)] });
const previous = require.cache[electronId];
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => os.tmpdir(), isPackaged: true, getVersion: () => '0.0.0' } } };
let LLMHelper, WhatToAnswerLLM, ProcessingHelper, IntelligenceEngine, IntelligenceManager, SessionTracker;
try {
  ({ LLMHelper } = require(built));
  ({ WhatToAnswerLLM } = require(path.resolve(import.meta.dirname, '../../../dist-electron/electron/llm/WhatToAnswerLLM.js')));
  ({ ProcessingHelper } = require(path.resolve(import.meta.dirname, '../../../dist-electron/electron/ProcessingHelper.js')));
  ({ IntelligenceEngine } = require(path.resolve(import.meta.dirname, '../../../dist-electron/electron/IntelligenceEngine.js')));
  ({ IntelligenceManager } = require(path.resolve(import.meta.dirname, '../../../dist-electron/electron/IntelligenceManager.js')));
  ({ SessionTracker } = require(path.resolve(import.meta.dirname, '../../../dist-electron/electron/SessionTracker.js')));
} finally { if (previous) require.cache[electronId] = previous; else delete require.cache[electronId]; }

const packet = (text = 'answer', finishReason = 'STOP') => ({ text, candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] });
const collect = async source => { let text = ''; for await (const chunk of source) text += chunk; return text; };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const target = (model = 'gemini-a') => ({ provider: 'gemini', protocol: 'gemini', model,
  imageSupportConfirmedFor: JSON.stringify(['gemini', 'gemini', 'https://generativelanguage.googleapis.com', model]) });
const policy = backupModel => ({ backupModel, ...(backupModel ? { backupImageSupportConfirmedFor: target(decodeURIComponent(backupModel.split(':').at(-1))).imageSupportConfirmedFor } : {}), interviewFirstTokenSeconds: 10, interviewTotalSeconds: 60, writtenTotalSeconds: 180 });
const selector = model => `llm-target:gemini:gemini:${model}`;
const expired = () => Object.assign(Error('structured cache error'), { status: 404, error: { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'CACHED_CONTENT_EXPIRED' }] } });

test('AG33 actual Manager engine cancellation preserves session usage; explicit reset still clears it', () => {
  const session = new SessionTracker(); session.logUsage('chat', 'synthetic', 'retained prior answer'); let resets = 0;
  const manager = Object.assign(Object.create(IntelligenceManager.prototype), { session, engine: { reset() { resets++; } } });
  manager.resetEngine(); assert.equal(resets, 1); assert.equal(session.getFullUsage()[0].answer, 'retained prior answer');
  manager.reset(); assert.equal(resets, 2); assert.equal(session.getFullUsage().length, 0);
});
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
  self.selectedTarget = { provider: 'groq', protocol: 'chat-completions', model: 'groq-other', imageSupportConfirmedFor: JSON.stringify(['groq', 'chat-completions', 'https://api.groq.com/openai/v1', 'groq-other']) }; self.currentModelId = 'groq-other'; self.groqFastTextMode = true;
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

test('AG33 actual ProcessingHelper late cancellation cannot clear the newer controller or publish the old result', async () => {
  const first = deferred(), second = deferred(), entered = deferred();
  const { self } = helper((args, number) => { if (number === 1) { entered.resolve(); return first.promise; } return second.promise; });
  const events = [], usage = [];
  const processing = Object.assign(Object.create(ProcessingHelper.prototype), { llmHelper: self, appState: {
    getMainWindow: () => ({ webContents: { id: 1, send: (...args) => events.push(args) } }), getView: () => 'queue',
    getScreenshotHelper: () => ({ getScreenshotQueue: () => ['original-image'] }), setView() {}, setProblemInfo() {}, setHasDebugged() {},
    getIntelligenceManager: () => ({ logUsage: (...args) => usage.push(args) }),
    PROCESSING_EVENTS: { INITIAL_START: 'start', PROBLEM_EXTRACTED: 'problem', SOLUTION_SUCCESS: 'success', INITIAL_SOLUTION_ERROR: 'error' },
  } });
  const old = processing.processScreenshots(); await entered.promise;
  const fresh = processing.processScreenshots(); const controller = processing.currentProcessingAbortController;
  await old;
  assert.equal(processing.currentProcessingAbortController, controller);
  assert.equal(controller.signal.aborted, false);
  assert.equal(usage[0][3].status, 'cancelled'); assert.equal(usage[0][3].model, 'gemini-a');
  first.resolve(packet(JSON.stringify({ code: 'OLD' })));
  second.resolve(packet(JSON.stringify({ code: 'FRESH' })));
  await fresh;
  assert.equal(events.filter(event => event[0] === 'success').length, 1);
  assert.equal(events.find(event => event[0] === 'success')[1].solution.code, 'FRESH');
  assert.equal(events.find(event => event[0] === 'success')[1].generation.status, 'completed');
  assert.equal(usage.at(-1)[3].status, 'completed');
});

for (const status of ['empty', 'refused', 'incomplete']) test(`AG33 actual Engine stores ${status} even without a visible partial`, async () => {
  const { self } = helper(() => packet('', status === 'empty' ? 'STOP' : status === 'refused' ? 'SAFETY' : 'MAX_TOKENS'));
  const session = new SessionTracker(), engine = new IntelligenceEngine(self, session); engine.on('error', () => {});
  await engine.runWhatShouldISay('QUESTION', 0.8, undefined, { skipCooldown: true }).catch(() => {});
  const entry = session.getFullUsage().at(-1);
  assert.equal(entry.status, status); assert.equal(entry.model, 'gemini-a'); assert.equal(entry.partial, false);
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

for (const stop of ['timeout', 'model-switch']) test(`AG33 Engine ${stop} releases its mode and allows the next assist request`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });
  const entered = deferred(), late = deferred();
  const { self, requests } = helper((_, number) => { if (number === 1) { entered.resolve(); return late.promise; } return packet('fresh assist'); });
  const session = new SessionTracker(); session.addTranscript({ speaker: 'interviewer', text: 'QUESTION', timestamp: Date.now(), final: true });
  const engine = new IntelligenceEngine(self, session); engine.on('error', () => {});
  const modes = []; engine.on('mode_changed', mode => modes.push(mode));
  const lifecycle = []; engine.on('mode_changed', mode => lifecycle.push(mode)); engine.on('generation_terminal', () => lifecycle.push('terminal'));
  const pending = engine.runWhatShouldISay('QUESTION', 0.8, undefined, { skipCooldown: true });
  await entered.promise; assert.equal(engine.getActiveMode(), 'what_to_say');
  if (stop === 'timeout') t.mock.timers.tick(10_001); else self.setModel(selector('gemini-next'));
  await assert.rejects(pending, { name: stop === 'timeout' ? 'GenerationTimeoutError' : 'AbortError' });
  assert.equal(engine.getActiveMode(), 'idle'); assert.equal(modes.at(-1), 'idle');
  assert.deepEqual(lifecycle.slice(-2), ['idle', 'terminal'], 'idle is sent while main still retains the request owner');
  assert.equal(await engine.runAssistMode(), 'fresh assist', 'the completed cleanup must not leave assist locked out');
  assert.equal(requests.length, 2); assert.equal(engine.getActiveMode(), 'idle');
  late.resolve(packet('LATE OLD ANSWER'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.getActiveMode(), 'idle');
  assert.equal(session.getFullTranscript().some(segment => segment.text.includes('LATE OLD')), false);
});

test('AG33 old Engine finally cannot reset the newer active request mode', async () => {
  const oldEntered = deferred(), freshEntered = deferred(), oldLate = deferred(), freshLate = deferred();
  const { self } = helper((_, number) => { if (number === 1) { oldEntered.resolve(); return oldLate.promise; } freshEntered.resolve(); return freshLate.promise; });
  const session = new SessionTracker(); session.addTranscript({ speaker: 'interviewer', text: 'QUESTION', timestamp: Date.now(), final: true });
  const engine = new IntelligenceEngine(self, session); engine.on('error', () => {});
  const old = engine.runWhatShouldISay('OLD', 0.8, undefined, { skipCooldown: true });
  await oldEntered.promise;
  const fresh = engine.runManualAnswer('FRESH'); const newTask = engine.activeGenerationTask;
  await assert.rejects(old, { name: 'AbortError' }); await freshEntered.promise;
  assert.equal(engine.activeGenerationTask, newTask); assert.equal(engine.getActiveMode(), 'manual');
  oldLate.resolve(packet('LATE OLD ANSWER')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.activeGenerationTask, newTask); assert.equal(engine.getActiveMode(), 'manual');
  freshLate.resolve(packet('fresh answer')); assert.equal(await fresh, 'fresh answer');
  assert.equal(engine.getActiveMode(), 'idle');
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

test('AG33 actual Engine preserves a legitimate short answer and its request metadata', async () => {
  const { self } = helper(() => packet('是'));
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(self, session); const answers = [];
  engine.on('error', () => {}); engine.on('suggested_answer', (...args) => answers.push(args));
  assert.equal(await engine.runWhatShouldISay('QUESTION', 0.8, undefined, { skipCooldown: true }), '是');
  assert.equal(answers[0][0], '是');
  assert.equal(typeof answers[0][3].requestId, 'string');
  assert.equal(session.getLastAssistantMessage(), '是');
});

test('AG33 outer cancellation fences late inner errors, held sentinel text and mode changes', async () => {
  const entered = deferred(), late = deferred();
  const { self } = helper(() => (async function* () { yield packet('Nothing ', null); entered.resolve(); await late.promise; throw Error('late inner failure'); })());
  const engine = new IntelligenceEngine(self, new SessionTracker()); const events = [];
  engine.on('error', () => events.push('error')); engine.on('suggested_answer_token', () => events.push('token'));
  const pending = engine.runWhatShouldISay('OLD', 0.8, undefined, { skipCooldown: true });
  await entered.promise; engine.reset(); await assert.rejects(pending, { name: 'AbortError' });
  late.resolve(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, []);
});

test('AG33 shared written task records a second-step failure rather than first-step completion', async () => {
  const { self } = helper((_, n) => { if (n === 1) return packet('step one'); throw Object.assign(Error('bad configuration'), { status: 400 }); });
  const task = self.beginGenerationTask('written');
  await assert.rejects(() => self.runGeneration(async () => { await self.chatWithGemini('FIRST'); await self.chatWithGemini('SECOND'); }, 'written', undefined, task));
  assert.equal(task.terminalStatus, 'failed');
});

test('AG33 unknown image capability needs exact target confirmation; primary confirmation does not authorize same-provider backup', async () => {
  const { self, requests } = helper((_, n) => { if (n === 1) throw { status: 503 }; return packet('not allowed'); });
  delete self.selectedTarget.imageSupportConfirmedFor;
  await assert.rejects(() => collect(self.streamChat('QUESTION', ['image'])), /unconfirmed/);
  assert.equal(requests.length, 0);
  self.selectedTarget = target();
  self.setGenerationPolicy({ ...policy(selector('gemini-b')), backupImageSupportConfirmedFor: undefined });
  const task = self.beginGenerationTask();
  await assert.rejects(() => collect(self.runGenerationStream(() => self.streamChat('QUESTION', ['image']), 'interview', undefined, task)), /unconfirmed/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'gemini-a');
  assert.equal(self.getTaskMetadata(task).model, 'gemini-a', 'a preflight-rejected backup was never physically sent');
  assert.equal(self.getTaskMetadata(task).attempts, 1);
});

test('AG33 custom endpoint with a vendor model ID remains unknown; known text-only model cannot be overridden', async () => {
  for (const config of [
    { provider: 'gemini', protocol: 'gemini', model: 'gemini-3.1-pro-preview', baseUrl: 'https://compatible.example' },
    { provider: 'gemini', protocol: 'gemini', model: 'toString' },
    { provider: 'groq', protocol: 'chat-completions', model: 'llama-3.3-70b-versatile', imageSupportConfirmedFor: JSON.stringify(['groq', 'chat-completions', 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile']) },
  ]) {
    const { self, requests } = helper(); self.selectedTarget = config; self.currentModelId = config.model;
    self.groqClient = { chat: { completions: { create: () => { throw Error('must not send'); } } } };
    await assert.rejects(() => collect(self.streamChat('QUESTION', ['image'])), /unconfirmed|does not support/);
    assert.equal(requests.length, 0);
  }
});

test('AG33 second-step timeout overwrites an earlier completed state and keeps the first-step send count', async () => {
  const { self } = helper(); const task = self.beginGenerationTask('written');
  await assert.rejects(() => self.runGeneration(async () => {
    await self.chatWithGemini('FIRST');
    assert.equal(task.terminalStatus, 'completed');
    task.controller.abort(Object.assign(Error('second step timeout'), { name: 'GenerationTimeoutError', deadline: 'total' }));
    task.check();
  }, 'written', undefined, task), { name: 'GenerationTimeoutError' });
  assert.equal(task.terminalStatus, 'failed'); assert.equal(task.sends, 1);
  assert.equal(self.getTaskMetadata(task).timeout, 'total');
});

test('AG33 non-image data disguised as PNG fails real image decoding and never uploads raw bytes', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag33-invalid-image-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'private.png'); fs.writeFileSync(file, 'SYNTHETIC_PRIVATE_NON_IMAGE');
  const { self, requests } = helper(); delete self.processImage;
  await assert.rejects(() => collect(self.streamChat('QUESTION', [file])), /Invalid or unreadable image/);
  assert.equal(requests.length, 0);
});

test('AG33 CodeHint delegates images to the target-aware transport rather than answering with a model-name capability warning', async () => {
  const { CodeHintLLM } = require('../../../dist-electron/electron/llm/CodeHintLLM.js');
  const { self, requests } = helper();
  self.selectedTarget = target('opaque-model'); self.currentModelId = 'opaque-model';
  assert.equal(await collect(new CodeHintLLM(self).generateStream(['image'], 'QUESTION')), 'answer');
  assert.equal(requests.length, 1);
  assert.ok(requests[0].contents.some(part => part.inlineData));
});

test('AG33 partial cancellation records exact target and cancelled status in existing session usage', async () => {
  const entered = deferred(), late = deferred();
  const { self } = helper(() => (async function* () { yield packet('partial answer', null); entered.resolve(); await late.promise; yield packet('late'); })());
  const session = new SessionTracker(), engine = new IntelligenceEngine(self, session);
  engine.on('error', () => {});
  const pending = engine.runWhatShouldISay('QUESTION', 0.8, undefined, { skipCooldown: true });
  await entered.promise; engine.reset(); await assert.rejects(pending, { name: 'AbortError' }); late.resolve();
  const usage = session.getFullUsage().at(-1);
  assert.equal(usage.answer, 'partial answer'); assert.equal(usage.status, 'cancelled');
  assert.equal(usage.model, 'gemini-a'); assert.equal(usage.provider, 'gemini'); assert.equal(usage.partial, true);
  assert.equal(session.getFullTranscript().at(-1).generation.requestId, usage.requestId);
});
