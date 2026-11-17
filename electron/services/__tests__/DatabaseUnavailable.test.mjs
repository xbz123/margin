// Failed meeting save (PLAN §8): the actual DatabaseManager.saveMeeting with no open
// database throws a recognizable error instead of returning as if it had saved, and
// MeetingPersistence keeps that meeting as "database unavailable". Removing the retired
// demo meeting without a database does nothing; with an in-memory database it removes
// only that meeting and its rows. Both modules run from source with stub Electron and
// SQLite modules; no database file is opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(REPO, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
}).outputText;

function run(file, modules) {
  const module = { exports: {} };
  vm.runInNewContext(compile(file), {
    module, exports: module.exports, Date, console: { log() {}, error() {}, warn() {} },
    require(id) { if (Object.hasOwn(modules, id)) return modules[id]; throw Error(`unexpected require ${id}`); },
  });
  return module.exports;
}

const database = run('electron/db/DatabaseManager.ts', {
  'better-sqlite3': function Database() { throw Error('no database is opened in this test'); },
  path, fs: { existsSync: () => { throw Error('no file access in this test'); } },
  electron: { app: { getPath: () => { throw Error('no userData in this test'); } } },
});

// An instance whose database is not open (as after a failed initialisation).
function closedManager() {
  return Object.assign(Object.create(database.DatabaseManager.prototype), { db: null, dbPath: 'unused' });
}

const meeting = { id: 'null-db-meeting', title: 'T', date: '2026-10-17T00:00:00.000Z', duration: '0:05',
  transcript: [{ speaker: 'user', text: 'line', timestamp: 1 }], usage: [], isProcessed: true };

test('saveMeeting without an open database throws DatabaseUnavailableError', () => {
  assert.throws(() => closedManager().saveMeeting(meeting, 0, 5_000), error =>
    error instanceof database.DatabaseUnavailableError && error.code === 'database-unavailable');
  assert.doesNotThrow(() => closedManager().removeRetiredDemoMeeting(), 'demo cleanup skips a missing database');
});

test('removeRetiredDemoMeeting deletes only the demo-meeting row and its rows, and is repeatable', () => {
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, summary_json TEXT);
    CREATE TABLE transcripts (id INTEGER PRIMARY KEY, meeting_id TEXT, content TEXT);
    CREATE TABLE ai_interactions (id INTEGER PRIMARY KEY, meeting_id TEXT, user_query TEXT);`);
  for (const id of ['demo-meeting', 'kept']) {
    raw.prepare('INSERT INTO meetings VALUES (?, ?, ?)').run(id, id, '{}');
    raw.prepare('INSERT INTO transcripts (meeting_id, content) VALUES (?, ?)').run(id, 'line');
    raw.prepare('INSERT INTO ai_interactions (meeting_id, user_query) VALUES (?, ?)').run(id, 'q');
  }
  // The better-sqlite3 surface the manager uses: prepare().run() and transaction(fn)().
  const db = { prepare: sql => raw.prepare(sql),
    transaction: fn => () => { raw.exec('BEGIN'); try { fn(); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; } } };
  const manager = Object.assign(Object.create(database.DatabaseManager.prototype), { db, dbPath: 'unused' });
  manager.removeRetiredDemoMeeting();
  manager.removeRetiredDemoMeeting();
  const ids = table => raw.prepare(`SELECT ${table === 'meetings' ? 'id' : 'meeting_id'} AS id FROM ${table}`).all().map(row => row.id);
  for (const table of ['meetings', 'transcripts', 'ai_interactions']) assert.deepEqual(ids(table), ['kept'], table);
  raw.close();
});

test('MeetingPersistence keeps a meeting the actual null-database save refused, as database-unavailable', async () => {
  const manager = closedManager();
  const sent = [];
  const { MeetingPersistence } = run('electron/MeetingPersistence.ts', {
    crypto: require('node:crypto'),
    electron: { BrowserWindow: { getAllWindows: () => [{ webContents: { send: (...args) => sent.push(args) } }] } },
    './db/DatabaseManager': { DatabaseManager: { getInstance: () => manager } },
    './services/SettingsManager': { SettingsManager: { getInstance: () => ({ get: () => 'forever' }) } },
  });
  const persistence = new MeetingPersistence({
    flushInterimTranscript() {}, getSessionStartTime: () => Date.now() - 5_000,
    getFullTranscript: () => meeting.transcript, getFullUsage: () => [], getMeetingMetadata: () => null, reset() {},
  });
  const result = await persistence.stopMeeting();
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'database-unavailable');
  assert.equal(persistence.getUnsavedMeeting().reason, 'database-unavailable');
  assert.deepEqual(sent.map(([channel]) => channel), ['unsaved-meeting-changed']);
});
