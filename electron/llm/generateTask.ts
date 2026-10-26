import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { GenerationMetadata } from '../../src/types/generationMetadata';
import { GenerationResultError, type GenerateEvent } from './generateContract';
import { rethrowProviderScopeError } from './ProviderRouter';
import { DEFAULT_GENERATION_POLICY, validateGenerationPolicy, type GenerationPolicy } from '../../src/types/generationPolicy';

export const BACKGROUND_GENERATION_TIMEOUT_MS = 180_000;
export type GenerationKind = 'interview' | 'written' | 'background' | 'compatibility';

export class GenerationTimeoutError extends Error {
    constructor(public readonly deadline: 'first-token' | 'total', public readonly partial: boolean) {
        super(`Generation ${deadline} timeout${partial ? ' after partial output' : ''}`);
        this.name = 'GenerationTimeoutError';
    }
}

// Node timers cap their delay at a signed 32-bit integer; long budgets need successive timers.
function deadlineTimer(deadline: number, expire: () => void): () => void {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const tick = () => {
        if (cancelled) return;
        const remaining = deadline - Date.now();
        if (remaining <= 0) { expire(); return; }
        timer = setTimeout(tick, Math.min(remaining, 2_147_483_647));
        timer.unref?.();
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
}

export class GenerationTask<T = unknown> {
    codeOutputFormat?: 'plain' | 'markdown';
    readonly requestId = randomUUID();
    questionId = this.requestId;
    retryOf?: string;
    entryPoint = 'internal';
    requireVisibleReceipt = false;
    onClose?: () => void;
    speechEndedAt?: number;
    firstSendAt?: number;
    firstVisibleAt?: number;
    private offeredVisible = false;
    private resolveVisible?: () => void;
    private readonly visible = new Promise<void>(resolve => { this.resolveVisible = resolve; });
    rendererOwner?: { id: number; isDestroyed(): boolean; send(channel: string, ...args: any[]): void };
    readonly controller = new AbortController();
    readonly signal = this.controller.signal;
    readonly startedAt: number;
    readonly totalDeadline: number;
    readonly firstTokenDeadline?: number;
    readonly sendLimit: number;
    sends = 0;
    hasText = false;
    deferVisibleText = false;
    imageCount = 0;
    displayedText = '';
    errorMessage?: string;
    actualTarget: T;
    terminalStatus?: GenerationMetadata['status'];
    private firstTimer?: () => void;
    private totalTimer?: () => void;
    private detach?: () => void;

    constructor(readonly primary: T, readonly backup: T | undefined, policy: GenerationPolicy = DEFAULT_GENERATION_POLICY,
        readonly kind: GenerationKind = 'interview', signal?: AbortSignal, startedAt = Date.now()) {
        validateGenerationPolicy(policy);
        this.sendLimit = kind === 'compatibility' ? 1 : 2;
        this.actualTarget = primary;
        this.signal.addEventListener('abort', () => {
            if (!this.finished) this.terminalStatus = this.signal.reason?.name === 'GenerationTimeoutError' ? 'failed' : 'cancelled';
        }, { once: true });
        this.startedAt = startedAt;
        this.totalDeadline = startedAt + (kind === 'background' ? BACKGROUND_GENERATION_TIMEOUT_MS
            : kind === 'written' ? policy.writtenTotalSeconds * 1000 : kind === 'compatibility' ? 15_000 : policy.interviewTotalSeconds * 1000);
        if (kind === 'interview') {
            this.firstTokenDeadline = startedAt + policy.interviewFirstTokenSeconds * 1000;
            this.firstTimer = deadlineTimer(this.firstTokenDeadline, () => this.controller.abort(new GenerationTimeoutError('first-token', this.hasText)));
        }
        this.totalTimer = deadlineTimer(this.totalDeadline, () => this.controller.abort(new GenerationTimeoutError('total', this.hasText)));
        if (signal) {
            const abort = () => this.controller.abort(signal.reason);
            if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
            this.detach = () => signal.removeEventListener('abort', abort);
        }
    }

    check(): void {
        if (!this.signal.aborted && Date.now() >= this.totalDeadline) this.controller.abort(new GenerationTimeoutError('total', this.hasText));
        if (!this.signal.aborted && this.firstTimer && Date.now() >= this.firstTokenDeadline!) this.controller.abort(new GenerationTimeoutError('first-token', this.hasText));
        this.signal.throwIfAborted();
    }

    claimSend(target?: T): void {
        this.check();
        if (this.sends >= this.sendLimit) throw new Error('Generation send budget exhausted');
        this.sends++;
        this.firstSendAt ??= Date.now();
        if (target !== undefined) this.actualTarget = target;
    }

    acceptText(text: string): void {
        this.hasText ||= Boolean(text);
    }

    markVisible(text: string): void {
        if (!text.trim()) return;
        this.offeredVisible = true;
        if (!this.requireVisibleReceipt) this.acknowledgeVisible();
    }

    acknowledgeVisible(): void {
        if (!this.offeredVisible || this.firstVisibleAt !== undefined || this.signal.aborted || this.finished) return;
        this.check();
        this.firstVisibleAt = Date.now();
        this.firstTimer?.(); this.firstTimer = undefined;
        this.resolveVisible?.();
    }

    async waitForVisible(): Promise<void> {
        if (this.requireVisibleReceipt && this.offeredVisible && this.firstVisibleAt === undefined && this.terminalStatus === 'completed') {
            await awaitGeneration(this, this.visible);
        }
    }

    close(): void {
        if (this.finished) return;
        this.finished = true;
        this.onClose?.();
        this.firstTimer?.(); this.totalTimer?.(); this.detach?.();
        this.controller.abort();
    }
    private finished = false;
}

export const generationTasks = new AsyncLocalStorage<GenerationTask<any>>();

export function awaitGeneration<T>(task: GenerationTask<any>, value: PromiseLike<T>): Promise<T> {
    task.check();
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(task.signal.reason);
        task.signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(value).then(result => {
            task.signal.removeEventListener('abort', abort);
            try { task.check(); resolve(result); } catch (error) { reject(error); }
        }, error => { task.signal.removeEventListener('abort', abort); reject(error); });
    });
}

// A generator resumes in next(), not when constructed; preserve the task at every step.
export function withGenerationTask<T>(task: GenerationTask<any>, source: AsyncGenerator<T, void, unknown>, own = true): AsyncGenerator<T> {
    const iterator = (async function* () {
        try {
            for (;;) {
                task.check();
                const step = await awaitGeneration(task, generationTasks.run(task, () => source.next()));
                if (step.done) { if (own) await task.waitForVisible(); return; }
                if (!task.deferVisibleText && typeof step.value === 'string') task.markVisible(step.value);
                yield step.value as T;
            }
        } catch (error) {
            if (!task.signal.aborted && !['refused', 'incomplete', 'empty'].includes(task.terminalStatus ?? '')) task.terminalStatus = 'failed';
            throw error;
        } finally {
            if (own) task.close();
            if (source.return) void Promise.resolve(generationTasks.run(task, () => source.return(undefined))).catch(() => {});
        }
    })();
    const cancel = () => {
        task.controller.abort(new DOMException('Generation consumer closed', 'AbortError'));
        if (own) task.close();
    };
    return {
        next: value => iterator.next(value),
        return: value => { cancel(); return iterator.return(value); },
        throw: error => { cancel(); return iterator.throw(error); },
        [Symbol.asyncIterator]() { return this; },
        async [Symbol.asyncDispose]() { await this.return(undefined); },
    };
}

function details(error: any): any {
    if (error?.error) return error.error.error ?? error.error;
    if (error?.response?.data) return error.response.data.error ?? error.response.data;
    try { return JSON.parse(error?.message)?.error; } catch { return undefined; }
}
function isImageRejection(error: any): boolean {
    const info = details(error);
    return ['unsupported_image', 'image_not_supported', 'invalid_image', 'invalid_image_format', 'invalid_image_url'].includes(info?.code ?? error?.code)
        || /(?:does not support|doesn't support|cannot process|unable to process) (?:image|vision)|image (?:input|processing) (?:is )?not supported/i.test(info?.message ?? '');
}

export function classifyGenerationFailure(error: any): 'transient' | 'model-unavailable' | 'cache-invalid' | 'terminal' {
    const info = details(error);
    const code = info?.code ?? error?.code;
    const reason = info?.details?.find((entry: any) => entry['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo')?.reason;
    const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? info?.code ?? (typeof error?.code === 'number' ? error.code : undefined));
    if (isImageRejection(error)) return 'terminal';
    if (status === 401 || status === 403 || ['insufficient_quota', 'invalid_api_key'].includes(code)) return 'terminal';
    if (['CACHED_CONTENT_NOT_FOUND', 'CACHED_CONTENT_EXPIRED'].includes(reason)) return 'cache-invalid';
    if (['model_not_found', 'model_decommissioned', 'model_not_available'].includes(code) || reason === 'MODEL_NOT_FOUND') return 'model-unavailable';
    if (status === 408 || status === 429 || status >= 500 && status <= 599) return 'transient';
    if (status >= 400) return 'terminal';
    const seen = new Set();
    for (let cause = error; cause && !seen.has(cause); cause = cause.cause) {
        seen.add(cause);
        if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(cause.code)) return 'transient';
    }
    return 'terminal';
}

function retryAfterMs(error: any): number {
    const headers = error?.headers ?? error?.response?.headers;
    const value = headers?.get?.('retry-after') ?? headers?.['retry-after'];
    if (!value) return 0;
    const seconds = Number(value);
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value) - Date.now()) || 0;
}

export async function* generateTask<T>(task: GenerationTask<T>, open: (target: T, signal: AbortSignal, cacheRecovery: boolean) => AsyncIterable<GenerateEvent>,
    options: { cacheReference?: string; invalidateCache?: () => void; onAttempt?: (target: T, attempt: number) => void;
      recoverAuthentication?: (target: T, error: unknown) => Promise<boolean> } = {}): AsyncGenerator<GenerateEvent> {
    let target = task.primary, cacheRecovery = false;
    let authRecovery = false;
    for (let attempt = 1; attempt <= task.sendLimit; attempt++) {
        task.check();
        task.terminalStatus = undefined;
        options.onAttempt?.(target, attempt);
        let failure: unknown;
        try {
            const source = open(target, task.signal, cacheRecovery)[Symbol.asyncIterator]();
            try { for (;;) {
                const step = await awaitGeneration(task, source.next());
                if (step.done) break;
                const event = step.value;
                task.check();
                if (event.type === 'delta') { task.acceptText(event.text); yield event; }
                else if (event.status === 'failed') failure = event.error ?? new GenerationResultError('failed', task.hasText);
                else if (event.status === 'cancelled') { task.controller.abort(new DOMException('Generation cancelled', 'AbortError')); task.check(); }
                else { task.terminalStatus = event.status; yield event; return; }
            } } finally { if (source.return) void Promise.resolve(source.return()).catch(() => {}); }
        } catch (error) { failure = error; }
        failure ??= new GenerationResultError('incomplete', task.hasText);
        task.check(); rethrowProviderScopeError(failure);
        if (task.hasText && (failure as any)?.name !== 'GenerationResultError') failure = Object.assign(new GenerationResultError('failed', true), { cause: failure });
        const category = classifyGenerationFailure(failure);
        const terminalFailure = () => {
            task.terminalStatus = 'failed';
            if (isImageRejection(failure)) failure = new Error('This model may not support images. Check the provider model documentation or cancel the image-support confirmation. Your input and attachments were kept.');
            if (failure && typeof failure === 'object' && Object.isExtensible(failure)) Object.defineProperty(failure, 'generationTaskTerminal', { value: true, configurable: true });
            return failure;
        };
        if (task.hasText || attempt === task.sendLimit || task.sends >= task.sendLimit) throw terminalFailure();
        if (!authRecovery && options.recoverAuthentication) {
            authRecovery = true;
            const recovered = await awaitGeneration(task, options.recoverAuthentication(target, failure));
            task.check();
            if (recovered) continue;
        }
        if (category === 'terminal') throw terminalFailure();
        if (category === 'cache-invalid') {
            if (!options.cacheReference || !options.invalidateCache || cacheRecovery) throw terminalFailure();
            options.invalidateCache(); cacheRecovery = true;
        } else {
            if (task.backup) target = task.backup;
            else if (category !== 'transient') throw terminalFailure();
            const delay = retryAfterMs(failure);
            const remaining = Math.min(task.totalDeadline, task.firstTokenDeadline ?? task.totalDeadline) - Date.now();
            if (delay >= remaining) throw terminalFailure();
            if (delay > 0) await new Promise<void>((resolve, reject) => {
                const abort = () => { cancelTimer(); reject(task.signal.reason); };
                const cancelTimer = deadlineTimer(Date.now() + delay, () => { task.signal.removeEventListener('abort', abort); resolve(); });
                task.signal.addEventListener('abort', abort, { once: true });
            });
        }
    }
}
