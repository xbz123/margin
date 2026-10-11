import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { streamingStttWsOptions } from './dnsHelpers';

const QUEUE_LIMIT = 160 * 1024;

// Shared ownership and drain rules for the two task-oriented STT protocols.
export abstract class DomesticStreamingSTT extends EventEmitter {
  private socket: WebSocket | undefined;
  private enabled = false;
  private ready = false;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private drain: { promise: Promise<void>; resolve(): void; reject(error: Error): void } | undefined;
  private finishing = false;
  private queue: Buffer[] = [];
  private queuedBytes = 0;
  private overflowReported = false;
  private rate = 16000;
  private channels = 1;
  private remainder = Buffer.alloc(0);
  private previous: number | undefined;
  private position = 0;

  protected abstract connection(): { url: string; headers: Record<string, string> };
  protected abstract opened(): void;
  protected abstract received(data: Buffer): void;
  protected abstract audio(data: Buffer): void;
  protected abstract finish(): void;

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
    this.release();
  }
  finalize(): Promise<void> {
    if (this.drain) return this.drain.promise;
    if (!this.enabled || (!this.socket && !this.queuedBytes)) return Promise.resolve();
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    this.drain = { promise, resolve, reject };
    clearTimeout(this.deadline);
    this.deadline = setTimeout(() => {
      this.report('STT finish acknowledgement timed out', 'timeout');
      this.release(new Error('STT drain timed out'));
    }, 4500);
    this.flush();
    return promise;
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
    if (!this.drain) this.deadline = undefined;
    else this.deadline = setTimeout(() => { this.report('STT finish acknowledgement timed out', 'timeout'); this.release(new Error('STT drain timed out')); }, 4500);
    this.flush();
  }
  protected healthy(): void { this.attempts = 0; }
  protected completed(): void {
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
    this.report(messages[reason], reason);
    const wasDraining = !!this.drain;
    this.release(new Error('STT drain interrupted'));
    if (permanent) this.stop(false);
    else if (!wasDraining && reason !== 'empty-audio') this.schedule();
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
      const config = this.connection();
      const ws = new WebSocket(config.url, { ...streamingStttWsOptions(), headers: config.headers, maxPayload: 1024 * 1024 });
      this.socket = ws;
      this.deadline = setTimeout(() => this.failed(false), 15000);
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
      ws.on('error', () => { if (this.socket === ws) this.failed(false); });
      ws.on('close', () => { if (this.socket === ws) this.failed(false); });
    } catch { this.failed(true, 'configuration'); }
  }
  private flush(): void {
    if (!this.ready || this.finishing) return;
    try {
      while (this.queue.length) {
        this.audio(this.queue[0]);
        this.queuedBytes -= this.queue.shift()!.length;
      }
      if (this.drain) { this.finishing = true; this.finish(); }
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
