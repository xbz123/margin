import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { deferred, fixture } from './meetingAudioFixture.mjs';

// Compiles the production health monitors and the monitorCapture callback that forwards them.
function productionHealth(timers, owner, now = Date.now) {
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
  const Class = new Function('setTimeout', 'clearTimeout', 'console', 'formatPermissionMessage', 'Date',
    ts.transpileModule('class Health {\nmonitorCapture = ' + monitor + ';\n' + methods.join('\n') + '}\nreturn Health;', {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText)(
      callback => { const timer = { callback, cancelled: false, owner: owner() }; timers.push(timer); return timer; },
      timer => { timer.cancelled = true; }, { log() {}, warn() {} }, reason => reason, { now });
  return new Class();
}

test('allowed system capture forwards silent keepalives and resumed audio without permission warnings', async () => {
  for (const amplitude of [0, 20]) {
    let now = 1000, permissionChecks = 0;
    const timers = [], errors = [];
    const health = productionHealth(timers, () => null, () => now);
    Object.assign(health, { isMeetingActive: true, sendAudioCaptureFailed: e => errors.push(e) });
    const f = fixture({
      capability: async () => { permissionChecks++; return { effectiveDenied: false }; },
      monitorCapture: (capture, channel) => channel === 'interviewer' ? health.wireSystemCapture(capture) : () => {},
    });
    Object.defineProperty(health, 'systemAudioCapture', { get: () => f.pipeline.systemAudioCapture });
    await f.begin();
    try {
      assert.equal(permissionChecks, 1);
      const capture = f.pipeline.systemAudioCapture;
      const quiet = Buffer.alloc(1920);
      for (let i = 0; i < quiet.length; i += 2) quiet.writeInt16LE(i < 960 ? amplitude : -amplitude, i);
      // Native silence suppression emits zero-filled keepalives about every 100ms.
      for (let elapsed = 0; elapsed <= 20000; elapsed += 100) {
        now = 1000 + elapsed;
        capture.emit('data', quiet);
      }
      assert.deepEqual(errors, [], 'silence after an allowed preflight is not evidence of denied permission');
      assert.ok(timers.every(timer => timer.cancelled), 'a received keepalive disarms the no-data watchdog');
      const speech = Buffer.alloc(1920);
      for (let i = 0; i < speech.length; i += 2) speech.writeInt16LE(i < 960 ? 2000 : -2000, i);
      capture.emit('data', speech);
      assert.equal(f.providers.interviewer.writes.length, 202);
      assert.strictEqual(f.providers.interviewer.writes.at(-1), speech);
      assert.deepEqual(errors, []);
    } finally { await f.pipeline.detachAndDestroy(); }
  }
});

test('system no-data watchdog and denied preflight remain distinct from silent keepalives', async () => {
  const timers = [], errors = [];
  const health = productionHealth(timers, () => null);
  Object.assign(health, { isMeetingActive: true, detectSameInputOutputDevice: () => null, sendAudioCaptureFailed: e => errors.push(e) });
  const f = fixture({ monitorCapture: (capture, channel) => channel === 'interviewer' ? health.wireSystemCapture(capture) : () => {} });
  Object.defineProperty(health, 'systemAudioCapture', { get: () => f.pipeline.systemAudioCapture });
  await f.begin();
  try {
    for (const timer of timers.filter(timer => !timer.cancelled)) timer.callback();
    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, 'system-audio-stuck');
    assert.equal(errors[0].channel, 'system');
  } finally { await f.pipeline.detachAndDestroy(); }
  const denied = fixture({ capability: async () => ({ effectiveDenied: true, message: 'synthetic denial' }) });
  await denied.begin();
  try {
    assert.equal(denied.pipeline.systemAudioCapture, null);
    assert.equal(denied.events.filter(([kind]) => kind === 'permission-denied').length, 1);
  } finally { await denied.pipeline.detachAndDestroy(); }
});

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
