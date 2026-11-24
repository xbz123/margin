// IntelligenceEngine.ts
// LLM mode routing and orchestration.
// Extracted from IntelligenceManager to decouple LLM logic from state management.

import { EventEmitter } from 'events';
import { LLMHelper } from './LLMHelper';
import type { GenerationTask } from './llm/generateTask';
import { prepareManualAnswer, isPendingAnswerSentinel, latestInterviewerQuestion } from './llm/answerGeneration';
import type { PreparedInput } from './llm/preparedInput';
import { manualAnswerError, MANUAL_ANSWER_CANCELLED } from './direct-assist/errors';
import { SessionTracker, TranscriptSegment, type TranscriptView } from './SessionTracker';
import {
    AnswerLLM, ClarifyLLM, CodeHintLLM, FollowUpLLM, RecapLLM,
    FollowUpQuestionsLLM, WhatToAnswerLLM,
    prepareTranscriptForWhatToAnswer, buildTemporalContext, classifyIntent
} from './llm';
import { ScreenContext } from './services/screen/ScreenContextService';
import { buildPreparedTranscriptContext as assemblePreparedTranscriptContext } from './utils/preparedTranscriptContext';

// Mode types
export type IntelligenceMode = 'idle' | 'what_to_say' | 'follow_up' | 'recap' | 'clarify' | 'follow_up_questions' | 'code_hint';

// Refinement intent detection (refined to avoid false positives)
function detectRefinementIntent(userText: string): { isRefinement: boolean; intent: string } {
    const lowercased = userText.toLowerCase().trim();
    const refinementPatterns = [
        { pattern: /make it longer|expand on this|elaborate more/i, intent: 'expand' },
        { pattern: /rephrase that|say it differently|put it another way/i, intent: 'rephrase' },
        { pattern: /give me an example|provide an instance/i, intent: 'add_example' },
        { pattern: /make it more confident|be more assertive|sound stronger/i, intent: 'more_confident' },
        { pattern: /make it casual|be less formal|sound relaxed/i, intent: 'more_casual' },
        { pattern: /make it formal|be more professional|sound professional/i, intent: 'more_formal' },
        { pattern: /simplify this|make it simpler|explain specifically/i, intent: 'simplify' },
    ];

    for (const { pattern, intent } of refinementPatterns) {
        if (pattern.test(lowercased)) {
            return { isRefinement: true, intent };
        }
    }

    return { isRefinement: false, intent: '' };
}

// Events emitted by IntelligenceEngine
export interface IntelligenceModeEvents {
    'suggested_answer': (answer: string, question: string, confidence: number) => void;
    'suggested_answer_token': (token: string, question: string, confidence: number) => void;
    'refined_answer': (answer: string, intent: string) => void;
    'refined_answer_token': (token: string, intent: string) => void;
    'recap': (summary: string) => void;
    'recap_token': (token: string) => void;
    'clarify': (clarification: string) => void;
    'clarify_token': (token: string) => void;
    'follow_up_questions_update': (questions: string) => void;
    'follow_up_questions_token': (token: string) => void;
    'mode_changed': (mode: IntelligenceMode) => void;
    'error': (error: Error, mode: IntelligenceMode) => void;
}

export class IntelligenceEngine extends EventEmitter {
    // Mode state
    private activeMode: IntelligenceMode = 'idle';

    // Mode-specific LLMs
    private answerLLM: AnswerLLM | null = null;
    private clarifyLLM: ClarifyLLM | null = null;
    private followUpLLM: FollowUpLLM | null = null;
    private recapLLM: RecapLLM | null = null;
    private followUpQuestionsLLM: FollowUpQuestionsLLM | null = null;
    private whatToAnswerLLM: WhatToAnswerLLM | null = null;
    private codeHintLLM: CodeHintLLM | null = null;

    // Concurrency tracking
    private currentGenerationId: number = 0;
    private activeGenerationController?: AbortController;
    private activeGenerationTask?: GenerationTask<any>;
    private generationMetadata() {
        const task = this.llmHelper.getCurrentGenerationTask();
        return task ? this.llmHelper.getTaskMetadata(task) : undefined;
    }
    // Every recordUsage call is a success row; the task is marked so a later abort (e.g. the
    // visible-receipt timeout) does not list it a second time (runGenerationRequest recordPartial).
    private recordUsage(entry: any): void {
        this.session.pushUsage({ ...entry, ...this.generationMetadata() });
        this.markSuccessRecorded();
    }
    private markSuccessRecorded(): void {
        const task = this.llmHelper?.getCurrentGenerationTask?.();
        if (task) (this.successRecorded ??= new WeakSet()).add(task);
    }

    // The history label of each question, by question id, set when the question is first
    // issued. A retry keeps the question id, so its answer is listed under the words the
    // user saw rather than the id; the assembled prompt is never a label (it can carry
    // meeting context or reference material).
    private static readonly QUESTION_LABEL_LIMIT = 64;
    // Created on first use: mode methods are also run on engine-shaped objects.
    private questionLabels?: Map<string, { type: string; question: string; displayQuestion?: string }>;
    private rememberQuestion(type: string, question: string): void {
        this.rememberQuestionFor(this.llmHelper?.getCurrentGenerationTask?.(), type, question);
    }
    /**
     * Records the history label of a question issued outside the mode methods (typed or spoken
     * chat). `question` is the user-visible message, the one a first-try success logs; never the
     * assembled prompt. `displayQuestion` is the localized text the user saw in place of the
     * message (a screenshot-only question in the Chinese UI), kept for the history row.
     */
    rememberQuestionFor(task: GenerationTask<any> | undefined, type: string, question: string, displayQuestion?: string): void {
        const id = task?.questionId;
        if (!id || typeof question !== 'string' || !question.trim()) return;
        const labels = this.questionLabels ??= new Map();
        labels.delete(id);
        labels.set(id, typeof displayQuestion === 'string' && displayQuestion.trim() ? { type, question, displayQuestion } : { type, question });
        while (labels.size > IntelligenceEngine.QUESTION_LABEL_LIMIT) labels.delete(labels.keys().next().value!);
    }
    // The action name of each entry point, for a question whose label is not held.
    private static readonly ENTRY_POINT_LABELS: Record<string, { type: string; question: string }> = {
        'what-to-say': { type: 'assist', question: 'What to Answer' },
        'follow-up': { type: 'followup', question: 'Follow-up' },
        recap: { type: 'chat', question: 'Recap Meeting' },
        clarify: { type: 'chat', question: 'Clarify Question' },
        'follow-up-questions': { type: 'followup_questions', question: 'Generate Follow-up Questions' },
        'code-hint': { type: 'assist', question: 'Code Hint' },
        // Typed and spoken chat log their message; this applies only when it was not held.
        text: { type: 'chat', question: 'Retry' },
        answer: { type: 'chat', question: 'Retry' },
    };
    // The label of a first attempt with no held label and no named entry point (an 'internal'
    // task). Typed and spoken chat log their own rows and never get here; 'Retry' would be
    // wrong for a first attempt, so it keeps the placeholder older meetings stored, which the
    // renderer shows as "question not recorded" (meetingUsageExport shownQuestion).
    private static readonly UNLABELLED_QUESTION = 'generation outcome';
    /**
     * The history label a successful answer of this task records: the label its mode method
     * remembered, else the entry point's action name. A Retry with neither is "Retry"; a first
     * attempt is never called a Retry.
     */
    private questionLabel(task: GenerationTask<any>): { type: string; question: string; displayQuestion?: string } {
        const held = this.questionLabels?.get(task.questionId);
        if (held) return held;
        const named = IntelligenceEngine.ENTRY_POINT_LABELS[task.entryPoint];
        if (task.retryOf) return named ?? { type: 'assist', question: 'Retry' };
        return named && named.question !== 'Retry' ? named : { type: 'assist', question: IntelligenceEngine.UNLABELLED_QUESTION };
    }

    // The history label of a follow-up, the one place its intents are named: shared by the mode
    // method and the IPC action, which remembers it before the speech is frozen.
    private static readonly FOLLOW_UP_INTENT_LABELS: Record<string, string> = {
        'expand': 'Expand Answer',
        'rephrase': 'Rephrase Answer',
        'add_example': 'Add Example',
        'more_confident': 'Make More Confident',
        'more_casual': 'Make More Casual',
        'more_formal': 'Make More Formal',
        'simplify': 'Simplify Answer'
    };
    static followUpQuestion(intent: string, userRequest?: string): string {
        return userRequest || IntelligenceEngine.FOLLOW_UP_INTENT_LABELS[intent] || `Refining: ${intent}`;
    }

    /**
     * Records the history row of a task that ended (cancelled or failed while its speech was being
     * frozen) before any mode method ran it, so nothing was generated and runGenerationRequest never
     * saw it. A task the engine ran records its own row there; this never adds a second one.
     */
    recordUnrunTask(task: GenerationTask<any>): void {
        if (!task.terminalStatus || task.terminalStatus === 'completed') return;
        if (this.generationRequested?.has(task) || this.successRecorded?.has(task)) return;
        // Marked as recorded, so a mode method still reached after the abort lists nothing more.
        (this.successRecorded ??= new WeakSet()).add(task);
        const label = this.questionLabel(task);
        this.session.pushUsage({ type: label.type, timestamp: Date.now(), question: label.question, ...(label.displayQuestion ? { displayQuestion: label.displayQuestion } : {}), answer: '', ...this.llmHelper.getTaskMetadata(task) });
    }

    override emit(event: string | symbol, ...args: any[]): boolean {
        const task = this.llmHelper?.getCurrentGenerationTask();
        if (task) {
            if (task !== this.activeGenerationTask || task.signal.aborted) return false;
            if (event === 'error') task.errorMessage = args[0]?.message;
            if (String(event).endsWith('_token')) { task.displayedText += String(args[0] ?? ''); task.markVisible(String(args[0] ?? '')); }
            else if (['suggested_answer', 'refined_answer', 'recap', 'clarify', 'follow_up_questions_update'].includes(String(event))) task.markVisible(String(args[0] ?? ''));
            return super.emit(event, ...args, this.llmHelper.getTaskMetadata(task), task.rendererOwner);
        }
        return super.emit(event, ...args);
    }

    // Tasks whose success (usage row or assistant message) a mode method or runPreparedRetry has
    // recorded. Created on first use, like questionLabels, since mode methods also run on
    // engine-shaped objects.
    private successRecorded?: WeakSet<GenerationTask<any>>;
    // Tasks that reached runGenerationRequest, which records their failure itself (recordUnrunTask).
    private generationRequested?: WeakSet<GenerationTask<any>>;

    private runGenerationRequest(factory: () => Promise<string | null>): Promise<string | null> {
        const inherited = this.llmHelper.getCurrentGenerationTask();
        if (inherited) (this.generationRequested ??= new WeakSet()).add(inherited);
        if (inherited && this.activeGenerationTask === inherited) return this.llmHelper.runGeneration(factory);
        this.activeGenerationTask?.controller.abort(new DOMException('Superseded generation', 'AbortError'));
        this.activeGenerationController?.abort(new DOMException('Superseded generation', 'AbortError'));
        const task = inherited ?? this.llmHelper.beginGenerationTask();
        this.activeGenerationTask = task;
        let recordedPartial = false;
        const recordPartial = () => {
            if (recordedPartial || !task.terminalStatus || task.terminalStatus === 'completed') return;
            // A mode method or runPreparedRetry already recorded this task's answer; a later abort
            // (e.g. the visible-receipt timeout) must not list it a second time.
            if (this.successRecorded?.has(task)) return;
            recordedPartial = true;
            const metadata = this.llmHelper.getTaskMetadata(task);
            if (task.displayedText.trim()) this.session.addAssistantMessage(task.displayedText, metadata);
            // A failed, cancelled or empty answer is listed under the label its success records:
            // the mode method's question for a first attempt, the Retry label (runPreparedRetry) for a Retry.
            const label = this.questionLabel(task);
            this.session.pushUsage({ type: label.type, timestamp: Date.now(), question: label.question, ...(label.displayQuestion ? { displayQuestion: label.displayQuestion } : {}), answer: task.displayedText, ...metadata });
        };
        task.signal.addEventListener('abort', recordPartial, { once: true });
        super.emit('generation_started', this.llmHelper.getTaskMetadata(task), task.rendererOwner);
        let terminalError: string | undefined;
        return this.llmHelper.runGeneration(factory, 'interview', undefined, task).then(answer => {
            task.terminalStatus ??= answer?.trim() ? 'completed' : 'empty';
            if (task.terminalStatus !== 'completed') recordPartial();
            return answer;
        }, error => {
            terminalError = task.terminalStatus === 'cancelled' ? MANUAL_ANSWER_CANCELLED : task.errorMessage ?? error?.message ?? 'Generation failed';
            recordPartial();
            throw error;
        }).finally(() => {
            if (this.activeGenerationTask === task) {
                // An aborted task cannot call setMode; its owner performs the final cleanup.
                this.activeGenerationTask = undefined;
                if (this.activeMode !== 'idle') {
                    this.activeMode = 'idle';
                    super.emit('mode_changed', 'idle', this.llmHelper.getTaskMetadata(task), task.rendererOwner);
                }
            }
            super.emit('generation_terminal', { ...this.llmHelper.getTaskMetadata(task), error: terminalError ?? task.errorMessage }, task.rendererOwner);
        });
    }

    /** Consume the original prepared request with the existing display events, not prompt preparation. */
    runPreparedRetry(input: PreparedInput): Promise<string | null> {
        return this.runGenerationRequest(async () => {
            const task = this.llmHelper.getCurrentGenerationTask()!;
            task.deferVisibleText = true;
            const events: Record<string, [string, string]> = {
                clarify: ['clarify_token', 'clarify'], recap: ['recap_token', 'recap'],
                'follow-up-questions': ['follow_up_questions_token', 'follow_up_questions_update'],
                'follow-up': ['refined_answer_token', 'refined_answer'],
            };
            const [tokenEvent, resultEvent] = events[task.entryPoint] ?? ['suggested_answer_token', 'suggested_answer'];
            let answer = '', held = '';
            try {
                for await (const token of this.llmHelper.replayPrepared(input)) {
                    answer += token; held += token;
                    if (task.entryPoint !== 'what-to-say' || !isPendingAnswerSentinel(answer)) {
                        this.emit(tokenEvent, held, 'retry', 1); held = '';
                    }
                }
                if (task.entryPoint === 'what-to-say' && IntelligenceEngine.isNonAnswerSentinel(answer)) {
                    task.terminalStatus = 'empty'; return null;
                }
                if (held) this.emit(tokenEvent, held, 'retry', 1);
                if (answer.trim()) {
                    this.session.addAssistantMessage(answer, this.generationMetadata());
                    const label = this.questionLabel(task);
                    this.recordUsage({ type: label.type, timestamp: Date.now(), question: label.question, ...(label.displayQuestion ? { displayQuestion: label.displayQuestion } : {}), answer });
                    (this.successRecorded ??= new WeakSet()).add(task);
                    this.emit(resultEvent, answer, 'retry', 1);
                }
                return answer;
            } catch (error) {
                if (held && !task.signal.aborted && (task.entryPoint !== 'what-to-say' || !isPendingAnswerSentinel(answer))) this.emit(tokenEvent, held, 'retry', 1);
                throw error;
            }
        });
    }

    // Keep reference to LLMHelper for client access
    private llmHelper: LLMHelper;

    // Reference to SessionTracker for context
    private session: SessionTracker;

    // Timestamps for tracking
    private lastTriggerTime: number = 0;
    private readonly triggerCooldown: number = 3000; // 3 seconds

    private static isNonAnswerSentinel(answer: string): boolean {
        const normalized = answer.trim().toLowerCase().replace(/[.!?]+$/g, '');
        return normalized === 'nothing actionable right now'
            || normalized === 'nothing to capture right now';
    }

    constructor(llmHelper: LLMHelper, session: SessionTracker) {
        super();
        this.llmHelper = llmHelper;
        this.session = session;
        this.initializeLLMs();
    }

    getLLMHelper(): LLMHelper {
        return this.llmHelper;
    }

    getRecapLLM(): RecapLLM | null {
        return this.recapLLM;
    }

    // ============================================
    // LLM Initialization
    // ============================================

    /**
     * Initialize or Re-Initialize mode-specific LLMs with shared Gemini client and Groq client
     * Must be called after API keys are updated.
     */
    initializeLLMs(): void {
        console.log(`[IntelligenceEngine] Initializing LLMs with LLMHelper`);
        this.answerLLM = new AnswerLLM(this.llmHelper);
        this.clarifyLLM = new ClarifyLLM(this.llmHelper);
        this.followUpLLM = new FollowUpLLM(this.llmHelper);
        this.recapLLM = new RecapLLM(this.llmHelper);
        this.followUpQuestionsLLM = new FollowUpQuestionsLLM(this.llmHelper);
        this.whatToAnswerLLM = new WhatToAnswerLLM(this.llmHelper);
        this.codeHintLLM = new CodeHintLLM(this.llmHelper);
    }

    reinitializeLLMs(): void {
        this.initializeLLMs();
    }

    // ============================================
    // Transcript Handling (delegates to SessionTracker)
    // ============================================

    /**
     * Process transcript from native audio, and trigger follow-up if appropriate
     */
    handleTranscript(segment: TranscriptSegment, skipRefinementCheck: boolean = false): void {
        const result = this.session.handleTranscript(segment);

        // Check for follow-up intent if user is speaking
        if (result && !skipRefinementCheck && result.role === 'user' && this.session.getLastAssistantMessage()) {
            const { isRefinement, intent } = detectRefinementIntent(segment.text.trim());
            if (isRefinement) {
                this.runFollowUp(intent, segment.text.trim());
            }
        }
    }

    // ============================================
    // Mode Executors
    // ============================================

    /**
     * Build transcript context aligned with What-to-Answer: cleaned turns,
     * interim interviewer speech, and recent assistant responses. The responses are
     * left out when the profile_history scope is denied (PLAN.md AG-17 fourth review).
     */
    private buildPreparedTranscriptContext(lastSeconds: number = 180, view: TranscriptView = this.session): string {
        const historyAllowed = this.llmHelper.deniedDataScopes(['profile_history']).length === 0;
        return assemblePreparedTranscriptContext(view, lastSeconds, historyAllowed);
    }

    /**
     * MODE 2: What Should I Say (Primary)
     * Manual trigger - uses clean transcript pipeline for question inference
     * Scope refusals reach the error boundary, never become a suggested answer.
     */
    runWhatShouldISay(...args: Parameters<IntelligenceEngine['runWhatShouldISayInner']>): Promise<string | null> {
        return this.runGenerationRequest(async () => {
            const task = this.llmHelper.getCurrentGenerationTask();
            // Remembered before preparation, so a failure or cancel while the transcript is frozen
            // is listed under the label the success path records.
            this.rememberQuestion('assist', args[0] || 'What to Answer');
            try {
                const view = args[3]?.manual ? await prepareManualAnswer(this.llmHelper, args[3].beforeGenerate) : undefined;
                return await this.runWhatShouldISayInner(args[0], args[1], args[2], view ? { ...args[3], view } : args[3]);
            } catch (error) {
                if (args[3]?.manual && task) task.errorMessage = manualAnswerError(error);
                throw error;
            }
        });
    }

    async runWhatShouldISayInner(question?: string, confidence: number = 0.8, imagePaths?: string[], options?: { manual?: boolean; beforeGenerate?: (signal: AbortSignal) => Promise<TranscriptView | void>; skipCooldown?: boolean; errorDelivery?: 'caller'; screenContext?: ScreenContext; view?: TranscriptView }): Promise<string | null> {
        const task = this.llmHelper.getCurrentGenerationTask();
        if (task) task.deferVisibleText = true;
        // A manual action reads the transcript frozen for it; live history writes are unchanged.
        const view = options?.view ?? this.session;
        const now = Date.now();
        const skipCooldown = options?.manual === true || options?.skipCooldown === true;

        // Cooldown bypass: explicit images (user intent) or test harness.
        const hasImages = imagePaths && imagePaths.length > 0;
        if (!hasImages && !skipCooldown && now - this.lastTriggerTime < this.triggerCooldown) {
            return null;
        }


        this.setMode('what_to_say');
        this.lastTriggerTime = now;
        this.rememberQuestion('assist', question || 'What to Answer');

        try {
            if (!this.whatToAnswerLLM) {
                if (!this.answerLLM) {
                    this.setMode('idle');
                    return "Please configure your API Keys in Settings to use this feature.";
                }
                const context = view.getFormattedContext(180);
                const answer = await this.answerLLM.generate(question || '', context);
                if (answer) {
                    task?.markVisible(answer);
                    this.session.addAssistantMessage(answer, this.generationMetadata());
                    this.markSuccessRecorded();
                    this.emit('suggested_answer', answer, question || 'inferred', confidence);
                }
                this.setMode('idle');
                return answer || "Could you repeat that? I want to make sure I address your question properly.";
            }

            const contextItems = view.getContext(180);

            // Inject latest interim transcript if available
            const lastInterim = view.getLastInterimInterviewer();
            if (lastInterim && lastInterim.text.trim().length > 0) {
                const lastItem = contextItems[contextItems.length - 1];
                const isDuplicate = lastItem &&
                    lastItem.role === 'interviewer' &&
                    (lastItem.text === lastInterim.text || Math.abs(lastItem.timestamp - lastInterim.timestamp) < 1000);

                if (!isDuplicate) {
                    console.log(`[IntelligenceEngine] Injecting interim transcript`, { length: lastInterim.text.length });
                    contextItems.push({
                        role: 'interviewer',
                        text: lastInterim.text,
                        timestamp: lastInterim.timestamp
                    });
                }
            }

            // A manual press without a question answers the interviewer's latest words from the
            // same snapshot as the background; the renderer shows them through the answer events.
            const interviewerQuestion = options?.manual && !question
                ? latestInterviewerQuestion(contextItems) : undefined;
            const shownQuestion = question || interviewerQuestion;

            const transcriptTurns = contextItems.map(item => ({
                role: item.role,
                text: item.text,
                timestamp: item.timestamp
            }));

            const preparedTranscript = prepareTranscriptForWhatToAnswer(transcriptTurns, 12);

            const temporalContext = buildTemporalContext(
                contextItems,
                view.getAssistantResponseHistory(),
                180
            );

            const lastInterviewerTurn = view.getLastInterviewerTurn();
            const intentResult = await classifyIntent(
                lastInterviewerTurn,
                preparedTranscript,
                view.getAssistantResponseHistory().length
            );

            const screenContext = options?.screenContext;
            console.log('[IntelligenceEngine] Temporal RAG', {
                previousResponses: temporalContext.previousResponses.length,
                tone: temporalContext.toneSignals[0]?.type || 'neutral',
                intent: intentResult.intent,
                imageCount: imagePaths?.length || 0,
                screenOcrAvailable: Boolean(screenContext?.ocrText),
                screenOcrTextLength: screenContext?.ocrText?.length || 0,
            });

            const generationId = ++this.currentGenerationId;
            let fullAnswer = "";
            let pendingDisplay = "";
            // Only the first token event carries the interviewer's words; later ones keep the old label.
            let questionSent = false;
            const tokenQuestion = () => {
                const firstEvent = !questionSent;
                questionSent = true;
                return (firstEvent ? shownQuestion : question) || 'inferred';
            };
            // RC-03 fix: hold a reference to the generator so we can call .return()
            // to properly terminate the network request when a new generation starts.
            const stream = this.whatToAnswerLLM.generateStream(preparedTranscript, temporalContext, intentResult, imagePaths, screenContext, interviewerQuestion);
            let streamAborted = false;

            try { for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] _what_to_say stream aborted by new generation');
                    // RC-03 fix: .return() signals the generator to clean up and stops
                    // the underlying network request (SDK generators honour this).
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                fullAnswer += token;
                pendingDisplay += token;
                const possibleSentinel = isPendingAnswerSentinel(fullAnswer);
                if (!possibleSentinel) {
                    task?.markVisible(pendingDisplay);
                    this.emit('suggested_answer_token', pendingDisplay, tokenQuestion(), confidence);
                    pendingDisplay = "";
                }
            } } catch (error) {
                if (pendingDisplay && !task?.signal.aborted && task === this.activeGenerationTask) {
                    task?.markVisible(pendingDisplay);
                    this.emit('suggested_answer_token', pendingDisplay, tokenQuestion(), confidence);
                }
                throw error;
            }

            if (streamAborted) {
                // Aborted mid-stream — don't update session or emit final event
                this.setMode('idle');
                return null;
            }

            if (!fullAnswer?.trim()) {
                fullAnswer = "Could you repeat that? I want to make sure I address your question properly.";
            }

            if (IntelligenceEngine.isNonAnswerSentinel(fullAnswer)) {
                this.setMode('idle');
                return null;
            }

            if (pendingDisplay) {
                task?.markVisible(pendingDisplay);
                this.emit('suggested_answer_token', pendingDisplay, tokenQuestion(), confidence);
            }

            this.session.addAssistantMessage(fullAnswer, this.generationMetadata());

            this.recordUsage({
                type: 'assist',
                timestamp: Date.now(),
                question: question || 'What to Answer',
                answer: fullAnswer
            });

            this.emit('suggested_answer', fullAnswer, shownQuestion || 'What to Answer', confidence);

            this.setMode('idle');
            return fullAnswer;

        } catch (error) {
            if (task?.signal.aborted || task !== this.activeGenerationTask) throw error;
            if ((error as Error)?.name === 'AbortError') throw error;
            // An IPC caller owns its error display; emitting as well can target another window.
            if (options?.errorDelivery !== 'caller') this.emit('error', error as Error, 'what_to_say');
            this.setMode('idle');
            throw error;
        }
    }

    /**
     * MODE 3: Follow-Up (Refinement)
     * Modify the last assistant message
     */
    runFollowUp(...args: Parameters<IntelligenceEngine['runFollowUpInner']>): Promise<string | null> {
        return this.runGenerationRequest(() => this.runFollowUpInner(...args));
    }

    async runFollowUpInner(intent: string, userRequest?: string, view: TranscriptView = this.session): Promise<string | null> {
        console.log(`[IntelligenceEngine] runFollowUp called with intent: ${intent}`);
        // Remembered first, so a follow-up with no answer to refine is listed under its intent.
        const displayQuestion = IntelligenceEngine.followUpQuestion(intent, userRequest);
        this.rememberQuestion('followup', displayQuestion);
        const lastMsg = view.getLastAssistantMessage();
        if (!lastMsg) {
            console.warn('[IntelligenceEngine] No lastAssistantMessage found for follow-up');
            return null;
        }

        this.setMode('follow_up');

        try {
            if (!this.followUpLLM) {
                console.error('[IntelligenceEngine] FollowUpLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.buildPreparedTranscriptContext(120, view) || view.getFormattedContextWithInterim(60);
            const refinementRequest = userRequest || intent;

            const generationId = ++this.currentGenerationId;
            let fullRefined = "";
            const stream = this.followUpLLM.generateStream(
                lastMsg,
                refinementRequest,
                context
            );
            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] _follow_up stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('refined_answer_token', token, intent);
                fullRefined += token;
            }

            if (!streamAborted && fullRefined) {
                this.session.addAssistantMessage(fullRefined, this.generationMetadata());
                this.emit('refined_answer', fullRefined, intent);

                this.recordUsage({
                    type: 'followup',
                    timestamp: Date.now(),
                    question: displayQuestion,
                    answer: fullRefined
                });
            }

            this.setMode('idle');
            return fullRefined;

        } catch (error) {
            this.emit('error', error as Error, 'follow_up');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 4: Recap (Summary)
     * Neutral conversation summary
     */
    runRecap(...args: Parameters<IntelligenceEngine['runRecapInner']>): Promise<string | null> {
        return this.runGenerationRequest(() => this.runRecapInner(...args));
    }

    async runRecapInner(view: TranscriptView = this.session): Promise<string | null> {
        console.log('[IntelligenceEngine] runRecap called');
        this.setMode('recap');
        this.rememberQuestion('chat', 'Recap Meeting');

        try {
            if (!this.recapLLM) {
                console.error('[IntelligenceEngine] RecapLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = view.getFormattedContext(120);
            if (!context) {
                console.warn('[IntelligenceEngine] No context available for recap');
                this.setMode('idle');
                return null;
            }

            const generationId = ++this.currentGenerationId;
            let fullSummary = "";
            const stream = this.recapLLM.generateStream(context);
            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] _recap stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('recap_token', token);
                fullSummary += token;
            }

            // Only emit final if not aborted
            if (!streamAborted && fullSummary && this.currentGenerationId === generationId) {
                this.emit('recap', fullSummary);

                // Track recap as an assistant message so "make it shorter" / other
                // refinements can target it via FollowUpLLM (which reads the last
                // assistant message).
                this.session.addAssistantMessage(fullSummary, this.generationMetadata());

                this.recordUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: 'Recap Meeting',
                    answer: fullSummary
                });
            }
            if (this.currentGenerationId === generationId) {
                this.setMode('idle');
            }
            return fullSummary;

        } catch (error) {
            this.emit('error', error as Error, 'recap');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE: Clarify
     * Ask a clarifying question to the interviewer
     */
    runClarify(...args: Parameters<IntelligenceEngine['runClarifyInner']>): Promise<string | null> {
        return this.runGenerationRequest(() => this.runClarifyInner(...args));
    }

    async runClarifyInner(view: TranscriptView = this.session): Promise<string | null> {
        console.log('[IntelligenceEngine] runClarify called');
        this.setMode('clarify');
        this.rememberQuestion('chat', 'Clarify Question');

        try {
            if (!this.clarifyLLM) {
                console.error('[IntelligenceEngine] ClarifyLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const rawContext = this.buildPreparedTranscriptContext(180, view);
            // If no transcript yet, use a generic prompt — the LLM will ask a scoping question
            const context = rawContext || '[No transcript available yet. The candidate just joined the interview. Generate an opening clarifying question to understand the scope and constraints of the upcoming problem.]';

            const generationId = ++this.currentGenerationId;
            let fullClarification = "";
            const stream = this.clarifyLLM.generateStream(context);
            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] _clarify stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('clarify_token', token);
                fullClarification += token;
            }

            if (streamAborted) {
                this.setMode('idle');
                return null;
            }

            // Only update history and emit final if not aborted
            if (fullClarification && this.currentGenerationId === generationId) {
                this.emit('clarify', fullClarification);
                this.session.addAssistantMessage(fullClarification, this.generationMetadata());

                this.recordUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: 'Clarify Question',
                    answer: fullClarification
                });
            }
            if (this.currentGenerationId === generationId) {
                this.setMode('idle');
            }
            return fullClarification;

        } catch (error) {
            this.emit('error', error as Error, 'clarify');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 6: Follow-Up Questions
     * Suggest strategic questions for the user to ask
     */
    runFollowUpQuestions(...args: Parameters<IntelligenceEngine['runFollowUpQuestionsInner']>): Promise<string | null> {
        return this.runGenerationRequest(() => this.runFollowUpQuestionsInner(...args));
    }

    async runFollowUpQuestionsInner(view: TranscriptView = this.session): Promise<string | null> {
        console.log('[IntelligenceEngine] runFollowUpQuestions called');
        this.setMode('follow_up_questions');
        this.rememberQuestion('followup_questions', 'Generate Follow-up Questions');

        try {
            if (!this.followUpQuestionsLLM) {
                console.error('[IntelligenceEngine] FollowUpQuestionsLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.buildPreparedTranscriptContext(120, view);
            if (!context) {
                console.warn('[IntelligenceEngine] No context available for follow-up questions');
                this.setMode('idle');
                return null;
            }

            const generationId = ++this.currentGenerationId;
            let fullQuestions = "";
            const stream = this.followUpQuestionsLLM.generateStream(context);
            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] _follow_up_questions stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('follow_up_questions_token', token);
                fullQuestions += token;
            }

            if (streamAborted) {
                this.setMode('idle');
                return null;
            }

            if (fullQuestions && this.currentGenerationId === generationId) {
                this.emit('follow_up_questions_update', fullQuestions);
                this.recordUsage({
                    type: 'followup_questions',
                    timestamp: Date.now(),
                    question: 'Generate Follow-up Questions',
                    answer: fullQuestions
                });
            }
            if (this.currentGenerationId === generationId) {
                this.setMode('idle');
            }
            return fullQuestions;

        } catch (error) {
            this.emit('error', error as Error, 'follow_up_questions');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 7: Code Hint (Live Code Reviewer)
     * Analyzes a screenshot of partially written code against the detected/provided question
     * and returns a short targeted hint. Question comes from (priority order):
     *   1. problemStatement passed in from ipcHandler (screenshot extraction — highest confidence)
     *   2. session.detectedCodingQuestion (detected from interviewer transcript)
     *   3. transcriptContext (last N seconds of conversation — fallback for inference)
     */
    runCodeHint(...args: Parameters<IntelligenceEngine['runCodeHintInner']>): Promise<string | null> {
        return this.runGenerationRequest(() => this.runCodeHintInner(...args));
    }

    async runCodeHintInner(imagePaths?: string[], problemStatement?: string, view: TranscriptView = this.session): Promise<string | null> {
        this.setMode('code_hint');
        this.rememberQuestion('assist', 'Code Hint');

        try {
            if (!this.codeHintLLM) {
                this.setMode('idle');
                return "Please configure your API Keys in Settings to use this feature.";
            }

            // Resolve question context from available sources (priority order)
            const sessionQuestion = view.getDetectedCodingQuestion();
            const questionContext = problemStatement ?? sessionQuestion.question ?? null;
            const questionSource = problemStatement
                ? 'screenshot'
                : sessionQuestion.source;

            // Pull transcript as fallback context when no question is pinned
            const transcriptContext = questionContext === null
                ? view.getFormattedContext(180)
                : null;

            console.log(`[IntelligenceEngine] Code hint — question source: ${questionContext ? (questionSource ?? 'passed') : 'none'}, transcript lines: ${transcriptContext ? transcriptContext.split('\n').length : 0}, images: ${imagePaths?.length ?? 0}`);

            const generationId = ++this.currentGenerationId;
            let fullHint = "";
            const stream = this.codeHintLLM.generateStream(
                imagePaths,
                questionContext ?? undefined,
                questionSource,
                transcriptContext ?? undefined
            );

            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] code_hint stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('suggested_answer_token', token, 'Code Hint', 1.0);
                fullHint += token;
            }

            if (streamAborted) {
                this.setMode('idle');
                return null;
            }

            if (!fullHint?.trim()) {
                fullHint = "I couldn't detect any code in the screenshot. Try screenshotting your code editor directly.";
            }

            this.session.addAssistantMessage(fullHint, this.generationMetadata());
            this.recordUsage({
                type: 'assist',
                timestamp: Date.now(),
                question: 'Code Hint',
                answer: fullHint
            });

            this.emit('suggested_answer', fullHint, 'Code Hint', 1.0);
            this.setMode('idle');
            return fullHint;

        } catch (error) {
            this.emit('error', error as Error, 'code_hint');
            this.setMode('idle');
            return null;
        }
    }

    // ============================================
    // State Management
    // ============================================

    private setMode(mode: IntelligenceMode): void {
        const task = this.llmHelper.getCurrentGenerationTask();
        if (task && (task !== this.activeGenerationTask || task.signal.aborted)) return;
        if (this.activeMode !== mode) {
            this.activeMode = mode;
            this.emit('mode_changed', mode);
        }
    }

    getActiveMode(): IntelligenceMode {
        return this.activeMode;
    }

    /**
     * Reset engine state (cancels any in-flight operations)
     */
    reset(): void {
        this.activeGenerationTask?.controller.abort(new DOMException('Session reset', 'AbortError'));
        this.activeGenerationController?.abort(new DOMException('Session reset', 'AbortError'));
        this.activeMode = 'idle';
        this.currentGenerationId++; // Increment to break all active LLM streams
    }
}
