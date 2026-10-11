// AG-52 (PLAN S33): stopping a meeting saves one finished record of its transcript and
// usage at once. Nothing is generated, so no placeholder, background step or recovery
// is left. Runs MeetingPersistence.ts with stub database, settings and windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(REPO, 'electron/MeetingPersistence.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

function load({ retention = 'forever', saveFails = false } = {}) {
  const saved = [], sent = [];
  const fakeModules = {
    crypto: require('node:crypto'),
    electron: { BrowserWindow: { getAllWindows: () => [{ webContents: { send: channel => sent.push(channel) } }] } },
    './db/DatabaseManager': { DatabaseManager: { getInstance: () => ({ saveMeeting(meeting, startTime, durationMs) {
      if (saveFails) throw Error('synthetic save failure');
      saved.push({ meeting, startTime, durationMs });
    } }) } },
    './services/SettingsManager': { SettingsManager: { getInstance: () => ({ get: key => key === 'meetingRetention' ? retention : undefined }) } },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, Date, console: { log() {}, error() {}, warn() {} },
    require(id) { if (Object.hasOwn(fakeModules, id)) return fakeModules[id]; throw Error(`unexpected require ${id}`); },
  });
  return { MeetingPersistence: module.exports.MeetingPersistence, saved, sent };
}

function session({ startedMsAgo = 5_000, metadata = null } = {}) {
  const calls = [];
  let transcript = [{ speaker: 'interviewer', text: 'TRANSCRIPT_SENTINEL', timestamp: 1 }];
  return {
    calls,
    flushInterimTranscript: () => calls.push('flush'),
    getSessionStartTime: () => Date.now() - startedMsAgo,
    getFullTranscript: () => transcript,
    getFullUsage: () => [{ type: 'assist', timestamp: 2, question: 'Q', answer: 'A' }],
    getMeetingMetadata: () => metadata,
    reset: () => { calls.push('reset'); transcript = []; metadata = null; },
  };
}

test('stopMeeting saves the finished transcript and usage once, without generating anything', async () => {
  const { MeetingPersistence, saved, sent } = load();
  const tracker = session({ metadata: { title: 'Weekly sync' } });
  const id = await new MeetingPersistence(tracker).stopMeeting();
  assert.equal(saved.length, 1);
  const { meeting, durationMs } = saved[0];
  assert.equal(meeting.id, id);
  assert.equal(meeting.title, 'Weekly sync', 'the title is read before reset clears the metadata');
  assert.equal(meeting.isProcessed, true);
  assert.equal(meeting.summary, '');
  assert.deepEqual(JSON.parse(JSON.stringify(meeting.detailedSummary)), { actionItems: [], keyPoints: [] });
  assert.equal(meeting.transcript[0].text, 'TRANSCRIPT_SENTINEL', 'the transcript is copied before reset');
  assert.equal(meeting.usage.length, 1);
  assert.ok(durationMs >= 5_000);
  assert.deepEqual(tracker.calls, ['flush', 'reset']);
  assert.deepEqual(sent, ['meetings-updated']);
});

test('an untitled meeting is saved as Untitled Session', async () => {
  const { MeetingPersistence, saved } = load();
  await new MeetingPersistence(session()).stopMeeting();
  assert.equal(saved[0].meeting.title, 'Untitled Session');
});

test('short, never-retained, do-not-persist and failed saves leave no meeting id', async () => {
  for (const [options, tracker] of [
    [{}, session({ startedMsAgo: 10 })],
    [{ retention: 'never' }, session()],
    [{}, session({ metadata: { doNotPersist: true } })],
    [{ saveFails: true }, session()],
  ]) {
    const { MeetingPersistence, saved, sent } = load(options);
    assert.equal(await new MeetingPersistence(tracker).stopMeeting(), null);
    assert.equal(saved.length, 0);
    assert.deepEqual(sent, []);
    assert.ok(tracker.calls.includes('reset'), 'the session is reset either way');
  }
});
