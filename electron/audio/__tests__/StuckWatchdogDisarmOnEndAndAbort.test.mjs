import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { deferred, fixture } from './meetingAudioFixture.mjs';

// Compiles the production health monitors and the monitorCapture callback that forwards them.
function productionHealth(timers, owner) {
  const text = fs.readFileSync(new URL('../../main.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('main.ts', text, ts.ScriptTarget.Latest, true);
  const state = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AppState');
  const member = name => state.members.find(node => node.name?.getText(tree) === name);
  const methods = ['wireSystemCapture', 'wireMicCapture'].map(name => member(name).getText(tree));
  let monitor;
  const find = node => {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'monitorCapture') monitor = node.initializer.getText(tree);
    else ts.forEachChild(node, find);
  };
  find(member('meetingAudio'));
  const Class = new Function('setTimeout', 'clearTimeout', 'console', 'formatPermissionMessage',
    ts.transpileModule('class Health {\nmonitorCapture = ' + monitor + ';\n' + methods.join('\n') + '}\nreturn Health;', {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText)(
      callback => { const timer = { callback, cancelled: false, owner: owner() }; timers.push(timer); return timer; },
      timer => { timer.cancelled = true; }, { log() {}, warn() {} }, () => 'synthetic permission warning');
  return new Class();
}

test('production health watchdogs are disarmed before native destroy on stop, replacement and abort', async () => {
  const timers = [], errors = [], order = [], forwarded = [];
  let runningCapture, gate = null;
  const health = productionHealth(timers, () => runningCapture);
  Object.assign(health, { isMeetingActive: true, detectSameInputOutputDevice: () => undefined, sendAudioCaptureFailed: event => errors.push(event) });
  const f = fixture({
    capability: async () => { await gate?.promise; return { effectiveDenied: false }; },
    monitorCapture: (capture, channel) => {
      const cleanup = health.monitorCapture(capture, channel);
      forwarded.push(`${channel}:${typeof cleanup}`);
      const start = capture.start.bind(capture);
      capture.start = () => { runningCapture = capture; start(); runningCapture = null; };
      const destroy = capture.destroy.bind(capture);
      capture.destroy = () => {
        assert.ok(timers.filter(timer => timer.owner === capture).every(timer => timer.cancelled), 'disarm precedes native destroy');
        order.push(['destroy', capture]);
        return destroy();
      };
      return () => { order.push(['cleanup', capture]); cleanup(); };
    },
  });
  Object.defineProperties(health, {
    microphoneCapture: { get: () => f.pipeline.microphoneCapture },
    systemAudioCapture: { get: () => f.pipeline.systemAudioCapture },
  });
  const live = () => timers.filter(timer => !timer.cancelled);

  // Stop.
  await f.begin();
  assert.deepEqual(forwarded.sort(), ['interviewer:function', 'user:function'], 'monitorCapture forwards each disarm closure');
  assert.equal(timers.length, 2);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
  for (const timer of live()) timer.callback();
  assert.deepEqual(errors, []);
  // A repeated stop releases nothing again and leaves no timer behind.
  const stopped = order.length;
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
  assert.equal(order.length, stopped);
  assert.deepEqual(live(), []);

  // Device replacement, then stop.
  await f.begin();
  await f.pipeline.reconfigureAudio();
  assert.equal(live().length, 2);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
  assert.deepEqual(live(), []);

  // Abort while a replacement is waiting on the capability probe: the system capture
  // is already released, the microphone is released by the abort.
  await f.begin();
  gate = deferred();
  const replacing = f.pipeline.reconfigureAudio();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.pipeline.systemAudioCapture, null);
  const aborted = f.pipeline.abortInit();
  gate.resolve();
  await aborted;
  await replacing;
  await f.pipeline.detachAndDestroy();
  assert.deepEqual(live(), []);
  assert.deepEqual(errors, []);
  assert.deepEqual(f.events.filter(([kind]) => kind === 'capture-failed'), []);

  // Every capture had its own cleanup run once, before its own native destroy.
  const captures = [...f.microphones, ...f.systems];
  assert.equal(captures.length, 8);
  for (const capture of captures) {
    assert.deepEqual(order.filter(([, owner]) => owner === capture).map(([kind]) => kind), ['cleanup', 'destroy'], `${capture.kind} capture`);
  }
});

test('a throwing monitor cleanup still destroys the native capture and reports the failure', async () => {
  const f = fixture({ monitorCapture: capture => () => { f.log.push(`${capture.kind}:cleanup`); throw new Error('synthetic cleanup failure'); } });
  await f.begin();
  await f.pipeline.abortInit();
  await assert.rejects(f.pipeline.detachAndDestroy(), /Native audio release failed/);
  for (const capture of [...f.microphones, ...f.systems]) {
    assert.equal(capture.destroyed, true);
    assert.ok(f.log.indexOf(`${capture.kind}:cleanup`) < f.log.indexOf(`${capture.kind}:destroy`));
  }
});

test('captures without a monitor callback are released normally', async () => {
  const f = fixture();
  await f.begin();
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
  await f.pipeline.waitForRelease();
  assert.equal(f.microphones.length + f.systems.length, 2);
  assert.ok([...f.microphones, ...f.systems].every(capture => capture.destroyed));
});
