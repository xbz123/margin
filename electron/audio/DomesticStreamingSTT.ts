import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { streamingStttWsOptions } from './dnsHelpers';
import type { SttChannel, SttSeal } from './MeetingSttSession';

const QUEUE_LIMIT = 160 * 1024;
/**
 * How long a sealed request may take to send its last result before it is given up. While it ends,
 * new audio waits in the queue, which holds QUEUE_LIMIT bytes = 5.12 s of 16 kHz mono PCM; the next
 * request can only start after this wait plus its own handshake (TLS and, for Aliyun, task-started).
 * 3 s leaves about 2 s for that handshake before queued speech is rejected. It also ends before the
 * manual collection tail (750 ms + 3 s), so a timed-out seal ends that wait as failed.
 */
const SEAL_ACK_TIMEOUT_MS = 3000;
/**
 * The meeting drain has 5 s in all (MeetingSttSession.drain), stop included. The finish of this
 * provider, a seal still ending included, must be over within this budget from its start.
 */
const DRAIN_BUDGET_MS = 4500;
/**
 * A seal still ending when the drain starts gets at most this long, so the audio queued behind it
 * keeps most of the budget to drain on the next request (handshake, audio and last result).
 */
const FINALIZE_SEAL_WAIT_MS = 1000;

type SealOutcome = 'complete' | 'failed';
interface Sealing {
  /** The request whose results this seal scopes. */
  readonly scope: string;
  readonly done: Promise<SealOutcome>;
  /** Queued bytes that belong to this seal and are not yet sent (a seal of queued audio). */
  unsent: number;
  expiresAt: number;
  timer?: ReturnType<typeof setTimeout>;
  settle(outcome: SealOutcome): void;
}

// Shared ownership and drain rules for the two task-oriented STT protocols.
export abstract class DomesticStreamingSTT extends EventEmitter {
  private socket: WebSocket | undefined;
  private enabled = false;
  private ready = false;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private drain: { promise: Promise<void>; resolve(): void; reject(error: Error): void; until: number } | undefined;
  private finishing = false;
  private queue: Buffer[] = [];
  private queuedBytes = 0;
  private overflowReported = false;
  private rate = 16000;
  private channels = 1;
  private remainder = Buffer.alloc(0);
  private previous: number | undefined;
  private position = 0;
  // Audio frames were sent on the current connection; finishing a request without any is an error.
  private sentAudio = false;
  // The request identifier of the current connection, and the one reserved for the next connection.
  private current = '';
  private nextScope: string | undefined;
  // The request now ending with its finish frame.
  private sealing: Sealing | undefined;
  // A seal of audio still queued: it ends the request that sends those bytes, once that request is ready.
  private queuedSeal: Sealing | undefined;

  /** Connection settings for a new request; `id` is its request/task identifier. */
  protected abstract connection(id: string): { url: string; headers: Record<string, string> };
  protected abstract opened(): void;
  protected abstract received(data: Buffer): void;
  protected abstract audio(data: Buffer): void;
  protected abstract finish(): void;
  /** The current request/task identifier: every transcript of the connection carries it as `scope`. */
  protected scope(): string { return this.current; }

  setRecognitionLanguage(_language: string): void { /* Both models detect language. */ }
  notifySpeechEnded(): void { /* VAD ends a sentence, not a provider task. */ }
  setSampleRate(rate: number): void {
    if (!Number.isInteger(rate) || rate < 8000 || rate > 96000) throw Error('Invalid STT sample rate');
    if (rate !== this.rate) { this.rate = rate; this.resetPcm(); }
  }
  setAudioChannelCount(channels: number): void {
    if (channels !== 1 && channels !== 2) throw Error('Invalid STT channel count');
    if (channels !== this.channels) { this.channels = channels; this.resetPcm(); }
  }
  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.attempts = 0;
    this.connect();
  }
  stop(_flush = false): void {
    this.enabled = false;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.queue = [];
    this.queuedBytes = 0;
    this.overflowReported = false;
    this.resetPcm();
    this.queuedSeal?.settle('failed');
    this.nextScope = undefined;
    this.release();
  }
  finalize(): Promise<void> { return this.finalizeBy(Date.now() + DRAIN_BUDGET_MS); }
  // Drains the queue and finishes the current request; everything, a seal still ending included, ends by `until`.
  private finalizeBy(until: number): Promise<void> {
    if (this.drain) return this.drain.promise;
    const sealing = this.sealing;
    if (sealing) {
      // A sealed request ends first, but only briefly: the audio queued behind it must still drain.
      const wait = Math.max(0, Math.min(sealing.expiresAt, Date.now() + FINALIZE_SEAL_WAIT_MS, until) - Date.now());
      return new Promise<void>(resolve => {
        const timer = setTimeout(resolve, wait);
        void sealing.done.then(() => { clearTimeout(timer); resolve(); });
      }).then(() => {
        if (this.sealing === sealing) this.abandonSeal();
        return this.finalizeBy(until);
      });
    }
    if (!this.enabled || (!this.socket && !this.queuedBytes)) return Promise.resolve();
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    this.drain = { promise, resolve, reject, until };
    this.armDrainDeadline();
    this.flush();
    return promise;
  }
  // The drain deadline is absolute: a new connection or its readiness never extends it.
  private armDrainDeadline(): void {
    clearTimeout(this.deadline);
    this.deadline = setTimeout(() => {
      this.report('STT finish acknowledgement timed out', 'timeout');
      this.release(new Error('STT drain timed out'));
    }, Math.max(0, this.drain!.until - Date.now()));
  }
  /**
   * Non-terminating flush for a manual action (Stop, What to Answer and the other actions; never the
   * Answer mark): ends the request carrying the audio received so far with its finish frame and
   * scopes that request's results to the seal, including sentences it splits off only in its last
   * result. Audio written meanwhile stays queued and is sent on a new request once this one
   * completes (or is given up), so the next action never shares a request with this one.
   *
   * While an earlier seal is still ending, the audio queued behind it is sealed too: it is sent on
   * the next request, which is then finished at once; both requests are scoped and `done` settles
   * with the later one.
   *
   * Only the microphone lane is sealed. The interviewer's request keeps running, so a question
   * still being asked at the action keeps its revisions (collection takes them in its tail window).
   * Accepted trade-off: a seal still ending when the meeting ends gets only FINALIZE_SEAL_WAIT_MS.
   */
  seal(_cutoffAt: number, channel?: SttChannel): SttSeal | undefined {
    if (channel === 'interviewer' || !this.enabled || this.drain) return undefined;
    if (this.ready && !this.finishing) {
      this.flush();
      if (this.socket === undefined || !this.ready || this.finishing || !this.sentAudio) return undefined;
      const sealing = this.createSeal(this.current, 0);
      this.startSealing(sealing);
      return { scopes: [sealing.scope], pending: true, done: sealing.done };
    }
    const ending = [this.sealing, this.queuedSeal].filter((item): item is Sealing => !!item);
    if (!this.queuedSeal && this.queuedBytes) {
      // The queued audio goes to the connection now opening, or to the next one after the ending request.
      const scope = this.socket && !this.sealing ? this.current : (this.nextScope ??= randomUUID());
      this.queuedSeal = this.createSeal(scope, this.queuedBytes);
      ending.push(this.queuedSeal);
    }
    if (!ending.length) return undefined;
    return { scopes: ending.map(item => item.scope), pending: true, done: ending.at(-1)!.done };
  }
  write(chunk: Buffer): void {
    if (!this.enabled || !chunk.length) return;
    // Reject before conversion/allocation, including a single oversized input block.
    const projected = Math.ceil((chunk.length + this.remainder.length) / (2 * this.channels) * 16000 / this.rate) * 2;
    if (chunk.length > QUEUE_LIMIT || projected + this.queuedBytes > QUEUE_LIMIT) {
      this.reportOverflow();
      return;
    }
    const pcm = this.convert(chunk);
    if (pcm.length + this.queuedBytes > QUEUE_LIMIT) {
      this.reportOverflow();
      return;
    }
    if (!pcm.length) return;
    this.overflowReported = false;
    this.queue.push(pcm);
    this.queuedBytes += pcm.length;
    if (!this.socket && !this.retry) this.connect();
    this.flush();
  }
  protected send(data: string | Buffer): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw Error('STT socket is not open');
    if (this.socket.bufferedAmount > QUEUE_LIMIT) throw Error('STT socket backpressure limit exceeded');
    const owner = this.socket;
    owner.send(data, error => { if (error && this.socket === owner) this.failed(false); });
  }
  protected acceptAudio(): void {
    this.ready = true;
    this.overflowReported = false;
    clearTimeout(this.deadline);
    this.deadline = undefined;
    if (this.drain) this.armDrainDeadline();
    this.flush();
  }
  protected healthy(): void { this.attempts = 0; }
  protected completed(): void {
    this.sealing?.settle('complete');
    this.emit('completed');
    this.release();
    if (this.enabled && this.queuedBytes) this.connect();
  }
  protected failed(permanent: boolean, reason: 'authentication' | 'configuration' | 'empty-audio' | 'connection' = permanent ? 'authentication' : 'connection'): void {
    const messages = {
      authentication: 'STT authentication failed; check credentials and resource access',
      configuration: 'STT configuration or protocol parameters are invalid',
      'empty-audio': 'STT received empty audio; continue speaking to resume transcription',
      connection: 'STT connection or protocol failed',
    };
    if (reason === 'empty-audio' && this.sealing && !this.drain) {
      // The sealed request had nothing to recognise: complete, not a user-facing error.
      this.sealing.settle('complete');
      this.endSealed();
      return;
    }
    this.report(messages[reason], reason);
    const wasDraining = !!this.drain;
    this.release(new Error('STT drain interrupted'));
    if (permanent) this.stop(false);
    else if (!wasDraining && reason !== 'empty-audio') this.schedule();
  }
  private createSeal(scope: string, bytes: number): Sealing {
    let resolve!: (outcome: SealOutcome) => void;
    const done = new Promise<SealOutcome>(settled => { resolve = settled; });
    const sealing: Sealing = { scope, done, unsent: bytes, expiresAt: Infinity, settle: outcome => {
      if (this.sealing !== sealing && this.queuedSeal !== sealing) return;
      clearTimeout(sealing.timer);
      if (this.sealing === sealing) this.sealing = undefined;
      if (this.queuedSeal === sealing) this.queuedSeal = undefined;
      resolve(outcome);
    } };
    return sealing;
  }
  // Sends the finish frame of the current request for this seal. A drain owns its own deadline.
  private startSealing(sealing: Sealing): void {
    if (this.queuedSeal === sealing) this.queuedSeal = undefined;
    this.sealing = sealing;
    this.finishing = true;
    if (!this.drain) {
      sealing.expiresAt = Date.now() + SEAL_ACK_TIMEOUT_MS;
      sealing.timer = setTimeout(() => this.abandonSeal(), SEAL_ACK_TIMEOUT_MS);
    }
    try { this.finish(); } catch {
      // The finish frame could not be sent: the request cannot end with a last result.
      if (this.drain) { this.failed(false); return; }
      this.emit('warning', { code: 'seal-failed', message: 'STT seal could not finish the request; continuing on a new request' });
      this.endSealed();
    }
  }
  // Gives up a sealed request that sent no last result in time; queued audio continues on a new one.
  private abandonSeal(): void {
    this.emit('warning', { code: 'seal-timeout', message: 'STT seal acknowledgement timed out; continuing on a new request' });
    this.endSealed();
  }
  // Ends a sealed request (a seal still pending settles failed); queued audio continues at once on a new one.
  private endSealed(): void {
    this.release();
    if (this.enabled && this.queuedBytes) this.connect();
  }
  // The connection closed or errored. While a seal ends its request, that is the end of the request, not an error.
  private lost(): void {
    if (this.sealing && !this.drain) this.endSealed();
    else this.failed(false);
  }
  private reportOverflow(): void {
    if (this.overflowReported) return;
    this.overflowReported = true;
    this.report('STT audio buffer limit exceeded; audio chunk rejected');
  }
  protected report(message: string, code = 'connection'): void {
    // Provider response bodies and transport errors can echo credentials: never forward them.
    this.emit('error', Object.assign(new Error(message), { code }));
  }
  private connect(): void {
    if (!this.enabled || this.socket) return;
    try {
      const id = this.nextScope ?? randomUUID();
      this.nextScope = undefined;
      const config = this.connection(id);
      const ws = new WebSocket(config.url, { ...streamingStttWsOptions(), headers: config.headers, maxPayload: 1024 * 1024 });
      this.socket = ws;
      this.current = id;
      if (this.drain) this.armDrainDeadline();
      else this.deadline = setTimeout(() => this.failed(false), 15000);
      ws.on('open', () => {
        if (this.socket !== ws) return;
        try { this.opened(); } catch { this.failed(false); }
      });
      ws.on('message', data => {
        if (this.socket !== ws) return;
        try { this.received(Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)); }
        catch { this.failed(false); }
      });
      ws.on('unexpected-response', (_request, response) => {
        if (this.socket !== ws) return;
        response.resume();
        this.failed(response.statusCode === 401 || response.statusCode === 403);
      });
      ws.on('error', () => { if (this.socket === ws) this.lost(); });
      ws.on('close', () => { if (this.socket === ws) this.lost(); });
    } catch { this.failed(true, 'configuration'); }
  }
  private flush(): void {
    if (!this.ready || this.finishing) return;
    try {
      // A seal of queued audio sends exactly the bytes queued when it was made, then finishes.
      const sealing = this.queuedSeal?.scope === this.current ? this.queuedSeal : undefined;
      while (this.queue.length && (this.drain || !sealing || sealing.unsent > 0)) {
        const chunk = this.queue[0];
        this.audio(chunk);
        this.sentAudio = true;
        this.queue.shift();
        this.queuedBytes -= chunk.length;
        if (sealing) sealing.unsent -= chunk.length;
      }
      if (sealing && this.sentAudio) this.startSealing(sealing);
      else if (this.drain) { this.finishing = true; this.finish(); }
    } catch { this.failed(false); }
  }
  private schedule(): void {
    if (!this.enabled || this.retry) return;
    if (this.attempts === 10) {
      this.stop(false);
      this.report('STT maximum reconnect attempts exceeded');
      return;
    }
    this.retry = setTimeout(() => { this.retry = undefined; this.connect(); }, Math.min(1000 * 2 ** this.attempts++, 30000));
  }
  private release(error?: Error): void {
    const retired = this.socket;
    this.socket = undefined;
    this.ready = false;
    this.finishing = false;
    this.sentAudio = false;
    this.sealing?.settle('failed');
    // A seal of queued audio waiting for this very connection sent none of it (the connection never
    // became ready). The retry connection reuses its request id, so that audio stays in this seal's
    // scope (and in the scopes the action already ended) and is finished there; without a retry it fails.
    if (retired && this.queuedSeal?.scope === this.current) {
      if (this.enabled && !this.drain) this.nextScope = this.queuedSeal.scope;
      else this.queuedSeal.settle('failed');
    }
    clearTimeout(this.deadline);
    this.deadline = undefined;
    const pending = this.drain;
    this.drain = undefined;
    if (error) pending?.reject(error);
    else pending?.resolve();
    // Keep the guarded error listener attached: ws can emit error after termination.
    retired?.terminate();
  }
  private resetPcm(): void {
    this.remainder = Buffer.alloc(0);
    this.previous = undefined;
    this.position = 0;
  }
  private convert(chunk: Buffer): Buffer {
    const bytes = Buffer.concat([this.remainder, chunk]);
    const frameBytes = 2 * this.channels;
    const count = Math.floor(bytes.length / frameBytes);
    this.remainder = Buffer.from(bytes.subarray(count * frameBytes));
    const samples: number[] = this.previous === undefined ? [] : [this.previous];
    for (let frame = 0; frame < count; frame++) {
      const left = bytes.readInt16LE(frame * frameBytes);
      samples.push(this.channels === 1 ? left : (left + bytes.readInt16LE(frame * frameBytes + 2)) / 2);
    }
    const output: number[] = [];
    while (this.position < samples.length && (Number.isInteger(this.position) || this.position < samples.length - 1)) {
      const index = Math.floor(this.position), fraction = this.position - index;
      output.push(Math.round(samples[index] + (fraction ? (samples[index + 1] - samples[index]) * fraction : 0)));
      this.position += this.rate / 16000;
    }
    if (samples.length) {
      this.previous = samples.at(-1);
      this.position -= samples.length - 1;
    }
    const pcm = Buffer.alloc(output.length * 2);
    output.forEach((value, index) => pcm.writeInt16LE(value, index * 2));
    return pcm;
  }
}
