import test from 'node:test';
import assert from 'node:assert/strict';
import { mainFixture } from './mainMeetingFixture.mjs';

test('written sessions need neither STT nor permission and mode switches preserve the same meeting', async () => {
  let checks = 0, permissions = 0;
  const f = mainFixture({ examSettings: { enabled: true, autoCaptureEnabled: true },
    requireSttConfigured() { checks++; }, microphonePermission: async () => { permissions++; return true; },
    inputDevices: async () => [{ id: 'mic-1', name: 'Synthetic microphone' }] });
  await f.start({ audio: { inputDeviceId: 'mic-1', outputDeviceId: 'sck' } });
  const id = f.state.activeAudioSession;
  assert.equal(checks, 0); assert.equal(permissions, 0);
  assert.equal(f.audio.microphones.length, 0); assert.equal(f.providers.length, 0);
  await f.state.updateWrittenExamSettings({ enabled: false });
  assert.equal(checks, 1); assert.equal(permissions, 1);
  assert.equal(f.state.writtenMeeting, false); assert.equal(f.audio.pipeline.hasMicCapture(), true);
  assert.equal(f.audio.microphones[0].id, 'mic-1'); assert.equal(f.audio.systems[0].id, 'sck');
  assert.equal(f.settings.getWrittenExamSettings().autoCaptureEnabled, true);
  const old = f.providers[0];
  await f.state.updateWrittenExamSettings({ enabled: true }, true);
  old.emit('transcript', { text: 'LATE OLD AUDIO', isFinal: true });
  assert.equal(f.audio.pipeline.hasMicCapture(), false);
  assert.equal(f.transcripts.some(row => row.text === 'LATE OLD AUDIO'), false);
  assert.equal(f.state.activeAudioSession, id); assert.equal(f.order.includes('archive-save'), false);
  await f.state.endMeeting();
  await f.state.endMeeting();
  await f.state.updateWrittenExamSettings({ intervalSeconds: 30 });
  assert.equal(f.state.endingMeeting, false, 'duplicate end must not block future settings');
});

test('ending during a permission wait prevents a late interview start', async () => {
  let release, entered;
  const permission = new Promise(resolve => { release = resolve; });
  const checking = new Promise(resolve => { entered = resolve; });
  const f = mainFixture({ examSettings: { enabled: true, autoCaptureEnabled: true },
    microphonePermission: async () => { entered(); return permission; } });
  await f.start();
  const changing = f.state.updateWrittenExamSettings({ enabled: false });
  await checking;
  const ending = f.state.endMeeting();
  release(true);
  await assert.rejects(changing, /session has ended/);
  await ending;
  assert.equal(f.audio.microphones.length, 0); assert.equal(f.state.isMeetingActive, false);
  assert.equal(f.settings.getWrittenExamSettings().autoCaptureEnabled, true);
});

test('rapid switches serialize without resetting the meeting and failed written saves leave audio alone', async () => {
  let failSave = false;
  const f = mainFixture({ examSettings: { enabled: true }, saveExam() { if (failSave) throw Error('synthetic disk failure'); } });
  await f.start();
  const id = f.state.activeAudioSession;
  await Promise.all([f.state.updateWrittenExamSettings({ enabled: false }),
    f.state.updateWrittenExamSettings({ enabled: true }), f.state.updateWrittenExamSettings({ enabled: false })]);
  assert.equal(f.audio.microphones.length, 2);
  assert.equal(f.audio.microphones[0].destroyed, true);
  assert.equal(f.state.activeAudioSession, id);
  const mic = f.audio.pipeline.microphoneCapture;
  failSave = true;
  await assert.rejects(f.state.updateWrittenExamSettings({ enabled: true }), /disk failure/);
  assert.equal(f.audio.pipeline.microphoneCapture, mic); assert.equal(mic.destroyed, false);
  assert.equal(f.settings.getWrittenExamSettings().enabled, false);
  await f.state.endMeeting();
});

test('failed interview switch stays written, preserves capture preference and does not retry', async () => {
  for (const failure of ['key', 'permission', 'capture', 'event', 'save']) {
    let checks = 0, saving = false;
    const f = mainFixture({ examSettings: { enabled: true, autoCaptureEnabled: true },
      requireSttConfigured() { checks++; if (failure === 'key') throw Error('missing key'); },
      microphonePermission: async () => failure !== 'permission',
      micError: () => failure === 'capture', saveExam() { if (saving && failure === 'save') throw Error('save failed'); },
      monitorCapture: capture => { if (failure === 'event') capture.on('start', () => capture.emit('error', Error('synthetic start failure'))); return () => {}; } });
    await f.start(); saving = true;
    await assert.rejects(f.state.updateWrittenExamSettings({ enabled: false }));
    assert.equal(f.state.writtenMeeting, true);
    assert.equal(f.settings.getWrittenExamSettings().enabled, true);
    assert.equal(f.settings.getWrittenExamSettings().autoCaptureEnabled, true);
    assert.equal(f.audio.pipeline.hasMicCapture(), false);
    f.audio.flush(100000); assert.equal(checks, 1);
    await f.state.endMeeting();
  }
});

test('missing STT configuration fails before permission, captures, or meeting state changes', async () => {
  let permissions = 0;
  const f = mainFixture({ requireSttConfigured() { throw Error('STT is not configured'); },
    microphonePermission: async () => { permissions++; return true; } });
  await assert.rejects(f.state.startMeeting(), /STT is not configured/);
  assert.equal(permissions, 0);
  assert.equal(f.audio.microphones.length, 0);
  assert.equal(f.audio.systems.length, 0);
  assert.equal(f.state.isMeetingActive, false);
});

// Failed meeting save (PLAN §8): a pending unsaved meeting refuses start in the queued
// body before STT, permission, audio-test, window or audio steps; once it is resolved,
// start works again.
test('a pending unsaved meeting refuses start with its code before any side effect', async () => {
  let permissions = 0, sttChecks = 0, pending = { id: 'unsaved' };
  const windowCalls = [], broadcasts = [];
  const f = mainFixture({ requireSttConfigured() { sttChecks++; },
    microphonePermission: async () => { permissions++; return true; } });
  f.state.intelligenceManager.getUnsavedMeeting = () => pending;
  f.state.windowHelper = { resetOverlayPosition: () => windowCalls.push('reset'), setWindowMode: mode => windowCalls.push(mode) };
  f.state.broadcastMeetingState = () => broadcasts.push('state');
  await assert.rejects(f.state.startMeeting(), error => error.code === 'pending-unsaved-meeting');
  assert.deepEqual({ permissions, sttChecks, windowCalls, broadcasts }, { permissions: 0, sttChecks: 0, windowCalls: [], broadcasts: [] });
  assert.equal(f.order.includes('audio-test-stop'), false);
  assert.equal(f.audio.microphones.length, 0);
  assert.equal(f.audio.systems.length, 0);
  assert.equal(f.state.isMeetingActive, false);

  pending = null;
  await f.start();
  assert.equal(f.state.isMeetingActive, true);
  assert.deepEqual(windowCalls, ['reset', 'overlay']);
});

test('quitting with an unsaved meeting logs its metadata only', async () => {
  const logged = [];
  const record = (...args) => logged.push(args);
  const f = mainFixture({ console: { log: record, warn: record, error: record } });
  const secret = 'TRANSCRIPT_MUST_NOT_BE_LOGGED';
  f.state.intelligenceManager.getUnsavedMeeting = () => ({ id: 'unsaved', startedAt: 1, durationMs: 2, transcriptCount: 3, reason: 'write-error', transcript: secret });
  await f.state.shutdownAudio();
  const text = JSON.stringify(logged);
  assert.match(text, /unsaved meeting; it is lost on exit/);
  assert.match(text, /"transcriptCount":3,"reason":"write-error"/);
  assert.equal(text.includes(secret), false);
});
