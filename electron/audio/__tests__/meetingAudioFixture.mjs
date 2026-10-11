import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

export function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

export function fixture({ capability, stopChannels, inputDevices, outputDevices, defaultOutputId, micError, systemError, monitorCapture, querySnapshot } = {}) {
  const source = fs.readFileSync(new URL('../MeetingAudioPipeline.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const log = [];
  const microphones = [];
  const systems = [];
  const timers = [];
  const intervals = [];
  const provider = channel => ({
    writes: [],
    start() { log.push(`stt:${channel}:start`); },
    stop() {},
    write(chunk) { this.writes.push(chunk); },
    setSampleRate() {},
    setAudioChannelCount() {},
    notifySpeechEnded() {},
  });
  const providers = { user: provider('user'), interviewer: provider('interviewer') };
  const stt = {
    get: channel => providers[channel],
    ensure: channel => providers[channel],
    set: (channel, value) => { providers[channel] = value; },
    stopChannels: stopChannels ?? (async () => {}),
  };
  class FakeCapture extends EventEmitter {
    started = false;
    stopped = false;
    destroyed = false;
    start() { this.started = true; log.push(`${this.kind}:start`); this.emit('start'); }
    stop() { this.stopped = true; log.push(`${this.kind}:stop`); this.emit('stop'); }
    destroy() { this.destroyed = true; log.push(`${this.kind}:destroy`); return Promise.resolve(); }
    disablePreWarm() { log.push(`${this.kind}:disablePreWarm`); }
    getSampleRate() { return 48000; }
    getActiveBackend() { return 'coreaudio'; }
  }
  class FakeMicrophoneCapture extends FakeCapture {
    constructor(id) { super(); if (micError?.(id)) throw new Error('synthetic mic failure'); this.kind = 'mic'; this.id = id; microphones.push(this); }
  }
  class FakeSystemAudioCapture extends FakeCapture {
    constructor(id) { super(); if (systemError?.(id)) throw new Error('synthetic system failure'); this.kind = 'system'; this.id = id; systems.push(this); }
  }
  const exports = {};
  let snapshot = { active: true, quitting: false, verbose: false };
  const events = [];
  vm.runInNewContext(code, {
    exports, Buffer, AbortController, setImmediate: callback => callback(),
    process: { platform: 'darwin', env: {} },
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (callback, delay) => {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: timer => { timer.cancelled = true; },
    setInterval: (callback, delay) => {
      const interval = { callback, delay, cancelled: false, unref() {} };
      intervals.push(interval);
      return interval;
    },
    clearInterval: interval => { interval.cancelled = true; },
    require: name => {
      if (name === './nativeModuleLoader') return { loadNativeModule: () => ({ getDefaultOutputDeviceId: defaultOutputId ?? (() => 'output-a'), screenCaptureDisplaysAvailable: () => true }) };
      if (name === './SystemAudioCapture') return { SystemAudioCapture: FakeSystemAudioCapture };
      if (name === './MicrophoneCapture') return { MicrophoneCapture: FakeMicrophoneCapture };
      if (name === './AudioDevices') return { AudioDevices: {
        getInputDevices: inputDevices ?? (async () => []),
        getOutputDevices: outputDevices ?? (async () => []),
      } };
      if (name === '../services/CredentialsManager') return { CredentialsManager: { getInstance: () => ({ getSttProvider: () => 'mock' }) } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  const pipeline = new exports.MeetingAudioPipeline(stt, () => querySnapshot?.() ?? snapshot, {
    monitorCapture,
    captureFailed: payload => events.push(['capture-failed', payload]),
    systemPermissionDenied: (message, titleKey) => events.push(['permission-denied', message, titleKey]),
    deviceSelection: payload => events.push(['device-selection', payload]),
  }, capability ?? (async () => ({ effectiveDenied: false })));
  const flush = delay => {
    for (const timer of timers.filter(item => item.delay === delay && !item.cancelled)) {
      timer.cancelled = true;
      timer.callback();
    }
  };
  const begin = async options => {
    pipeline.begin(options ?? { ambient: false });
    const init = pipeline._audioInitPromise;
    flush(0);
    await init;
  };
  return { pipeline, stt, providers, events, log, microphones, systems, timers, intervals, flush, begin,
    settle: async () => { await Promise.all([...pipeline.pending]); },
    setSnapshot: value => { snapshot = { ...snapshot, ...value }; } };
}
