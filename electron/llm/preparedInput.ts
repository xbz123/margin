import type { GenerateRequest } from './generateContract';
import type { ProviderDataScope } from './ProviderRouter';
import type { LocalContextEntry } from '../../src/types/localContext';
import type { GenerationTask } from './generateTask';

export const PREPARED_INPUT_LIMIT = 64 * 1024 * 1024;
type InputDependencies = Pick<PreparedInput, 'imagePaths' | 'localContext' | 'promptDependency'>;
export interface PreparedInput {
    userContent: string;
    systemInstruction?: string;
    contents: any[];
    dataScopes: ProviderDataScope[];
    localContext: LocalContextEntry[];
    promptDependency?: string;
    imagePaths: string[];
    stream: boolean;
    purpose: GenerateRequest['purpose'];
    outputLimit?: number;
}

/** JSON-only, owned input. Never retain credentials, a transport, or caller-owned buffers. */
export function copyPreparedInput(input: PreparedInput): PreparedInput {
    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized) > PREPARED_INPUT_LIMIT) throw new Error('Request input exceeds the 64 MiB retry limit. Remove attachments or shorten the request.');
    return JSON.parse(serialized);
}

export interface PresentationOwner {
    id: number;
    isDestroyed(): boolean;
    send(channel: string, ...args: any[]): void;
    once?(event: 'destroyed', listener: () => void): unknown;
    removeListener?(event: 'destroyed', listener: () => void): unknown;
}

interface HeldInput {
    task?: GenerationTask<any>;
    failure?: Pick<GenerationTask<any>, 'requestId' | 'questionId' | 'kind' | 'entryPoint'>;
    owner: PresentationOwner;
    input?: PreparedInput;
    pending?: InputDependencies;
    detach(): void;
}

/** One current question per window. Completed tasks never keep their input alive. */
export class PreparedInputs {
    private readonly held = new Map<number, HeldInput>();

    begin(owner: PresentationOwner, task: GenerationTask<any>, input?: PreparedInput): void {
        this.clear(owner.id);
        if (owner.isDestroyed()) throw new Error('The question window is closed.');
        if (this.held.size >= 32) this.clear(this.held.keys().next().value!);
        const destroyed = () => { this.held.get(owner.id)?.task?.controller.abort(new DOMException('Window closed', 'AbortError')); this.clear(owner.id); };
        owner.once?.('destroyed', destroyed);
        const entry: HeldInput = { owner, task, input, detach: () => owner.removeListener?.('destroyed', destroyed) };
        this.held.set(owner.id, entry);
        task.onClose = this.finish.bind(this, owner.id, task.requestId);
    }

    private finish(ownerId: number, requestId: string): void {
        const entry = this.held.get(ownerId), task = entry?.task;
        if (!entry || !task || task.requestId !== requestId) return;
        if (!entry.input || !this.failed(task)) this.clear(ownerId);
        else {
            entry.failure = { requestId, questionId: task.questionId, kind: task.kind, entryPoint: task.entryPoint };
            entry.task = undefined;
        }
    }

    capture(task: GenerationTask<any>, input: PreparedInput): void {
        const entry = task.rendererOwner && this.held.get(task.rendererOwner.id);
        if (entry?.task === task && !entry.input) entry.input = copyPreparedInput(input);
    }

    depend(task: GenerationTask<any>, imagePaths: string[]): void {
        const entry = task.rendererOwner && this.held.get(task.rendererOwner.id);
        if (entry?.task === task && !entry.input) entry.pending = { imagePaths: [...imagePaths], localContext: [] };
    }

    private failed(task: GenerationTask<any>): boolean {
        return ['failed', 'incomplete', 'empty'].includes(task.terminalStatus ?? '');
    }

    retryable(task: GenerationTask<any>): boolean {
        const entry = task.rendererOwner && this.held.get(task.rendererOwner.id);
        return !!entry?.input && (entry.failure?.requestId === task.requestId || entry.task === task && this.failed(task));
    }

    take(owner: PresentationOwner, requestId: unknown): { input: PreparedInput; prior: NonNullable<HeldInput['failure']> } {
        const entry = this.held.get(owner.id);
        if (typeof requestId !== 'string' || entry?.owner !== owner || entry.failure?.requestId !== requestId || !entry.input) {
            throw new Error('This failed question is no longer available.');
        }
        return { input: entry.input, prior: entry.failure };
    }

    visible(owner: PresentationOwner, requestId: unknown): void {
        const entry = this.held.get(owner.id);
        if (entry?.owner === owner && entry.task?.requestId === requestId) entry.task.acknowledgeVisible();
    }

    revoke(predicate: (input: InputDependencies) => boolean): void {
        for (const [id, entry] of this.held) {
            const input = entry.input ?? entry.pending;
            if (!input || !predicate(input)) continue;
            entry.task?.controller.abort(new DOMException('Request input was withdrawn', 'AbortError'));
            this.clear(id);
        }
    }

    clear(ownerId?: number): void {
        if (ownerId === undefined) { for (const id of [...this.held.keys()]) this.clear(id); return; }
        const entry = this.held.get(ownerId);
        entry?.detach();
        this.held.delete(ownerId);
    }
}
