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
    selectedTarget: { provider: 'openai', protocol: 'chat-completions', model: 'gpt-4o', imageSupportConfirmedFor: JSON.stringify(['openai', 'chat-completions', 'https://api.openai.com/v1', 'gpt-4o']) },
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
  const handlers = new Map(), listeners = new Map();
  const electron = { app: { getPath: () => root }, BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] }, dialog: {},
    ipcMain: { removeHandler() {}, handle: (name, callback) => handlers.set(name, callback), removeAllListeners() {}, on: (name, callback) => listeners.set(name, callback) } };
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
  const state = { processingHelper: { getLLMHelper: () => helper }, getIntelligenceManager: () => intelligence,
    getMainWindow: () => null,
    getScreenshotQueue: () => [], collectSpeech: options => meeting.collect(options), markDictation: at => meeting.markDictation(at),
    endMeeting: async () => {}, deleteScreenshot: async () => ({ success: true }) };
  module.exports.initializeIpcHandlers(state);
  const sender = new Sender(7);
  const invoke = (channel, ...args) => handlers.get(channel)({ sender }, ...args);
  const begin = async (kind, extra = {}, owner = sender) => {
    const { speechActionId } = await handlers.get('speech-action:begin')({ sender: owner }, { clientActionId: crypto.randomUUID(), kind, clickedAt: Date.now(), ...extra });
    return { speechActionId, stage1EndAt: Date.now() };
  };
  const releaseSeals = () => { for (const resolve of seals.splice(0)) resolve('no-pending'); };
  return { sent, intelligence, user, interviewer, handlers, listeners, sender, invoke, begin, releaseSeals, helper, policy, state };
}

async function failTyped(c, images) {
  c.helper.openaiClient.chat.completions.create = async body => {
    c.sent.push(body);
    return (async function* () { yield { choices: [{ delta: { content: 'FIRST PARTIAL' } }] }; throw new Error('synthetic request failure'); })();
  };
  await c.invoke('gemini-chat-stream', 'ORIGINAL question', images, 'ORIGINAL context');
  const event = c.sender.sent.findLast(([name]) => name === 'gemini-stream-error');
  assert.ok(event?.[3]?.retryable, `a prepared failed request is retryable: ${event?.[1]}`);
  return event[3];
}

test('S42-04 real retry sends the exact original input with a new model/client/task, not live context or partial output', async () => {
  const c = chain();
  const file = path.join(root, 'retry-image.png'); fs.writeFileSync(file, 'synthetic image fixture');
  let decodes = 0;
  c.helper.processImage = async () => { decodes++; return { mimeType: 'image/jpeg', data: 'T1JJR0lOQUw=' }; };
  const failure = await failTyped(c, [file]);
  const original = structuredClone(c.sent[0]);
  fs.unlinkSync(file); // Automatic queue eviction does not revoke an already-owned image.
  c.intelligence.addAssistantMessage('LATER assistant context');
  c.interviewer.emit('transcript', { segmentId: 'new', text: 'LATER conversation unrelated to the original', isFinal: true });
  let newClientCalls = 0;
  c.helper.selectedTarget = { provider: 'openai', protocol: 'chat-completions', model: 'gpt-4o-mini', imageSupportConfirmedFor: JSON.stringify(['openai', 'chat-completions', 'https://api.openai.com/v1', 'gpt-4o-mini']) };
  c.helper.openaiClient = { chat: { completions: { create: async body => {
    newClientCalls++; c.sent.push(body);
    return [{ choices: [{ delta: { content: 'RETRY ANSWER' }, finish_reason: 'stop' }] }];
  } } } };
  const result = await c.invoke('generation:retry', failure.requestId, Date.now());
  assert.equal(result.answer, 'RETRY ANSWER', result.error); assert.equal(result.retryable, false);
  assert.equal(newClientCalls, 1); assert.equal(decodes, 1);
  assert.equal(c.sent[1].model, 'gpt-4o-mini');
  assert.deepEqual(c.sent[1].messages, original.messages);
  assert.doesNotMatch(JSON.stringify(c.sent[1]), /FIRST PARTIAL|LATER/);
  assert.notEqual(result.requestId, failure.requestId);
  assert.equal(result.questionId, failure.questionId); assert.equal(result.retryOf, failure.requestId);
  await assert.rejects(() => c.invoke('generation:retry', result.requestId, Date.now()), /no longer available/);
});

test('S42-04 a replaced failure, new question, wrong owner, and destroyed owner cannot replay old input', async () => {
  const c = chain(); const failure = await failTyped(c);
  await assert.rejects(() => c.handlers.get('generation:retry')({ sender: new Sender(8) }, failure.requestId, Date.now()), /no longer available/);
  const again = await c.invoke('generation:retry', failure.requestId, Date.now());
  assert.equal(again.retryable, true); assert.notEqual(again.requestId, failure.requestId);
  assert.equal(again.questionId, failure.questionId);
  await assert.rejects(() => c.invoke('generation:retry', failure.requestId, Date.now()), /no longer available/);
  await c.begin('clarify');
  await assert.rejects(() => c.invoke('generation:retry', again.requestId, Date.now()), /no longer available/);
  await c.invoke('cancel-intelligence-generation');
  const current = await failTyped(c);
  c.sender.emit('destroyed');
  await assert.rejects(() => c.invoke('generation:retry', current.requestId, Date.now()), /no longer available/);
});

for (const successor of ['dictation', 'speech']) test(`F1 starting ${successor} cancels an old queued retry without cancelling the successor`, async () => {
  const c = chain(), image = path.join(root, `superseded-${successor}.png`);
  fs.writeFileSync(image, 'synthetic image');
  c.helper.processImage = async () => ({ mimeType: 'image/jpeg', data: 'V0lUSERSQVdO' });
  const failure = await failTyped(c, [image]);
  let release;
  c.helper.rateLimiters = { openai: { acquire: () => new Promise(resolve => { release = resolve; }) } };
  c.helper.openaiClient.chat.completions.create = async body => { c.sent.push(body); return [{ choices: [{ delta: { content: 'NEW ANSWER' }, finish_reason: 'stop' }] }]; };
  const retry = c.invoke('generation:retry', failure.requestId, Date.now());
  await tick(); assert.equal(typeof release, 'function');
  let next;
  if (successor === 'dictation') {
    const dictationId = crypto.randomUUID();
    await c.invoke('dictation:begin', { dictationId, clickedAt: Date.now() - 1 });
    c.user.emit('transcript', { segmentId: 'next', text: 'The new dictated question', isFinal: true });
    next = await c.begin('answer', { dictationId });
  } else next = await c.begin('clarify');
  await c.invoke('delete-screenshot', image);
  release();
  assert.equal((await retry).status, 'cancelled');
  assert.equal(c.sent.length, 1, 'the cancelled retry must not send an image');
  c.helper.rateLimiters = undefined;
  c.releaseSeals();
  if (successor === 'dictation') {
    const frozen = await c.invoke('speech-action:freeze', next);
    assert.equal(frozen.question, 'The new dictated question', 'old cleanup left new dictation intact');
  } else {
    const result = await c.invoke('generate-clarify', next);
    assert.equal(result.clarification, 'NEW ANSWER', 'old cleanup left the successor task intact');
  }
  await c.invoke('cancel-intelligence-generation');
  fs.rmSync(image, { force: true });
});

for (const newInput of ['invalid image', 'dictation']) test(`S42-04 starting ${newInput} releases the prior failure before later preparation`, async () => {
  const c = chain(); const failure = await failTyped(c);
  if (newInput === 'invalid image') await assert.rejects(() => c.invoke('gemini-chat-stream', 'new question', ['/missing-image.png']), /Invalid image path/);
  else await c.invoke('dictation:begin', { dictationId: crypto.randomUUID(), clickedAt: Date.now() });
  await assert.rejects(() => c.invoke('generation:retry', failure.requestId, Date.now()), /no longer available/);
});

for (const revoke of ['image', 'context', 'skill']) test(`S42-04 explicit ${revoke} withdrawal prevents replay`, async () => {
  const c = chain();
  const imageFile = path.join(root, 'withdraw-image.png'); fs.writeFileSync(imageFile, 'synthetic fixture');
  const contextFile = path.join(root, 'local-context.json');
  const promptFile = path.join(root, 'prompt-settings.json');
  const entries = [{ id: 'original', name: 'source.txt', content: 'LOCAL ORIGINAL' }];
  const prompt = { skills: [], scenes: { interview: { skillId: null, additional: '' }, written: { skillId: null, additional: 'ORIGINAL SKILL TEXT' } } };
  fs.writeFileSync(contextFile, JSON.stringify(entries)); fs.writeFileSync(promptFile, JSON.stringify(prompt));
  c.helper.processImage = async () => ({ mimeType: 'image/jpeg', data: 'T1JJR0lOQUw=' });
  try {
    const failure = await failTyped(c, [imageFile]);
    assert.ok(c.sent[0], c.sender.sent.findLast(([name]) => name === 'gemini-stream-error')?.[1]);
    assert.match(JSON.stringify(c.sent[0]), /LOCAL ORIGINAL/);
    assert.match(JSON.stringify(c.sent[0]), /ORIGINAL SKILL TEXT/);
    let deletion, finishDeletion;
    if (revoke === 'image') {
      c.state.deleteScreenshot = () => new Promise(resolve => { finishDeletion = resolve; });
      deletion = c.invoke('delete-screenshot', imageFile);
    }
    if (revoke === 'context') fs.writeFileSync(contextFile, '[]');
    if (revoke === 'skill') { prompt.scenes.written.additional = 'NEW SKILL'; fs.writeFileSync(promptFile, JSON.stringify(prompt)); }
    const count = c.sent.length;
    await assert.rejects(() => c.invoke('generation:retry', failure.requestId, Date.now()), /no longer available/);
    assert.equal(c.sent.length, count);
    if (deletion) { finishDeletion({ success: true }); await deletion; }
  } finally { for (const file of [imageFile, contextFile, promptFile]) fs.rmSync(file, { force: true }); }
});

for (const phase of ['decode', 'speech wait']) test(`S42-04 attachment removal during ${phase} prevents the first send`, async () => {
  const c = chain();
  const imageFile = path.join(root, 'preparing-image.png'); fs.writeFileSync(imageFile, 'synthetic fixture');
  let finishPreparation;
  c.helper.processImage = () => new Promise(resolve => { finishPreparation = resolve; });
  try {
    let request;
    if (phase === 'speech wait') {
      c.interviewer.emit('transcript', { segmentId: 'pending-image', text: 'Explain this diagram', isFinal: false });
      const ref = await c.begin('what-to-say');
      request = c.invoke('generate-what-to-say', undefined, [imageFile], ref);
    } else request = c.invoke('gemini-chat-stream', 'Analyze original attachment', [imageFile]);
    await tick();
    assert.equal(typeof finishPreparation, phase === 'decode' ? 'function' : 'undefined');
    await c.invoke('delete-screenshot', imageFile);
    c.releaseSeals();
    finishPreparation?.({ mimeType: 'image/jpeg', data: 'V0lUSERSQVdO' });
    await request;
    assert.equal(c.sent.length, 0, 'an explicitly withdrawn attachment never reaches the provider');
  } finally { fs.rmSync(imageFile, { force: true }); }
});

test('S42-04 new Local Context is not injected into a retry; withdrawal during its queue prevents sending', async () => {
  const c = chain(), contextFile = path.join(root, 'local-context.json');
  fs.writeFileSync(contextFile, JSON.stringify([{ id: 'old', name: 'old.txt', content: 'OLD LOCAL' }]));
  try {
    const failure = await failTyped(c);
    fs.writeFileSync(contextFile, JSON.stringify([{ id: 'old', name: 'old.txt', content: 'OLD LOCAL' }, { id: 'new', name: 'new.txt', content: 'NEW LOCAL' }]));
    c.helper.rateLimiters = { openai: { acquire: async () => fs.writeFileSync(contextFile, '[]') } };
    const result = await c.invoke('generation:retry', failure.requestId, Date.now());
    assert.equal(result.answer, null); assert.equal(c.sent.length, 1);
    assert.equal(result.retryable, false, 'withdrawn original content is not retained');
  } finally { fs.rmSync(contextFile, { force: true }); }
});

test('S42-04 oversized input fails before the first send and cannot fabricate a retry snapshot', async () => {
  const c = chain();
  await c.invoke('gemini-chat-stream', 'x'.repeat(34 * 1024 * 1024));
  assert.equal(c.sent.length, 0);
  const failure = c.sender.sent.findLast(([name]) => name === 'gemini-stream-error');
  assert.match(failure[1], /64 MiB/); assert.equal(failure[3].retryable, false);
});

test('S42-04 the real handler waits after quick EOF for a valid first-visible receipt, not a wrong owner or old ID', async () => {
  const c = chain(); await c.invoke('generation:presentation-ready');
  let done = false;
  const request = c.invoke('gemini-chat-stream', 'short question', undefined, undefined, { generationKind: 'interview' }).then(() => { done = true; });
  await tick();
  const token = c.sender.sent.find(([name]) => name === 'gemini-stream-token');
  assert.ok(token); assert.equal(done, false); assert.equal(c.sender.sent.some(([name]) => name === 'gemini-stream-done'), false);
  const metadata = token[3], acknowledge = c.listeners.get('generation:first-visible');
  acknowledge({ sender: new Sender(8) }, metadata.requestId);
  acknowledge({ sender: c.sender }, 'old-request');
  await tick(); assert.equal(done, false);
  acknowledge({ sender: c.sender }, metadata.requestId);
  await request;
  const complete = c.sender.sent.find(([name]) => name === 'gemini-stream-done')[2];
  assert.ok(complete.timing.firstVisibleMs >= 0); assert.ok(complete.timing.modelToVisibleMs >= 0);
});

test('S42-04 a non-Natively consumer in the same window keeps its existing completion lifecycle', async () => {
  const c = chain(); await c.invoke('generation:presentation-ready');
  await c.invoke('gemini-chat-stream', 'other UI question', undefined, undefined, { owner: 'global' });
  assert.equal(c.sender.sent.filter(([name]) => name === 'gemini-stream-done').length, 1);
  await assert.rejects(() => c.invoke('gemini-chat-stream', 'forged owner', undefined, undefined, { owner: 'made-up' }), /Invalid question owner/);
  assert.equal(c.sent.length, 1);
});

for (const at of ['queue', 'automatic retry']) test(`S42-04 manual retry rechecks original scopes at ${at}`, async () => {
  const c = chain(); const failure = await failTyped(c);
  if (at === 'queue') c.helper.rateLimiters = { openai: { acquire: async () => { c.policy.current.transcript = false; } } };
  else c.helper.openaiClient.chat.completions.create = async body => {
    c.sent.push(body); c.policy.current.transcript = false;
    throw Object.assign(new Error('synthetic overload'), { status: 503 });
  };
  const result = await c.invoke('generation:retry', failure.requestId, Date.now());
  assert.equal(result.answer, null);
  assert.equal(c.sent.length, at === 'queue' ? 1 : 2, 'no sends after the permission was withdrawn');
});

test('S44 a smaller retry model receives the full original input with no local capacity refusal; provider overflow stays terminal and retryable', async () => {
  const c = chain();
  c.helper.openaiClient.chat.completions.create = async body => { c.sent.push(body); throw new Error('synthetic failure'); };
  await c.invoke('gemini-chat-stream', 'large original '.repeat(900));
  const failure = c.sender.sent.findLast(([name]) => name === 'gemini-stream-error')[3];
  assert.equal(c.sent.length, 1); assert.equal(failure.retryable, true);
  c.helper.selectedTarget = { provider: 'openai', protocol: 'chat-completions', model: 'tiny-8b' };
  c.helper.openaiClient.chat.completions.create = async body => { c.sent.push(body); throw Object.assign(new Error('synthetic overflow'), { status: 400, error: { code: 'context_length_exceeded' } }); };
  const smaller = await c.invoke('generation:retry', failure.requestId, Date.now());
  assert.equal(c.sent.length, 2, 'the smaller model was asked once, with no hidden retry');
  assert.deepEqual(c.sent[1].messages, c.sent[0].messages, 'nothing was trimmed');
  assert.equal(smaller.answer, null); assert.equal(smaller.retryable, true);
  c.helper.selectedTarget = { provider: 'openai', protocol: 'chat-completions', model: 'gpt-4o' };
  c.helper.openaiClient.chat.completions.create = async body => { c.sent.push(body); return [{ choices: [{ delta: { content: 'LARGER MODEL ANSWER' }, finish_reason: 'stop' }] }]; };
  assert.equal((await c.invoke('generation:retry', smaller.requestId, Date.now())).answer, 'LARGER MODEL ANSWER');
  assert.deepEqual(c.sent[2].messages, c.sent[0].messages);
});

test('S44 manual retry sends the original input with the reasoning setting saved since the failure', async () => {
  const c = chain();
  c.helper.openaiClient.chat.completions.create = async body => { c.sent.push(body); throw new Error('synthetic failure'); };
  await c.invoke('gemini-chat-stream', 'original question');
  const failure = c.sender.sent.findLast(([name]) => name === 'gemini-stream-error')[3];
  assert.equal(Object.hasOwn(c.sent[0], 'reasoning_effort'), false);
  c.helper.selectedTarget = { ...c.helper.selectedTarget, reasoning: { effort: 'low' } };
  c.helper.openaiClient.chat.completions.create = async body => { c.sent.push(body); return [{ choices: [{ delta: { content: 'RETRIED' }, finish_reason: 'stop' }] }]; };
  assert.equal((await c.invoke('generation:retry', failure.requestId, Date.now())).answer, 'RETRIED');
  assert.equal(c.sent[1].reasoning_effort, 'low');
  assert.deepEqual(c.sent[1].messages, c.sent[0].messages);
});

// The production global shortcut callback from main.ts, bound to the test app state.
function shortcutCallback(state) {
  const mainSource = fs.readFileSync(new URL('../../main.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true);
  let callback;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'keybindManager.onShortcutTriggered') callback = node.arguments[0].getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree); assert.ok(callback);
  const callbackCode = ts.transpileModule(`(function () { return ${callback}; }).call(state)`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(callbackCode, { state, process: { platform: 'linux' }, console: { log() {}, error() {} } });
}

test('S42-04 the production global capture callback starts the speech cut and budget before screenshot work', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });
  const c = chain(), tasks = [];
  const beginTask = c.helper.beginGenerationTask.bind(c.helper);
  c.helper.beginGenerationTask = (...args) => { const task = beginTask(...args); tasks.push(task); return task; };
  c.interviewer.emit('transcript', { segmentId: 'original', text: 'Explain hash table collisions before capture', isFinal: true });
  let releaseCapture;
  Object.assign(c.state, {
    getMainWindow: () => ({ webContents: c.sender }), showMainWindow() {},
    takeScreenshot: () => new Promise(resolve => { releaseCapture = resolve; }),
    getImagePreview: async () => 'synthetic preview',
  });
  const capture = shortcutCallback(c.state)('general:capture-and-process');
  assert.equal(tasks[0].startedAt, 100_000);
  t.mock.timers.tick(4000); await Promise.resolve();
  c.interviewer.emit('transcript', { segmentId: 'late', text: 'POST CAPTURE unrelated live speech', isFinal: true });
  releaseCapture('/synthetic.png'); await capture;
  const payload = c.sender.sent.find(([name]) => name === 'capture-and-process')[1];
  assert.equal(tasks[0].firstTokenDeadline, 110_000, 'capture did not buy a new ten seconds');
  const result = await c.invoke('generate-what-to-say', undefined, undefined, { speechActionId: payload.speechActionId, stage1EndAt: Date.now() });
  assert.equal(result.requestId, tasks[0].requestId); assert.equal(tasks.length, 1);
  assert.doesNotMatch(JSON.stringify(c.sent), /POST CAPTURE/);
});

test('S42-04 a superseded capture cannot cancel the newer action or dispatch its stale reference', async () => {
  const c = chain(), tasks = [], shots = [];
  const beginTask = c.helper.beginGenerationTask.bind(c.helper);
  c.helper.beginGenerationTask = (...args) => { const task = beginTask(...args); tasks.push(task); return task; };
  c.interviewer.emit('transcript', { segmentId: 'original', text: 'Explain hash table collisions before capture', isFinal: true });
  Object.assign(c.state, {
    getMainWindow: () => ({ webContents: c.sender }), showMainWindow() {},
    takeScreenshot: () => new Promise((resolve, reject) => shots.push({ resolve, reject })),
    getImagePreview: async () => 'synthetic preview',
  });
  const run = shortcutCallback(c.state);
  const dispatched = () => c.sender.sent.filter(([name]) => name === 'capture-and-process').map(([, payload]) => payload);

  // A late failure of the first capture leaves the second action current and takeable.
  const first = run('general:capture-and-process');
  const second = run('general:capture-and-process');
  assert.equal(tasks[0].signal.aborted, true, 'the newer capture superseded the first action');
  shots[0].reject(new Error('synthetic screenshot failure'));
  await first;
  assert.equal(tasks[1].signal.aborted, false, 'the stale failure did not cancel the newer action');
  shots[1].resolve('/synthetic-second.png'); await second;
  // A late success of a superseded capture never dispatches its reference.
  const third = run('general:capture-and-process');
  const fourth = run('general:capture-and-process');
  shots[2].resolve('/synthetic-third.png'); await third;
  assert.equal(tasks[3].signal.aborted, false);
  shots[3].resolve('/synthetic-fourth.png'); await fourth;
  assert.deepEqual(dispatched().map(payload => payload.path), ['/synthetic-second.png', '/synthetic-fourth.png']);
  c.releaseSeals();
  const result = await c.invoke('generate-what-to-say', undefined, undefined, { speechActionId: dispatched()[1].speechActionId, stage1EndAt: Date.now() });
  assert.equal(result.requestId, tasks[3].requestId);
  // A capture superseded by a typed question also dispatches nothing.
  const fifth = run('general:capture-and-process');
  await c.invoke('gemini-chat-stream', 'TYPED question supersedes capture');
  shots[4].resolve('/synthetic-fifth.png'); await fifth;
  assert.equal(dispatched().length, 2);
});

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
  test(`S42-04 ${kind}: retry consumes the same prepared request without a second speech collection`, async () => {
    const c = chain(), tasks = [];
    const begin = c.helper.beginGenerationTask.bind(c.helper);
    c.helper.beginGenerationTask = (...args) => { const task = begin(...args); tasks.push(task); return task; };
    let collections = 0;
    const collect = c.state.collectSpeech;
    c.state.collectSpeech = options => { collections++; return collect(options); };
    c.helper.openaiClient.chat.completions.create = async body => { c.sent.push(body); throw new Error('synthetic initial failure'); };
    await (await historyAction(c, kind))();
    const failure = c.helper.getTaskMetadata(tasks[0]);
    assert.equal(failure.retryable, true);
    const before = collections;
    c.helper.openaiClient.chat.completions.create = async body => { c.sent.push(body); return [{ choices: [{ delta: { content: 'Retried body' }, finish_reason: 'stop' }] }]; };
    const result = await c.invoke('generation:retry', failure.requestId, Date.now());
    assert.equal(result.answer, 'Retried body'); assert.equal(collections, before);
    assert.deepEqual(c.sent[1].messages, c.sent[0].messages);
    assert.equal(result.questionId, failure.questionId);
  });

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
