import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import fs from 'node:fs';
import OpenAI from 'openai';
import { mainFixture } from '../../audio/__tests__/mainMeetingFixture.mjs';

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
// Primary and backup are listed image models (S48); an older manual confirmation no longer counts for official targets.
const target = (model = 'gemini-3.1-flash-lite') => ({ provider: 'gemini', protocol: 'gemini', model });
const policy = backupModel => ({ backupModel, interviewFirstTokenSeconds: 10, interviewTotalSeconds: 60, writtenTotalSeconds: 180 });
const selector = model => `llm-target:gemini:gemini:${model}`;

test('AG42 manual preparation waits for mic tail and includes current session in one streamed answer', async () => {
  const f = helper(() => (async function* () { yield packet('First ', null); yield packet('second.'); })());
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(f.self, session);
  const tail = deferred(), entered = deferred(), tokens = [], terminals = [];
  engine.on('suggested_answer_token', text => tokens.push(text));
  engine.on('generation_terminal', event => terminals.push(event));
  const pending = engine.runWhatShouldISay(undefined, 0.8, undefined, { manual: true, beforeGenerate: async () => {
    entered.resolve(); await tail.promise;
    session.handleTranscript({ speaker: 'user', text: 'AG42 final mic context', timestamp: Date.now(), final: true });
  } });
  await entered.promise;
  assert.equal(f.requests.length, 0);
  tail.resolve();
  assert.equal(await pending, tokens.join(''));
  assert.equal(tokens.join(''), 'First second.');
  assert.match(JSON.stringify(f.requests[0].contents), /ag42 final mic context/);
  assert.equal(terminals[0].status, 'completed');
  assert.equal(f.requests.length, 1);
  await engine.runWhatShouldISay(undefined, 0.8, undefined, { manual: true });
  assert.equal(f.requests.length, 2, 'manual actions have no automatic-trigger cooldown');
  assert.notEqual(terminals[0].requestId, terminals[1].requestId);
});

test('AG42 missing configuration refuses before finalization or transport', async () => {
  const f = helper(); f.self.client = null;
  const engine = new IntelligenceEngine(f.self, new SessionTracker());
  let finalized = false;
  await assert.rejects(engine.runWhatShouldISay(undefined, 0.8, undefined, {
    manual: true, beforeGenerate: async () => { finalized = true; },
  }), /Configure an answer model/);
  assert.equal(finalized, false);
  assert.equal(f.requests.length, 0);
});

test('AG42 replacement and session reset cancel preparation without a late send', async () => {
  const f = helper(); const engine = new IntelligenceEngine(f.self, new SessionTracker());
  const first = deferred(), entered = deferred();
  const old = engine.runWhatShouldISay(undefined, 0.8, undefined, { manual: true, beforeGenerate: async () => {
    entered.resolve(); await first.promise;
  } });
  const rejected = assert.rejects(old, { name: 'AbortError' });
  await entered.promise;
  await engine.runWhatShouldISay(undefined, 0.8, undefined, { manual: true });
  await rejected; first.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, 1);
  const second = deferred(), preparing = deferred();
  const stopping = engine.runWhatShouldISay(undefined, 0.8, undefined, { manual: true, beforeGenerate: async () => {
    preparing.resolve(); await second.promise;
  } });
  const stopped = assert.rejects(stopping, { name: 'AbortError' });
  await preparing.promise; engine.reset(); await stopped; second.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, 1);
});

test('AG42 terminal failure cannot expose the provider error', async () => {
  const f = helper(() => { throw Object.assign(Error('SECRET_KEY full request server text'), { status: 400 }); });
  const engine = new IntelligenceEngine(f.self, new SessionTracker()); const terminal = [];
  engine.on('generation_terminal', event => terminal.push(event));
  await assert.rejects(engine.runWhatShouldISay(undefined, 0.8, undefined, { manual: true, errorDelivery: 'caller' }));
  assert.equal(terminal[0].error, 'Answer failed. Check the model configuration and try again.');
  assert.doesNotMatch(JSON.stringify(terminal), /SECRET_KEY|full request|server text/);
});

test('AG42 production meeting end aborts streaming and main never forwards late deltas or stale terminals', async () => {
  const entered = deferred(), late = deferred(); let signal;
  const f = helper(args => {
    signal = args.config.abortSignal;
    return (async function* () { yield packet('prefix ', null); entered.resolve(); await late.promise; yield packet('LATE'); })();
  });
  const meeting = mainFixture(); await meeting.start();
  const engine = new IntelligenceEngine(f.self, new SessionTracker());
  engine.resetEngine = () => engine.reset(); engine.stopMeeting = async () => {};
  meeting.state.intelligenceManager = engine;
  const sent = [];
  meeting.state.getMainWindow = () => ({ webContents: { id: 42, isDestroyed: () => false, send: (...args) => sent.push(args) } });
  meeting.state.setupIntelligenceEvents();
  const pending = engine.runWhatShouldISay(undefined, 0.8, undefined, { manual: true });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise;
  await meeting.state.endMeeting(); await rejected;
  assert.equal(signal.aborted, true);
  const terminal = sent.find(([name]) => name === 'intelligence-generation-terminal')[1];
  assert.equal(terminal.status, 'cancelled');
  const count = sent.length; late.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, count);
  assert.doesNotMatch(JSON.stringify(sent), /LATE/);
});

test('S42-03 the answer reads only its frozen view: later live context is excluded and cancellation while freezing sends nothing', async () => {
  const f = helper(); const meeting = mainFixture(); await meeting.start();
  const session = new SessionTracker();
  const cutoffAt = Date.now() - 1000;
  session.handleTranscript({ speaker: 'interviewer', text: 'Existing context before the click', timestamp: cutoffAt - 10, final: true });
  const engine = new IntelligenceEngine(f.self, session);
  const user = meeting.providers.find(provider => provider.channel === 'user');
  let finishes = 0; user.finalize = () => { finishes++; };
  user.emit('transcript', { segmentId: 'open', text: 'my frozen microphone words', isFinal: false });
  const collector = meeting.state.collectSpeech({ cutoffAt: Date.now(), deadline: Date.now() + 20, signal: new AbortController().signal });
  assert.equal(await engine.runWhatShouldISay(undefined, 0.8, undefined, {
    manual: true, beforeGenerate: async () => {
      const frozen = await collector.frozen;
      // Live history keeps growing after the freeze; the request must not see it.
      session.handleTranscript({ speaker: 'interviewer', text: 'Later live context', timestamp: Date.now() + 5, final: true });
      user.emit('transcript', { segmentId: 'open', text: 'my frozen microphone words revised later', isFinal: true });
      return session.frozenView(frozen);
    },
  }), 'answer');
  assert.equal(finishes, 0, 'the action did not finish the microphone task');
  assert.equal(f.requests.length, 1);
  const request = JSON.stringify(f.requests[0].contents);
  assert.match(request, /existing context before the click/i);
  assert.match(request, /my frozen microphone words/);
  assert.doesNotMatch(request, /later live context|revised later/i);
  const entered = deferred();
  const pending = engine.runWhatShouldISay(undefined, 0.8, undefined, {
    manual: true, beforeGenerate: () => { entered.resolve(); return new Promise(() => {}); },
  });
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise; engine.reset(); await cancelled;
  assert.equal(f.requests.length, 1);
  await meeting.state.endMeeting();
});

test('AG42 review: denied transcript scope is a fixed local failure, never a model configuration hint', async () => {
  const f = helper(undefined, { transcript: false }); const terminals = [];
  const engine = new IntelligenceEngine(f.self, new SessionTracker());
  engine.on('generation_terminal', data => terminals.push(data));
  await assert.rejects(engine.runWhatShouldISay(undefined, 0.8, undefined, { manual: true, errorDelivery: 'caller' }), { name: 'ProviderScopeError' });
  assert.equal(terminals[0].error, 'Data scope denied. Check Data Scopes in Settings.');
  assert.equal(f.requests.length, 0);
});
const { CodexAuthSource } = require('../../../dist-electron/electron/services/CodexAuthSource.js');
const codexBinding = model => JSON.stringify(['codex', 'responses', 'https://chatgpt.com/backend-api/codex/responses', model]);
function codexHelper(options = {}) {
  const { self, scopes, requests } = helper(options.apiSend, options.scopes ?? {}), reads = [], sends = [];
  const auth = nonce => JSON.stringify({ tokens: { account_id: 'synthetic-account', access_token: `e30.${Buffer.from(JSON.stringify({ exp: 4_000_000_000, nonce })).toString('base64url')}.synthetic` } });
  self.setCodexCliConfig({ enabled: true, riskConfirmedVersion: 1, model: 'gpt-5.4', fastModel: 'fast', serviceTier: 'default',
    ...(options.images ? { imageSupportConfirmedFor: codexBinding('gpt-5.4'), fastImageSupportConfirmedFor: codexBinding('fast') } : {}) });
  self.codexAuthSource = new CodexAuthSource(async () => { reads.push(1); return options.read ? options.read(auth, reads.length) : auth('same'); }, async (url, init) => {
    sends.push({ url, init }); return options.send?.(sends.length, init) ?? new Response('data: {"type":"response.output_text.delta","delta":"codex answer"}\n\ndata: {"type":"response.completed"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  if (!options.apiPrimary) self.setModel('codex-cli');
  return { self, scopes, requests, reads, sends };
}

test('AG34 source snapshot has no API client/base URL and refuses unconfirmed backend images before auth read', async () => {
  const r = codexHelper(); r.self.openaiClient = { apiKey: 'API_CANARY' };
  const task = r.self.beginGenerationTask('written');
  assert.equal(task.primary.kind, 'codex'); assert.equal(task.primary.target.provider, 'codex-cli'); assert.equal('client' in task.primary, false); assert.equal('baseUrl' in task.primary.target, false); task.close();
  await assert.rejects(() => collect(r.self.streamChat('QUESTION', ['image'])), /unconfirmed.*Codex/i);
  assert.equal(r.reads.length, 0); assert.equal(r.sends.length, 0);
});
for (const state of ['denied', 'revoked-during-read', 'allowed']) test(`AG34 preparedContents inline image screenshots scope: ${state}`, async () => {
  let r; r = codexHelper({ images: true, scopes: state === 'denied' ? { screenshots: false } : {}, read: async auth => { if (state === 'revoked-during-read') r.scopes.screenshots = false; return auth('same'); } });
  const generate = () => collect(r.self.selectedGeneration('QUESTION', undefined, 'SYSTEM', true, 'chat', undefined, [{ text: 'QUESTION' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }]));
  if (state === 'allowed') { assert.equal(await generate(), 'codex answer'); assert.equal(r.sends.length, 1); }
  else { await assert.rejects(generate, { name: 'ProviderScopeError' }); assert.equal(r.sends.length, 0); assert.equal(r.reads.length, state === 'denied' ? 0 : 1); }
});
test('AG34 Codex backup image confirmation cannot inherit primary confirmation', async () => {
  const r = codexHelper({ apiPrimary: true, images: true, apiSend: () => { throw { status: 503 }; } });
  r.self.setGenerationPolicy({ ...r.self.getGenerationPolicy(), backupModel: 'codex-cli:gpt-5.4' });
  await assert.rejects(() => collect(r.self.streamChat('QUESTION', ['image'])), /unconfirmed.*Codex/i);
  assert.equal(r.requests.length, 1); assert.equal(r.reads.length, 0); assert.equal(r.sends.length, 0);
  r.self.setGenerationPolicy({ ...r.self.getGenerationPolicy(), backupImageSupportConfirmedFor: codexBinding('gpt-5.4') });
  assert.equal(await collect(r.self.streamChat('QUESTION', ['image'])), 'codex answer');
  assert.equal(r.sends.length, 1);
});
test('AG34 changing main/fast model invalidates only matching image bindings', () => {
  const r = codexHelper({ images: true }); const previous = r.self.getCodexCliConfig();
  r.self.setCodexCliConfig({ ...previous, model: 'changed' });
  assert.equal(r.self.getCodexCliConfig().imageSupportConfirmedFor, undefined); assert.equal(r.self.getCodexCliConfig().fastImageSupportConfirmedFor, codexBinding('fast'));
});
test('AG34 equal normal/fast models still require their independent image confirmations', async () => {
  const r = codexHelper();
  r.self.setCodexCliConfig({ ...r.self.getCodexCliConfig(), fastModel: 'gpt-5.4', imageSupportConfirmedFor: codexBinding('gpt-5.4') });
  assert.equal(await collect(r.self.streamChat('QUESTION', ['image'])), 'codex answer');
  assert.equal(r.reads.length, 1); assert.equal(r.sends.length, 1);
  r.self.setGroqFastTextMode(true);
  await assert.rejects(() => collect(r.self.streamChat('QUESTION', ['image'])), /unconfirmed.*Codex/i);
  assert.equal(r.reads.length, 1); assert.equal(r.sends.length, 1);
});
test('AG34 external same-account changed token recovers once within the real LLMHelper task', async () => {
  const r = codexHelper({ read: (auth, n) => auth(String(n)), send: n => n === 1 ? new Response('{}', { status: 401 }) : undefined });
  assert.equal(await collect(r.self.streamChat('QUESTION')), 'codex answer'); assert.equal(r.sends.length, 2); assert.equal(r.reads.length, 2);
});
for (const change of ['consent', 'model', 'fast', 'policy']) test(`AG34 ${change} change cancels auth-waiting task without late send`, async () => {
  const wait = deferred(), started = deferred();
  const r = codexHelper({ read: async auth => { started.resolve(); await wait.promise; return auth('same'); } });
  const result = collect(r.self.streamChat('QUESTION')); await started.promise;
  if (change === 'consent') r.self.setCodexCliConfig({ ...r.self.getCodexCliConfig(), enabled: false, riskConfirmedVersion: undefined });
  if (change === 'model') r.self.setModel('codex-cli:changed');
  if (change === 'fast') r.self.setGroqFastTextMode(true);
  if (change === 'policy') r.self.setGenerationPolicy({ ...r.self.getGenerationPolicy(), interviewTotalSeconds: 75 });
  await assert.rejects(result, { name: 'AbortError' }); wait.resolve(); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(r.sends.length, 0);
});
test('AG34 source getters/selectors and disabled/unconfirmed requests never read auth', async () => {
  const r = codexHelper(); r.self.setCodexCliConfig({ ...r.self.getCodexCliConfig(), enabled: false, riskConfirmedVersion: undefined });
  r.self.getCodexCliConfig(); r.self.setModel('codex-cli:gpt-5.4');
  await assert.rejects(() => r.self.chatWithGemini('QUESTION'), /disabled/); assert.equal(r.reads.length, 0); assert.equal(r.sends.length, 0);
  r.self.setCodexCliConfig({ ...r.self.getCodexCliConfig(), enabled: true }); await assert.rejects(() => r.self.chatWithGemini('QUESTION'), /Confirm/); assert.equal(r.reads.length, 0);
});
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
    client, selectedTarget: target(), currentModelId: 'gemini-3.1-flash-lite', geminiModel: 'gemini-3.1-flash-lite',
    generationPolicy: policy(), personaPrompt: '', customNotes: '', aiResponseLanguage: 'auto', codexCliConfig: { enabled: false },
    rateLimiters: { gemini: { acquire: async () => {} } }, getProviderScopePolicy: () => scopes,
    injectLanguageInstruction: value => value, processResponse: value => value, logScopeFallback: () => {},
    geminiPromptCache: { getOrCreate: async () => null, invalidate() {} },
    processImage: async imagePath => ({ mimeType: 'image/png', data: Buffer.from(imagePath).toString('base64') }),
  });
  return { self, requests, client, scopes };
}

for (const entry of ['chatWithGemini', 'generateContentStructured', 'streamChat']) test(`${entry}: transient failure uses only explicit backup and at most two sends`, async () => {
  const { self, requests } = helper((args, number) => { if (number === 1) throw Object.assign(Error('unavailable'), { status: 503 }); return packet('backup'); });
  self.setGenerationPolicy(policy(selector('gemini-3.1-pro-preview')));
  const answer = entry === 'streamChat' ? await collect(self[entry]('QUESTION')) : await self[entry]('QUESTION');
  assert.equal(answer, 'backup'); assert.deepEqual(requests.map(r => r.model), ['gemini-3.1-flash-lite', 'gemini-3.1-pro-preview']);
});

for (const state of ['SAFETY', 'MAX_TOKENS', 'EMPTY', 'AUTH', 'CONFIG', 'PARTIAL']) test(`real answer interface: ${state} terminates without backup`, async () => {
  const { self, requests } = helper(() => {
    if (state === 'AUTH') throw Object.assign(Error('auth'), { status: 401 });
    if (state === 'CONFIG') throw Object.assign(Error('not found'), { status: 404 });
    if (state === 'PARTIAL') return (async function* () { yield packet('partial', null); throw Object.assign(Error('network'), { code: 'ECONNRESET' }); })();
    return packet(state === 'EMPTY' ? '' : 'partial', state === 'EMPTY' ? 'STOP' : state);
  });
  self.setGenerationPolicy(policy(selector('gemini-3.1-pro-preview')));
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
  self.setGenerationPolicy(policy(selector('gemini-3.1-pro-preview')));
  const ready = deferred(); self.processImage = async () => { await ready.promise; return { mimeType: 'image/png', data: 'AAAA' }; };
  const stream = self.streamChat('QUESTION', ['image']); const pending = collect(stream);
  self.client = { models: { generateContentStream: () => { throw Error('hot client must not run'); } } };
  self.selectedTarget = target('gemini-hot'); self.generationPolicy = policy(selector('gemini-hot-backup'));
  ready.resolve(); assert.equal(await pending, 'old backup');
  assert.deepEqual(requests.map(r => r.model), ['gemini-3.1-flash-lite', 'gemini-3.1-pro-preview']);
});

for (const waiting of ['limiter', 'image', 'cache', 'retry-after']) test(`permission revoked during ${waiting} stops all later sends`, async () => {
  const { self, requests, scopes } = helper((_, n) => { if (waiting === 'retry-after' && n === 1) { scopes.transcript = false; throw { status: 429, headers: { 'retry-after': '0' } }; } return packet(); });
  self.setGenerationPolicy(policy(selector('gemini-3.1-pro-preview')));
  if (waiting === 'limiter') self.rateLimiters.gemini.acquire = async () => { scopes.transcript = false; };
  if (waiting === 'image') self.processImage = async () => { scopes.screenshots = false; return { mimeType: 'image/png', data: 'AAAA' }; };
  if (waiting === 'cache') self.geminiPromptCache.getOrCreate = async () => { scopes.transcript = false; return 'cachedContents/test'; };
  await assert.rejects(() => collect(self.streamChat('QUESTION', waiting === 'image' ? ['image'] : undefined)), { name: 'ProviderScopeError' });
  assert.equal(requests.length, waiting === 'retry-after' ? 1 : 0);
});

for (const second of ['valid', 'invalid']) test(`explicit cache recovery ${second}: same model, full original content, only two sends`, async () => {
  const { self, requests } = helper((args, n) => { if (n === 1 || second === 'invalid') throw expired(); return packet(); });
  self.geminiPromptCache.getOrCreate = async () => 'cachedContents/explicit';
  self.setGenerationPolicy(policy(selector('gemini-3.1-pro-preview')));
  const run = () => collect(self.streamChat('QUESTION', ['original-image'], undefined, 'ORIGINAL SYSTEM'));
  if (second === 'valid') assert.equal(await run(), 'answer'); else await assert.rejects(run);
  assert.deepEqual(requests.map(r => r.model), ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite']);
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
  self.setModel(selector('gemini-3.1-flash-lite'));
  self.setModel('gemini-3.1-flash-lite');
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
  const { self } = helper(); self.setGenerationPolicy(policy(selector('gemini-3.1-pro-preview')));
  const task = self.beginGenerationTask();
  try { assert.throws(() => self.setModel(selector('gemini-3.1-pro-preview')), /must differ/); assert.equal(self.currentModelId, 'gemini-3.1-flash-lite'); assert.equal(task.signal.aborted, false); }
  finally { task.close(); }
});

test('Groq fast mode preserves the explicitly selected model for both text and images', async () => {
  const { self } = helper(); const requests = [];
  self.groqClient = { chat: { completions: { create: async args => { requests.push(args); return { choices: [{ message: { content: 'fast' }, finish_reason: 'stop' }] }; } } } };
  self.selectedTarget = { provider: 'groq', protocol: 'chat-completions', model: 'groq-other', imageSupportConfirmedFor: JSON.stringify(['groq', 'chat-completions', 'https://api.groq.com/openai/v1', 'groq-other']) }; self.currentModelId = 'groq-other'; self.groqFastTextMode = true;
  assert.equal(await self.chatWithGemini('QUESTION'), 'fast');
  assert.equal(requests[0].model, 'groq-other');
  assert.equal(requests[0].max_tokens, 8192); assert.equal(requests[0].temperature, 0.4);
  // S48: an unlisted official model sends no images, even with an older manual confirmation.
  await assert.rejects(() => self.chatWithGemini('QUESTION', ['image']), /not been verified yet.*attachments were kept/);
  assert.equal(requests.length, 1);
});

test('saved provider connection test ignores the answer backup and sends its own failed target only once', async () => {
  const { self, requests } = helper(() => { throw Object.assign(Error('overloaded'), { status: 503 }); });
  self.providerConfigurations = { gemini: target() };
  self.setGenerationPolicy(policy(selector('gemini-3.1-pro-preview')));
  await assert.rejects(() => self.testProviderConnection('gemini'));
  assert.deepEqual(requests.map(request => request.model), ['gemini-3.1-flash-lite']);
});

test('the configured answer backup can itself be connection-tested once without a primary/backup conflict', async () => {
  const { self, requests } = helper();
  self.setGenerationPolicy(policy(selector('gemini-3.1-pro-preview')));
  self.providerConfigurations = { gemini: target('gemini-3.1-pro-preview') };
  assert.equal(await self.testProviderConnection('gemini'), 'answer');
  assert.deepEqual(requests.map(request => request.model), ['gemini-3.1-pro-preview']); assert.equal(self.selectedTarget.model, 'gemini-3.1-flash-lite');
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
  assert.equal(usage[0][3].status, 'cancelled'); assert.equal(usage[0][3].model, 'gemini-3.1-flash-lite');
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
  assert.equal(entry.status, status); assert.equal(entry.model, 'gemini-3.1-flash-lite'); assert.equal(entry.partial, false);
});

for (const visible of [false, true]) test(`actual Engine TTFT clears only at displayed body, not a held sentinel prefix: visible ${visible}`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });
  const waiting = deferred(); const release = deferred();
  const { self, requests } = helper(() => (async function* () {
    yield packet(visible ? 'Actual answer body ' : 'Nothing ', null);
    waiting.resolve(); await release.promise; yield packet('late', 'STOP');
  })());
  self.setGenerationPolicy(policy(selector('gemini-3.1-pro-preview')));
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
  assert.equal(requests[0].model, 'gemini-3.1-flash-lite');
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
  assert.throws(() => self.setGenerationPolicy(policy(selector('gemini-3.1-flash-lite'))), /must differ/);
  self.setGenerationPolicy(policy(selector('gemini-3.1-pro-preview'))); const client = self.client;
  self.geminiPromptCache = { clear() {} };
  // The selection follows a save only when it named the saved configured model.
  self.providerConfigurations = { ...self.providerConfigurations, gemini: target('gemini-3.1-flash-lite') };
  assert.throws(() => self.configureProvider(target('gemini-3.1-pro-preview'), 'synthetic-not-used'), /must differ/);
  assert.equal(self.client, client); assert.equal(self.selectedTarget.model, 'gemini-3.1-flash-lite');
  self.providerConfigurations = { ...self.providerConfigurations, gemini: target('gemini-c') };
  self.configureProvider(target('gemini-3.1-pro-preview'), 'synthetic-not-used');
  assert.equal(self.selectedTarget.model, 'gemini-3.1-flash-lite', 'another configured model never changes the running selection');
});

test('explicit Codex selector clears stale API selection and snapshots its configured fast model', () => {
  const { self } = helper(); self.codexCliConfig = { enabled: true, riskConfirmedVersion: 1, model: 'ordinary', fastModel: 'fast', serviceTier: 'default' }; self.groqFastTextMode = true;
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

test('S48 an unlisted official model sends no images, an older confirmation cannot bypass it, and the backup is checked on its own', async () => {
  const { self, requests } = helper((_, n) => { if (n === 1) throw { status: 503 }; return packet('not allowed'); });
  const legacyConfirmation = model => JSON.stringify(['gemini', 'gemini', 'https://generativelanguage.googleapis.com', model]);
  for (const model of ['gemini-unlisted', 'gemini-3.1-flash-lite-latest', 'GEMINI-3.1-FLASH-LITE']) {
    self.selectedTarget = { ...target(model), imageSupportConfirmedFor: legacyConfirmation(model) }; self.currentModelId = model;
    await assert.rejects(() => collect(self.streamChat('QUESTION', ['image'])), /not been verified yet.*attachments were kept/);
  }
  assert.equal(requests.length, 0);
  self.selectedTarget = target(); self.currentModelId = 'gemini-3.1-flash-lite';
  self.setGenerationPolicy({ ...policy(selector('gemini-unlisted-backup')), backupImageSupportConfirmedFor: legacyConfirmation('gemini-unlisted-backup') });
  const task = self.beginGenerationTask();
  await assert.rejects(() => collect(self.runGenerationStream(() => self.streamChat('QUESTION', ['image']), 'interview', undefined, task)), /not been verified yet/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'gemini-3.1-flash-lite');
  assert.equal(self.getTaskMetadata(task).model, 'gemini-3.1-flash-lite', 'a preflight-rejected backup was never physically sent');
  assert.equal(self.getTaskMetadata(task).attempts, 1);
});

test('AG33 custom endpoint with a vendor model ID remains unknown; known text-only model cannot be overridden', async () => {
  for (const config of [
    // A gateway with a vendor model ID is still a gateway: image support stays unknown until confirmed.
    { provider: 'gateway', gatewayId: 'gw-vendor-id', protocol: 'gemini', model: 'gemini-3.1-pro-preview', baseUrl: 'https://compatible.example' },
    { provider: 'gemini', protocol: 'gemini', model: 'toString' },
    { provider: 'groq', protocol: 'chat-completions', model: 'llama-3.3-70b-versatile', imageSupportConfirmedFor: JSON.stringify(['groq', 'chat-completions', 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile']) },
  ]) {
    const { self, requests } = helper(); self.selectedTarget = config; self.currentModelId = config.model;
    self.gatewayClients = new Map([['gw-vendor-id', self.client]]);
    self.groqClient = { chat: { completions: { create: () => { throw Error('must not send'); } } } };
    await assert.rejects(() => collect(self.streamChat('QUESTION', ['image'])), config.provider === 'gateway' ? /unconfirmed/ : config.provider === 'groq' ? /does not support/ : /not been verified yet/);
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
  self.selectedTarget = target('gemini-3.1-pro-preview'); self.currentModelId = 'gemini-3.1-pro-preview';
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
  assert.equal(usage.model, 'gemini-3.1-flash-lite'); assert.equal(usage.provider, 'gemini'); assert.equal(usage.partial, true);
  assert.equal(session.getFullTranscript().at(-1).generation.requestId, usage.requestId);
});
