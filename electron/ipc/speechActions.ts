import type { GenerationTask } from '../llm/generateTask';
import type { CollectOptions, DictationMark, FrozenSpeech, SpeechCollector } from '../audio/MeetingSttSession';
import type { ConversationBase } from '../SessionTracker';

export const SPEECH_ACTION_KINDS = ['what-to-say', 'clarify', 'follow-up', 'recap', 'follow-up-questions', 'code-hint', 'brainstorm', 'answer'] as const;
export type SpeechActionKind = typeof SPEECH_ACTION_KINDS[number];

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_LIMIT = 32;

export class SpeechActionError extends Error {
  constructor() { super('This action is no longer available. Try again.'); this.name = 'SpeechActionError'; }
}

export interface SpeechActionOwner {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, ...args: any[]): void;
  once(event: 'destroyed', listener: () => void): unknown;
  removeListener(event: 'destroyed', listener: () => void): unknown;
}

export interface SpeechAction {
  readonly id: string;
  readonly kind: SpeechActionKind;
  readonly task: GenerationTask<any>;
  readonly startedAt: number;
  /** Conversation, replies and coding question copied when the action began. */
  readonly base: ConversationBase;
  readonly frozen: Promise<FrozenSpeech>;
  /** Set once the Stop question is frozen; the chat request must send exactly this. */
  question?: string;
}

interface Entry {
  owner: SpeechActionOwner;
  kind: SpeechActionKind;
  action?: SpeechAction;
  collector?: SpeechCollector;
  failure?: unknown;
  consumed?: boolean;
  detach(): void;
}

export interface SpeechActionDeps {
  beginTask(startedAt: number): GenerationTask<any>;
  collect(options: CollectOptions): SpeechCollector;
  markDictation(at: number): DictationMark;
  captureBase(cutoffAt: number): ConversationBase;
  now?(): number;
}

/**
 * Main-owned manual actions. Begin cuts the speech at the click and starts collecting without
 * waiting for providers; the action channel later takes the action once. A sender has at most
 * one action and one dictation, and the table is bounded.
 */
export class SpeechActions {
  private readonly entries = new Map<string, Entry>();
  private readonly dictations = new Map<number, { id: string; mark: DictationMark; detach(): void }>();

  constructor(private readonly deps: SpeechActionDeps) {}

  private now(): number { return this.deps.now?.() ?? Date.now(); }

  begin(owner: SpeechActionOwner, payload: unknown): { speechActionId: string } {
    const receivedAt = this.now();
    const { clientActionId, kind, clickedAt, dictationId } = (payload ?? {}) as Record<string, unknown>;
    if (typeof clientActionId !== 'string' || !ID.test(clientActionId) || !SPEECH_ACTION_KINDS.includes(kind as SpeechActionKind)
      || typeof clickedAt !== 'number' || !Number.isFinite(clickedAt) || clickedAt <= 0
      || (kind === 'answer') !== (typeof dictationId === 'string') || (dictationId !== undefined && typeof dictationId !== 'string')
      || owner.isDestroyed() || this.entries.has(clientActionId)) throw new SpeechActionError();
    const held = this.dictations.get(owner.id);
    if (dictationId !== undefined && held?.id !== dictationId) throw new SpeechActionError();
    if (dictationId !== undefined) this.endDictation(owner.id);
    this.cancel(owner);
    if (this.entries.size >= ACTION_LIMIT) this.release(this.entries.keys().next().value!);
    const id = clientActionId;
    const destroyed = () => this.cancel(owner);
    const entry: Entry = { owner, kind: kind as SpeechActionKind, detach: () => owner.removeListener('destroyed', destroyed) };
    owner.once('destroyed', destroyed);
    this.entries.set(id, entry);
    let task: GenerationTask<any> | undefined;
    const onAbort = () => this.release(id);
    try {
      const startedAt = Math.min(clickedAt, receivedAt);
      task = this.deps.beginTask(startedAt);
      task.rendererOwner = owner;
      task.signal.addEventListener('abort', onAbort, { once: true });
      const running = task;
      entry.detach = () => { owner.removeListener('destroyed', destroyed); running.signal.removeEventListener('abort', onAbort); };
      const base = this.deps.captureBase(startedAt);
      entry.collector = this.deps.collect({
        cutoffAt: startedAt, deadline: Math.min(task.firstTokenDeadline ?? Infinity, task.totalDeadline), signal: task.signal,
        dictation: dictationId !== undefined ? held!.mark : undefined,
      });
      const collector = entry.collector;
      entry.action = { id, kind: entry.kind, task, startedAt, base,
        get frozen() { return collector.frozen; } };
    } catch (error) {
      // The action channel reports the failure with its own error semantics. A task started before
      // the failure is released now; only the owner's destroy listener stays until the entry goes.
      if (task) {
        task.signal.removeEventListener('abort', onAbort);
        entry.detach = () => owner.removeListener('destroyed', destroyed);
        if (!task.signal.aborted) task.controller.abort(new DOMException('Speech action failed to start', 'AbortError'));
        task.close();
      }
      entry.failure = error;
    }
    return { speechActionId: id };
  }

  /** Validates a continuation from its sender; `stage1EndAt` can only shorten the receipt window. */
  take(owner: SpeechActionOwner, ref: unknown, kind: SpeechActionKind, consume = true): SpeechAction {
    const { speechActionId, stage1EndAt } = (ref ?? {}) as Record<string, unknown>;
    const entry = typeof speechActionId === 'string' ? this.entries.get(speechActionId) : undefined;
    if (!entry || entry.owner !== owner || entry.kind !== kind || entry.consumed) throw new SpeechActionError();
    if (!entry.action) { this.forget(speechActionId as string); throw entry.failure; }
    const action = entry.action;
    if (action.task.signal.aborted) { this.release(action.id); throw new SpeechActionError(); }
    if (typeof stage1EndAt === 'number') entry.collector?.setStage1End(stage1EndAt);
    // Consuming the capability must not relinquish cancellation while its task is still running.
    if (consume) entry.consumed = true;
    return action;
  }

  /**
   * Answer marks where dictated speech starts. The renderer names the mark, so Stop never waits for
   * this reply; main owns the mark, bound to its sender, and drops it when the sender is destroyed.
   */
  beginDictation(owner: SpeechActionOwner, payload: unknown): { dictationId: string } {
    const receivedAt = this.now();
    const { dictationId, clickedAt } = (payload ?? {}) as Record<string, unknown>;
    if (typeof dictationId !== 'string' || !ID.test(dictationId) || typeof clickedAt !== 'number' || !Number.isFinite(clickedAt)
      || clickedAt <= 0 || owner.isDestroyed()) throw new SpeechActionError();
    this.cancel(owner);
    this.endDictation(owner.id);
    const destroyed = () => { if (this.dictations.get(owner.id)?.id === dictationId) this.endDictation(owner.id); };
    owner.once('destroyed', destroyed);
    this.dictations.set(owner.id, { id: dictationId, mark: this.deps.markDictation(Math.min(clickedAt, receivedAt)),
      detach: () => owner.removeListener('destroyed', destroyed) });
    return { dictationId };
  }

  /**
   * A newer action, typed question, cancel, reset or a destroyed sender ends pending actions. A
   * sender's dictation mark survives its own cancels so Stop still works; reset, meeting end and
   * sender destruction drop it.
   */
  cancel(owner?: SpeechActionOwner): void {
    for (const [id, entry] of [...this.entries]) {
      if (!owner || entry.owner === owner) this.release(id);
    }
    if (!owner) for (const ownerId of [...this.dictations.keys()]) this.endDictation(ownerId);
  }

  get size(): number { return this.entries.size; }

  get dictationCount(): number { return this.dictations.size; }

  private endDictation(ownerId: number): void {
    this.dictations.get(ownerId)?.detach();
    this.dictations.delete(ownerId);
  }

  private forget(id: string): Entry | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    entry.detach();
    return entry;
  }

  // An unconsumed action owns its task: releasing it aborts and closes the task.
  private release(id: string): void {
    const task = this.forget(id)?.action?.task;
    if (!task) return;
    if (!task.signal.aborted) task.controller.abort(new DOMException('Speech action released', 'AbortError'));
    task.close();
  }
}
