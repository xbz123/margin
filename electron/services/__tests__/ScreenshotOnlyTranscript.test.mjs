// A screenshot sent with nothing typed (item 6). The model gets the default English instruction,
// but the user never said or typed it, so it is not a transcript line: not in the saved meeting's
// transcript rows, its copied text or the PDF transcript. The AI usage history keeps the Chinese
// text the window showed, the answer, and the question id / retryOf of a Retry.
//
// Real chain: the registered gemini-chat-stream and generation:retry handlers (ipcHandlers.ts
// compiled from source) -> IntelligenceManager -> LLMHelper (dist), with a mocked provider client
// and a stubbed image decode. The meeting is saved by MeetingPersistence through DatabaseManager
// (both from source) into a real SQLite file (node:sqlite behind a better-sqlite3 adapter, as in
// RetryHistoryPersistence.test.mjs), read back by a second DatabaseManager, and rendered through
// meetingTranscriptView.mjs and pdfGenerator.ts (Noto Sans SC export font, real jsPDF).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';
import { visibleTranscriptRows, formatTranscriptTime, formatTranscriptCopy } from '../../../src/lib/meetingTranscriptView.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-screenshot-only-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const SCREENSHOT_QUESTION = 'Solve the question in this screenshot directly';
const SHOWN = '直接解答截图中的题目';
const AUTO_LINE = /Solve the question in this screenshot directly|直接解答截图中的题目/;

const compile = file => ts.transpileModule(fs.readFileSync(path.join(REPO, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
}).outputText;
function run(file, modules, extra = {}) {
  const module = { exports: {} };
  vm.runInNewContext(compile(file), {
    module, exports: module.exports, Date, JSON, console: { log() {}, error() {}, warn() {} }, ...extra,
    require(id) { if (Object.hasOwn(modules, id)) return modules[id]; throw Error(`unexpected require ${id}`); },
  });
  return module.exports;
}
const zh = run('src/i18n.zh.ts', {}).chinese;
const translate = key => zh[key] ?? key;

// --- The registered IPC handlers on the real main-process chain ------------------------------
const dist = file => require(`../../../dist-electron/electron/${file}.js`);
const ipcSource = compile('electron/ipcHandlers.ts');
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
    modules = { ...dist('LLMHelper'), ...dist('IntelligenceManager'), ...dist('audio/MeetingSttSession'), ...dist('services/SkillsManager'), ...dist('services/SettingsManager') };
  } finally { if (previous) require.cache[electronId] = previous; else delete require.cache[electronId]; }
  const sent = [];
  const answer = { text: 'MOCK ANSWER' };
  const helper = Object.assign(Object.create(modules.LLMHelper.prototype), {
    selectedTarget: { provider: 'openai', protocol: 'chat-completions', model: 'gpt-5.4' },
    currentModelId: 'gpt-5.4', aiResponseLanguage: 'auto', customNotes: '',
    getProviderScopePolicy: () => ({}),
    // The screenshot file is a synthetic fixture; decoding is stubbed.
    processImage: async () => ({ mimeType: 'image/png', data: 'U1lOVEhFVElD' }),
    openaiClient: { chat: { completions: { create: async body => {
      sent.push(body);
      return [{ choices: [{ delta: { content: answer.text }, finish_reason: 'stop' }] }];
    } } } },
  });
  const intelligence = new modules.IntelligenceManager(helper);
  intelligence.on('error', () => {});
  // Voice lines arrive as in a meeting: STT events -> MeetingSttSession -> handleTranscript.
  const meeting = new modules.MeetingSttSession({
    create: channel => Object.assign(new EventEmitter(), { channel, write() {}, stop() {}, finalize() {}, seal() { return { scopes: [], done: Promise.resolve('no-pending') }; } }),
    onTranscript: event => intelligence.handleTranscript({ speaker: event.channel, text: event.text, timestamp: event.timestamp, final: event.final, segmentId: event.segmentId }),
  });
  meeting.begin('meeting-1');
  const user = meeting.ensure('user'), interviewer = meeting.ensure('interviewer');
  const handlers = new Map();
  const electron = { app: { getPath: () => root }, BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] }, dialog: {},
    ipcMain: { removeHandler() {}, handle: (name, callback) => handlers.set(name, callback), removeAllListeners() {}, on() {} } };
  const module = { exports: {} };
  vm.runInNewContext(ipcSource, { module, exports: module.exports, console: { log() {}, warn() {}, error() {} },
    process: { env: {}, platform: process.platform }, AbortController,
    require(id) {
      if (id === 'electron') return electron;
      if (id === './services/SkillsManager') return { SkillsManager: modules.SkillsManager };
      if (id === './services/SettingsManager') return { SettingsManager: modules.SettingsManager };
      if (id === './services/WrittenExamMode') return dist('services/WrittenExamMode');
      if (['./llm/scenarioPrompts', './services/PromptSettingsStore', './direct-assist/errors', './utils/imagePathValidation', './ipc/speechActions', './SessionTracker'].includes(id)) return dist(id.substring(2));
      if (id === './ipc/sttHandlers') return { registerDomesticSttHandlers() {} };
      if (id === './ipc/networkProxyHandlers') return { registerNetworkProxyHandlers() {} };
      if (id === './ipc/localContextHandlers') return { registerLocalContextHandlers() {} };
      if (id === './margin/appIdentity') return { APP_IDENTITY: { name: 'temp' } };
      if (['fs', 'os', 'path', 'crypto'].includes(id)) return require(id);
      return {};
    },
  });
  module.exports.initializeIpcHandlers({ processingHelper: { getLLMHelper: () => helper }, getIntelligenceManager: () => intelligence,
    getMainWindow: () => null, getScreenshotQueue: () => [], collectSpeech: options => meeting.collect(options),
    markDictation: at => meeting.markDictation(at), endMeeting: async () => {}, deleteScreenshot: async () => ({ success: true }) });
  const sender = new Sender(7);
  const invoke = (channel, ...args) => handlers.get(channel)({ sender }, ...args);
  return { sent, answer, helper, intelligence, user, interviewer, sender, invoke };
}

let shots = 0;
function screenshot() {
  const file = path.join(root, `shot-${++shots}.png`);
  fs.writeFileSync(file, 'synthetic screenshot fixture');
  return file;
}

/** The options NativelyInterface.submitQuestion sends for this input. */
function rendererOptions(userText, attachments) {
  return {
    generationKind: 'written', clickedAt: Date.now(),
    screenshotOnly: !userText && attachments.length > 0,
    ...(userText ? {} : { displayQuestion: translate(SCREENSHOT_QUESTION) }),
  };
}
/** submitQuestion's call: the typed text, or the default instruction for a screenshot alone. */
const submit = (c, userText, attachments) => c.invoke('gemini-chat-stream', userText || SCREENSHOT_QUESTION,
  attachments.length ? attachments : undefined, undefined, rendererOptions(userText, attachments));

// --- Save, reopen, and render the meeting -----------------------------------------------------
class SqliteAdapter {
  constructor(file) { this.raw = new DatabaseSync(file); }
  prepare(sql) { return this.raw.prepare(sql); }
  exec(sql) { this.raw.exec(sql); }
  pragma(sql, options) {
    const rows = this.raw.prepare(`PRAGMA ${sql}`).all();
    return options?.simple ? (rows[0] ? Object.values(rows[0])[0] : undefined) : rows;
  }
  transaction(fn) {
    return (...args) => { this.raw.exec('BEGIN'); try { const r = fn(...args); this.raw.exec('COMMIT'); return r; } catch (e) { this.raw.exec('ROLLBACK'); throw e; } };
  }
}
function openManager(dir) {
  const opened = [];
  const { DatabaseManager } = run('electron/db/DatabaseManager.ts', {
    'better-sqlite3': function Database(file) { const db = new SqliteAdapter(file); opened.push(db); return db; },
    path, fs, electron: { app: { getPath: () => dir } },
  });
  return { manager: DatabaseManager.getInstance(), close: () => opened.forEach(db => db.raw.close()) };
}

async function saveAndReopen(session) {
  const dir = fs.mkdtempSync(path.join(root, 'db-'));
  const writer = openManager(dir);
  const { MeetingPersistence } = run('electron/MeetingPersistence.ts', {
    crypto: require('node:crypto'),
    electron: { BrowserWindow: { getAllWindows: () => [] } },
    './db/DatabaseManager': { DatabaseManager: { getInstance: () => writer.manager } },
    './services/SettingsManager': { SettingsManager: { getInstance: () => ({ get: () => 'forever' }) } },
  });
  const saved = await new MeetingPersistence({
    flushInterimTranscript() {}, getSessionStartTime: () => Date.now() - 5_000,
    getFullTranscript: () => session.getFullTranscript(), getFullUsage: () => session.getFullUsage(),
    getMeetingMetadata: () => null, reset() {},
  }).stopMeeting();
  assert.equal(saved.status, 'saved');
  writer.close();
  const reader = openManager(dir);
  const meeting = reader.manager.getMeetingDetails(saved.id);
  reader.close();
  return meeting;
}

// pdfGenerator.ts compiled from source, with the export font generateMeetingPDF loads. Every
// string the generator draws is recorded on its way into jsPDF's text().
const { jsPDF } = require('jspdf');
const fontFile = 'NotoSansSC-Regular-subset.ttf';
const fontBase64 = fs.readFileSync(path.join(REPO, 'src/font/NotoSansSC-2.004', fontFile)).toString('base64');
async function pdfText(meeting) {
  const drawn = [];
  class RecordingPDF extends jsPDF {
    constructor(...args) {
      super(...args);
      const text = this.text;
      this.text = function recorded(value, ...rest) { drawn.push(...[value].flat()); return text.call(this, value, ...rest); };
    }
  }
  const modules = {
    jspdf: { __esModule: true, default: RecordingPDF, jsPDF: RecordingPDF },
    '../lib/pdfTextFlow.mjs': await import('../../../src/lib/pdfTextFlow.mjs'),
    '../lib/meetingTranscriptView.mjs': await import('../../../src/lib/meetingTranscriptView.mjs'),
    '../lib/meetingUsageExport.mjs': await import('../../../src/lib/meetingUsageExport.mjs'),
  };
  const { buildMeetingPDF } = run('src/utils/pdfGenerator.ts', modules);
  const doc = buildMeetingPDF(meeting, { fontBase64, fontFile, translate });
  assert.ok(doc.output('arraybuffer').byteLength > 0, 'the PDF is produced');
  const transcriptStart = drawn.indexOf(translate('Transcript'));
  const usageStart = drawn.indexOf(translate('AI Usage & Interactions'));
  return {
    transcript: transcriptStart < 0 ? [] : drawn.slice(transcriptStart + 1, usageStart < 0 ? undefined : usageStart),
    usage: usageStart < 0 ? [] : drawn.slice(usageStart + 1),
  };
}

async function views(c) {
  const meeting = await saveAndReopen(c.intelligence.session);
  const rows = visibleTranscriptRows(meeting.transcript, formatTranscriptTime);
  const copy = formatTranscriptCopy(rows, translate);
  const pdf = await pdfText(meeting);
  const chats = meeting.usage.filter(entry => entry.type === 'chat');
  return { meeting, rows, copy, pdf, chats };
}

function assertNoAutoLine({ rows, copy, pdf }) {
  for (const row of rows) assert.doesNotMatch(row.text, AUTO_LINE, 'details transcript row');
  assert.doesNotMatch(copy, AUTO_LINE, 'copied transcript');
  assert.doesNotMatch(pdf.transcript.join('\n'), AUTO_LINE, 'PDF transcript section');
}

const table = [];
test.after(() => console.log('scenario table:\n' + JSON.stringify(table, null, 2)));

// --- 1. Screenshot only, first attempt succeeds ----------------------------------------------
test('1. screenshot only, first attempt succeeds: no auto line in transcript, copy or PDF; history shows the Chinese question', async () => {
  const c = chain();
  c.interviewer.emit('transcript', { segmentId: 'i1', text: '请看屏幕上的这道题', isFinal: true });
  c.answer.text = '答案是 B，因为函数返回 42。';
  await submit(c, '', [screenshot()]);
  assert.equal(c.sent.length, 1);
  assert.match(JSON.stringify(c.sent[0]), /Solve the question in this screenshot directly/, 'the model still receives the instruction');
  assert.ok(c.sender.sent.some(([name]) => name === 'gemini-stream-done'));

  const v = await views(c);
  assertNoAutoLine(v);
  assert.deepEqual(v.rows.map(row => row.text), ['请看屏幕上的这道题'], 'the spoken line stays');
  assert.match(v.copy, /请看屏幕上的这道题/);
  assert.ok(v.pdf.transcript.includes('请看屏幕上的这道题'));
  assert.equal(v.chats.length, 1);
  const [row] = v.chats;
  assert.equal(row.displayQuestion, SHOWN);
  assert.equal(row.question, SCREENSHOT_QUESTION, 'history stores the message sent apart from the text shown');
  assert.equal(row.answer, '答案是 B，因为函数返回 42。');
  assert.ok(row.generation.questionId);
  assert.equal(row.generation.retryOf, undefined);
  assert.ok(v.pdf.usage.includes(`Q: ${SHOWN}`), 'the PDF usage section prints the question the user saw');
  assert.ok(!v.pdf.usage.some(line => line.includes(SCREENSHOT_QUESTION)));
  table.push({ scenario: '1 screenshot only, success', transcriptHasAutoLine: false, historyQuestion: row.displayQuestion, answer: row.answer, questionId: row.generation.questionId, retryOf: row.generation.retryOf ?? null });
});

// --- 2. Screenshot only, first attempt fails, Retry succeeds ---------------------------------
test('2. screenshot only, first attempt fails, Retry succeeds: no auto line; history keeps the question id and retryOf', async () => {
  const c = chain();
  c.interviewer.emit('transcript', { segmentId: 'i1', text: '这是一道算法题', isFinal: true });
  c.helper.openaiClient.chat.completions.create = async body => {
    c.sent.push(body);
    return (async function* () { throw new Error('synthetic provider failure'); })();
  };
  await submit(c, '', [screenshot()]);
  const failure = c.sender.sent.findLast(([name]) => name === 'gemini-stream-error')?.[3];
  assert.ok(failure?.retryable, 'the failed screenshot question is retryable');

  c.helper.openaiClient.chat.completions.create = async body => {
    c.sent.push(body);
    return [{ choices: [{ delta: { content: '重试答案：时间复杂度 O(n log n)。' }, finish_reason: 'stop' }] }];
  };
  const retry = await c.invoke('generation:retry', failure.requestId, Date.now());
  assert.equal(retry.answer, '重试答案：时间复杂度 O(n log n)。', retry.error);
  assert.deepEqual(c.sent[1].messages, c.sent[0].messages, 'Retry sends the original instruction and screenshot');
  await tick();

  const v = await views(c);
  assertNoAutoLine(v);
  assert.deepEqual(v.rows.map(row => row.text), ['这是一道算法题']);
  assert.equal(v.chats.length, 2);
  const [failed, retried] = v.chats;
  assert.equal(failed.displayQuestion, SHOWN);
  assert.equal(retried.displayQuestion, SHOWN, 'the Retry row is labelled with the Chinese question');
  assert.equal(failed.generation.status, 'failed');
  assert.equal(retried.answer, '重试答案：时间复杂度 O(n log n)。');
  assert.equal(failed.generation.requestId, failure.requestId);
  assert.equal(retried.generation.requestId, retry.requestId);
  assert.notEqual(retry.requestId, failure.requestId, 'the Retry is a new request');
  assert.equal(retried.generation.questionId, failed.generation.questionId, 'same question id');
  assert.equal(retried.generation.retryOf, failure.requestId, 'retryOf names the first request');
  assert.ok(v.pdf.usage.filter(line => line === `Q: ${SHOWN}`).length >= 1);
  assert.ok(!v.pdf.usage.some(line => line.includes(SCREENSHOT_QUESTION)));
  table.push({ scenario: '2 screenshot only, fail then Retry', transcriptHasAutoLine: false, historyQuestion: retried.displayQuestion, answer: retried.answer, questionId: retried.generation.questionId, retryOf: retried.generation.retryOf, firstRequestId: failed.generation.requestId, retryRequestId: retried.generation.requestId });
});

// --- Controls --------------------------------------------------------------------------------
test('3. screenshot with typed text: the typed text is a transcript line as before', async () => {
  const c = chain();
  const typed = '这道题的时间复杂度是多少？';
  const options = rendererOptions(typed, ['x']);
  assert.equal(options.screenshotOnly, false);
  await submit(c, typed, [screenshot()]);
  const v = await views(c);
  assert.deepEqual(v.rows.map(row => row.text), [typed]);
  assert.match(v.copy, new RegExp(`${translate('Me')}: ${typed}`));
  assert.ok(v.pdf.transcript.includes(typed));
  assert.equal(v.chats[0].question, typed);
  assert.equal(v.chats[0].displayQuestion, undefined);
  table.push({ scenario: '3 screenshot + typed text', transcriptHasTypedLine: true, historyQuestion: v.chats[0].question, answer: v.chats[0].answer });
});

for (const withScreenshot of [false, true]) test(`4. the user types the default instruction itself${withScreenshot ? ' with a screenshot' : ''}: recorded`, async () => {
  const c = chain();
  await submit(c, SCREENSHOT_QUESTION, withScreenshot ? [screenshot()] : []);
  const v = await views(c);
  assert.deepEqual(v.rows.map(row => row.text), [SCREENSHOT_QUESTION], 'typed text is never matched against the default instruction');
  assert.match(v.copy, /Solve the question in this screenshot directly/);
  assert.ok(v.pdf.transcript.includes(SCREENSHOT_QUESTION));
  table.push({ scenario: `4 typed the English sentence${withScreenshot ? ' + screenshot' : ''}`, transcriptHasAutoLine: true, historyQuestion: v.chats[0].displayQuestion ?? v.chats[0].question });
});

test('5. a spoken line through the STT transcript path is kept alongside a screenshot-only question', async () => {
  const c = chain();
  c.user.emit('transcript', { segmentId: 'u1', text: '我先说一下思路', isFinal: true });
  c.interviewer.emit('transcript', { segmentId: 'i1', text: '好的，请继续', isFinal: true });
  await submit(c, '', [screenshot()]);
  const v = await views(c);
  assert.deepEqual(v.rows.map(row => [row.speakerKey, row.text]), [['Me', '我先说一下思路'], ['Them', '好的，请继续']]);
  assert.match(v.copy, new RegExp(`${translate('Me')}: 我先说一下思路`));
  assert.ok(v.pdf.transcript.includes('我先说一下思路'));
  assertNoAutoLine(v);
  table.push({ scenario: '5 STT voice line + screenshot only', transcriptHasVoiceLine: true, transcriptHasAutoLine: false });
});

test('the flag is checked in main: only a boolean, and only for a request that has a screenshot', async () => {
  const c = chain();
  for (const value of ['true', 1, {}, null]) {
    await assert.rejects(() => c.invoke('gemini-chat-stream', SCREENSHOT_QUESTION, [screenshot()], undefined, { screenshotOnly: value }), /Invalid question source/);
  }
  assert.equal(c.sent.length, 0, 'a rejected request is not sent');
  // Without a screenshot the flag cannot hide typed text.
  await c.invoke('gemini-chat-stream', 'typed without image', undefined, undefined, { screenshotOnly: true });
  const v = await views(c);
  assert.deepEqual(v.rows.map(row => row.text), ['typed without image']);
});

test('the renderer marks the request by input source, not by its text', () => {
  const renderer = fs.readFileSync(path.join(REPO, 'src/components/NativelyInterface.tsx'), 'utf8');
  assert.match(renderer, /screenshotOnly: !userText && currentAttachments\.length > 0/);
  assert.doesNotMatch(renderer, /screenshotOnly:[^,]*SCREENSHOT_QUESTION/);
});
