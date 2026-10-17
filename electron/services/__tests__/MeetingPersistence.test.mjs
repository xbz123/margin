// AG-52 (PLAN S33): stopping a meeting saves one finished record of its transcript and
// usage at once. Nothing is generated, so no placeholder, background step or recovery
// is left. Runs MeetingPersistence.ts with stub database, settings and windows.
// Failed meeting save (PLAN §8): a failed database write keeps that one meeting in memory
// until a retry saves it or the user discards it; skipped meetings keep nothing.
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

const unavailable = () => Object.assign(Error('synthetic database unavailable'), { code: 'database-unavailable' });

// `control.fail` makes the next writes fail: 'write' (SQLite error), 'unavailable' (no
// database) or 'open' (getInstance throws). `control.duringSave` runs inside a write.
function load({ retention = 'forever', settingsThrow = false, saveFails = null, sendThrows = false } = {}) {
  const saved = [], sent = [], attempts = [];
  const control = { fail: saveFails, duringSave: null };
  const fakeModules = {
    crypto: require('node:crypto'),
    electron: { BrowserWindow: { getAllWindows: () => [{ webContents: { send: (channel, ...args) => {
      sent.push(args.length ? [channel, ...args] : channel);
      if (sendThrows) throw Error('synthetic send failure');
    } } }] } },
    './db/DatabaseManager': { DatabaseManager: { getInstance: () => {
      if (control.fail === 'open') throw Error('synthetic open failure');
      return { saveMeeting(meeting, startTime, durationMs) {
        attempts.push({ meeting, startTime, durationMs });
        control.duringSave?.();
        if (control.fail === 'write') throw Error('synthetic write failure');
        if (control.fail === 'unavailable') throw unavailable();
        saved.push({ meeting, startTime, durationMs });
      } };
    } } },
    './services/SettingsManager': { SettingsManager: { getInstance: () => ({ get: key => {
      if (settingsThrow) throw Error('synthetic settings failure');
      return key === 'meetingRetention' ? retention : undefined;
    } }) } },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, Date, console: { log() {}, error() {}, warn() {} },
    require(id) { if (Object.hasOwn(fakeModules, id)) return fakeModules[id]; throw Error(`unexpected require ${id}`); },
  });
  return { MeetingPersistence: module.exports.MeetingPersistence, saved, sent, attempts, control };
}

function session({ startedMsAgo = 5_000, metadata = null } = {}) {
  const calls = [];
  let transcript = [
    { speaker: 'interviewer', text: 'TRANSCRIPT_SENTINEL', timestamp: 1 },
    { speaker: 'user', text: 'SECOND_LINE', timestamp: 2 },
  ];
  let usage = [{ type: 'assist', timestamp: 2, question: 'Q', answer: 'A' }];
  return {
    calls,
    flushInterimTranscript: () => calls.push('flush'),
    getSessionStartTime: () => Date.now() - startedMsAgo,
    getFullTranscript: () => transcript,
    getFullUsage: () => usage,
    getMeetingMetadata: () => metadata,
    reset: () => { calls.push('reset'); transcript = []; usage = []; metadata = null; },
  };
}

const plain = value => JSON.parse(JSON.stringify(value));

test('stopMeeting saves the finished transcript and usage once, without generating anything', async () => {
  const { MeetingPersistence, saved, sent } = load();
  const tracker = session({ metadata: { title: 'Weekly sync' } });
  const persistence = new MeetingPersistence(tracker);
  const result = await persistence.stopMeeting();
  assert.equal(saved.length, 1);
  const { meeting, durationMs } = saved[0];
  assert.deepEqual(plain(result), { status: 'saved', id: meeting.id });
  assert.equal(meeting.title, 'Weekly sync', 'the title is read before reset clears the metadata');
  assert.equal(meeting.isProcessed, true);
  assert.equal(meeting.summary, '');
  assert.deepEqual(JSON.parse(JSON.stringify(meeting.detailedSummary)), { actionItems: [], keyPoints: [] });
  assert.equal(meeting.transcript[0].text, 'TRANSCRIPT_SENTINEL', 'the transcript is copied before reset');
  assert.equal(meeting.usage.length, 1);
  assert.ok(durationMs >= 5_000);
  assert.deepEqual(tracker.calls, ['flush', 'reset']);
  assert.deepEqual(sent, ['meetings-updated']);
  assert.equal(persistence.getUnsavedMeeting(), null);
});

test('an untitled meeting is saved as Untitled Session', async () => {
  const { MeetingPersistence, saved } = load();
  await new MeetingPersistence(session()).stopMeeting();
  assert.equal(saved[0].meeting.title, 'Untitled Session');
});

test('short, never-retained, do-not-persist and unreadable-privacy meetings are skipped and keep nothing', async () => {
  for (const [options, tracker, reason] of [
    [{}, session({ startedMsAgo: 10 }), 'too-short'],
    [{ retention: 'never' }, session(), 'privacy-setting'],
    [{}, session({ metadata: { doNotPersist: true } }), 'privacy-setting'],
    [{ settingsThrow: true }, session(), 'privacy-settings-unreadable'],
  ]) {
    const { MeetingPersistence, saved, sent, attempts } = load(options);
    const persistence = new MeetingPersistence(tracker);
    assert.deepEqual(plain(await persistence.stopMeeting()), { status: 'skipped', reason }, reason);
    assert.equal(attempts.length, 0, `${reason}: nothing is written`);
    assert.equal(saved.length, 0);
    assert.deepEqual(sent, []);
    assert.ok(tracker.calls.includes('reset'), 'the session is reset either way');
    assert.equal(persistence.getUnsavedMeeting(), null, `${reason}: nothing is retained`);
  }
});

test('a failed write keeps the complete meeting in memory, resets the session and exposes metadata only', async () => {
  for (const [fail, reason] of [['write', 'write-error'], ['unavailable', 'database-unavailable'], ['open', 'database-unavailable']]) {
    const { MeetingPersistence, saved, sent, attempts } = load({ saveFails: fail });
    const tracker = session({ metadata: { title: 'Kept title' } });
    const persistence = new MeetingPersistence(tracker);
    const result = await persistence.stopMeeting();
    assert.equal(saved.length, 0);
    assert.equal(result.status, 'failed', fail);
    assert.equal(result.reason, reason, fail);
    assert.deepEqual(tracker.calls, ['flush', 'reset'], 'the session is reset at once');
    assert.equal(tracker.getFullTranscript().length, 0);
    const info = persistence.getUnsavedMeeting();
    assert.deepEqual(Object.keys(info).sort(), ['durationMs', 'id', 'reason', 'startedAt', 'transcriptCount']);
    assert.equal(info.id, result.id);
    assert.equal(info.transcriptCount, 2);
    assert.equal(info.reason, reason);
    assert.ok(info.durationMs >= 5_000 && info.startedAt <= Date.now() - 5_000);
    assert.deepEqual(plain(sent), [['unsaved-meeting-changed', plain(info)]]);
    if (fail !== 'open') {
      const kept = attempts[0].meeting;
      assert.equal(kept.id, result.id);
      assert.equal(kept.title, 'Kept title');
      assert.deepEqual(plain(kept.transcript.map(t => t.text)), ['TRANSCRIPT_SENTINEL', 'SECOND_LINE']);
      assert.deepEqual(plain(kept.usage), [{ type: 'assist', timestamp: 2, question: 'Q', answer: 'A' }]);
    }
  }
});

test('retry writes the same stored meeting, clears it and notifies; a failed retry keeps it with the new reason', async () => {
  const { MeetingPersistence, saved, sent, attempts, control } = load({ saveFails: 'unavailable' });
  const persistence = new MeetingPersistence(session());
  const { id } = await persistence.stopMeeting();
  const first = attempts[0];

  control.fail = 'write';
  assert.deepEqual(plain(persistence.retryUnsavedMeeting(id)), { ok: false, code: 'save-failed', reason: 'write-error' });
  assert.equal(persistence.getUnsavedMeeting().reason, 'write-error');
  assert.equal(persistence.getUnsavedMeeting().id, id);
  assert.equal(attempts[1].meeting, first.meeting, 'the retry reuses the stored meeting');

  control.fail = null;
  sent.length = 0;
  assert.deepEqual(plain(persistence.retryUnsavedMeeting(id)), { ok: true });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].meeting.id, id, 'same id');
  assert.equal(saved[0].meeting, first.meeting);
  assert.equal(saved[0].startTime, first.startTime);
  assert.equal(saved[0].durationMs, first.durationMs);
  assert.equal(persistence.getUnsavedMeeting(), null);
  assert.deepEqual(sent, [['unsaved-meeting-changed', null], 'meetings-updated']);
  assert.deepEqual(plain(persistence.retryUnsavedMeeting(id)), { ok: false, code: 'not-found' }, 'a duplicate retry writes nothing');
  assert.equal(attempts.length, 3);
});

test('discard clears only the named meeting without writing; stale and duplicate commands change nothing', async () => {
  const { MeetingPersistence, sent, attempts } = load({ saveFails: 'write' });
  const persistence = new MeetingPersistence(session());
  const { id } = await persistence.stopMeeting();
  sent.length = 0;
  assert.deepEqual(plain(persistence.discardUnsavedMeeting('another-meeting')), { ok: false, code: 'not-found' });
  assert.deepEqual(plain(persistence.retryUnsavedMeeting('another-meeting')), { ok: false, code: 'not-found' });
  assert.deepEqual(plain(persistence.discardUnsavedMeeting(undefined)), { ok: false, code: 'not-found' });
  assert.equal(persistence.getUnsavedMeeting().id, id);
  assert.deepEqual(sent, []);
  assert.deepEqual(plain(persistence.discardUnsavedMeeting(id)), { ok: true });
  assert.equal(persistence.getUnsavedMeeting(), null);
  assert.deepEqual(sent, [['unsaved-meeting-changed', null]]);
  assert.deepEqual(plain(persistence.discardUnsavedMeeting(id)), { ok: false, code: 'not-found' });
  assert.deepEqual(plain(persistence.retryUnsavedMeeting(id)), { ok: false, code: 'not-found' });
  assert.equal(attempts.length, 1, 'discard never writes');
});

test('commands arriving while a retry is writing are refused', async () => {
  const { MeetingPersistence, saved, control } = load({ saveFails: 'write' });
  const persistence = new MeetingPersistence(session());
  const { id } = await persistence.stopMeeting();
  const during = [];
  control.fail = null;
  control.duringSave = () => {
    during.push(plain(persistence.discardUnsavedMeeting(id)), plain(persistence.retryUnsavedMeeting(id)));
  };
  assert.deepEqual(plain(persistence.retryUnsavedMeeting(id)), { ok: true });
  assert.deepEqual(during, [{ ok: false, code: 'busy' }, { ok: false, code: 'busy' }]);
  assert.equal(saved.length, 1);
  assert.equal(persistence.getUnsavedMeeting(), null);
});

test('a committed save stays saved when notifying windows throws: no retry entry, no second row', async () => {
  const { MeetingPersistence, saved, attempts } = load({ sendThrows: true });
  const persistence = new MeetingPersistence(session());
  const result = await persistence.stopMeeting();
  assert.deepEqual(plain(result), { status: 'saved', id: saved[0].meeting.id });
  assert.equal(persistence.getUnsavedMeeting(), null);
  assert.deepEqual(plain(persistence.retryUnsavedMeeting(result.id)), { ok: false, code: 'not-found' });
  assert.equal(attempts.length, 1);

  const retried = load({ saveFails: 'write', sendThrows: true });
  const second = new retried.MeetingPersistence(session());
  const { id } = await second.stopMeeting();
  retried.control.fail = null;
  assert.deepEqual(plain(second.retryUnsavedMeeting(id)), { ok: true }, 'a committed retry is saved even if notifying throws');
  assert.equal(second.getUnsavedMeeting(), null);
  assert.equal(retried.saved.length, 1);
});

test('an unresolved meeting is never overwritten by a later failed save', async () => {
  const { MeetingPersistence } = load({ saveFails: 'write' });
  const persistence = new MeetingPersistence(session());
  const first = await persistence.stopMeeting();
  const second = await persistence.stopMeeting();
  assert.equal(second.status, 'failed');
  assert.notEqual(second.id, first.id);
  assert.equal(persistence.getUnsavedMeeting().id, first.id);
});
