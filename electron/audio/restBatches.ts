import type { SttSeal } from './MeetingSttSession';

export type BatchOutcome = 'complete' | 'no-pending' | 'unknown' | 'failed';
export interface RestBatch {
  readonly scope: string;
  readonly chunks: Buffer[];
  readonly bytes: number;
  readonly firstAt?: number;
  readonly lastAt?: number;
  readonly outcome: Promise<BatchOutcome>;
  settle(outcome: BatchOutcome): void;
}

const SEALED_LIMIT = 8;
const BYTE_LIMIT = 8 * 1024 * 1024;

/**
 * Upload batches of a REST STT provider. A manual action seals the audio received so far into its
 * own batch, even while another upload is in flight; later audio stays in the open buffer. Every
 * batch has its ID before its result, so results can be tied to the seal that covers them.
 */
export class RestBatches {
  private readonly sealed: RestBatch[] = [];
  private inFlight: RestBatch | undefined;
  private seq = 0;
  private retainedBytes = 0;
  private retainedChunks = 0;
  private ingress = new WeakMap<Buffer, { at: number; retained: boolean }>();
  private unaccountedAt = Infinity;

  constructor(private readonly prefix: string) {}

  get waiting(): boolean { return this.sealed.length > 0; }

  /** Own the bytes and their ingress time; capture callbacks may reuse the original Buffer. */
  capture(chunk: Buffer, at = Date.now()): Buffer {
    if (chunk.length > BYTE_LIMIT - this.retainedBytes || this.retainedChunks >= 32768) {
      this.unaccountedAt = Math.min(this.unaccountedAt, Number.isFinite(at) ? at : -Infinity);
      throw new Error('STT audio buffer capacity exceeded');
    }
    const owned = Buffer.from(chunk);
    this.ingress.set(owned, { at, retained: true });
    this.retainedBytes += owned.length;
    this.retainedChunks++;
    return owned;
  }

  create(chunks: Buffer[], bytes: number): RestBatch {
    let settle!: (outcome: BatchOutcome) => void;
    const outcome = new Promise<BatchOutcome>(resolve => { settle = resolve; });
    let firstAt = Infinity, lastAt = -Infinity, known = chunks.length > 0;
    for (const chunk of chunks) {
      const at = this.ingress.get(chunk)?.at;
      if (at === undefined || !Number.isFinite(at)) known = false;
      else { firstAt = Math.min(firstAt, at); lastAt = Math.max(lastAt, at); }
    }
    return { scope: `${this.prefix}:b${++this.seq}`, chunks: [...chunks], bytes, outcome, settle,
      ...(known ? { firstAt, lastAt } : {}) };
  }

  /** Removes only known pre-cut input from the open buffer. A mixed in-flight batch stays unknown. */
  seal(chunks: Buffer[], cutoffAt = Date.now()): SttSeal {
    if (!Number.isFinite(cutoffAt)) throw new Error('Invalid STT cutoff');
    const held = [...(this.inFlight ? [this.inFlight] : []), ...this.sealed];
    let unknown = this.unaccountedAt <= cutoffAt;
    const covered = held.filter(batch => {
      if (batch.lastAt !== undefined && batch.lastAt <= cutoffAt) return true;
      if (batch.firstAt === undefined || batch.firstAt <= cutoffAt) unknown = true;
      return false;
    });
    const before: Buffer[] = [], after: Buffer[] = [];
    for (const chunk of chunks) {
      const at = this.ingress.get(chunk)?.at;
      if (at !== undefined && Number.isFinite(at) && at <= cutoffAt) before.push(chunk);
      else { after.push(chunk); if (at === undefined || !Number.isFinite(at)) unknown = true; }
    }
    if (before.length) {
      if (this.sealed.length >= SEALED_LIMIT) throw new Error('STT audio queue capacity exceeded');
      const batch = this.create(before, before.reduce((bytes, chunk) => bytes + chunk.length, 0));
      this.sealed.push(batch);
      covered.push(batch);
      chunks.splice(0, chunks.length, ...after);
    }
    if (!covered.length) return { scopes: [], pending: unknown ? undefined : false, done: Promise.resolve(unknown ? 'unknown' : 'no-pending') };
    return {
      scopes: covered.map(batch => batch.scope),
      pending: true,
      done: Promise.all(covered.map(batch => batch.outcome)).then(outcomes =>
        outcomes.includes('failed') ? 'failed' : unknown || outcomes.includes('unknown') ? 'unknown'
          : outcomes.includes('complete') ? 'complete' : 'no-pending'),
    };
  }

  next(): RestBatch | undefined { return this.sealed.shift(); }

  start(batch: RestBatch): void { this.inFlight = batch; }

  finish(batch: RestBatch, outcome: BatchOutcome, release = true): void {
    batch.settle(outcome);
    if (release) for (const chunk of batch.chunks) {
      const input = this.ingress.get(chunk);
      if (input?.retained) { input.retained = false; this.retainedBytes -= chunk.length; this.retainedChunks--; }
    }
    if (this.inFlight === batch) this.inFlight = undefined;
  }

  /** Stop discards queued batches; nothing about them can be proven any more. */
  clear(): void {
    for (const batch of this.sealed.splice(0)) batch.settle('unknown');
    this.inFlight?.settle('unknown');
    this.inFlight = undefined;
    this.retainedBytes = 0;
    this.retainedChunks = 0;
    this.ingress = new WeakMap();
    this.unaccountedAt = Infinity;
  }
}
