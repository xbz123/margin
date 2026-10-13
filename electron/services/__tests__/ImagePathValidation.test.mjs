import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { validateImagePath } = require('../../../dist-electron/electron/utils/imagePathValidation.js');
const { GenerationTask } = require('../../../dist-electron/electron/llm/generateTask.js');
const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../ipcHandlers.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const frozenSpeech = { sessionId: null, cutoffAt: 0, frozenAt: 0, channels: { user: { segments: [], reason: 'absent' }, interviewer: { segments: [], reason: 'absent' } } };
const owner = id => ({ id, send() {}, isDestroyed: () => false, once() {}, removeListener() {} });

function handlers(root, queue = []) {
  const callbacks = new Map(); const sends = [], resets = [];
  let task; const startedTasks = [];
  const helper = { beginGenerationTask: (kind, signal, _primary, startedAt) => { task = new GenerationTask({ target: { model: 'synthetic' } }, undefined, undefined, kind, signal, startedAt); startedTasks.push(task); return task; }, getCurrentGenerationTask: () => task,
    runGeneration: factory => factory(), getTaskMetadata: () => ({ requestId: 'request', provider: 'synthetic', model: 'synthetic', status: 'completed', attempts: sends.length }),
    withDeclaredScopes: run => run(() => {}),
    clearPreparedInput() {}, attachPresentation(task, sender) { task.rendererOwner = sender; },
    dependPreparedImages() {},
    chatWithGemini: async (...args) => { sends.push(args); return 'answer'; },
    analyzeImageFiles: async (...args) => { sends.push(args); return 'answer'; },
    runGenerationStream: factory => factory(), streamChat: async function* (...args) { sends.push(args); yield 'answer'; },
    deniedDataScopes: () => [],
    getPromptTier: () => 'standard',
  };
  const manager = { getFormattedContext: () => '', getLastAssistantMessage: () => null, addTranscript() {}, addAssistantMessage() {}, logUsage() {},
    getDetectedCodingQuestion: () => ({ question: null, source: null }), captureBase: () => ({}),
    frozenView: () => ({ frozen: true, getLastAssistantMessage: () => null, getContext: () => [] }),
    resetEngine() { resets.push('engine'); }, reset() { resets.push('session'); },
    runWhatShouldISay: async (...args) => { sends.push(args); return 'answer'; },
    runCodeHint: async (...args) => { sends.push(args); return 'hint'; },
    runBrainstorm: async (...args) => { sends.push(args); return 'script'; },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, console: { log() {}, warn() {}, error() {} }, process: { env: { NODE_ENV: 'test' }, platform: process.platform }, AbortController,
    require(id) {
      if (id === 'electron') return { app: { getPath: () => root }, ipcMain: { removeHandler() {}, handle: (name, callback) => callbacks.set(name, callback), removeAllListeners() {}, on() {} } };
      if (id === './utils/imagePathValidation') return { validateImagePath };
      if (id === './direct-assist/errors') return require('../../../dist-electron/electron/direct-assist/errors.js');
      if (id === './llm/scenarioPrompts') return require('../../../dist-electron/electron/llm/scenarioPrompts.js');
      if (id === './ipc/sttHandlers') return { registerDomesticSttHandlers() {} };
      if (id === './ipc/localContextHandlers') return { registerLocalContextHandlers() {} };
      if (id === './ipc/speechActions') return require('../../../dist-electron/electron/ipc/speechActions.js');
      if (id === './margin/appIdentity') return { APP_IDENTITY: { name: 'Synthetic' } };
      if (['fs', 'os', 'path', 'crypto'].includes(id)) return require(id);
      return {};
    },
  });
  module.exports.initializeIpcHandlers({ processingHelper: { getLLMHelper: () => helper }, getIntelligenceManager: () => manager, getScreenshotQueue: () => queue,
    collectSpeech: () => ({ cutoffAt: 0, setStage1End() {}, frozen: Promise.resolve(frozenSpeech) }), markDictation: at => ({ sessionId: null, at }) });
  // Every interview action begins at its click; the action channel then names it.
  const act = async (sender, kind) => {
    const { speechActionId } = await callbacks.get('speech-action:begin')({ sender }, { clientActionId: crypto.randomUUID(), kind, clickedAt: Date.now() });
    return { speechActionId, stage1EndAt: Date.now() };
  };
  return { callbacks, sends, startedTasks, resets, helper, manager, act };
}

test('AG42 registered manual IPC returns fixed failures even before a task can start', async () => {
  const f = handlers(os.tmpdir()); const sender = owner(42);
  const invoke = async () => f.callbacks.get('generate-what-to-say')({ sender }, undefined, undefined, await f.act(sender, 'what-to-say'));
  f.manager.runWhatShouldISay = async (_question, _confidence, _images, options) => {
    assert.equal(options.manual, true);
    assert.equal(typeof options.beforeGenerate, 'function');
    throw Error('SERVER_SECRET and full request: Data scope denied; Invalid image path');
  };
  const failed = await invoke();
  assert.equal(failed.answer, null); assert.equal(failed.error, 'Answer failed. Check the model configuration and try again.');
  assert.doesNotMatch(JSON.stringify(failed), /SERVER_SECRET|full request/);
  const { ProviderScopeError } = require('../../../dist-electron/electron/llm/ProviderRouter.js');
  f.manager.runWhatShouldISay = async () => { throw new ProviderScopeError('SERVER_SECRET', ['transcript']); };
  const denied = await invoke();
  assert.equal(denied.error, 'Data scope denied. Check Data Scopes in Settings.');
  assert.doesNotMatch(JSON.stringify(denied), /SERVER_SECRET/);
  f.manager.runWhatShouldISay = async () => { f.helper.getCurrentGenerationTask().terminalStatus = 'cancelled'; throw Error('PRIVATE_ABORT'); };
  assert.equal((await invoke()).error, 'Cancelled');
  f.helper.beginGenerationTask = () => { throw Error('invalid selection with SECRET'); };
  assert.equal((await invoke()).error, 'Configure an answer model and its credentials first.');
  assert.equal(f.sends.length, 0);
});

for (const channel of ['generate-code-hint', 'generate-brainstorm']) test(`R3-2 ${channel} validates selected queue once before generation and uses canonical symlinks`, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-queue-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'userData'); fs.mkdirSync(root);
  const outside = path.join(temp, 'outside.png'); fs.writeFileSync(outside, 'synthetic');
  const escape = path.join(root, 'escape.png'); fs.symlinkSync(outside, escape);
  const image = path.join(root, 'image.png'); fs.writeFileSync(image, Buffer.from('iVBORw0KGgo=', 'base64'));
  const alias = path.join(root, 'alias.png'); fs.symlinkSync(image, alias);
  const sender = owner(1);
  for (const payload of [undefined, []]) for (const queue of [[escape], Array(6).fill(image)]) {
    const { callbacks, sends, act } = handlers(root, queue);
    const ref = await act(sender, channel.slice(9));
    await assert.rejects(() => callbacks.get(channel)({ sender }, payload, undefined, ref), /Invalid image path/);
    assert.deepEqual(sends, []);
  }
  for (const payload of [null, '', { length: 0 }, [null], ['']]) {
    const { callbacks, sends, act } = handlers(root, [image]);
    const ref = await act(sender, channel.slice(9));
    await assert.rejects(() => callbacks.get(channel)({ sender }, payload, undefined, ref), /Invalid image path/);
    assert.deepEqual(sends, []);
  }
  for (const payload of [undefined, [], [alias]]) {
    const { callbacks, sends, act } = handlers(root, payload?.length ? [escape] : [alias]);
    await callbacks.get(channel)({ sender }, payload, undefined, await act(sender, channel.slice(9)));
    assert.deepEqual(Array.from(sends[0][0]), [fs.realpathSync(image)]);
  }
});

test('R3-2 what-to-say canonicalizes explicit images and never selects the screenshot queue', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-explicit-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const image = path.join(root, 'image.png'); fs.writeFileSync(image, Buffer.from('iVBORw0KGgo=', 'base64'));
  const alias = path.join(root, 'alias.png'); fs.symlinkSync(image, alias);
  const { callbacks, sends, act } = handlers(root, [alias]);
  const event = { sender: owner(1) };
  for (const payload of [undefined, []]) { await callbacks.get('generate-what-to-say')(event, 'QUESTION', payload, await act(event.sender, 'what-to-say')); assert.equal(sends.at(-1)[2], undefined); }
  await callbacks.get('generate-what-to-say')(event, 'QUESTION', [alias], await act(event.sender, 'what-to-say'));
  assert.deepEqual(Array.from(sends.at(-1)[2]), [fs.realpathSync(image)]);
});

test('AG33 actual registered cancellation uses engine-only reset and keeps explicit reset semantics distinct', async () => {
  const { callbacks, resets } = handlers(os.tmpdir());
  await callbacks.get('cancel-intelligence-generation')({ sender: {} }); assert.deepEqual(resets, ['engine']);
  await callbacks.get('reset-intelligence')({ sender: {} }); assert.deepEqual(resets, ['engine', 'session']);
});

test('AG33 actual registered chat handler fixes written/interview task budgets and refuses unknown modes', async () => {
  const { callbacks, startedTasks, sends } = handlers(os.tmpdir());
  const invoke = options => callbacks.get('gemini-chat-stream')({ sender: { id: 1, send() {}, isDestroyed: () => false } }, 'QUESTION', undefined, undefined, options);
  await invoke({ generationKind: 'written' });
  assert.equal(startedTasks[0].totalDeadline - startedTasks[0].startedAt, 180_000); assert.equal(startedTasks[0].firstTokenDeadline, undefined);
  await invoke({ generationKind: 'interview' });
  assert.equal(startedTasks[1].totalDeadline - startedTasks[1].startedAt, 60_000); assert.equal(startedTasks[1].firstTokenDeadline - startedTasks[1].startedAt, 10_000);
  await assert.rejects(() => invoke({ generationKind: 'unknown' }), /Invalid question mode/);
  await invoke(undefined);
  assert.equal(startedTasks[2].totalDeadline - startedTasks[2].startedAt, 180_000);
  assert.equal(startedTasks[2].firstTokenDeadline, undefined);
  assert.equal(startedTasks.length, 3); assert.equal(sends.length, 3);
});

for (const channel of ['gemini-chat', 'gemini-chat-stream', 'generate-what-to-say', 'generate-code-hint', 'generate-brainstorm', 'analyze-image-file']) test(`AG33 real registered ${channel} rejects malformed, traversal, missing, sensitive and symlink-escape images before generation`, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag33-image-handler-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'userData'); fs.mkdirSync(root);
  const outside = path.join(temp, 'outside.png'); fs.writeFileSync(outside, 'synthetic private data');
  const escape = path.join(root, 'escape.png'); fs.symlinkSync(outside, escape);
  const { callbacks, sends, act } = handlers(root); const callback = callbacks.get(channel);
  const sender = owner(1);
  const invoke = async images => channel === 'analyze-image-file' ? callback({ sender }, Array.isArray(images) && images.length === 1 ? images[0] : images) : channel.startsWith('gemini-') ? callback({ sender }, 'QUESTION', images) : channel === 'generate-what-to-say' ? callback({ sender }, 'QUESTION', images, await act(sender, 'what-to-say')) : callback({ sender }, images, 'QUESTION', await act(sender, channel.slice(9)));
  for (const images of [{ length: 1 }, [null], [''], Array(6).fill(escape), [path.join(root, '../outside.png')], ['/etc/passwd'], ['C:\\Windows\\secret.png'], [path.join(root, 'missing.png')], [escape]]) {
    const outcome = await invoke(images).then(result => ({ result }), error => ({ error }));
    if (outcome.error) assert.match(outcome.error.message, /Invalid image path/);
    else {
      assert.equal(outcome.result.answer ?? outcome.result.hint ?? outcome.result.script ?? null, null);
      assert.match(outcome.result.error, /Invalid image path/);
    }
    assert.equal(sends.length, 0);
  }
  const image = path.join(root, 'legitimate.png'); fs.writeFileSync(image, Buffer.from('iVBORw0KGgo=', 'base64'));
  await invoke([image]); assert.equal(sends.length, 1, 'an owned screenshot reaches the selected generation entry');
});
