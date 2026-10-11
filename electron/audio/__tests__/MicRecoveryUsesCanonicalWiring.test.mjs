import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './meetingAudioFixture.mjs';

test('replacement mic uses the same PCM, format and speech-end wiring; old mic is inert', async () => {
  const f = fixture();
  await f.begin();
  const old = f.microphones[0];
  old.emit('error', Error('lost device'));
  await f.settle();
  const current = f.microphones.at(-1);
  assert.notEqual(current, old);
  const rates = [], channels = [];
  let endpoints = 0;
  f.providers.user.setSampleRate = rate => rates.push(rate);
  f.providers.user.setAudioChannelCount = count => channels.push(count);
  f.providers.user.notifySpeechEnded = () => endpoints++;
  current.getSampleRate = () => 16000;
  old.emit('data', Buffer.alloc(4));
  old.emit('speech_ended');
  current.emit('data', Buffer.alloc(4));
  current.emit('speech_ended');
  assert.equal(f.providers.user.writes.length, 1);
  assert.deepEqual(rates, [16000]);
  assert.deepEqual(channels, [1]);
  assert.equal(endpoints, 1);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});
