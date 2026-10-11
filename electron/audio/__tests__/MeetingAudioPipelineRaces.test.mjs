import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './meetingAudioFixture.mjs';

test('abort revokes PCM and speech callbacks immediately even while joining a pending reconfigure', async () => {
  const permission = deferred(), entered = deferred();
  const f = fixture({ capability: reason => {
    if (reason === 'audio reconfigure') { entered.resolve(); return permission.promise; }
    return Promise.resolve({ effectiveDenied: false });
  } });
  await f.begin();
  const microphone = f.microphones[0];
  let endpoints = 0;
  f.providers.user.notifySpeechEnded = () => endpoints++;
  const changing = f.pipeline.reconfigureAudio();
  await entered.promise;
  const stopping = f.pipeline.abortInit();
  microphone.emit('data', Buffer.alloc(4));
  microphone.emit('speech_ended');
  assert.equal(f.providers.user.writes.length, 0);
  assert.equal(endpoints, 0);
  permission.resolve({ effectiveDenied: false });
  await Promise.all([changing, stopping]);
  await f.pipeline.detachAndDestroy();
});

test('native release barriers also cover route changes during microphone replacement', async () => {
  const f = fixture();
  await f.begin();
  const releasing = deferred(), entered = deferred();
  f.microphones[0].destroy = () => { entered.resolve(); return releasing.promise; };
  const replacing = f.pipeline.reconfigureAudio();
  await entered.promise;
  const route = f.pipeline.handleDefaultOutputChanged('new-route');
  await Promise.resolve();
  assert.equal(f.systems.length, 1, 'new capture must wait for native microphone release');
  releasing.resolve();
  await Promise.all([replacing, route]);
  assert.ok(f.systems.every(capture => capture === f.pipeline.systemAudioCapture || capture.destroyed));
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});

test('a superseded begin cannot clear the new init or allocate late captures', async () => {
  const f = fixture();
  f.pipeline.begin({});
  const first = f.pipeline._audioInitPromise;
  f.pipeline.begin({});
  const second = f.pipeline._audioInitPromise;
  f.flush(0);
  await Promise.all([first, second]);
  assert.equal(f.microphones.length, 1);
  assert.equal(f.systems.length, 1);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});

test('begin is deferred and starts mic before system and either STT channel', async () => {
  const f = fixture();
  f.pipeline.begin({ ambient: false });
  const init = f.pipeline._audioInitPromise;
  assert.equal(f.microphones.length, 0);
  f.flush(0);
  await init;
  assert.deepEqual(f.log.filter(item => item.endsWith(':start')).slice(0, 4),
    ['mic:start', 'stt:user:start', 'system:start', 'stt:interviewer:start']);
  assert.equal(f.pipeline.hasMicCapture(), true);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});

test('abort during a pending permission probe joins init and removes late captures', async () => {
  const permission = deferred();
  const entered = deferred();
  const f = fixture({ capability: () => { entered.resolve(); return permission.promise; } });
  f.pipeline.begin({ ambient: false });
  f.flush(0);
  await entered.promise;
  const aborting = f.pipeline.abortInit();
  permission.resolve({ effectiveDenied: false });
  await aborting;
  assert.equal(f.pipeline.hasMicCapture(), false);
  assert.ok(f.microphones.every(capture => capture.destroyed));
  assert.ok(f.systems.every(capture => capture.destroyed));
  await f.pipeline.detachAndDestroy();
});

test('detachment clears ownership synchronously and gates the next begin on native release', async () => {
  const f = fixture();
  await f.begin();
  const oldMic = f.microphones[0];
  const oldSystem = f.systems[0];
  const release = deferred();
  oldMic.destroy = () => release.promise;
  oldSystem.destroy = () => release.promise;
  await f.pipeline.abortInit();
  const tearingDown = f.pipeline.detachAndDestroy();
  assert.equal(f.pipeline.hasMicCapture(), false);
  assert.equal(f.pipeline.systemAudioCapture, null);
  f.pipeline.begin({ ambient: false });
  const nextInit = f.pipeline._audioInitPromise;
  f.flush(0);
  await Promise.resolve();
  assert.equal(f.microphones.length, 1);
  assert.equal(f.systems.length, 1);
  release.resolve();
  await tearingDown;
  await nextInit;
  assert.equal(f.microphones.length, 2);
  assert.equal(f.systems.length, 2);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});

test('a replaced capture cannot write late PCM into the live STT channel', async () => {
  const f = fixture();
  await f.begin();
  const stale = f.systems[0];
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
  const before = f.providers.interviewer.writes.length;
  stale.emit('data', Buffer.alloc(100));
  assert.equal(f.providers.interviewer.writes.length, before);
});

test('route change and system recovery share one rebuild owner', async () => {
  const permission = deferred();
  let probeCount = 0;
  const f = fixture({ capability: () => {
    probeCount++;
    return probeCount === 2 ? permission.promise : Promise.resolve({ effectiveDenied: false });
  } });
  await f.begin();
  const old = f.systems[0];
  const route = f.pipeline.handleDefaultOutputChanged('output-b');
  await Promise.resolve();
  old.emit('error', new Error('capture failed'));
  permission.resolve({ effectiveDenied: false });
  await route;
  assert.equal(f.systems.length, 2);
  assert.equal(f.pipeline.systemAudioCapture, f.systems[1]);
  assert.equal(f.pipeline._lastObservedDefaultOutputId, 'output-b');
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});

test('STT reconfiguration requests serialize while both channels remain independently wired', async () => {
  const firstStop = deferred();
  const entered = deferred();
  let stops = 0;
  const f = fixture({ stopChannels: () => {
    stops++;
    if (stops === 1) { entered.resolve(); return firstStop.promise; }
    return Promise.resolve();
  } });
  await f.begin();
  const a = f.pipeline.reconfigureSttProvider();
  const b = f.pipeline.reconfigureSttProvider();
  await entered.promise;
  assert.equal(stops, 1);
  firstStop.resolve();
  await Promise.all([a, b]);
  assert.equal(stops, 2);
  assert.ok(f.providers.user);
  assert.ok(f.providers.interviewer);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});

test('stop while enumeration is pending cannot create captures or report a stale device', async () => {
  const pending = deferred();
  const entered = deferred();
  const f = fixture({
    inputDevices: () => { entered.resolve(); return pending.promise; },
    outputDevices: async () => [],
  });
  f.pipeline.begin({ ambient: false, audio: { inputDeviceId: 'Mic A' } });
  f.flush(0);
  await entered.promise;
  f.setSnapshot({ active: false });
  const stopping = f.pipeline.abortInit();
  pending.resolve([{ id: 'Mic A', name: 'Mic A' }]);
  await stopping;
  assert.equal(f.microphones.length, 0);
  assert.equal(f.systems.length, 0);
  assert.equal(f.events.some(([kind]) => kind === 'device-selection'), false);
  await f.pipeline.detachAndDestroy();
});

test('newer reconfigure supersedes a pending lookup before any old capture is created', async () => {
  const pending = deferred();
  const entered = deferred();
  let scans = 0;
  const f = fixture({
    inputDevices: () => { entered.resolve(); return ++scans === 1 ? pending.promise : Promise.resolve([
      { id: 'Mic A', name: 'Mic A' }, { id: 'Mic B', name: 'Mic B' },
    ]); },
    outputDevices: async () => [],
  });
  const oldRun = f.pipeline.reconfigureAudio('Mic A');
  await entered.promise;
  const newRun = f.pipeline.reconfigureAudio('Mic B');
  pending.resolve([{ id: 'Mic A', name: 'Mic A' }]);
  await Promise.all([oldRun, newRun]);
  assert.equal(f.microphones.length, 1);
  assert.equal(f.microphones[0].id, 'Mic B');
  assert.equal(f.pipeline._lastRequestedInputDeviceId, 'Mic B');
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});

test('low-rate PCM is forwarded without enumeration or automatic device switching; retired PCM is ignored', async () => {
  let scans = 0;
  const f = fixture({ inputDevices: () => { scans++; return []; } });
  await f.begin();
  const mic = f.microphones[0];
  mic.getSampleRate = () => 16000;
  const before = scans;
  mic.emit('data', Buffer.alloc(96));
  assert.equal(f.providers.user.writes.length, 1);
  assert.equal(scans, before, 'PCM delivery must not trigger a device lookup');
  assert.equal(f.microphones.length, 1, 'HFP auto-switch is outside AG-40');
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
  await f.begin();
  mic.emit('data', Buffer.alloc(96));
  assert.equal(f.providers.user.writes.length, 1, 'retired microphone cannot write into the next session');
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});

test('reconfigure releases a route rebuild that claimed the slot during enumeration', async () => {
  const enumerate = deferred();
  const routePermission = deferred();
  const reconfigurePermission = deferred();
  const enumerationEntered = deferred();
  const routeEntered = deferred();
  const reconfigureEntered = deferred();
  let delayEnumerate = false;
  let currentDefaultId = 'output-a';
  const f = fixture({
    inputDevices: () => {
      if (delayEnumerate) { enumerationEntered.resolve(); return enumerate.promise; }
      return Promise.resolve([]);
    },
    outputDevices: async () => [],
    defaultOutputId: () => currentDefaultId,
    capability: reason => {
      if (reason === 'default output route change') { routeEntered.resolve(); return routePermission.promise; }
      if (reason === 'audio reconfigure') { reconfigureEntered.resolve(); return reconfigurePermission.promise; }
      return Promise.resolve({ effectiveDenied: false });
    },
  });
  await f.begin();
  const original = f.systems[0];
  delayEnumerate = true;
  const changing = f.pipeline.reconfigureAudio('Mic A', 'explicit-output');
  await enumerationEntered.promise;
  currentDefaultId = 'new-default-output';
  const routeWatcher = f.intervals.find(item => item.delay === 4000);
  assert.ok(routeWatcher, 'actual default-route watcher started');
  routeWatcher.callback();
  await routeEntered.promise;
  enumerate.resolve([{ id: 'Mic A', name: 'Mic A' }]);
  await reconfigureEntered.promise;
  routePermission.resolve({ effectiveDenied: false });
  await Promise.resolve();
  await Promise.resolve();
  const routeCapture = f.systems[1];
  assert.equal(f.pipeline.systemAudioCapture, routeCapture);
  assert.equal(routeCapture.started, true);
  reconfigurePermission.resolve({ effectiveDenied: false });
  await changing;
  assert.equal(original.destroyed, true);
  assert.equal(f.systems.length, 3);
  assert.equal(routeCapture.destroyed, true, 'route capture must be released before replacement');
  assert.equal(f.pipeline.systemAudioCapture, f.systems[2]);
  assert.equal(routeCapture.started, true, 'orphan still owns native capture');
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
  assert.equal(routeCapture.destroyed, true);
});

test('reconfigure releases a recovery capture that claimed the slot during enumeration', async () => {
  const enumerate = deferred();
  const recoveryPermission = deferred();
  const reconfigurePermission = deferred();
  const enumerationEntered = deferred();
  const recoveryEntered = deferred();
  const reconfigureEntered = deferred();
  let delayEnumerate = false;
  const f = fixture({
    inputDevices: () => {
      if (delayEnumerate) { enumerationEntered.resolve(); return enumerate.promise; }
      return Promise.resolve([]);
    },
    outputDevices: async () => [],
    capability: reason => {
      if (reason === 'system audio recovery') { recoveryEntered.resolve(); return recoveryPermission.promise; }
      if (reason === 'audio reconfigure') { reconfigureEntered.resolve(); return reconfigurePermission.promise; }
      return Promise.resolve({ effectiveDenied: false });
    },
  });
  await f.begin();
  const oldCapture = f.systems[0];
  delayEnumerate = true;
  const changing = f.pipeline.reconfigureAudio('Mic A', 'explicit-output');
  await enumerationEntered.promise;
  oldCapture.emit('error', new Error('route failed'));
  f.flush(1500);
  await recoveryEntered.promise;
  enumerate.resolve([{ id: 'Mic A', name: 'Mic A' }]);
  await reconfigureEntered.promise;
  recoveryPermission.resolve({ effectiveDenied: false });
  await Promise.resolve();
  await Promise.resolve();
  const recoveryCapture = f.systems[1];
  assert.equal(f.pipeline.systemAudioCapture, recoveryCapture);
  reconfigurePermission.resolve({ effectiveDenied: false });
  await changing;
  assert.equal(f.systems.length, 3);
  assert.equal(recoveryCapture.destroyed, true);
  assert.equal(recoveryCapture.started, true);
  assert.equal(f.pipeline.systemAudioCapture, f.systems[2]);
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
  assert.equal(recoveryCapture.destroyed, true);
});

test('stop waits for an intervening capture release and prevents a late replacement', async () => {
  const permission = deferred();
  const permissionEntered = deferred();
  const release = deferred();
  const releaseEntered = deferred();
  const f = fixture({
    inputDevices: async () => [{ id: 'Mic A', name: 'Mic A' }],
    outputDevices: async () => [],
    capability: reason => {
      if (reason === 'audio reconfigure') { permissionEntered.resolve(); return permission.promise; }
      return Promise.resolve({ effectiveDenied: false });
    },
  });
  await f.begin();
  const changing = f.pipeline.reconfigureAudio('Mic A', 'explicit-output');
  await permissionEntered.promise;
  let destroyed = false;
  f.pipeline.systemAudioCapture = {
    destroy: async () => { releaseEntered.resolve(); await release.promise; destroyed = true; },
  };
  permission.resolve({ effectiveDenied: false });
  await releaseEntered.promise;
  assert.equal(f.pipeline.systemAudioCapture, null);
  f.setSnapshot({ active: false });
  let stopped = false;
  const stopping = f.pipeline.abortInit().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  release.resolve();
  await Promise.all([changing, stopping]);
  assert.equal(destroyed, true);
  assert.equal(f.systems.length, 1, 'stop must not build a replacement after release');
  await f.pipeline.detachAndDestroy();
});

test('reconfigure releases a second capture claimed during the first release', async () => {
  const permission = deferred();
  const permissionEntered = deferred();
  const firstRelease = deferred();
  const firstReleaseEntered = deferred();
  const f = fixture({
    inputDevices: async () => [], outputDevices: async () => [],
    capability: reason => {
      if (reason === 'audio reconfigure') { permissionEntered.resolve(); return permission.promise; }
      return Promise.resolve({ effectiveDenied: false });
    },
  });
  await f.begin();
  const changing = f.pipeline.reconfigureAudio(undefined, 'new-output');
  await permissionEntered.promise;
  let firstDestroyed = false;
  f.pipeline.systemAudioCapture = {
    destroy: async () => { firstReleaseEntered.resolve(); await firstRelease.promise; firstDestroyed = true; },
  };
  permission.resolve({ effectiveDenied: false });
  await firstReleaseEntered.promise;
  let secondDestroyed = false;
  f.pipeline.systemAudioCapture = { destroy: async () => { secondDestroyed = true; } };
  firstRelease.resolve();
  await changing;
  assert.equal(firstDestroyed, true);
  assert.equal(secondDestroyed, true);
  assert.equal(f.pipeline.systemAudioCapture, f.systems.at(-1));
  await f.pipeline.abortInit();
  await f.pipeline.detachAndDestroy();
});
