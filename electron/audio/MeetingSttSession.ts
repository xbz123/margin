import type { EventEmitter } from 'node:events';

export type SttChannel = 'user' | 'interviewer';
export interface DrainResult {
  timedOut: boolean;
  failedChannels: SttChannel[];
}
export interface SttTranscript {
  text: string;
  isFinal?: boolean;
  itemId?: string;
  utteranceId?: string;
  segmentId?: string;
  speakerId?: string;
  confidence?: number;
}
export interface SessionTranscript {
  sessionId: string;
  channel: SttChannel;
  segmentId: string;
  revision: number;
  text: string;
  final: boolean;
  timestamp: number;
  speakerId?: string;
  confidence?: number;
}
export interface ManagedSttProvider extends EventEmitter {
  start?(): void;
  stop(flush?: boolean): Promise<void> | void;
  finalize?(): Promise<void> | void | boolean;
  write(chunk: Buffer): void;
  setSampleRate?(rate: number): void;
  setAudioChannelCount?(count: number): void;
  notifySpeechEnded?(): void;
}
interface Options<P> {
  create(channel: SttChannel): P | null;
  onTranscript(event: SessionTranscript): void;
  onFinal?(channel: SttChannel): void;
  onError?(channel: SttChannel, error: Error): void;
  onWarning?(channel: SttChannel, warning: unknown): void;
  onEndpoint?(channel: SttChannel, event: unknown): void;
}
interface Binding<P> {
  provider: P;
  dispose(): void;
}

// Each binding owns its listeners and transcript revisions; replacing it invalidates queued callbacks.
export class MeetingSttSession<P extends ManagedSttProvider = ManagedSttProvider> {
  private readonly bindings = new Map<SttChannel, Binding<P>>();
  private readonly serial = { user: 0, interviewer: 0 };
  private session: string | null = null;
  private draining = false;
  private generation = 0;
  private readonly retiredError = () => {};

  constructor(private readonly options: Options<P>) {}

  get(channel: SttChannel): P | null { return this.bindings.get(channel)?.provider ?? null; }

  ensure(channel: SttChannel): P | null {
    let provider = this.get(channel);
    if (!provider) {
      provider = this.options.create(channel);
      this.set(channel, provider);
    }
    return provider;
  }

  set(channel: SttChannel, provider: P | null): void {
    if (this.get(channel) === provider) return;
    const previous = this.get(channel);
    this.bindings.get(channel)?.dispose();
    this.bindings.delete(channel);
    if (previous) previous.on('error', this.retiredError);
    if (provider) this.bind(channel, provider, ++this.serial[channel]);
  }

  begin(id: string): void {
    if (!id) throw new Error('STT sessionId is required');
    if (this.draining) throw new Error('Wait for the previous STT drain before starting');
    this.session = id;
    ++this.generation;
    for (const [channel, binding] of this.bindings) {
      binding.dispose();
      this.bind(channel, binding.provider, this.serial[channel]);
    }
  }

  private bind(channel: SttChannel, provider: P, serial: number): void {
    provider.removeListener('error', this.retiredError);
    const generation = this.generation;
    const history = new Map<string, SessionTranscript>();
    let sequence = 0;
    let pendingId: string | undefined;
    const listeners = new Map<string, (...args: any[]) => void>();
    const binding: Binding<P> = { provider, dispose: () => {
      for (const [name, listener] of listeners) provider.removeListener(name, listener);
    } };
    const current = () => this.bindings.get(channel) === binding && generation === this.generation && this.session !== null;
    const listen = (name: string, listener: (...args: any[]) => void) => { listeners.set(name, listener); provider.on(name, listener); };
    listen('transcript', (input: SttTranscript) => {
      if (!current() || !input || typeof input.text !== 'string' || !input.text.trim()) return;
      const final = input.isFinal === true;
      if (this.draining && !final) return;
      const supplied = [input.itemId, input.utteranceId, input.segmentId].find(value => typeof value === 'string' && value.length > 0);
      const local = supplied ?? pendingId ?? 'local-' + ++sequence;
      if (!supplied) pendingId = final ? undefined : local;
      const key = channel + ':' + serial + ':' + local;
      const previous = history.get(key);
      const speakerId = input.speakerId ?? previous?.speakerId;
      if (previous?.final && !final) return;
      if (previous && previous.text === input.text && previous.final === final && previous.speakerId === speakerId) return;
      const event: SessionTranscript = {
        sessionId: this.session!, channel, segmentId: key,
        revision: (previous?.revision ?? 0) + 1,
        text: input.text, final, timestamp: previous?.timestamp ?? Date.now(),
        speakerId, confidence: input.confidence,
      };
      history.set(key, event);
      this.options.onTranscript(event);
      if (final) this.options.onFinal?.(channel);
    });
    listen('error', (error: Error) => { if (current() && !this.draining) this.options.onError?.(channel, error); });
    listen('warning', (warning: unknown) => { if (current() && !this.draining) this.options.onWarning?.(channel, warning); });
    listen('endpoint', (event: unknown) => { if (current() && !this.draining) this.options.onEndpoint?.(channel, event); });
    this.bindings.set(channel, binding);
  }

  async drain(timeoutMs = 5000, graceMs = 1500): Promise<DrainResult> {
    this.draining = true;
    try { return await this.finish(true, timeoutMs, graceMs); }
    finally { this.session = null; this.draining = false; }
  }

  async finalizeUser(signal?: AbortSignal, timeoutMs = 1500): Promise<void> {
    signal?.throwIfAborted();
    const mic = this.get('user');
    if (!this.session || this.draining || !mic?.finalize) return;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        clearTimeout(timer);
        mic.removeListener('transcript', onTranscript);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve();
      };
      const onTranscript = (event: SttTranscript) => { if (event.isFinal) finish(); };
      const onAbort = () => finish(signal?.reason);
      // Some providers only acknowledge via a final transcript; silence has no acknowledgement.
      const timer = setTimeout(finish, timeoutMs);
      mic.on('transcript', onTranscript);
      signal?.addEventListener('abort', onAbort, { once: true });
      try { Promise.resolve(mic.finalize!()).catch(finish); } catch (error) { finish(error); }
    });
  }

  async stopChannels(timeoutMs = 5000): Promise<void> {
    ++this.generation;
    const revoked = [...this.bindings];
    for (const [channel] of revoked) this.set(channel, null);
    await this.finish(false, timeoutMs, 0, revoked);
  }

  async cancel(timeoutMs = 5000): Promise<void> {
    this.session = null;
    await this.stopChannels(timeoutMs);
  }

  private async finish(flush: boolean, timeoutMs: number, graceMs: number, owned = [...this.bindings]): Promise<DrainResult> {
    const failed = new Set<SttChannel>();
    const waiting = new Set(owned.map(([channel]) => channel));
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const invoke = async (channel: SttChannel, call: () => unknown) => {
      try { await call(); } catch { failed.add(channel); }
    };
    const stopping = (async () => {
      if (flush) {
        await Promise.all([
          ...owned.map(([channel, { provider }]) => invoke(channel, () => provider.finalize?.())),
          new Promise<void>(resolve => { grace = setTimeout(resolve, graceMs); }),
        ]);
      }
      if (timedOut) return;
      await Promise.all(owned.map(async ([channel, { provider }]) => {
        await invoke(channel, () => provider.stop(flush));
        waiting.delete(channel);
      }));
    })();
    try {
      await Promise.race([stopping, new Promise<void>(resolve => {
        deadline = setTimeout(() => { timedOut = true; resolve(); }, Math.max(0, timeoutMs));
      })]);
      if (timedOut) {
        for (const channel of waiting) failed.add(channel);
        // A graceful provider may be stuck; revoke its send path without waiting again.
        for (const [channel, { provider }] of owned) {
          if (waiting.has(channel)) void invoke(channel, () => provider.stop(false));
        }
      }
    } finally {
      clearTimeout(deadline);
      clearTimeout(grace);
      for (const [channel, binding] of owned) {
        if (this.bindings.get(channel) === binding) this.set(channel, null);
      }
    }
    return { timedOut, failedChannels: [...failed] };
  }
}
