import { loadNativeModule } from './nativeModuleLoader';
import { SystemAudioCapture } from './SystemAudioCapture';
import { MicrophoneCapture } from './MicrophoneCapture';
import { AudioDevices, type AudioDevice } from './AudioDevices';
import type { MeetingSttSession, ManagedSttProvider, SttChannel } from './MeetingSttSession';

type Capture = MicrophoneCapture | SystemAudioCapture;
type Capability = { effectiveDenied: boolean; message?: string };
export interface MeetingAudioSnapshot { active: boolean; quitting: boolean; verbose: boolean }
export interface MeetingAudioEvents {
  captureFailed(payload: { channel: string; message: string; terminal?: boolean }): void;
  systemPermissionDenied(message: string): void;
  deviceSelection(payload: { kind: 'input' | 'output'; requested: string | null; actual: string | null; fellBack: boolean; reason?: string }): void;
  monitorCapture?(capture: Capture, channel: SttChannel): () => void;
}
export type MeetingAudioSttPort<P extends ManagedSttProvider> = Pick<MeetingSttSession<P>, 'get' | 'ensure' | 'stopChannels'>;

// A session epoch invalidates asynchronous work; a revision chooses the latest device request.
export class MeetingAudioPipeline<P extends ManagedSttProvider = ManagedSttProvider> {
  public systemAudioCapture: SystemAudioCapture | null = null;
  public microphoneCapture: MicrophoneCapture | null = null;
  public _audioInitPromise: Promise<void> | null = null;
  public _lastRequestedInputDeviceId: string | undefined;
  public _lastRequestedOutputDeviceId: string | undefined;
  public _lastObservedDefaultOutputId = '';
  private epoch = 0;
  private revision = 0;
  private deviceTail: Promise<void> = Promise.resolve();
  private sttTail: Promise<void> = Promise.resolve();
  private released: Promise<void> = Promise.resolve();
  private readonly pending = new Set<Promise<void>>();
  private rebuilding: Promise<void> | null = null;
  private routeTimer: ReturnType<typeof setInterval> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryAttempts = 0;
  private micRecoveryAttempts = 0;
  private micRecovery: Promise<void> | null = null;
  private readonly monitorCleanups = new WeakMap<Capture, () => void>();

  constructor(
    private readonly stt: MeetingAudioSttPort<P>,
    private readonly snapshot: () => MeetingAudioSnapshot,
    private readonly events: MeetingAudioEvents,
    private readonly capability: (reason: string) => Promise<Capability>,
  ) {}

  hasMicCapture(): boolean { return this.microphoneCapture !== null; }
  waitForRelease(): Promise<void> { return this.released; }

  resetRecovery(): void {
    this.recoveryAttempts = 0;
    this.micRecoveryAttempts = 0;
  }

  private live(epoch: number): boolean {
    const state = this.snapshot();
    return epoch === this.epoch && state.active && !state.quitting;
  }

  private track(task: Promise<void>): Promise<void> {
    this.pending.add(task);
    void task.then(() => this.pending.delete(task), () => this.pending.delete(task));
    return task;
  }

  begin(options: { audio?: { inputDeviceId?: string | null; outputDeviceId?: string | null }; ambient?: boolean }): void {
    const epoch = ++this.epoch;
    const revision = ++this.revision;
    this.resetRecovery();
    const init = this.track((async () => {
      // Defer native work until the start IPC can update the renderer.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      await this.released;
      if (!this.live(epoch) || options.ambient) return;
      await this.configure(options.audio?.inputDeviceId, options.audio?.outputDeviceId, epoch, revision, 'meeting start');
      if (this.live(epoch)) this.watchRoute();
    })());
    this._audioInitPromise = init;
    void init.catch(() => {
      if (this.live(epoch)) this.report('audio', 'Audio initialization failed');
    }).finally(() => {
      if (this._audioInitPromise === init) this._audioInitPromise = null;
    });
  }

  async abortInit(): Promise<void> {
    ++this.epoch;
    ++this.revision;
    this.stopWatching();
    if (this.recoveryTimer !== null) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    await Promise.allSettled([...this.pending]);
    this._audioInitPromise = null;
  }

  stopWatching(): void {
    if (this.routeTimer !== null) clearInterval(this.routeTimer);
    this.routeTimer = null;
  }

  private destroy(capture: Capture | null): Promise<void> {
    if (!capture) return this.released;
    const cleanup = this.monitorCleanups.get(capture);
    this.monitorCleanups.delete(capture);
    const release = (async () => {
      // Baseline health monitors must be disarmed before deferred native stop.
      try { cleanup?.(); }
      finally { await capture.destroy(); }
    })();
    this.released = Promise.allSettled([this.released, release]).then(results => {
      if (results.some(result => result.status === 'rejected')) throw new Error('Native audio release failed; restart the application before another meeting');
    });
    void this.released.catch(() => {});
    return this.released;
  }

  detachAndDestroy(): Promise<void> {
    this.stopWatching();
    const captures = [this.microphoneCapture, this.systemAudioCapture];
    this.microphoneCapture = null;
    this.systemAudioCapture = null;
    this.released = Promise.allSettled([this.released, ...captures.map(capture => this.destroy(capture))]).then(results => {
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length) throw new Error('Native audio release failed; restart the application before another meeting');
    });
    void this.released.catch(() => {});
    return this.released;
  }

  reconfigureAudio(input?: string | null, output?: string | null): Promise<void> {
    const epoch = this.epoch;
    const revision = ++this.revision;
    const task = this.track(this.deviceTail.then(() => this.configure(input, output, epoch, revision, 'audio reconfigure')));
    this.deviceTail = task.catch(() => {});
    return task;
  }

  private async configure(input: string | null | undefined, output: string | null | undefined, epoch: number, revision: number, reason: string): Promise<void> {
    const current = () => this.live(epoch) && revision === this.revision;
    if (!current()) return;
    await this.released;
    const [inputs, outputs] = await Promise.all([AudioDevices.getInputDevices(), AudioDevices.getOutputDevices()]);
    if (!current()) return;
    const choose = (kind: 'input' | 'output', requested: string | null | undefined, choices: AudioDevice[]) => {
      const explicit = requested && requested !== 'default' ? requested : undefined;
      // 'sck' selects a capture backend, not an enumerated output device.
      const selected = explicit && (kind === 'output' && explicit === 'sck' || choices.some(device => device.id === explicit)) ? explicit : undefined;
      this.events.deviceSelection({ kind, requested: explicit ?? null, actual: selected ?? 'default',
        fellBack: Boolean(explicit && !selected), ...(explicit && !selected ? { reason: 'missing' } : {}) });
      return selected;
    };
    const micId = choose('input', input, inputs);
    const systemId = choose('output', output, outputs);
    this._lastRequestedInputDeviceId = micId;
    this._lastRequestedOutputDeviceId = systemId;
    if (this.systemAudioCapture) {
      const previous = this.systemAudioCapture;
      this.systemAudioCapture = null;
      await this.destroy(previous);
    }
    if (!current()) return;
    const permission = await this.capability(reason);
    if (!current()) return;
    const oldMic = this.microphoneCapture;
    this.microphoneCapture = null;
    await this.destroy(oldMic);
    if (!current()) return;
    // A route recovery may have acquired the slot while enumeration/probing was pending.
    while (this.systemAudioCapture) {
      const intervening = this.systemAudioCapture;
      this.systemAudioCapture = null;
      await this.destroy(intervening);
      if (!current()) return;
    }
    if (permission.effectiveDenied) this.events.systemPermissionDenied(permission.message ?? 'System audio permission is denied');
    else {
      try {
        this.systemAudioCapture = new SystemAudioCapture(systemId);
        this.wire(this.systemAudioCapture, 'interviewer');
      } catch { this.report('system', 'System audio capture could not be opened'); }
    }
    try {
      this.microphoneCapture = new MicrophoneCapture(micId);
      this.wire(this.microphoneCapture, 'user');
    } catch { this.report('mic', 'Microphone capture could not be opened'); }
    if (!current()) return;
    this.startChannel('user', this.microphoneCapture);
    this.startChannel('interviewer', this.systemAudioCapture);
    if (current()) this.watchRoute();
  }

  private startChannel(channel: SttChannel, capture: Capture | null): void {
    if (!capture) return;
    try {
      const provider = this.stt.ensure(channel);
      capture.start();
      provider?.start?.();
      if (!provider) this.report(channel === 'user' ? 'mic' : 'system', 'Speech provider is unavailable for this channel');
    } catch { this.report(channel === 'user' ? 'mic' : 'system', 'Audio channel failed to start'); }
  }

  reconfigureSttProvider(): Promise<void> {
    const epoch = this.epoch;
    const task = this.track(this.sttTail.then(async () => {
      await this.stt.stopChannels();
      if (!this.live(epoch)) return;
      for (const [channel, capture] of [['user', this.microphoneCapture], ['interviewer', this.systemAudioCapture]] as const) {
        if (!capture) continue;
        const provider = this.stt.ensure(channel);
        provider?.setSampleRate?.(capture.getSampleRate());
        provider?.setAudioChannelCount?.(1);
        provider?.start?.();
      }
    }));
    this.sttTail = task.catch(() => {});
    return task;
  }

  handleDefaultOutputChanged(id?: string): Promise<void> {
    return this.rebuildSystem('default output route change', id);
  }

  private rebuildSystem(reason: string, id?: string): Promise<void> {
    if (this.rebuilding) return this.rebuilding;
    const epoch = this.epoch;
    if (!this.live(epoch)) return Promise.resolve();
    const task = this.track((async () => {
      if (id !== undefined) this._lastObservedDefaultOutputId = id;
      const previous = this.systemAudioCapture;
      this.systemAudioCapture = null;
      await this.destroy(previous);
      if (!this.live(epoch)) return;
      const permission = await this.capability(reason);
      if (!this.live(epoch)) return;
      if (permission.effectiveDenied) {
        this.events.systemPermissionDenied(permission.message ?? 'System audio permission is denied');
        return;
      }
      if (this.systemAudioCapture) return;
      this.systemAudioCapture = new SystemAudioCapture(this._lastRequestedOutputDeviceId);
      this.wire(this.systemAudioCapture, 'interviewer');
      this.startChannel('interviewer', this.systemAudioCapture);
    })());
    this.rebuilding = task;
    void task.then(() => { if (this.rebuilding === task) this.rebuilding = null; },
      () => { if (this.rebuilding === task) this.rebuilding = null; });
    return task;
  }

  private watchRoute(): void {
    if (this.routeTimer !== null) return;
    const native = loadNativeModule();
    if (!native?.getDefaultOutputDeviceId) return;
    this._lastObservedDefaultOutputId = native.getDefaultOutputDeviceId();
    this.routeTimer = setInterval(() => {
      const epoch = this.epoch;
      if (!this.live(epoch) || this._lastRequestedOutputDeviceId) return;
      try {
        const id = native.getDefaultOutputDeviceId!();
        if (id !== this._lastObservedDefaultOutputId) void this.handleDefaultOutputChanged(id).catch(() => {
          if (this.live(epoch)) this.report('system', 'Audio route recovery failed');
        });
      } catch { this.report('system', 'Unable to inspect the audio route'); }
    }, 4000);
    this.routeTimer.unref?.();
  }

  private wire(capture: Capture, channel: SttChannel): void {
    const epoch = this.epoch;
    const owned = () => capture === (channel === 'user' ? this.microphoneCapture : this.systemAudioCapture);
    let rateApplied = false;
    capture.on('data', (chunk: Buffer) => {
      if (!owned() || !this.live(epoch)) return;
      const provider = this.stt.get(channel);
      if (!rateApplied && provider) {
        provider.setSampleRate?.(capture.getSampleRate());
        provider.setAudioChannelCount?.(1);
        rateApplied = true;
      }
      provider?.write(chunk);
    });
    capture.on('sample_rate_changed', (rate: number) => { if (owned() && this.live(epoch)) this.stt.get(channel)?.setSampleRate?.(rate); });
    capture.on('speech_ended', () => { if (owned() && this.live(epoch)) this.stt.get(channel)?.notifySpeechEnded?.(); });
    capture.on('error', () => {
      if (!owned() || !this.live(epoch)) return;
      if (channel === 'user') {
        if (this.micRecovery) return;
        if (this.micRecoveryAttempts++ >= 3) {
          if (this.micRecoveryAttempts === 4) this.report('mic', 'Microphone recovery exhausted');
          return;
        }
        const task = this.reconfigureAudio(this._lastRequestedInputDeviceId, this._lastRequestedOutputDeviceId);
        this.micRecovery = task;
        void task.catch(() => {
          if (this.live(epoch)) this.report('mic', 'Microphone recovery failed');
        }).finally(() => {
          if (this.micRecovery === task) this.micRecovery = null;
        });
      } else {
        if (this.rebuilding || this.recoveryTimer !== null) return;
        if (this.recoveryAttempts++ >= 3) {
          if (this.recoveryAttempts === 4) this.report('system', 'System audio recovery exhausted');
          return;
        }
        this.recoveryTimer = setTimeout(() => {
          this.recoveryTimer = null;
          if (!owned() || !this.live(epoch)) return;
          void this.rebuildSystem('system audio recovery').catch(() => {
            if (this.live(epoch)) this.report('system', 'System audio recovery failed');
          });
        }, 1500);
      }
    });
    if (this.events.monitorCapture) this.monitorCleanups.set(capture, this.events.monitorCapture(capture, channel));
  }

  private report(channel: string, message: string): void {
    this.events.captureFailed({ channel, message, terminal: true });
  }
}
