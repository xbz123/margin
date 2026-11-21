// Retry history survives a meeting save (item 6). In the Chinese UI the user sends only a
// screenshot; the window shows the localized "solve the screenshot" line. The first attempt
// fails, Retry succeeds, the meeting is saved and read back from SQLite. The history rows keep
// the Chinese text the user saw (separately from the English message the model got), the answer,
// the shared questionId and the retry's retryOf, and no row carries the assembled prompt context.
//
// The actual DatabaseManager (constructor, migrations, saveMeeting, getMeetingDetails) and
// MeetingPersistence run from source. better-sqlite3 is not built in this checkout (no binding
// for node or electron), so the manager's better-sqlite3 handle is a thin adapter over
// node:sqlite on a real database file in a temporary directory; the file is reopened by a second
// manager instance to read the meeting back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const { GenerationTask, generationTasks } = require('../../../dist-electron/electron/llm/generateTask.js');
const { IntelligenceManager } = require('../../../dist-electron/electron/IntelligenceManager.js');

const compile = file => ts.transpileModule(fs.readFileSync(path.join(REPO, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
}).outputText;
function run(file, modules) {
  const module = { exports: {} };
  vm.runInNewContext(compile(file), {
    module, exports: module.exports, Date, JSON, console: { log() {}, error() {}, warn() {} },
    require(id) { if (Object.hasOwn(modules, id)) return modules[id]; throw Error(`unexpected require ${id}`); },
  });
  return module.exports;
}

/** The better-sqlite3 surface DatabaseManager uses, over node:sqlite on the same file. */
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

/** A fresh DatabaseManager module and instance opened on `dir/natively.db`. */
function openManager(dir) {
  const opened = [];
  const { DatabaseManager } = run('electron/db/DatabaseManager.ts', {
    'better-sqlite3': function Database(file) { const db = new SqliteAdapter(file); opened.push(db); return db; },
    path, fs, electron: { app: { getPath: () => dir } },
  });
  return { manager: DatabaseManager.getInstance(), close: () => opened.forEach(db => db.raw.close()) };
}

const zh = run('src/i18n.zh.ts', {}).chinese;
const SCREENSHOT_QUESTION = 'Solve the question in this screenshot directly';
const PROMPT = 'SYSTEM: private reference material\n<transcript>meeting context</transcript>\nQ: ';

class StubLLMHelper {
  constructor(replay) { this.replay = replay; }
  getCurrentGenerationTask() { return generationTasks.getStore(); }
  beginGenerationTask() { return new GenerationTask({ target: { provider: 'synthetic', model: 'stub' } }); }
  async runGeneration(factory, _kind, _signal, supplied) {
    const inherited = generationTasks.getStore();
    const task = supplied ?? inherited ?? this.beginGenerationTask();
    try { return await generationTasks.run(task, factory); }
    catch (error) { task.terminalStatus ??= 'failed'; throw error; }
    finally { if (task !== inherited) task.close(); }
  }
  getTaskMetadata(task) {
    return { requestId: task.requestId, questionId: task.questionId, retryOf: task.retryOf, entryPoint: task.entryPoint,
      provider: 'synthetic', model: 'stub', status: task.terminalStatus, attempts: 1, partial: false };
  }
  deniedDataScopes() { return []; }
  async *replayPrepared() { yield* this.replay; }
}

test('Chinese UI: screenshot only, first attempt fails, Retry succeeds, saved and read back from SQLite', async t => {
  // The renderer sends the English message and the line it showed; check both ends of that wiring.
  const renderer = fs.readFileSync(path.join(REPO, 'src/components/NativelyInterface.tsx'), 'utf8');
  assert.match(renderer, /userText \|\| SCREENSHOT_QUESTION,/);
  assert.match(renderer, /userText \? \{\} : \{ displayQuestion: t\(SCREENSHOT_QUESTION\) \}/);
  const displayQuestion = zh[SCREENSHOT_QUESTION];
  assert.equal(displayQuestion, '直接解答截图中的题目');
  const message = SCREENSHOT_QUESTION;

  const helper = new StubLLMHelper(['选项 B', '：因为截图中的函数返回 42。']);
  const intelligence = new IntelligenceManager(helper);
  intelligence.session.handleTranscript({ speaker: 'interviewer', text: '请看这道题', timestamp: Date.now() - 2000, final: true });

  // First attempt, as the gemini-chat-stream handler does it: register the question, then the
  // provider fails and the failure path logs the question with an empty partial answer.
  const first = helper.beginGenerationTask(); first.entryPoint = 'text';
  intelligence.rememberQuestion(first, 'chat', message, displayQuestion);
  first.terminalStatus = 'failed';
  intelligence.logUsage('chat', message, '', helper.getTaskMetadata(first), displayQuestion);

  // Retry (LLMHelper.beginPreparedRetry): same question id, new request id, retryOf = first.
  const retry = helper.beginGenerationTask();
  retry.entryPoint = first.entryPoint; retry.questionId = first.questionId; retry.retryOf = first.requestId;
  const answer = await helper.runGeneration(() => intelligence.runPreparedRetry({ userContent: PROMPT + message }), 'written', undefined, retry);
  assert.equal(answer, '选项 B：因为截图中的函数返回 42。');
  assert.notEqual(retry.requestId, first.requestId);

  // Save the meeting with the actual MeetingPersistence into a real database file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-retry-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const writer = openManager(dir);
  const { MeetingPersistence } = run('electron/MeetingPersistence.ts', {
    crypto: require('node:crypto'),
    electron: { BrowserWindow: { getAllWindows: () => [] } },
    './db/DatabaseManager': { DatabaseManager: { getInstance: () => writer.manager } },
    './services/SettingsManager': { SettingsManager: { getInstance: () => ({ get: () => 'forever' }) } },
  });
  const session = intelligence.session;
  const saved = await new MeetingPersistence({
    flushInterimTranscript() {}, getSessionStartTime: () => Date.now() - 5_000,
    getFullTranscript: () => session.getFullTranscript(), getFullUsage: () => session.getFullUsage(),
    getMeetingMetadata: () => null, reset() {},
  }).stopMeeting();
  assert.equal(saved.status, 'saved');
  writer.close();

  // The raw rows, as a reopened database holds them.
  const raw = new DatabaseSync(path.join(dir, 'natively.db'));
  const rows = raw.prepare('SELECT type, user_query, ai_response, metadata_json FROM ai_interactions WHERE meeting_id = ? ORDER BY id').all(saved.id)
    .map(row => ({ ...row }));
  raw.close();
  console.log('ai_interactions rows read back:\n' + JSON.stringify(rows, null, 2));
  assert.equal(rows.length, 2);

  // Read back through a second DatabaseManager on the same file.
  const reader = openManager(dir);
  const meeting = reader.manager.getMeetingDetails(saved.id);
  reader.close();
  console.log('getMeetingDetails usage:\n' + JSON.stringify(meeting.usage, null, 2));
  const [failed, retried] = meeting.usage;

  assert.equal(failed.displayQuestion, '直接解答截图中的题目');
  assert.equal(retried.displayQuestion, '直接解答截图中的题目');
  assert.equal(failed.question, message);
  assert.equal(retried.question, message);
  assert.equal(failed.generation.status, 'failed');
  assert.equal(failed.answer, null, 'the failed attempt has no answer');
  assert.equal(retried.answer, '选项 B：因为截图中的函数返回 42。');
  assert.equal(retried.type, 'chat');

  assert.equal(failed.generation.requestId, first.requestId);
  assert.equal(retried.generation.requestId, retry.requestId);
  assert.equal(failed.generation.questionId, first.questionId);
  assert.equal(retried.generation.questionId, failed.generation.questionId, 'both requests share the question id');
  assert.equal(retried.generation.retryOf, first.requestId, 'the retry names the first request');
  assert.equal(failed.generation.retryOf, undefined);

  for (const row of rows) {
    for (const text of [row.user_query, row.metadata_json]) {
      assert.doesNotMatch(String(text), /private reference material|meeting context|<transcript>|请看这道题/, 'no assembled context is stored as the question');
    }
  }
});

test('older rows read back unchanged: a bare items array and generation metadata without the new fields', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-retry-history-old-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { manager, close } = openManager(dir);
  manager.saveMeeting({ id: 'old', title: 'T', date: '2026-10-01T00:00:00.000Z', duration: '0:05', transcript: [], isProcessed: true, usage: [
    { type: 'followup_questions', timestamp: 1, question: 'Generate Follow-up Questions', items: ['问题一？', '问题二？'] },
    { type: 'chat', timestamp: 2, question: 'typed', answer: 'a', generation: { requestId: 'r1', provider: 'p', model: 'm', attempts: 1, partial: false } },
  ] }, 0, 5_000);
  const db = manager.db;
  // An earlier version stored this shape; it must still read.
  db.prepare('INSERT INTO ai_interactions (meeting_id, type, timestamp, user_query, ai_response, metadata_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run('old', 'chat', 3, 'legacy', 'b', JSON.stringify({ generation: { requestId: 'r0', provider: 'p', model: 'm', attempts: 1, partial: false } }));
  const stored = db.prepare('SELECT metadata_json FROM ai_interactions WHERE meeting_id = ? ORDER BY timestamp').all('old').map(row => row.metadata_json);
  assert.equal(stored[0], JSON.stringify(['问题一？', '问题二？']), 'follow-up questions keep the bare array shape');
  const usage = manager.getMeetingDetails('old').usage;
  close();
  assert.deepEqual(usage[0].items, ['问题一？', '问题二？']);
  assert.equal(usage[0].displayQuestion, undefined);
  assert.equal(usage[1].generation.requestId, 'r1');
  assert.equal(usage[1].displayQuestion, undefined);
  assert.equal(usage[2].question, 'legacy');
  assert.equal(usage[2].generation.requestId, 'r0');
  assert.equal(usage[2].generation.questionId, undefined);
});

test('Chinese UI: screenshot only, first attempt and Retry both fail, the Retry row keeps the Chinese question after save', async t => {
  const displayQuestion = zh[SCREENSHOT_QUESTION];
  const message = SCREENSHOT_QUESTION;
  const helper = new StubLLMHelper([]);
  helper.replayPrepared = async function* () { throw Object.assign(new Error('provider down'), { status: 500 }); };
  const intelligence = new IntelligenceManager(helper);

  const first = helper.beginGenerationTask(); first.entryPoint = 'text';
  intelligence.rememberQuestion(first, 'chat', message, displayQuestion);
  first.terminalStatus = 'failed';
  intelligence.logUsage('chat', message, '', helper.getTaskMetadata(first), displayQuestion);

  const retry = helper.beginGenerationTask();
  retry.entryPoint = first.entryPoint; retry.questionId = first.questionId; retry.retryOf = first.requestId;
  await assert.rejects(() => helper.runGeneration(() => intelligence.runPreparedRetry({ userContent: PROMPT + message }), 'written', undefined, retry), /provider down/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-retry-history-failed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const writer = openManager(dir);
  const { MeetingPersistence } = run('electron/MeetingPersistence.ts', {
    crypto: require('node:crypto'),
    electron: { BrowserWindow: { getAllWindows: () => [] } },
    './db/DatabaseManager': { DatabaseManager: { getInstance: () => writer.manager } },
    './services/SettingsManager': { SettingsManager: { getInstance: () => ({ get: () => 'forever' }) } },
  });
  const session = intelligence.session;
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
  assert.equal(meeting.usage.length, 2, 'one row per attempt, no duplicate');
  const [failed, retried] = meeting.usage;
  for (const row of [failed, retried]) {
    assert.equal(row.type, 'chat');
    assert.equal(row.question, message);
    assert.equal(row.displayQuestion, '直接解答截图中的题目');
    assert.equal(row.answer, null);
    assert.equal(row.generation.status, 'failed');
  }
  assert.equal(retried.generation.retryOf, first.requestId);
  assert.equal(retried.generation.questionId, first.questionId);
  assert.equal(meeting.usage.some(row => row.question === 'generation outcome'), false);

  // The export leaves out entries with no answer, as for the failed first attempt.
  const { usageExportBlocks } = await import('../../../src/lib/meetingUsageExport.mjs');
  assert.deepEqual(usageExportBlocks(meeting.usage), []);
});
