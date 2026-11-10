// AG-71: a capture whose native side reports an error must release that native
// monitor, not just flip isRecording.
//
// Symptom: the native callback delivers an error (Windows: the WASAPI loopback
// endpoint was unplugged or invalidated; any platform: a CPAL device error). The
// wrappers set isRecording = false and emitted 'error', but kept this.monitor. The
// pipeline then destroys the wrapper; destroy() awaits stop(), which returns early
// because isRecording is already false, so monitor.stop() never runs and the
// native DSP thread (and the microphone's CPAL stream) live on until GC.
//
// Strategy: load the compiled wrappers with a fake native module, deliver an error
// through the native data callback, then check that the native monitor is stopped
// exactly once, late chunks are dropped, nothing is pre-warmed on the failed
// device, and a restart builds a fresh native instance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron/audio');
// require() takes a plain file path on every platform; ESM import() would need a
// file: URL, since a Windows drive letter reads as a URL scheme.
const loadDist = (file) => createRequire(import.meta.url)(path.join(distRoot, file));

const created = { system: [], mic: [] };

function makeFake(kind) {
    return {
        kind,
        startCalls: 0,
        stopCalls: 0,
        onData: null,
        start(cb) { this.startCalls++; this.onData = cb; },
        stop() { this.stopCalls++; },
        getSampleRate() { return 48000; },
    };
}

function track(kind) {
    const fake = makeFake(kind);
    created[kind].push(fake);
    return fake;
}

const fakeNativeModule = {
    getInputDevices: () => [],
    getOutputDevices: () => [],
    SystemAudioCapture: function FakeSystemCapture() { return track('system'); },
    MicrophoneCapture: function FakeMicCapture() { return track('mic'); },
};

const fakeApp = { getAppPath: () => '/tmp/ag71-fake-app', isPackaged: false, isReady: () => false };
const origLoad = Module._load;
Module._load = function patched(request, _parent, _isMain) {
    if (request === 'electron') {
        return { app: fakeApp };
    }
    if (request.endsWith('.node') || request.includes('native-module')) return fakeNativeModule;
    return origLoad.apply(this, arguments);
};

const { SystemAudioCapture } = loadDist('SystemAudioCapture.js');
const { MicrophoneCapture } = loadDist('MicrophoneCapture.js');

const settle = async () => {
    for (let turn = 0; turn < 5; turn++) await new Promise((done) => setImmediate(done));
};

for (const [label, Wrapper, list] of [
    ['SystemAudioCapture', SystemAudioCapture, created.system],
    ['MicrophoneCapture', MicrophoneCapture, created.mic],
]) {
    test(`${label}: a native error releases the native monitor exactly once`, async () => {
        list.length = 0;
        const cap = new Wrapper('device-under-test');
        const errors = [];
        const data = [];
        cap.on('error', (e) => errors.push(e));
        cap.on('data', (c) => data.push(c));
        cap.start();
        assert.equal(list.length, 1, 'one native instance');
        const native = list[0];

        native.onData(null, Buffer.from([1, 2]));
        native.onData(new Error('simulated endpoint invalidated'), undefined);
        // A chunk the native side had already queued before it reported the error.
        native.onData(null, Buffer.from([3, 4]));

        assert.equal(errors.length, 1, 'error is emitted once');
        assert.equal(data.length, 1, 'chunks after the error are dropped');
        await settle();
        assert.equal(native.stopCalls, 1, 'native monitor stopped after the error');

        // The pipeline's recovery path: destroy the failed wrapper.
        await cap.destroy();
        await cap.stop();
        await settle();
        assert.equal(native.stopCalls, 1, 'destroy/stop after the error do not stop it again');
        assert.equal(list.length, 1, 'nothing is pre-warmed on the failed device');
    });

    test(`${label}: restart after a native error builds a fresh native instance`, async () => {
        list.length = 0;
        const cap = new Wrapper('device-under-test');
        cap.on('error', () => {});
        cap.start();
        const first = list[0];
        first.onData(new Error('simulated device error'), undefined);
        await settle();

        cap.start();
        const second = list[list.length - 1];
        assert.notStrictEqual(second, first, 'restart uses a new native instance');
        assert.equal(first.startCalls, 1, 'the failed instance is not restarted');
        assert.equal(second.startCalls, 1);
        await cap.destroy();
        await settle();
        assert.equal(second.stopCalls, 1);
    });
}
