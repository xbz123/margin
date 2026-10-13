import test from 'node:test';
import assert from 'node:assert/strict';
import { mainFixture } from '../../audio/__tests__/mainMeetingFixture.mjs';
import { deferred } from '../../audio/__tests__/meetingAudioFixture.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('S42-03 production manual action collects both channels without finishing provider tasks or stopping capture', async () => {
  const f = mainFixture(); await f.start();
  const user = f.providers.find(item => item.channel === 'user');
  user.emit('transcript', { segmentId: 'tail', text: 'manual', isFinal: false });
  const mark = f.state.markDictation(0);
  const controller = new AbortController();
  const collector = f.state.collectSpeech({ cutoffAt: Date.now(), deadline: Date.now() + 10, signal: controller.signal, dictation: mark });
  user.emit('transcript', { segmentId: 'tail', text: 'manual tail', isFinal: true });
  const frozen = await collector.frozen;
  assert.equal(f.order.some(item => item.startsWith('finalize:')), false, 'a manual action never finishes a provider task');
  assert.equal(frozen.channels.user.segments.at(-1).text, 'manual tail');
  assert.equal(frozen.dictation, 'manual tail');
  assert.equal(f.transcripts.at(-1).text, 'manual tail');
  assert.equal(f.audio.microphones[0].destroyed, false);
  await f.state.endMeeting();
  assert.equal(f.order.filter(item => item.startsWith('finalize:')).length, 2, 'the meeting drain still finishes both tasks');
});

test('a denied start can be cleaned up without saving an unrelated session', async () => {
  const f = mainFixture({ microphonePermission: async () => false });
  await assert.rejects(f.state.startMeeting(), /permission denied/);
  await f.state.endMeeting();
  assert.equal(f.order.includes('archive-save'), false);
  assert.equal(f.audio.microphones.length, 0);
});

test('production Stop cancels answers, joins native release, drains finals, saves, then clears display', async () => {
  const f = mainFixture();
  await f.start();
  const capture = deferred(), final = deferred();
  f.audio.microphones[0].destroy = () => { f.order.push('capture-stop'); return capture.promise; };
  const provider = f.providers.find(item => item.channel === 'user');
  provider.finalize = () => final.promise;
  const stopping = f.state.endMeeting();
  await tick();
  assert.ok(f.order.indexOf('answers-cancel') < f.order.indexOf('capture-stop'));
  assert.equal(f.order.includes('stt-drain'), false);
  capture.resolve();
  await tick();
  assert.equal(f.order.includes('stt-drain'), true);
  assert.equal(f.order.includes('archive-save'), false);
  provider.emit('transcript', { text: 'tail', isFinal: true });
  provider.emit('transcript', { text: 'not-final', isFinal: false });
  assert.deepEqual(f.transcripts.map(row => row.text), ['tail']);
  final.resolve();
  await stopping;
  assert.ok(f.order.indexOf('transcript:tail') < f.order.indexOf('archive-save'));
  assert.ok(f.order.indexOf('archive-save') < f.order.indexOf('display-clear'));
  assert.equal(f.state.activeAudioSession, null);
  await f.start();
  provider.emit('transcript', { text: 'stale', isFinal: true });
  f.state.handleSttTranscript({ sessionId: 'old', channel: 'user', text: 'stale', final: true });
  assert.deepEqual(f.transcripts.map(row => row.text), ['tail']);
  await f.state.endMeeting();
});

test('duplicate stops join and next start cannot overtake saving', async () => {
  const f = mainFixture();
  await f.start();
  const saved = deferred();
  const saving = deferred();
  let saves = 0;
  f.state.intelligenceManager.stopMeeting = () => { saves++; saving.resolve(); return saved.promise; };
  const first = f.state.endMeeting(), duplicate = f.state.endMeeting();
  const next = f.state.startMeeting();
  await saving.promise;
  assert.equal(saves, 1);
  assert.equal(f.audio.microphones.length, 1);
  saved.resolve();
  await Promise.all([first, duplicate, next]);
  const init = f.audio.pipeline._audioInitPromise;
  f.audio.flush(0);
  await init;
  assert.equal(f.audio.microphones.length, 2);
  f.state.intelligenceManager.stopMeeting = async () => {};
  await f.state.endMeeting();
});

test('sleep release precedes wake reconstruction and a stopped session cannot resurrect', async () => {
  const f = mainFixture();
  await f.start();
  const released = deferred();
  f.audio.systems[0].destroy = () => released.promise;
  const sleeping = f.state.suspendAudio();
  const waking = f.state.restartCapturesAfterResume();
  await tick();
  assert.equal(f.audio.systems.length, 1);
  const stop = f.state.endMeeting();
  released.resolve();
  await Promise.all([sleeping, waking, stop]);
  assert.equal(f.audio.systems.length, 1);
  await f.state.restartCapturesAfterResume();
  assert.equal(f.audio.systems.length, 1);
});

test('shutdown joins active session tail and rejects a later start', async () => {
  const f = mainFixture();
  await f.start();
  const first = f.state.shutdownAudio();
  assert.equal(f.state.shutdownAudio(), first);
  await first;
  assert.ok(f.order.includes('archive-save'));
  assert.ok(f.audio.microphones.every(capture => capture.destroyed));
  await assert.rejects(f.state.startMeeting(), /quitting/);
});

test('native release failure still saves the tail but blocks reuse of the unreleased handle', async () => {
  const f = mainFixture();
  await f.start();
  f.audio.microphones[0].destroy = () => Promise.reject(new Error('synthetic release failure'));
  await assert.rejects(f.state.endMeeting(), /release failed/);
  assert.ok(f.order.includes('archive-save'));
  assert.equal(f.state._isDraining, false);
  assert.equal(f.state.activeAudioSession, null);
  await assert.rejects(f.state.startMeeting(), /release failed/);
  assert.equal(f.audio.microphones.length, 1);
});
