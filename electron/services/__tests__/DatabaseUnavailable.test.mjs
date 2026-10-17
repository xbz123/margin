// Failed meeting save (PLAN §8): the actual DatabaseManager.saveMeeting with no open
// database throws a recognizable error instead of returning as if it had saved, and
// MeetingPersistence keeps that meeting as "database unavailable". Demo seeding without
// a database still does nothing. Both modules run from source with stub Electron and
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
  '../margin/appIdentity': { APP_IDENTITY: { name: 'temp' } },
  'better-sqlite3': function Database() { throw Error('no database is opened in this test'); },
  path, fs: { existsSync: () => { throw Error('no file access in this test'); } },
  electron: { app: { getPath: () => { throw Error('no userData in this test'); } } },
});

// An instance whose database is not open (as after a failed initialisation).
function closedManager() {
  return Object.assign(Object.create(database.DatabaseManager.prototype), { db: null, dbPath: 'unused' });
}

const meeting = { id: 'null-db-meeting', title: 'T', date: '2026-10-17T00:00:00.000Z', duration: '0:05', summary: '',
  transcript: [{ speaker: 'user', text: 'line', timestamp: 1 }], usage: [], isProcessed: true };

test('saveMeeting without an open database throws DatabaseUnavailableError', () => {
  assert.throws(() => closedManager().saveMeeting(meeting, 0, 5_000), error =>
    error instanceof database.DatabaseUnavailableError && error.code === 'database-unavailable');
  assert.doesNotThrow(() => closedManager().seedDemoMeeting(), 'demo seeding still skips a missing database');
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
