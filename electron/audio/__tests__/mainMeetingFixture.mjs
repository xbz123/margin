import fs from 'node:fs';
import ts from 'typescript';
import { EventEmitter } from 'node:events';
import { fixture } from './meetingAudioFixture.mjs';

export function loadAudioModule(name) {
  const source = fs.readFileSync(new URL('../' + name + '.ts', import.meta.url), 'utf8');
  const exports = {};
  new Function('exports', ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(exports);
  return exports;
}

const { MeetingSttSession } = loadAudioModule('MeetingSttSession');
const { MeetingLifecycleQueue } = loadAudioModule('meetingLifecycleQueue');
const { TranscriptDisplayThrottle } = loadAudioModule('TranscriptDisplayThrottle');
const source = fs.readFileSync(new URL('../../main.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const app = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AppState');
const names = ['startMeeting', 'endMeeting', 'handleSttTranscript', 'suspendAudio', 'restartCapturesAfterResume',
  'reconfigureAudio', 'reconfigureSttProvider', 'discardSttProviders', 'shutdownAudio', 'setQuitting', 'finalizeMicSTT', 'setupIntelligenceEvents'];
const methods = names.map(name => {
  const method = app.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === name);
  if (!method) throw new Error('Missing production method ' + name);
  return method.getText(tree);
});
const js = ts.transpileModule('class AppState {' + methods.join('\n') + '}\nreturn AppState;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

export function mainFixture(options = {}) {
  const order = [], transcripts = [], providers = [];
  const Class = new Function('ensureMacMicrophoneAccess', 'formatPermissionMessage', 'crypto', 'CredentialsManager', 'console', js)(
    options.microphonePermission ?? (async () => true), () => 'permission denied',
    { randomUUID: () => 'meeting-' + providers.length + '-' + order.length },
    { getInstance: () => ({ getDefaultModel: () => 'synthetic-model', getSttProvider: () => 'synthetic',
      requireSttConfigured: options.requireSttConfigured ?? (() => {}) }) },
    { log() {}, warn() {}, error() {} },
  );
  const state = new Class();
  const audio = fixture({ ...options, querySnapshot: () => ({
    active: state.isMeetingActive && !state.audioSuspended, quitting: state._isQuitting, verbose: false,
  }) });
  const session = new MeetingSttSession({
    create: channel => {
      const provider = new EventEmitter();
      Object.assign(provider, {
        channel, writes: [], start() { order.push('stt-start:' + channel); },
        write(chunk) { this.writes.push(chunk); },
        stop(flush) { order.push('stt-stop:' + channel + ':' + flush); },
        finalize() { order.push('finalize:' + channel); },
        setSampleRate() {}, setAudioChannelCount() {},
      });
      providers.push(provider);
      return provider;
    },
    onTranscript: event => state.handleSttTranscript(event),
  });
  const drain = session.drain.bind(session);
  session.drain = ms => { order.push('stt-drain'); return drain(ms, 0); };
  Object.assign(audio.stt, {
    get: channel => session.get(channel), ensure: channel => session.ensure(channel),
    stopChannels: () => session.stopChannels(),
  });
  Object.assign(state, {
    isMeetingActive: false, _isQuitting: false, _meetingGeneration: 0, _isDraining: false,
    activeAudioSession: null, audioSuspended: false, suspendTask: Promise.resolve(), shutdownTask: null,
    meetingLifecycle: new MeetingLifecycleQueue(), meetingStt: session, meetingAudio: audio.pipeline,
    transcriptDisplay: new TranscriptDisplayThrottle(() => {}),
    windowHelper: { resetOverlayPosition() {}, setWindowMode() {} },
    processingHelper: {
      cancelOngoingRequests: () => order.push('processing-cancel'),
      getLLMHelper: () => ({ setModel() {}, getCurrentModelSelection: () => 'synthetic-model' }),
    },
    intelligenceManager: {
      reset() {}, setMeetingMetadata() {}, resetEngine: () => order.push('answers-cancel'),
      handleTranscript: payload => { transcripts.push(payload); order.push('transcript:' + payload.text); },
      stopMeeting: async () => { order.push('archive-save'); },
    },
    stopAudioTest: async () => { order.push('audio-test-stop'); },
    sendToMeetingSurfaces() {}, broadcastMeetingState() {}, sendModelChanged() {},
    broadcast() {}, sendAudioCaptureFailed: () => order.push('audio-error'),
  });
  const clear = state.transcriptDisplay.clear.bind(state.transcriptDisplay);
  state.transcriptDisplay.clear = () => { order.push('display-clear'); clear(); };
  return { state, audio, session, providers, order, transcripts,
    start: async metadata => {
      await state.startMeeting(metadata);
      const init = audio.pipeline._audioInitPromise;
      audio.flush(0);
      await init;
    },
  };
}
