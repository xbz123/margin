import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { fixture } from './meetingAudioFixture.mjs';

test('production health watchdogs are disarmed before native destroy on stop and replacement', async () => {
  const text = fs.readFileSync(new URL('../../main.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('main.ts', text, ts.ScriptTarget.Latest, true);
  const state = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AppState');
  const methods = ['wireSystemCapture', 'wireMicCapture'].map(name => state.members.find(node => node.name?.getText(tree) === name).getText(tree));
  const timers = [], errors = [];
  let runningCapture;
  const Class = new Function('setTimeout', 'clearTimeout', 'console', 'formatPermissionMessage',
    ts.transpileModule('class Health {' + methods.join('\n') + '}\nreturn Health;', {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText)(
      callback => { const timer = { callback, cancelled: false, owner: runningCapture }; timers.push(timer); return timer; },
      timer => { timer.cancelled = true; }, { log() {}, warn() {} }, () => 'synthetic permission warning');
  const health = new Class();
  Object.assign(health, { isMeetingActive: true, detectSameInputOutputDevice: () => undefined, sendAudioCaptureFailed: event => errors.push(event) });
  const f = fixture({ monitorCapture: (capture, channel) => {
    if (channel === 'user') health.wireMicCapture(capture);
    else health.wireSystemCapture(capture);
    const start = capture.start.bind(capture);
    capture.start = () => { runningCapture = capture; start(); runningCapture = null; };
    const destroy = capture.destroy.bind(capture);
    capture.destroy = () => {
      assert.ok(timers.filter(timer => timer.owner === capture).every(timer => timer.cancelled), 'disarm precedes native destroy');
      return destroy();
    };
  } });
  Object.defineProperties(health, {
    microphoneCapture: { get: () => f.pipeline.microphoneCapture },
    systemAudioCapture: { get: () => f.pipeline.systemAudioCapture },
  });
  await f.begin();
  assert.equal(timers.length, 2);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
  for (const timer of timers) if (!timer.cancelled) timer.callback();
  assert.deepEqual(errors, []);
  await f.begin();
  await f.pipeline.reconfigureAudio();
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
  assert.ok(timers.every(timer => timer.cancelled));
});
