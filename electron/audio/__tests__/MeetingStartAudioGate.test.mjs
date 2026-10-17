import test from 'node:test';
import assert from 'node:assert/strict';
import { mainFixture } from './mainMeetingFixture.mjs';

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
