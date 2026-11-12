import type { EventEmitter } from 'node:events';

export type SttChannel = 'user' | 'interviewer';
export interface DrainResult {
  timedOut: boolean;
  failedChannels: SttChannel[];
}
// Provider media time as reported, with the provider/epoch it is relative to. Never a wall clock.
export interface SttMedia {
  startMs?: number;
  endMs?: number;
  basis: string;
}
export interface SttTranscript {
  text: string;
  isFinal?: boolean;
  itemId?: string;
  utteranceId?: string;
  segmentId?: string;
  speakerId?: string;
  confidence?: number;
  /** Connection/task epoch the identifiers and media times belong to. */
  epoch?: string;
  /** Speech start without text: updates the ledger state only. */
  started?: boolean;
  media?: SttMedia;
  /** Audio range this result was produced from, e.g. a sealed REST batch. */
  scope?: string;
  identityReliable?: boolean;
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
  epoch?: string;
  media?: SttMedia;
}
/** One canonical record per segment: the latest revision and when it was first and finally seen. */
export interface SegmentRecord {
  sessionId: string;
  channel: SttChannel;
  key: string;
  epoch?: string;
  revision: number;
  text: string;
  final: boolean;
  state: 'started' | 'interim' | 'final';
  firstSeenAt: number;
  updatedAt: number;
  finalAt?: number;
  media?: SttMedia;
  scope?: string;
  speakerId?: string;
  identityReliable?: boolean;
}
/**
 * A provider's non-terminating flush of audio received up to `cutoffAt`. `scopes` names the
 * results that come from that audio; `done` settles only on scoped evidence:
 * complete (the sealed audio was processed), no-pending (nothing of it is left to process),
 * unknown (it cannot be proven) or failed.
 */
export interface SttSeal {
  scopes: readonly string[];
  /** False only when the adapter can account for every pending input in this range. */
  pending?: boolean;
  done: Promise<'complete' | 'no-pending' | 'unknown' | 'failed'>;
}
export type FreezeReason = 'complete' | 'deadline' | 'failed' | 'absent';
export interface FrozenSegment {
  key: string;
  channel: SttChannel;
  text: string;
  final: boolean;
  revision: number;
  firstSeenAt: number;
  epoch?: string;
  media?: SttMedia;
}
export interface FrozenSpeech {
  sessionId: string | null;
  cutoffAt: number;
  frozenAt: number;
  channels: Record<SttChannel, { segments: readonly FrozenSegment[]; reason: FreezeReason }>;
  /** Microphone text of a dictation, when the action carried a dictation mark. */
  dictation?: string;
  /** Segments the dictation text was taken from. */
  dictationKeys?: readonly string[];
  /** With a dictation mark: interviewer text in this snapshot was updated after mark.at - INTERVIEWER_LEAD_MS. */
  interviewerHeard?: boolean;
}
export interface DictationMark {
  sessionId: string | null;
  at: number;
  /**
   * Microphone fragments still live (interim, not replaced) when the mark was made, outside the
   * scopes an earlier action ended. One joins the dictation only if it is revised or finalized after
   * the mark, or was last updated within a few seconds before it; otherwise it is left-over speech.
   */
  open?: readonly string[];
  /**
   * Open fragments idle for longer than DICTATION_FRESH_INTERIM_MS at the mark, with their comparable
   * text then. Finalizing or punctuating one later (a seal's last result) is not a revision.
   */
  idle?: readonly (readonly [key: string, comparable: string])[];
}
export interface CollectOptions {
  cutoffAt: number;
  /** Earliest generation deadline; no channel waits past it. */
  deadline: number;
  signal: AbortSignal;
  dictation?: DictationMark;
}
export interface SpeechCollector {
  readonly cutoffAt: number;
  /** The actual end of the 750 ms receipt window; can only move earlier. */
  setStage1End(at: number): void;
  readonly frozen: Promise<FrozenSpeech>;
}
export interface ManagedSttProvider extends EventEmitter {
  start?(): void;
  stop(flush?: boolean): Promise<void> | void;
  finalize?(): Promise<void> | void | boolean;
  /**
   * Non-terminating flush for a manual action; providers without one (or returning none for this
   * channel) stay unknown. `channel` is the lane the provider serves.
   */
  seal?(cutoffAt: number, channel: SttChannel): SttSeal | undefined;
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

export const RECEIPT_WINDOW_MS = 750;
export const PENDING_TAIL_MS = 3000;
export const SETTLED_TAIL_MS = 1000;
const SNAPSHOT_WINDOW_MS = 180_000;
/** An interim live at the mark and updated at most this long before it is speech just said, dictated without a later update. */
const DICTATION_FRESH_INTERIM_MS = 5000;
/** Interviewer speech updated this long before a dictation mark, or later, counts as heard for that round. */
export const INTERVIEWER_LEAD_MS = 15_000;
const LEDGER_LIMIT = 2000;
const NUMERAL_RUN = /[0-9零〇一二两三四五六七八九十百千万亿]+/gu;
/** Text for comparison only: punctuation, spacing and case ignored, a numeral run (三 / 3) one token. */
export function comparableText(spoken: string): string {
  return spoken.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]+/gu, '').replace(NUMERAL_RUN, '#');
}
/** Microphone seal scopes remembered with the cutoff of the action that ended them. */
const ENDED_SCOPE_LIMIT = 256;

// Each binding owns its listeners and transcript revisions; replacing it invalidates queued callbacks.
export class MeetingSttSession<P extends ManagedSttProvider = ManagedSttProvider> {
  private readonly bindings = new Map<SttChannel, Binding<P>>();
  private readonly serial = { user: 0, interviewer: 0 };
  private session: string | null = null;
  private draining = false;
  private generation = 0;
  private readonly retiredError = () => {};
  private readonly ledger = new Map<string, SegmentRecord>();
  // Latest time an evicted record could still belong to speech (its final, else its last update).
  private readonly evictedThrough: Record<SttChannel, number> = { user: -Infinity, interviewer: -Infinity };
  private readonly collectors = new Set<{ update(record: SegmentRecord): void; abort(reason: unknown): void }>();
  /**
   * Microphone result scopes a manual action sealed, with that action's cutoff. A seal scopes only
   * audio received by its cutoff, so a scope ended by an earlier action holds speech from before any
   * later dictation mark, however late its last results arrive (a Stop's request still ending when
   * the next Answer is pressed).
   */
  private readonly endedScopes = new Map<string, number>();

  constructor(private readonly options: Options<P>) {}

  get(channel: SttChannel): P | null { return this.bindings.get(channel)?.provider ?? null; }

  /** Read-only copy of one ledger record, for tests and diagnostics. */
  record(key: string): SegmentRecord | undefined {
    const record = this.ledger.get(key);
    return record && { ...record };
  }

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
    this.abortCollectors();
    this.ledger.clear();
    this.endedScopes.clear();
    this.evictedThrough.user = this.evictedThrough.interviewer = -Infinity;
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
    let sequence = 0;
    let pendingId: string | undefined;
    const listeners = new Map<string, (...args: any[]) => void>();
    const binding: Binding<P> = { provider, dispose: () => {
      for (const [name, listener] of listeners) provider.removeListener(name, listener);
    } };
    const current = () => this.bindings.get(channel) === binding && generation === this.generation && this.session !== null;
    const listen = (name: string, listener: (...args: any[]) => void) => { listeners.set(name, listener); provider.on(name, listener); };
    listen('transcript', (input: SttTranscript) => {
      if (!current() || !input || typeof input.text !== 'string') return;
      const supplied = [input.itemId, input.utteranceId, input.segmentId].find(value => typeof value === 'string' && value.length > 0);
      const prefix = channel + ':' + serial + ':' + (input.epoch ? input.epoch + ':' : '');
      if (!input.text.trim()) {
        // A started segment without text is a state change, never a chat row.
        if (input.started && supplied && !this.draining) this.started(prefix + supplied, channel, input);
        return;
      }
      const final = input.isFinal === true;
      if (this.draining && !final) return;
      const local = supplied ?? pendingId ?? 'local-' + ++sequence;
      if (!supplied) pendingId = final ? undefined : local;
      const key = prefix + local;
      const previous = this.ledger.get(key);
      const speakerId = input.speakerId ?? previous?.speakerId;
      if (previous?.final && !final) return;
      if (previous && previous.state !== 'started' && previous.text === input.text && previous.final === final && previous.speakerId === speakerId) return;
      const now = Date.now();
      const media = input.media ? { ...previous?.media, ...input.media } : previous?.media;
      const record: SegmentRecord = {
        sessionId: this.session!, channel, key, epoch: input.epoch ?? previous?.epoch,
        revision: (previous?.revision ?? 0) + 1, text: input.text, final, state: final ? 'final' : 'interim',
        firstSeenAt: previous?.firstSeenAt ?? now, updatedAt: now, finalAt: final ? previous?.finalAt ?? now : undefined,
        media, scope: previous?.scope ?? input.scope, speakerId,
        identityReliable: supplied !== undefined && input.identityReliable !== false,
      };
      this.store(record);
      const event: SessionTranscript = {
        sessionId: record.sessionId, channel, segmentId: key, revision: record.revision,
        text: input.text, final, timestamp: record.firstSeenAt,
        speakerId, confidence: input.confidence, epoch: record.epoch, media,
      };
      this.options.onTranscript(event);
      if (final) this.options.onFinal?.(channel);
      this.notify(record);
    });
    listen('error', (error: Error) => { if (current() && !this.draining) this.options.onError?.(channel, error); });
    listen('warning', (warning: unknown) => { if (current() && !this.draining) this.options.onWarning?.(channel, warning); });
    listen('endpoint', (event: unknown) => { if (current() && !this.draining) this.options.onEndpoint?.(channel, event); });
    this.bindings.set(channel, binding);
  }

  private started(key: string, channel: SttChannel, input: SttTranscript): void {
    if (this.ledger.has(key) || !this.session) return;
    const now = Date.now();
    const record: SegmentRecord = { sessionId: this.session, channel, key, epoch: input.epoch, revision: 0, text: '', final: false, state: 'started',
      firstSeenAt: now, updatedAt: now, media: input.media, scope: input.scope, identityReliable: input.identityReliable !== false };
    this.store(record);
    this.notify(record);
  }

  // Collectors own their immutable revisions, so live eviction cannot change an outstanding input.
  private store(record: SegmentRecord): void {
    this.ledger.delete(record.key);
    this.ledger.set(record.key, record);
    while (this.ledger.size > LEDGER_LIMIT) {
      const oldest: SegmentRecord = this.ledger.values().next().value!;
      this.evictedThrough[oldest.channel] = Math.max(this.evictedThrough[oldest.channel], oldest.finalAt ?? oldest.updatedAt);
      this.ledger.delete(oldest.key);
    }
  }

  private notify(record: SegmentRecord): void { for (const collector of [...this.collectors]) collector.update(record); }

  private abortCollectors(): void {
    for (const collector of [...this.collectors]) collector.abort(new DOMException('STT session changed', 'AbortError'));
  }

  // A microphone record whose scope an action before `at` sealed: speech from before `at`.
  private endedBy(record: SegmentRecord, at: number): boolean {
    const ended = record.channel === 'user' && record.scope !== undefined ? this.endedScopes.get(record.scope) : undefined;
    return ended !== undefined && ended < at;
  }

  private rememberEnded(scopes: readonly string[], cutoffAt: number): void {
    for (const scope of scopes) {
      // The first action that sealed a scope dates it; a later seal reporting it again does not.
      if (this.endedScopes.has(scope)) continue;
      this.endedScopes.set(scope, cutoffAt);
      if (this.endedScopes.size > ENDED_SCOPE_LIMIT) this.endedScopes.delete(this.endedScopes.keys().next().value!);
    }
  }

  /**
   * Marks where a dictation starts; providers are not touched, so the words being said at the mark
   * keep their beginning and join the dictation whole once revised or finalized after it.
   */
  markDictation(at: number): DictationMark {
    const user = [...this.ledger.values()].filter(record => record.channel === 'user');
    // An interim that stopped changing before later microphone speech began was replaced, not left open:
    // a reconnect, a moved start time or a fallback key can leave one that is never revised again.
    // Only speech with text counts: an empty speech-start record (speech_started, sentence_begin) replaces nothing yet.
    const latestStart = Math.max(-Infinity, ...user.filter(record => record.text.trim()).map(record => record.firstSeenAt));
    const live = user.filter(record => record.state === 'interim' && !(latestStart > record.updatedAt) && !this.endedBy(record, at));
    const idle = live.filter(record => at - record.updatedAt > DICTATION_FRESH_INTERIM_MS)
      .map(record => Object.freeze([record.key, comparableText(record.text)] as const));
    return Object.freeze({ sessionId: this.session, at, open: Object.freeze(live.map(record => record.key)), idle: Object.freeze(idle) });
  }

  /**
   * Collects both channels for one manual action without finishing provider tasks. Records first
   * seen by the cutoff (or produced from audio a seal scoped to it) are eligible; their revisions
   * are taken until the channel ends: pending or unknown channels wait at most 3 s and settled
   * finals 1 s after the receipt window, scoped completion ends a channel early, and the generation
   * deadline caps both. The result is copied once and never changes.
   * Accepted trade-off: when a sealed request's last result takes 2.5 s or more and actions follow in
   * quick succession, the seal chain can outlast this wait and the round's dictation can be empty.
   */
  collect(options: CollectOptions): SpeechCollector {
    options.signal.throwIfAborted();
    const mark = options.dictation;
    const marked = !!mark && mark.sessionId === this.session;
    // A request an earlier action sealed holds only speech from before the mark, however late its results come.
    const ended = (record: SegmentRecord) => marked && this.endedBy(record, mark.at);
    const openAtMark = new Set(marked ? mark.open : undefined);
    // A dictation whose beginning left the bounded ledger cannot be returned whole; never truncate it silently.
    // That covers speech after the mark and fragments already open at the mark, even if never updated since.
    if (marked && (this.evictedThrough.user > mark.at || mark.open?.some(key => !this.ledger.has(key)))) {
      throw Object.assign(new Error('Dictation is too long to collect completely'), { name: 'DictationOverflowError' });
    }
    const sessionId = this.session;
    // Microphone speech of this dictation, the same rule for every provider: first heard after the
    // mark; a fragment that existed at the mark, was not final by then and was revised or finalized
    // after it (the words being said at the mark join whole); or one open at the mark whose last
    // update came at most DICTATION_FRESH_INTERIM_MS before it (just said, its final may never arrive
    // in time). Any other interim never touched again after the mark is left-over speech. Records of a
    // scope an earlier action sealed (a Stop's request whose last result comes after this mark) are
    // speech from before the mark and never join.
    // Known boundary, as in the earlier renderer gate: words said between two actions and not yet
    // final share a record with what follows when the provider appends new speech to it (Doubao does
    // until it splits the sentence), so a dictation that continues that record includes all of it.
    // Such a record finalized only by this action's own seal (its last result) is a revision too,
    // unless it had been idle at the mark and that result only finalized or punctuated the same words:
    // Doubao keeps a sentence followed by silence interim until the next sentence or a seal.
    const idleAtMark = new Map(marked ? mark.idle : undefined);
    const revised = (record: SegmentRecord) => record.channel === 'user' && marked && !ended(record)
      && record.updatedAt > mark.at && (record.finalAt ?? Infinity) > mark.at
      && idleAtMark.get(record.key) !== comparableText(record.text);
    const fresh = (record: SegmentRecord) => record.channel === 'user' && marked && !ended(record)
      && record.state === 'interim' && openAtMark.has(record.key) && mark.at - record.updatedAt <= DICTATION_FRESH_INTERIM_MS;
    // A fresh interim whose connection was replaced (later speech from another epoch) was cut off, not just said.
    // Requests an earlier action ended are not replacements: their late results are older speech.
    const abandoned = (record: SegmentRecord, others: readonly SegmentRecord[]) => record.epoch !== undefined
      && others.some(other => other.text.trim() && other.epoch !== undefined && other.epoch !== record.epoch
        && other.firstSeenAt > record.updatedAt && !ended(other));
    const dictated = (record: SegmentRecord, others: readonly SegmentRecord[]) => !!record.text.trim()
      && (revised(record) || (fresh(record) && !abandoned(record, others)));
    const cutoffAt = options.cutoffAt;
    let stage1End = cutoffAt + RECEIPT_WINDOW_MS;
    let receiptKnown = false;
    const maximumEnd = Math.min(options.deadline, stage1End + PENDING_TAIL_MS);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settle!: (value: FrozenSpeech) => void;
    let fail!: (error: unknown) => void;
    const waiting = new Promise<FrozenSpeech>((resolve, reject) => { settle = resolve; fail = reject; });
    void waiting.catch(() => {});
    let result: FrozenSpeech | undefined;
    let stopped = false;
    let failed = false;
    let revisionCount = 0;
    let revisionChars = 0;
    const lanes = (['user', 'interviewer'] as const).map(channel => {
      const lane = { channel, scopes: new Set<string>(), pending: undefined as boolean | undefined,
        history: new Map<string, SegmentRecord[]>(), outcome: undefined as string | undefined,
        earlyAt: Infinity, earlyReason: 'complete' as FreezeReason, closed: false };
      const provider = sessionId && !this.draining ? this.get(channel) : null;
      if (!provider) { lane.earlyAt = Math.min(Date.now(), maximumEnd); lane.earlyReason = 'absent'; return lane; }
      try {
        const seal = provider.seal?.(cutoffAt, channel);
        if (seal) {
          lane.pending = seal.pending;
          for (const scope of seal.scopes) lane.scopes.add(scope);
          if (channel === 'user') this.rememberEnded(seal.scopes, cutoffAt);
          seal.done.then(outcome => { if (!stopped) { lane.outcome = outcome; update(); } },
            () => { if (!stopped) { lane.outcome = 'failed'; update(); } });
        }
      } catch { lane.earlyAt = Math.min(Date.now(), maximumEnd); lane.earlyReason = 'failed'; }
      return lane;
    });
    type Lane = typeof lanes[number];
    const recordsAt = (lane: Lane, at: number) => [...lane.history.values()]
      .map(versions => versions.findLast(record => record.updatedAt <= at)).filter((record): record is SegmentRecord => !!record);
    const ending = (lane: Lane) => {
      const atReceipt = [...lane.history.values()].map(versions => versions.findLast(record => record.updatedAt <= stage1End) ?? versions[0]);
      const settled = receiptKnown && lane.pending === false && atReceipt.length > 0
        && atReceipt.every(record => record.final && (record.finalAt ?? Infinity) <= stage1End);
      return Math.min(options.deadline, stage1End + (settled ? SETTLED_TAIL_MS : PENDING_TAIL_MS), lane.earlyAt);
    };
    const cleanup = () => {
      clearTimeout(timer);
      this.collectors.delete(entry);
      options.signal.removeEventListener('abort', onAbort);
    };
    const abort = (error: unknown) => {
      if (stopped) return;
      stopped = true;
      failed = true;
      cleanup();
      fail(error);
    };
    const snapshot = (): FrozenSpeech => {
      const channels = {} as FrozenSpeech['channels'];
      const spoken: SegmentRecord[] = [];
      let interviewerHeard = false;
      for (const lane of lanes) {
        const records = recordsAt(lane, ending(lane)).sort((a, b) => a.firstSeenAt - b.firstSeenAt);
        spoken.push(...records.filter(record => dictated(record, records)));
        // Interim revisions count too: the interviewer may still be mid-sentence at Stop.
        if (mark && lane.channel === 'interviewer') interviewerHeard = records.some(record => !!record.text.trim() && record.updatedAt > mark.at - INTERVIEWER_LEAD_MS);
        const segments = records
          .map(record => Object.freeze({ key: record.key, channel: record.channel, text: record.text, final: record.final,
            revision: record.revision, firstSeenAt: record.firstSeenAt, epoch: record.epoch, media: record.media && Object.freeze({ ...record.media }) }));
        channels[lane.channel] = Object.freeze({ segments: Object.freeze(segments),
          reason: lane.earlyAt <= ending(lane) ? lane.earlyReason : 'deadline' });
      }
      return Object.freeze({ sessionId, cutoffAt, frozenAt: Math.max(...lanes.map(ending)), channels: Object.freeze(channels),
        ...(mark ? { dictation: spoken.map(segment => segment.text.trim()).join(' '), dictationKeys: Object.freeze(spoken.map(segment => segment.key)), interviewerHeard } : {}) });
    };
    // A provider can move words heard by the cutoff to a key first seen after it: Doubao appends the
    // next sentence to the open one, then sends the first one's definite (dropping those words from
    // its key) with the rest under a new key. A record continuing what a collected record of the same
    // epoch lost that way is that speech, not later speech.
    const splitOff = (lane: Lane, record: SegmentRecord) => {
      const spoken = comparableText(record.text);
      return spoken !== '' && [...lane.history.values()].some(versions => {
        const atCutoff = versions.findLast(version => version.updatedAt <= cutoffAt);
        const now = versions[versions.length - 1];
        if (!atCutoff || now.epoch !== record.epoch) return false;
        const held = comparableText(atCutoff.text), kept = comparableText(now.text);
        const dropped = held.length > kept.length && held.startsWith(kept) ? held.slice(kept.length) : '';
        return dropped !== '' && (spoken.startsWith(dropped) || dropped.startsWith(spoken));
      });
    };
    const remember = (record: SegmentRecord, initial = false) => {
      const lane = lanes.find(item => item.channel === record.channel)!;
      if (lane.closed) return;
      if (record.sessionId !== sessionId || record.updatedAt > Math.min(maximumEnd, lane.earlyAt)
        || (receiptKnown && record.updatedAt > ending(lane))) return;
      const ownedScope = record.scope !== undefined && lane.scopes.has(record.scope);
      if (!lane.history.has(record.key) && !(initial && record.firstSeenAt <= cutoffAt) && !ownedScope && !splitOff(lane, record)) return;
      if (record.identityReliable === false && !ownedScope && (!initial || record.updatedAt > cutoffAt)) return;
      // A fragment open at the mark is kept past the window so a revision during the tail can still join it.
      if (!revised(record) && !openAtMark.has(record.key) && record.updatedAt < cutoffAt - SNAPSHOT_WINDOW_MS) return;
      const versions = lane.history.get(record.key) ?? [];
      if (versions.at(-1)?.revision === record.revision) return;
      if (++revisionCount > 8192 || (revisionChars += record.text.length) > 2_097_152) {
        abort(new Error('Speech snapshot capacity exceeded')); return;
      }
      versions.push({ ...record, media: record.media && { ...record.media } });
      lane.history.set(record.key, versions);
    };
    const update = () => {
      if (stopped) return;
      const now = Date.now();
      for (const lane of lanes) {
        if (now <= ending(lane) && !Number.isFinite(lane.earlyAt)) {
          if (lane.outcome === 'failed') { lane.earlyAt = now; lane.earlyReason = 'failed'; }
          else if ((lane.outcome === 'complete' || lane.outcome === 'no-pending') && !recordsAt(lane, now).some(record => !record.final)) lane.earlyAt = now;
        }
        lane.closed = ending(lane) <= now;
      }
      if (lanes.every(lane => ending(lane) <= now)) {
        stopped = true;
        cleanup();
        result = snapshot();
        settle(result);
        return;
      }
      const due = Math.min(...lanes.map(ending).filter(end => end > now));
      clearTimeout(timer);
      timer = setTimeout(update, Math.max(0, due - now));
    };
    const entry = { update: (record: SegmentRecord) => { remember(record); update(); }, abort };
    const onAbort = () => abort(options.signal.reason ?? new DOMException('Aborted', 'AbortError'));
    options.signal.addEventListener('abort', onAbort, { once: true });
    this.collectors.add(entry);
    for (const record of this.ledger.values()) { remember(record, true); if (stopped) break; }
    update();
    return {
      cutoffAt,
      get frozen() { return result ? Promise.resolve(result) : waiting; },
      setStage1End: (at: number) => {
        if (failed || !Number.isFinite(at) || options.signal.aborted || receiptKnown) return;
        receiptKnown = true;
        const end = Math.max(cutoffAt, Math.min(at, Date.now(), cutoffAt + RECEIPT_WINDOW_MS));
        stage1End = end;
        // A late continuation selects only immutable revisions from its actual window.
        // It never reopens collection or changes an already returned snapshot object.
        if (stopped) result = snapshot(); else update();
      },
    };
  }

  async drain(timeoutMs = 5000, graceMs = 1500): Promise<DrainResult> {
    this.abortCollectors();
    this.draining = true;
    try { return await this.finish(true, timeoutMs, graceMs); }
    finally { this.session = null; this.draining = false; }
  }

  async stopChannels(timeoutMs = 5000): Promise<void> {
    this.abortCollectors();
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
