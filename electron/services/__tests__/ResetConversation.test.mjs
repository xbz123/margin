// The conversation reset (IPC 'reset-intelligence'; Ctrl+R itself only cancels an answer being
// generated) during a meeting clears the AI
// conversation but never the meeting record: the usage rows, transcript and start time logged
// before the reset are what the meeting save uses, and a refine right after the reset has no
// prior answer to refine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
const { SessionTracker } = require('../../../dist-electron/electron/SessionTracker.js');
const { IntelligenceManager } = require('../../../dist-electron/electron/IntelligenceManager.js');
const { IntelligenceEngine } = require('../../../dist-electron/electron/IntelligenceEngine.js');
// LLMHelper reads electron's app at load; stub it only for that require (as generationInterfaces does).
const builtHelper = path.join(REPO, 'dist-electron/electron/LLMHelper.js');
const electronId = require.resolve('electron', { paths: [path.dirname(builtHelper)] });
const previousElectron = require.cache[electronId];
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => os.tmpdir(), isPackaged: true, getVersion: () => '0.0.0' } } };
let LLMHelper;
try { ({ LLMHelper } = require(builtHelper)); } finally { if (previousElectron) require.cache[electronId] = previousElectron; else delete require.cache[electronId]; }

const final = (speaker, text, timestamp) => ({ speaker, text, timestamp, final: true });
const interim = (speaker, text, timestamp) => ({ speaker, text, timestamp, final: false });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const packet = (text, finishReason = 'STOP') => ({ text, candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] });

/** A real LLMHelper whose Gemini transport streams what `stream()` yields. */
function streamingHelper(stream) {
  const client = { models: {
    generateContent: async () => { throw Error('unexpected non-streaming send'); },
    generateContentStream: async () => stream(),
  }, caches: { create: async () => ({ name: 'cachedContents/explicit' }) } };
  return Object.assign(Object.create(LLMHelper.prototype), {
    client, selectedTarget: { provider: 'gemini', protocol: 'gemini', model: 'gemini-3.1-flash-lite' },
    currentModelId: 'gemini-3.1-flash-lite', geminiModel: 'gemini-3.1-flash-lite',
    generationPolicy: { interviewFirstTokenSeconds: 10, interviewTotalSeconds: 60, writtenTotalSeconds: 180 },
    customNotes: '', aiResponseLanguage: 'auto',
    rateLimiters: { gemini: { acquire: async () => {} } }, getProviderScopePolicy: () => ({}),
    injectLanguageInstruction: value => value, processResponse: value => value, logScopeFallback: () => {},
    geminiPromptCache: { getOrCreate: async () => null, invalidate() {} },
  });
}

/** The real MeetingPersistence, with its database recording each save into `saves`. */
function meetingPersistence(saves) {
  const module = { exports: {} };
  const modules = {
    crypto: require('node:crypto'),
    electron: { BrowserWindow: { getAllWindows: () => [] } },
    './db/DatabaseManager': { DatabaseManager: { getInstance: () => ({ saveMeeting: (...args) => saves.push(args) }) } },
    './services/SettingsManager': { SettingsManager: { getInstance: () => ({ get: () => 'forever' }) } },
  };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(REPO, 'electron/MeetingPersistence.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Date, JSON, Number, console: { log() {}, error() {}, warn() {} },
    require(id) { if (Object.hasOwn(modules, id)) return modules[id]; throw Error(`unexpected require ${id}`); },
  });
  return module.exports.MeetingPersistence;
}

/** A meeting in progress: transcript, an answer, usage rows and a coding question, then Reset. */
function meetingWithReset() {
  const session = new SessionTracker();
  const startedAt = Date.now() - 5 * 60_000;
  session.sessionStartTime = startedAt;
  const now = Date.now();
  session.addTranscript(final('interviewer', 'How would you reverse a linked list?', now - 4000));
  session.addTranscript(final('user', 'Let me think about it.', now - 3000));
  session.addAssistantMessage('Iterate with prev/curr pointers.');
  session.logUsage('assist', 'What to Answer', 'Iterate with prev/curr pointers.');
  session.logUsage('chat', 'typed question', 'typed answer');
  session.setCodingQuestion('Reverse a linked list', 'transcript');
  session.setMeetingMetadata({ title: 'Synthetic interview' });

  let engineResets = 0;
  const manager = Object.assign(Object.create(IntelligenceManager.prototype), { session, engine: { reset() { engineResets++; } } });
  manager.resetConversation();
  return { session, startedAt, engineResets: () => engineResets };
}

test('in-meeting Reset keeps the meeting record and transcript context', () => {
  const { session, startedAt, engineResets } = meetingWithReset();
  assert.equal(engineResets(), 1, 'in-flight generation is cancelled');
  assert.equal(session.getSessionStartTime(), startedAt);
  assert.deepEqual(session.getFullUsage().map(row => row.question), ['What to Answer', 'typed question']);
  assert.deepEqual(session.getFullTranscript().map(row => row.text),
    ['How would you reverse a linked list?', 'Let me think about it.', 'Iterate with prev/curr pointers.']);
  assert.deepEqual(session.getMeetingMetadata(), { title: 'Synthetic interview' });
  // The next "what to answer" still sees the live question.
  assert.deepEqual(session.getContext(Number.MAX_SAFE_INTEGER).map(item => item.role), ['interviewer', 'user']);
  assert.equal(session.getLastInterviewerTurn(), 'How would you reverse a linked list?');
});

test('in-meeting Reset clears the AI conversation', () => {
  const { session } = meetingWithReset();
  assert.equal(session.getLastAssistantMessage(), null);
  assert.deepEqual(session.getAssistantResponseHistory(), []);
  assert.deepEqual(session.getDetectedCodingQuestion(), { question: null, source: null });
  assert.ok(!session.getContext(Number.MAX_SAFE_INTEGER).some(item => item.role === 'assistant'));
  const view = session.frozenView({ cutoffAt: Date.now(), channels: { user: { segments: [] }, interviewer: { segments: [] } } });
  assert.equal(view.getLastAssistantMessage(), null);
  assert.deepEqual(view.getAssistantResponseHistory(), []);
});

test('a follow-up right after Reset has no prior answer to refine', async () => {
  const { session } = meetingWithReset();
  let followUps = 0;
  const engine = Object.assign(Object.create(IntelligenceEngine.prototype), { session, runFollowUp: () => { followUps++; } });
  engine.handleTranscript(final('user', 'Make it shorter', Date.now()));
  assert.equal(followUps, 0, 'spoken refine is not triggered against the cleared answer');
  const asked = [];
  const result = await IntelligenceEngine.prototype.runFollowUpInner.call(
    { rememberQuestion: (...args) => asked.push(args), setMode() { throw new Error('must not start a refine'); } },
    'shorten', 'Make it shorter', session);
  assert.equal(result, null);
  assert.equal(asked.length, 1);
});

test('the meeting saved after an in-meeting Reset has every usage row and the full duration', async () => {
  const { session, startedAt } = meetingWithReset();
  session.logUsage('assist', 'after reset', 'new answer');
  const saves = [];
  const saved = await new (meetingPersistence(saves))(session).stopMeeting();
  assert.equal(saved.status, 'saved');
  assert.equal(saves.length, 1);
  const [meeting, startTime, durationMs] = saves[0];
  assert.equal(startTime, startedAt);
  assert.ok(durationMs >= 5 * 60_000, `duration covers the whole meeting (${durationMs} ms)`);
  assert.match(meeting.duration, /^5:/);
  assert.equal(meeting.title, 'Synthetic interview');
  assert.deepEqual(Array.from(meeting.usage, row => row.question), ['What to Answer', 'typed question', 'after reset']);
  assert.equal(meeting.transcript.length, 3);
  // The stop itself still does the full reset for the next meeting.
  assert.equal(session.getFullUsage().length, 0);
});

test('Reset mid-stream cancels first, then clears the partial answer the cancel recorded', async () => {
  const streamed = deferred(), late = deferred();
  const llm = streamingHelper(() => (async function* () { yield packet('partial answer', null); streamed.resolve(); await late.promise; yield packet('late'); })());
  const session = new SessionTracker();
  session.addTranscript(final('interviewer', 'How would you reverse a linked list?', Date.now()));
  const engine = new IntelligenceEngine(llm, session); engine.on('error', () => {});
  const manager = Object.assign(Object.create(IntelligenceManager.prototype), { session, engine });
  const pending = engine.runWhatShouldISay('QUESTION', 0.8, undefined, { skipCooldown: true });
  await streamed.promise;
  assert.equal(engine.activeGenerationTask.displayedText, 'partial answer', 'some text was already displayed');

  manager.resetConversation();
  await assert.rejects(pending, { name: 'AbortError' }); late.resolve();

  // The abort records the partial answer; Reset must clear it, not leave it to be refined.
  assert.equal(session.getLastAssistantMessage(), null);
  assert.deepEqual(session.getAssistantResponseHistory(), []);
  assert.ok(!session.getContext(Number.MAX_SAFE_INTEGER).some(item => item.role === 'assistant'));
  // The cancelled usage row stays in the meeting record.
  const usage = session.getFullUsage().at(-1);
  assert.equal(session.getFullUsage().length, 1);
  assert.equal(usage.status, 'cancelled'); assert.equal(usage.partial, true); assert.equal(usage.answer, 'partial answer');
  assert.equal(session.getFullTranscript().at(-1).generation.requestId, usage.requestId);
});

test('Reset keeps interim interviewer speech and the recent interviewer turns', async () => {
  // Interim speech survives Reset, reaches the next answer's context and is flushed into the saved meeting.
  const session = new SessionTracker();
  session.sessionStartTime = Date.now() - 60_000;
  const now = Date.now();
  session.handleTranscript(final('interviewer', 'Here is the next one.', now - 3000));
  session.addAssistantMessage('An earlier answer.');
  session.handleTranscript(interim('interviewer', 'Now tell me how you would', now));
  const manager = Object.assign(Object.create(IntelligenceManager.prototype), { session, engine: { reset() {} } });
  manager.resetConversation();
  assert.equal(session.getLastAssistantMessage(), null);
  assert.equal(session.getLastInterimInterviewer()?.text, 'Now tell me how you would');
  assert.equal(session.getContextWithInterim(Number.MAX_SAFE_INTEGER).at(-1).text, 'Now tell me how you would');
  const saves = [];
  const saved = await new (meetingPersistence(saves))(session).stopMeeting();
  assert.equal(saved.status, 'saved');
  assert.deepEqual(Array.from(saves[0][0].transcript, row => row.text),
    ['Here is the next one.', 'An earlier answer.', 'Now tell me how you would']);

  // A coding question spoken across Reset is still detected from the recent interviewer turns.
  const spoken = new SessionTracker();
  spoken.handleTranscript(final('interviewer', 'Given an array of integers and a target value,', Date.now() - 2000));
  Object.assign(Object.create(IntelligenceManager.prototype), { session: spoken, engine: { reset() {} } }).resetConversation();
  spoken.handleTranscript(final('interviewer', 'return indices of two numbers adding up.', Date.now()));
  assert.deepEqual(spoken.getDetectedCodingQuestion(), {
    question: 'Given an array of integers and a target value, return indices of two numbers adding up.', source: 'transcript',
  });
});
