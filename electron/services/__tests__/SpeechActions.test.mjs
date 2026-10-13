import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

// S42-03 on the real IPC -> IntelligenceManager -> LLMHelper chain with a mocked provider client:
// actions cut speech at the click, read only their frozen view, and stale references never send.
const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 's42-03-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const dist = file => require(`../../../dist-electron/electron/${file}.js`);
const compiled = ts.transpileModule(fs.readFileSync(new URL('../../ipcHandlers.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));

class Sender extends EventEmitter {
  constructor(id) { super(); this.id = id; this.sent = []; }
  send(...args) { this.sent.push(args); }
  isDestroyed() { return false; }
}

function chain() {
  const electronId = require.resolve('electron');
  const previous = require.cache[electronId];
  require.cache[electronId] = { exports: { app: { getPath: () => root, isReady: () => true, isPackaged: false } } };
  let modules;
  try {
    modules = { ...dist('LLMHelper'), ...dist('IntelligenceManager'), ...dist('audio/MeetingSttSession'), ...dist('services/SkillsManager') };
  } finally { if (previous) require.cache[electronId] = previous; else delete require.cache[electronId]; }
  const sent = [], policy = { current: {} };
  const helper = Object.assign(Object.create(modules.LLMHelper.prototype), {
    selectedTarget: { provider: 'openai', protocol: 'chat-completions', model: 'gpt-4o' },
    currentModelId: 'gpt-4o', aiResponseLanguage: 'auto', personaPrompt: '', customNotes: '',
    getProviderScopePolicy: () => policy.current,
    openaiClient: { chat: { completions: { create: async body => {
      sent.push(body);
      return body.stream ? [{ choices: [{ delta: { content: 'MOCK ANSWER' }, finish_reason: 'stop' }] }]
        : { choices: [{ message: { content: 'MOCK ANSWER' }, finish_reason: 'stop' }] };
    } } } },
  });
  const intelligence = new modules.IntelligenceManager(helper);
  intelligence.on('error', () => {});
  const seals = [];
  const meeting = new modules.MeetingSttSession({
    create: channel => Object.assign(new EventEmitter(), {
      channel, write() {}, stop() {}, finalize() { throw Error('a manual action must not finish the task'); },
      seal() { let resolve; const done = new Promise(r => { resolve = r; }); seals.push(resolve); return { scopes: [], done }; },
    }),
    onTranscript: event => intelligence.handleTranscript({ speaker: event.channel, text: event.text, timestamp: event.timestamp, final: event.final, segmentId: event.segmentId }),
  });
  meeting.begin('meeting-1');
  const user = meeting.ensure('user'), interviewer = meeting.ensure('interviewer');
  const handlers = new Map();
  const electron = { app: { getPath: () => root }, BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] }, dialog: {},
    ipcMain: { removeHandler() {}, handle: (name, callback) => handlers.set(name, callback), removeAllListeners() {}, on() {} } };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, console: { log() {}, warn() {}, error() {} },
    process: { env: {}, platform: process.platform }, AbortController,
    require(id) {
      if (id === 'electron') return electron;
      if (id === './services/SkillsManager') return { SkillsManager: modules.SkillsManager };
      if (['./llm/scenarioPrompts', './services/PromptSettingsStore', './direct-assist/errors', './utils/imagePathValidation', './ipc/speechActions', './SessionTracker'].includes(id)) return dist(id.substring(2));
      if (id === './ipc/sttHandlers') return { registerDomesticSttHandlers() {} };
      if (id === './ipc/localContextHandlers') return { registerLocalContextHandlers() {} };
      if (id === './margin/appIdentity') return { APP_IDENTITY: { name: 'temp' } };
      if (['fs', 'os', 'path', 'crypto'].includes(id)) return require(id);
      return {};
    },
  });
  module.exports.initializeIpcHandlers({ processingHelper: { getLLMHelper: () => helper }, getIntelligenceManager: () => intelligence,
    getMainWindow: () => null,
    getScreenshotQueue: () => [], collectSpeech: options => meeting.collect(options), markDictation: at => meeting.markDictation(at),
    endMeeting: async () => {} });
  const sender = new Sender(7);
  const invoke = (channel, ...args) => handlers.get(channel)({ sender }, ...args);
  const begin = async (kind, extra = {}, owner = sender) => {
    const { speechActionId } = await handlers.get('speech-action:begin')({ sender: owner }, { clientActionId: crypto.randomUUID(), kind, clickedAt: Date.now(), ...extra });
    return { speechActionId, stage1EndAt: Date.now() };
  };
  const releaseSeals = () => { for (const resolve of seals.splice(0)) resolve('no-pending'); };
  return { sent, intelligence, user, interviewer, handlers, sender, invoke, begin, releaseSeals, helper, policy };
}

// Speech before the click, its later revision, and live speech that starts after the click.
async function speakAroundClick(c, kind, extra) {
  c.intelligence.addAssistantMessage('PRIOR ANSWER about hashing');
  c.interviewer.emit('transcript', { segmentId: 'o1', text: 'Old interviewer final words here', isFinal: true });
  c.interviewer.emit('transcript', { segmentId: 'i1', text: 'Tell me how a hash table handles collisions', isFinal: false });
  c.user.emit('transcript', { segmentId: 'u1', text: 'USER SAID earlier context words', isFinal: true });
  await new Promise(resolve => setTimeout(resolve, 2));
  const ref = await c.begin(kind, extra);
  await new Promise(resolve => setTimeout(resolve, 2));
  c.interviewer.emit('transcript', { segmentId: 'i1', text: 'Tell me how a hash table handles collisions REVISED', isFinal: true });
  c.interviewer.emit('transcript', { segmentId: 'late', text: 'LATE LIVE please write a function that can reverse a linked list efficiently', isFinal: true });
  c.intelligence.addAssistantMessage('LATE ASSISTANT reply');
  c.releaseSeals();
  await tick();
  // After the freeze: an old segment is revised and the coding question changes before the request is built.
  c.interviewer.emit('transcript', { segmentId: 'o1', text: 'OLD LEAK revision after freeze', isFinal: true });
  c.intelligence.setCodingQuestion('LEAK coding: implement a function that returns all subsets of an array efficiently', 'screenshot');
  return ref;
}

const shortcuts = {
  'what-to-say': ['generate-what-to-say', undefined, undefined],
  clarify: ['generate-clarify'],
  recap: ['generate-recap'],
  'follow-up-questions': ['generate-follow-up-questions'],
  'follow-up': ['generate-follow-up', 'shorten', undefined],
  'code-hint': ['generate-code-hint', undefined, undefined],
  brainstorm: ['generate-brainstorm', undefined, undefined],
};

async function historyAction(c, kind) {
  c.intelligence.addAssistantMessage('PRIVATE HISTORY sentinel about hash collisions');
  c.interviewer.emit('transcript', { segmentId: 'history-question', text: 'Explain how to implement a hash table and handle collisions', isFinal: true });
  if (kind !== 'answer') {
    const ref = await c.begin(kind);
    c.releaseSeals();
    const [channel, ...args] = shortcuts[kind];
    return () => c.invoke(channel, ...args, ref);
  }
  const dictationId = crypto.randomUUID();
  await c.invoke('dictation:begin', { dictationId, clickedAt: Date.now() - 1 });
  c.user.emit('transcript', { segmentId: 'dictated-history', text: 'Explain the collision strategy', isFinal: true });
  const ref = await c.begin('answer', { dictationId });
  c.releaseSeals();
  const frozen = await c.invoke('speech-action:freeze', ref);
  return () => c.invoke('gemini-chat-stream', frozen.question, undefined, 'PROMPT', { skipSystemPrompt: true, speechActionId: ref.speechActionId });
}

for (const kind of [...Object.keys(shortcuts), 'answer']) {
  test(`S42-03 ${kind}: frozen assistant history respects its own policy`, async () => {
    for (const denied of [true, false]) {
      const c = chain();
      c.policy.current = { profile_history: !denied };
      const run = await historyAction(c, kind);
      await run();
      const request = JSON.stringify(c.sent);
      if (denied) assert.doesNotMatch(request, /PRIVATE HISTORY/i);
      else {
        assert.ok(c.sent.length > 0, 'allowed history retains normal generation');
        assert.match(request, /PRIVATE HISTORY/i);
      }
    }
  });

  for (const revokeAt of ['queue', 'retry']) test(`S42-03 ${kind}: history withdrawal at ${revokeAt} prevents every later send`, async () => {
    const c = chain();
    let waits = 0;
    c.helper.rateLimiters = { openai: { acquire: async () => {
      waits++;
      if (revokeAt === 'queue') c.policy.current.profile_history = false;
    } } };
    if (revokeAt === 'retry') {
      c.helper.setGenerationPolicy({ ...c.helper.getGenerationPolicy(), backupModel: 'llm-target:openai:chat-completions:gpt-4o-mini' });
      c.helper.openaiClient.chat.completions.create = async body => {
        c.sent.push(body);
        c.policy.current.profile_history = false;
        throw Object.assign(new Error('synthetic overload before text'), { status: 503 });
      };
    }
    const run = await historyAction(c, kind);
    // Some existing handlers report failure as an IPC result rather than rejecting.
    await run().catch(error => { assert.match(error.name, /ProviderScopeError|Generation/, error.stack); });
    assert.ok(waits > 0, 'the real request reached the provider queue');
    assert.equal(c.sent.length, revokeAt === 'queue' ? 0 : 1, 'no request is sent after permission withdrawal');
    if (revokeAt === 'retry') assert.match(JSON.stringify(c.sent[0]), /PRIVATE HISTORY/i);
  });
}

for (const revisions of [1, 2]) test(`S42-03 delayed begin after the tail cannot import live coding or old-ID text (${revisions} revisions)`, async t => {
  let now = 900;
  t.mock.method(Date, 'now', () => now);
  const c = chain();
  c.interviewer.emit('transcript', { segmentId: 'stable-question', text: 'Explain the hash table collision strategy', isFinal: true });
  c.user.emit('transcript', { segmentId: 'old-revised', text: 'ORIGINAL pre click context', isFinal: true });
  now = 5000;
  c.user.emit('transcript', { segmentId: 'old-revised', text: 'POST DEADLINE forbidden revision', isFinal: true });
  if (revisions === 2) {
    now = 5500;
    c.user.emit('transcript', { segmentId: 'old-revised', text: 'POST DEADLINE second forbidden revision', isFinal: true });
  }
  c.intelligence.setCodingQuestion('POST CLICK coding question implement forbidden live input', 'screenshot');
  now = 6000;
  const ref = await c.begin('code-hint', { clickedAt: 1000 });
  c.releaseSeals();
  await c.invoke('generate-code-hint', undefined, undefined, ref);
  assert.ok(c.sent.length > 0, 'the delayed real handler still sends its bounded context');
  const request = JSON.stringify(c.sent);
  assert.doesNotMatch(request, /POST DEADLINE|POST CLICK|forbidden live/i);
  if (revisions === 1) assert.match(request, /ORIGINAL pre click/i, 'the known earlier version is preserved');
  else assert.doesNotMatch(request, /ORIGINAL pre click/i, 'an unavailable older version is conservatively omitted');
});

for (const kind of ['clarify', 'answer']) test(`S42-03 ${kind}: allowed history survives an actual automatic backup send`, async () => {
  const c = chain();
  c.helper.setGenerationPolicy({ ...c.helper.getGenerationPolicy(), backupModel: 'llm-target:openai:chat-completions:gpt-4o-mini' });
  const create = c.helper.openaiClient.chat.completions.create;
  c.helper.openaiClient.chat.completions.create = async body => {
    if (c.sent.length === 0) {
      c.sent.push(body);
      throw Object.assign(new Error('synthetic overload before text'), { status: 503 });
    }
    return create(body);
  };
  await (await historyAction(c, kind))();
  assert.equal(c.sent.length, 2, 'the same retry path can send when permission remains granted');
  assert.deepEqual(c.sent.map(body => body.model), ['gpt-4o', 'gpt-4o-mini']);
  for (const body of c.sent) assert.match(JSON.stringify(body), /PRIVATE HISTORY/i);
});

test('S42-03 a consumed shortcut remains cancellable while its transcript is pending', async () => {
  const c = chain();
  c.interviewer.emit('transcript', { segmentId: 'pending', text: 'Unfinished question before cancel', isFinal: false });
  const ref = await c.begin('clarify');
  const pending = c.invoke('generate-clarify', ref);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  await c.invoke('cancel-intelligence-generation');
  await rejected;
  c.releaseSeals();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.sent.length, 0);
  assert.equal(c.sender.listenerCount('destroyed'), 0);
});

for (const [kind, [channel, ...args]] of Object.entries(shortcuts)) test(`S42-03 ${kind} reads the frozen view: revised pre-click speech in, later live context out`, async () => {
  const c = chain();
  const ref = await speakAroundClick(c, kind);
  const before = c.sent.length;
  await c.invoke(channel, ...args, ref);
  assert.ok(c.sent.length > before, 'the action sent its request');
  const request = JSON.stringify(c.sent.slice(before));
  assert.match(request, /collisions revised/i, 'the pre-click fragment is taken at its latest revision');
  assert.doesNotMatch(request, /late live|late assistant|linked list|old leak|leak coding/i, 'live writes after the click or the freeze are excluded');
  const sentBefore = c.sent.length;
  // An action is consumed once; What to say keeps its existing fixed-failure result.
  if (kind === 'what-to-say') assert.equal((await c.invoke(channel, ...args, ref)).error, 'Answer failed. Check the model configuration and try again.');
  else await assert.rejects(() => c.invoke(channel, ...args, ref), { name: 'SpeechActionError' });
  assert.equal(c.sent.length, sentBefore);
  assert.equal(c.sender.listenerCount('destroyed'), 0, 'no listener is left behind');
});

test('S42-03 Stop: main freezes the dictated question, the chat request carries both frozen channels, and only that question is accepted', async () => {
  const c = chain();
  c.interviewer.emit('transcript', { segmentId: 'i1', text: 'Interviewer asks about hash table collisions', isFinal: true });
  c.user.emit('transcript', { segmentId: 'old', text: 'OLD speech before answer', isFinal: true });
  await new Promise(resolve => setTimeout(resolve, 2));
  const { dictationId } = await c.invoke('dictation:begin', { dictationId: crypto.randomUUID(), clickedAt: Date.now() });
  await new Promise(resolve => setTimeout(resolve, 2));
  c.user.emit('transcript', { segmentId: 'q', text: 'how would you resize it', isFinal: true });
  await new Promise(resolve => setTimeout(resolve, 2));
  const ref = await c.begin('answer', { dictationId });
  await new Promise(resolve => setTimeout(resolve, 2));
  c.user.emit('transcript', { segmentId: 'after', text: 'AFTER STOP speech', isFinal: true });
  c.interviewer.emit('transcript', { segmentId: 'late', text: 'LATE LIVE interviewer words', isFinal: true });
  c.releaseSeals();
  const frozen = await c.invoke('speech-action:freeze', ref);
  assert.equal(frozen.speechActionId, ref.speechActionId);
  assert.equal(frozen.question, 'how would you resize it', 'old final speech and speech after Stop are excluded');
  await c.invoke('gemini-chat-stream', frozen.question, undefined, 'PROMPT', { skipSystemPrompt: true, speechActionId: ref.speechActionId });
  assert.equal(c.sent.length, 1);
  const body = c.sent[0];
  assert.equal(body.messages.some(message => message.role === 'system'), false, 'skipSystemPrompt is preserved');
  const request = JSON.stringify(body);
  assert.match(request, /PROMPT/);
  assert.match(request, /Interviewer asks about hash table collisions/);
  assert.doesNotMatch(request, /late live|after stop/i);
  assert.equal(request.split('how would you resize it').length - 1, 1, 'the dictated question is not repeated as context');
  await assert.rejects(() => c.invoke('gemini-chat-stream', frozen.question, undefined, 'PROMPT', { skipSystemPrompt: true, speechActionId: ref.speechActionId }),
    { name: 'SpeechActionError' }, 'the Stop action is consumed once');
  const again = await c.begin('answer', { dictationId: (await c.invoke('dictation:begin', { dictationId: crypto.randomUUID(), clickedAt: Date.now() })).dictationId });
  c.releaseSeals();
  await c.invoke('speech-action:freeze', again);
  await assert.rejects(() => c.invoke('gemini-chat-stream', 'a different question', undefined, 'PROMPT', { skipSystemPrompt: true, speechActionId: again.speechActionId }),
    { name: 'SpeechActionError' });
  assert.equal(c.sent.length, 1, 'a question main did not freeze sends nothing');
});

test('S42-03 references are owned, typed, single-use and cannot be revived; typed questions and cancel release pending actions', async () => {
  const c = chain();
  const other = new Sender(8);
  let ref = await c.begin('clarify');
  c.releaseSeals();
  await assert.rejects(() => c.handlers.get('generate-clarify')({ sender: other }, ref), { name: 'SpeechActionError' }, 'wrong owner');
  await assert.rejects(() => c.invoke('generate-recap', ref), { name: 'SpeechActionError' }, 'wrong kind');
  await assert.rejects(() => c.invoke('generate-clarify', { speechActionId: crypto.randomUUID(), stage1EndAt: Date.now() }), { name: 'SpeechActionError' }, 'missing');
  await assert.rejects(() => c.invoke('generate-clarify', undefined), { name: 'SpeechActionError' }, 'no fallback without an action');
  // A newer action supersedes the pending one; its task is aborted and never sends.
  const superseded = ref;
  ref = await c.begin('clarify');
  await assert.rejects(() => c.invoke('generate-clarify', superseded), { name: 'SpeechActionError' });
  // A typed question cancels the pending action.
  await c.invoke('gemini-chat-stream', 'typed question');
  const sentAfterTyped = c.sent.length;
  await assert.rejects(() => c.invoke('generate-clarify', ref), { name: 'SpeechActionError' });
  ref = await c.begin('recap');
  await c.invoke('cancel-intelligence-generation');
  await assert.rejects(() => c.invoke('generate-recap', ref), { name: 'SpeechActionError' });
  ref = await c.begin('recap');
  await c.invoke('end-meeting');
  await assert.rejects(() => c.invoke('generate-recap', ref), { name: 'SpeechActionError' });
  assert.equal(c.sent.length, sentAfterTyped, 'released actions never send');
  assert.equal(c.sender.listenerCount('destroyed'), 0);
  await assert.rejects(() => c.handlers.get('speech-action:begin')({ sender: c.sender }, { clientActionId: 'not-a-uuid', kind: 'clarify', clickedAt: Date.now() }), { name: 'SpeechActionError' });
  await assert.rejects(() => c.handlers.get('speech-action:begin')({ sender: c.sender }, { clientActionId: crypto.randomUUID(), kind: 'unknown', clickedAt: Date.now() }), { name: 'SpeechActionError' });
  await assert.rejects(() => c.handlers.get('speech-action:begin')({ sender: c.sender }, { clientActionId: crypto.randomUUID(), kind: 'clarify', clickedAt: Number.NaN }), { name: 'SpeechActionError' });
  await assert.rejects(() => c.handlers.get('speech-action:begin')({ sender: c.sender }, { clientActionId: crypto.randomUUID(), kind: 'answer', clickedAt: Date.now(), dictationId: 'forged' }), { name: 'SpeechActionError' });
});

test('S42-03 the budget starts at the click, a future click cannot extend it, and an unconsumed action is released by its deadline', async () => {
  const c = chain();
  const tasks = [];
  const begin = c.helper.beginGenerationTask.bind(c.helper);
  c.helper.beginGenerationTask = (...args) => { const task = begin(...args); tasks.push(task); return task; };
  const clickedAt = Date.now() - 900;
  await c.handlers.get('speech-action:begin')({ sender: c.sender }, { clientActionId: crypto.randomUUID(), kind: 'clarify', clickedAt });
  assert.equal(tasks[0].startedAt, clickedAt);
  assert.equal(tasks[0].firstTokenDeadline, clickedAt + 10_000);
  const before = Date.now();
  await c.handlers.get('speech-action:begin')({ sender: c.sender }, { clientActionId: crypto.randomUUID(), kind: 'clarify', clickedAt: before + 60_000 });
  assert.ok(tasks[1].startedAt <= Date.now() && tasks[1].startedAt >= before, 'a future timestamp is clamped to receipt');
  assert.equal(tasks[0].signal.aborted, true, 'the superseded action released its task');
  tasks[1].controller.abort(new DOMException('deadline', 'AbortError'));
  await tick();
  assert.equal(c.sender.listenerCount('destroyed'), 0, 'an expired action detaches its listeners');
});

test('S42-03 Stop context: previous suggestions are profile_history; denied means they never egress, allowed means they are declared', async () => {
  for (const denied of [true, false]) {
    const c = chain();
    if (denied) c.policy.current = { profile_history: false };
    c.intelligence.addAssistantMessage('PRIOR SUGGESTION about hashing');
    c.interviewer.emit('transcript', { segmentId: 'i1', text: 'Interviewer asks about hash table collisions', isFinal: true });
    await new Promise(resolve => setTimeout(resolve, 2));
    const dictationId = crypto.randomUUID();
    await c.invoke('dictation:begin', { dictationId, clickedAt: Date.now() });
    await new Promise(resolve => setTimeout(resolve, 2));
    c.user.emit('transcript', { segmentId: 'q', text: 'how would you resize it', isFinal: true });
    await new Promise(resolve => setTimeout(resolve, 2));
    const ref = await c.begin('answer', { dictationId });
    c.releaseSeals();
    const frozen = await c.invoke('speech-action:freeze', ref);
    await c.invoke('gemini-chat-stream', frozen.question, undefined, 'PROMPT', { skipSystemPrompt: true, speechActionId: ref.speechActionId });
    assert.equal(c.sent.length, 1, denied ? 'the permitted transcript still works' : 'allowed history is sent');
    const request = JSON.stringify(c.sent[0]);
    assert.match(request, /Interviewer asks about hash table collisions/);
    if (denied) assert.doesNotMatch(request, /PRIOR SUGGESTION/);
    else assert.match(request, /PRIOR SUGGESTION/);
  }
});

test('S42-03 registry: a failed collection releases its task, and dictation marks follow their sender', async () => {
  const { SpeechActions } = dist('ipc/speechActions');
  const { GenerationTask } = dist('llm/generateTask');
  const tasks = [];
  let failCollect = true;
  const marks = [];
  const actions = new SpeechActions({
    beginTask: startedAt => { const task = new GenerationTask({ target: { model: 'synthetic' } }, undefined, undefined, 'interview', undefined, startedAt); tasks.push(task); return task; },
    collect: () => { if (failCollect) throw Object.assign(new Error('Dictation is too long to collect completely'), { name: 'DictationOverflowError' });
      return { cutoffAt: 0, setStage1End() {}, frozen: Promise.resolve({}) }; },
    markDictation: at => { marks.push(at); return { sessionId: 'meeting', at }; },
    captureBase: cutoffAt => ({ cutoffAt, items: [], responses: [], coding: { question: null, source: null } }),
  });
  const owner = new Sender(1);
  const id = crypto.randomUUID();
  actions.begin(owner, { clientActionId: id, kind: 'clarify', clickedAt: Date.now() });
  assert.equal(tasks[0].signal.aborted, true, 'the started task is aborted and closed at once');
  assert.throws(() => actions.take(owner, { speechActionId: id }, 'clarify'), { name: 'DictationOverflowError' });
  assert.equal(actions.size, 0);
  assert.equal(owner.listenerCount('destroyed'), 0);
  failCollect = false;
  // A sender's own cancels keep its dictation mark, so Stop still works after a typed question.
  const dictationId = crypto.randomUUID();
  actions.beginDictation(owner, { dictationId, clickedAt: Date.now() });
  actions.cancel(owner);
  assert.equal(actions.dictationCount, 1);
  const stop = crypto.randomUUID();
  actions.begin(owner, { clientActionId: stop, kind: 'answer', clickedAt: Date.now(), dictationId });
  assert.equal(actions.dictationCount, 0, 'Stop consumes the mark');
  assert.throws(() => actions.begin(owner, { clientActionId: crypto.randomUUID(), kind: 'answer', clickedAt: Date.now(), dictationId }), { name: 'SpeechActionError' }, 'a mark is used once');
  // A replaced mark and a destroyed sender release their listeners.
  actions.beginDictation(owner, { dictationId: crypto.randomUUID(), clickedAt: Date.now() });
  actions.beginDictation(owner, { dictationId: crypto.randomUUID(), clickedAt: Date.now() });
  assert.equal(actions.dictationCount, 1);
  owner.emit('destroyed');
  assert.equal(actions.dictationCount, 0);
  assert.equal(actions.size, 0);
  assert.equal(owner.listenerCount('destroyed'), 0);
  assert.throws(() => actions.beginDictation(owner, { dictationId: 'not-a-uuid', clickedAt: Date.now() }), { name: 'SpeechActionError' });
  for (const task of tasks) task.close();
});
