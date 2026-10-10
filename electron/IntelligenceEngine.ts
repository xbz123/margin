// IntelligenceEngine.ts
// LLM mode routing and orchestration.
// Extracted from IntelligenceManager to decouple LLM logic from state management.

import { EventEmitter } from 'events';
import { LLMHelper } from './LLMHelper';
import { rethrowProviderScopeError } from './llm/ProviderRouter';
import type { GenerationTask } from './llm/generateTask';
import { SessionTracker, TranscriptSegment, SuggestionTrigger, ContextItem } from './SessionTracker';
import {
    AnswerLLM, AssistLLM, BrainstormLLM, ClarifyLLM, CodeHintLLM, FollowUpLLM, RecapLLM,
    FollowUpQuestionsLLM, WhatToAnswerLLM,
    prepareTranscriptForWhatToAnswer, buildTemporalContext,
    AssistantResponse as LLMAssistantResponse, classifyIntent, planNextAssistantAction, PlannerDecision
} from './llm';
import { ScreenContext } from './services/screen/ScreenContextService';
import { buildPreparedTranscriptContext as assemblePreparedTranscriptContext } from './utils/preparedTranscriptContext';

// Mode types
export type IntelligenceMode = 'idle' | 'assist' | 'what_to_say' | 'follow_up' | 'recap' | 'clarify' | 'manual' | 'follow_up_questions' | 'code_hint' | 'brainstorm';

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
    'assist_update': (insight: string) => void;
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
    'manual_answer_started': () => void;
    'manual_answer_result': (answer: string, question: string) => void;
    'mode_changed': (mode: IntelligenceMode) => void;
    'error': (error: Error, mode: IntelligenceMode) => void;
}

export class IntelligenceEngine extends EventEmitter {
    // Mode state
    private activeMode: IntelligenceMode = 'idle';

    // Mode-specific LLMs
    private answerLLM: AnswerLLM | null = null;
    private assistLLM: AssistLLM | null = null;
    private clarifyLLM: ClarifyLLM | null = null;
    private followUpLLM: FollowUpLLM | null = null;
    private recapLLM: RecapLLM | null = null;
    private followUpQuestionsLLM: FollowUpQuestionsLLM | null = null;
    private whatToAnswerLLM: WhatToAnswerLLM | null = null;
    private codeHintLLM: CodeHintLLM | null = null;
    private brainstormLLM: BrainstormLLM | null = null;

    // Concurrency tracking
    private assistCancellationToken: AbortController | null = null;
    private currentGenerationId: number = 0;
    private activeGenerationController?: AbortController;
    private activeGenerationTask?: GenerationTask<any>;
    private generationMetadata() {
        const task = this.llmHelper.getCurrentGenerationTask();
        return task ? this.llmHelper.getTaskMetadata(task) : undefined;
    }
    private recordUsage(entry: any): void {
        this.session.pushUsage({ ...entry, ...this.generationMetadata() });
    }

    override emit(event: string | symbol, ...args: any[]): boolean {
        const task = this.llmHelper?.getCurrentGenerationTask();
        if (task) {
            if (task !== this.activeGenerationTask || task.signal.aborted) return false;
            if (event === 'error') task.errorMessage = args[0]?.message;
            if (String(event).endsWith('_token')) task.displayedText += String(args[0] ?? '');
            return super.emit(event, ...args, this.llmHelper.getTaskMetadata(task), task.rendererOwner);
        }
        return super.emit(event, ...args);
    }

    private runGenerationRequest(factory: () => Promise<string | null>): Promise<string | null> {
        const inherited = this.llmHelper.getCurrentGenerationTask();
        if (inherited && this.activeGenerationTask === inherited) return this.llmHelper.runGeneration(factory);
        this.activeGenerationTask?.controller.abort(new DOMException('Superseded generation', 'AbortError'));
        this.activeGenerationController?.abort(new DOMException('Superseded generation', 'AbortError'));
        const task = inherited ?? this.llmHelper.beginGenerationTask();
        this.activeGenerationTask = task;
        let recordedPartial = false;
        const recordPartial = () => {
            if (recordedPartial || !task.terminalStatus || task.terminalStatus === 'completed') return;
            recordedPartial = true;
            const metadata = this.llmHelper.getTaskMetadata(task);
            if (task.displayedText.trim()) this.session.addAssistantMessage(task.displayedText, metadata);
            this.session.pushUsage({ type: 'assist', timestamp: Date.now(), question: 'generation outcome', answer: task.displayedText, ...metadata });
        };
        task.signal.addEventListener('abort', recordPartial, { once: true });
        super.emit('generation_started', this.llmHelper.getTaskMetadata(task), task.rendererOwner);
        let terminalError: string | undefined;
        return this.llmHelper.runGeneration(factory, 'interview', undefined, task).then(answer => {
            task.terminalStatus ??= answer?.trim() ? 'completed' : 'empty';
            if (task.terminalStatus !== 'completed') recordPartial();
            return answer;
        }, error => {
            terminalError = error?.message ?? 'Generation failed';
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

    // Keep reference to LLMHelper for client access
    private llmHelper: LLMHelper;

    // Reference to SessionTracker for context
    private session: SessionTracker;

    // Timestamps for tracking
    private lastTranscriptTime: number = 0;
    private lastTriggerTime: number = 0;
    private readonly triggerCooldown: number = 3000; // 3 seconds

    // Speculative inference: start LLM on high-confidence interviewer partials
    private speculativeTimer: ReturnType<typeof setTimeout> | null = null;
    private speculativeText: string | null = null;
    // epoch ms after which speculativeText is stale; Infinity while stream is still running
    private speculativeTextExpiry: number = Infinity;
    private readonly SPECULATIVE_DEBOUNCE_MS = 350;
    private readonly SPECULATIVE_MIN_WORDS = 7;
    private readonly SPECULATIVE_MIN_CONFIDENCE = 0.75;
    private readonly SPECULATIVE_SIMILARITY_THRESHOLD = 0.75;

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
        this.assistLLM = new AssistLLM(this.llmHelper);
        this.clarifyLLM = new ClarifyLLM(this.llmHelper);
        this.followUpLLM = new FollowUpLLM(this.llmHelper);
        this.recapLLM = new RecapLLM(this.llmHelper);
        this.followUpQuestionsLLM = new FollowUpQuestionsLLM(this.llmHelper);
        this.whatToAnswerLLM = new WhatToAnswerLLM(this.llmHelper);
        this.codeHintLLM = new CodeHintLLM(this.llmHelper);
        this.brainstormLLM = new BrainstormLLM(this.llmHelper);

        // Sync RecapLLM reference to SessionTracker for epoch compaction
        this.session.setRecapLLM(this.recapLLM);
    }

    reinitializeLLMs(): void {
        this.initializeLLMs();
    }

    // ============================================
    // Transcript Handling (delegates to SessionTracker)
    // ============================================

    private static wordsOf(text: string): Set<string> {
        return new Set(text.toLowerCase().match(/\b\w+\b/g) ?? []);
    }

    // Returns a score in [0,1] that accounts for partial-to-final comparisons.
    // Pure Jaccard underestimates similarity when the speculative text is a prefix of the final
    // transcript (e.g., "Can you walk me through" vs. "Can you walk me through your design process?").
    // We blend Jaccard with a containment score (what fraction of speculative words appear in final).
    private static jaccardSimilarity(a: string, b: string): number {
        const setA = IntelligenceEngine.wordsOf(a);
        const setB = IntelligenceEngine.wordsOf(b);
        if (setA.size === 0 && setB.size === 0) return 1;
        let intersection = 0;
        setA.forEach(w => { if (setB.has(w)) intersection++; });
        const jaccard = intersection / (setA.size + setB.size - intersection);
        // Containment: fraction of setA (speculative/partial) covered by setB (final)
        const containment = setA.size > 0 ? intersection / setA.size : 0;
        return Math.max(jaccard, containment * 0.9); // weight containment slightly below pure Jaccard
    }

    private static hasQuestionSignal(text: string): boolean {
        if (text.trimEnd().endsWith('?')) return true;
        return /\b(what|how|why|where|when|which|who|can you|could you|tell me|explain|describe|walk me through|talk me through)\b/i.test(text);
    }

    // Fires speculative LLM inference on a stable high-confidence interviewer partial.
    // Debounced so rapid word-by-word partials don't spawn multiple streams.
    private maybeSpeculate(segment: TranscriptSegment): void {
        if (this.activeMode !== 'idle' && this.activeMode !== 'assist') return;

        // Snapshot values now — STT adapters may mutate the same segment object in place.
        const text = segment.text;
        const confidence = segment.confidence ?? 0;
        const words = text.trim().split(/\s+/).filter(Boolean);
        if (
            confidence < this.SPECULATIVE_MIN_CONFIDENCE ||
            words.length < this.SPECULATIVE_MIN_WORDS ||
            !IntelligenceEngine.hasQuestionSignal(text)
        ) return;

        if (this.speculativeTimer !== null) {
            clearTimeout(this.speculativeTimer);
        }

        this.speculativeTimer = setTimeout(() => {
            this.speculativeTimer = null;
            // Re-check mode: a high-priority mode may have started during the debounce window.
            if (this.activeMode !== 'idle' && this.activeMode !== 'assist') return;
            // Don't overwrite a speculative stream that is already in flight.
            if (this.speculativeText !== null) return;
            if (Date.now() - this.lastTriggerTime < this.triggerCooldown) return;
            console.log(`[IntelligenceEngine] Speculative inference fired on interim`, { length: text.length, confidence });
            this.runWhatShouldISay(text, confidence || 0.8, undefined, { speculative: true })
                .catch(err => console.error('[IntelligenceEngine] Speculative run error:', err));
        }, this.SPECULATIVE_DEBOUNCE_MS);
    }

    /**
     * Process transcript from native audio, and trigger follow-up if appropriate
     */
    handleTranscript(segment: TranscriptSegment, skipRefinementCheck: boolean = false): void {
        const result = this.session.handleTranscript(segment);
        this.lastTranscriptTime = Date.now();

        if (segment.speaker === 'interviewer') {
            if (!segment.final) {
                this.maybeSpeculate(segment);
            } else if (this.speculativeTimer !== null) {
                // Final arrived — cancel debounce; handleSuggestionTrigger will do Jaccard check
                clearTimeout(this.speculativeTimer);
                this.speculativeTimer = null;
            }
        }

        // Check for follow-up intent if user is speaking
        if (result && !skipRefinementCheck && result.role === 'user' && this.session.getLastAssistantMessage()) {
            const { isRefinement, intent } = detectRefinementIntent(segment.text.trim());
            if (isRefinement) {
                this.runFollowUp(intent, segment.text.trim());
            }
        }
    }

    /**
     * Handle suggestion trigger from native audio service
     * This is the primary auto-trigger path
     */
    async handleSuggestionTrigger(trigger: SuggestionTrigger): Promise<void> {
        if (trigger.confidence < 0.5) return;

        const plannerDecision = await this.planSuggestionTrigger(trigger);
        if (plannerDecision.kind === 'silent') {
            console.log('[IntelligenceEngine] Planner stayed silent', { reason: plannerDecision.reason, confidence: plannerDecision.confidence });
            return;
        }

        if (plannerDecision.kind !== 'answer') {
            await this.runPlannerDecision(plannerDecision, trigger.lastQuestion);
            return;
        }

        // If a speculative stream answered (or is answering) this question, reuse it.
        if (this.speculativeText !== null) {
            const expired = Date.now() > this.speculativeTextExpiry;
            const stale = expired || !trigger.lastQuestion; // empty question — reject conservatively
            if (!stale) {
                const similarity = IntelligenceEngine.jaccardSimilarity(this.speculativeText, trigger.lastQuestion);
                this.speculativeText = null;
                this.speculativeTextExpiry = Infinity;
                if (similarity >= this.SPECULATIVE_SIMILARITY_THRESHOLD) {
                    console.log(`[IntelligenceEngine] Speculative stream accepted (Jaccard=${similarity.toFixed(2)}) — continuing`);
                    this.lastTriggerTime = Date.now();
                    return;
                }
                console.log(`[IntelligenceEngine] Speculative stream rejected (Jaccard=${similarity.toFixed(2)}) — restarting`);
            } else {
                console.log(`[IntelligenceEngine] Speculative result discarded (expired=${expired}, noQuestion=${!trigger.lastQuestion})`);
                this.speculativeText = null;
                this.speculativeTextExpiry = Infinity;
            }
            // IMPORTANT: no await between this increment and runWhatShouldISay below —
            // the increment must be synchronous with the new stream launch to preserve generation-id ordering.
            ++this.currentGenerationId;
        }

        await this.runWhatShouldISay(trigger.lastQuestion, trigger.confidence);
    }

    private async planSuggestionTrigger(trigger: SuggestionTrigger): Promise<PlannerDecision> {
        const contextItems = this.session.getContext(180);
        const transcriptContext = contextItems.map(item => item.text).join('\n');
        const preparedTranscript = prepareTranscriptForWhatToAnswer(contextItems.map(item => ({
            role: item.role,
            text: item.text,
            timestamp: item.timestamp,
        })), 12);
        const lastInterviewerTurn = this.session.getLastInterviewerTurn();
        const intentResult = await classifyIntent(
            lastInterviewerTurn,
            preparedTranscript,
            this.session.getAssistantResponseHistory().length
        );
        const detectedCodingQuestion = this.session.getDetectedCodingQuestion();

        return planNextAssistantAction({
            triggerQuestion: trigger.lastQuestion,
            confidence: trigger.confidence,
            transcriptContext,
            intentResult,
            hasRecentAssistantResponse: this.session.getAssistantResponseHistory().length > 0,
            hasDetectedCodingQuestion: Boolean(detectedCodingQuestion.question),
            now: Date.now(),
            lastTriggerTime: this.lastTriggerTime,
            cooldownMs: this.triggerCooldown,
        });
    }

    private async runPlannerDecision(decision: PlannerDecision, question?: string): Promise<void> {
        switch (decision.kind) {
            case 'clarify':
                await this.runClarify();
                return;
            case 'recap':
                await this.runRecap();
                return;
            case 'follow_up_questions':
                await this.runFollowUpQuestions();
                return;
            case 'brainstorm':
                await this.runBrainstorm(undefined, question);
                return;
            case 'answer':
            case 'silent':
                return;
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
    private buildPreparedTranscriptContext(lastSeconds: number = 180): string {
        const historyAllowed = this.llmHelper.deniedDataScopes(['profile_history']).length === 0;
        return assemblePreparedTranscriptContext(this.session, lastSeconds, historyAllowed);
    }

    /**
     * MODE 1: Assist (Passive)
     * Low-priority observational insights
     */
    runAssistMode(...args: Parameters<IntelligenceEngine['runAssistModeInner']>): Promise<string | null> {
        return this.runGenerationRequest(() => this.runAssistModeInner(...args));
    }

    async runAssistModeInner(): Promise<string | null> {
        if (this.activeMode !== 'idle' && this.activeMode !== 'assist') {
            return null;
        }

        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
        }

        this.assistCancellationToken = new AbortController();
        this.setMode('assist');

        try {
            if (!this.assistLLM) {
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(60);
            if (!context) {
                this.setMode('idle');
                return null;
            }

            const insight = await this.assistLLM.generate(context);

            if (this.assistCancellationToken?.signal.aborted) {
                return null;
            }

            if (insight) {
                this.emit('assist_update', insight);
            }
            this.setMode('idle');
            return insight;

        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                return null;
            }
            this.emit('error', error as Error, 'assist');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 2: What Should I Say (Primary)
     * Manual trigger - uses clean transcript pipeline for question inference
     * Scope refusals reach the error boundary, never become a suggested answer.
     */
    runWhatShouldISay(...args: Parameters<IntelligenceEngine['runWhatShouldISayInner']>): Promise<string | null> {
        return this.runGenerationRequest(() => this.runWhatShouldISayInner(...args));
    }

    async runWhatShouldISayInner(question?: string, confidence: number = 0.8, imagePaths?: string[], options?: { speculative?: boolean; skipCooldown?: boolean; errorDelivery?: 'caller'; screenContext?: ScreenContext; activeSkill?: { id: string; name: string; promptBlock: string } }): Promise<string | null> {
        const task = this.llmHelper.getCurrentGenerationTask();
        if (task) task.deferVisibleText = true;
        const now = Date.now();
        const isSpeculative = options?.speculative === true;
        const skipCooldown = options?.skipCooldown === true;

        // Cooldown bypass: explicit images (user intent), speculative pre-fetch, or test harness.
        const hasImages = imagePaths && imagePaths.length > 0;
        if (!hasImages && !isSpeculative && !skipCooldown && now - this.lastTriggerTime < this.triggerCooldown) {
            return null;
        }

        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }

        this.setMode('what_to_say');
        // Speculative runs don't stamp lastTriggerTime at start — the cooldown slot
        // is reserved for the real trigger. We stamp it only on successful completion.
        if (!isSpeculative) {
            this.lastTriggerTime = now;
        }
        // Record the question text so handleSuggestionTrigger can do Jaccard comparison.
        // Expiry stays at Infinity while the stream is running — set to a close window only on completion.
        if (isSpeculative) {
            this.speculativeText = question ?? null;
            this.speculativeTextExpiry = Infinity;
        }

        try {
            if (!this.whatToAnswerLLM) {
                if (!this.answerLLM) {
                    if (isSpeculative) { this.speculativeText = null; this.speculativeTextExpiry = Infinity; }
                    this.setMode('idle');
                    return "Please configure your API Keys in Settings to use this feature.";
                }
                const context = this.session.getFormattedContext(180);
                const answer = await this.answerLLM.generate(question || '', context);
                if (isSpeculative) {
                    this.speculativeText = null;
                    this.speculativeTextExpiry = Infinity;
                    this.lastTriggerTime = Date.now();
                    this.setMode('idle');
                    return answer || "Could you repeat that? I want to make sure I address your question properly.";
                }
                if (answer) {
                    task?.markVisible(answer);
                    this.session.addAssistantMessage(answer, this.generationMetadata());
                    this.emit('suggested_answer', answer, question || 'inferred', confidence);
                }
                this.setMode('idle');
                return answer || "Could you repeat that? I want to make sure I address your question properly.";
            }

            const contextItems = this.session.getContext(180);

            // Inject latest interim transcript if available
            const lastInterim = this.session.getLastInterimInterviewer();
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

            const transcriptTurns = contextItems.map(item => ({
                role: item.role,
                text: item.text,
                timestamp: item.timestamp
            }));

            const preparedTranscript = prepareTranscriptForWhatToAnswer(transcriptTurns, 12);

            const temporalContext = buildTemporalContext(
                contextItems,
                this.session.getAssistantResponseHistory(),
                180
            );

            const lastInterviewerTurn = this.session.getLastInterviewerTurn();
            const intentResult = await classifyIntent(
                lastInterviewerTurn,
                preparedTranscript,
                this.session.getAssistantResponseHistory().length
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
            // RC-03 fix: hold a reference to the generator so we can call .return()
            // to properly terminate the network request when a new generation starts.
            const stream = this.whatToAnswerLLM.generateStream(preparedTranscript, temporalContext, intentResult, imagePaths, screenContext, options?.activeSkill);
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
                if (!isSpeculative) {
                    pendingDisplay += token;
                    const normalized = fullAnswer.trim().toLowerCase().replace(/[.!?]+$/g, '');
                    const possibleSentinel = ['nothing actionable right now', 'nothing to capture right now']
                        .some(sentinel => sentinel.startsWith(normalized));
                    if (!possibleSentinel) {
                        task?.markVisible(pendingDisplay);
                        this.emit('suggested_answer_token', pendingDisplay, question || 'inferred', confidence);
                        pendingDisplay = "";
                    }
                }
            } } catch (error) {
                if (pendingDisplay && !isSpeculative && !task?.signal.aborted && task === this.activeGenerationTask) {
                    task?.markVisible(pendingDisplay);
                    this.emit('suggested_answer_token', pendingDisplay, question || 'inferred', confidence);
                }
                throw error;
            }

            if (streamAborted) {
                // Aborted mid-stream — don't update session or emit final event
                if (isSpeculative) {
                    this.speculativeText = null;
                    this.speculativeTextExpiry = Infinity;
                    // Stamp lastTriggerTime so the real trigger that caused this abort
                    // doesn't allow a rapid second trigger within the cooldown window.
                    this.lastTriggerTime = Date.now();
                }
                this.setMode('idle');
                return null;
            }

            if (!fullAnswer?.trim()) {
                fullAnswer = "Could you repeat that? I want to make sure I address your question properly.";
            }

            if (IntelligenceEngine.isNonAnswerSentinel(fullAnswer)) {
                if (isSpeculative) {
                    this.speculativeText = null;
                    this.speculativeTextExpiry = Infinity;
                    this.lastTriggerTime = Date.now();
                }
                this.setMode('idle');
                return null;
            }

            if (pendingDisplay && !isSpeculative) {
                task?.markVisible(pendingDisplay);
                this.emit('suggested_answer_token', pendingDisplay, question || 'inferred', confidence);
            }
            if (isSpeculative) {
                this.lastTriggerTime = Date.now();
                this.speculativeTextExpiry = this.lastTriggerTime + this.triggerCooldown + 500;
                this.setMode('idle');
                return fullAnswer;
            }

            this.session.addAssistantMessage(fullAnswer, this.generationMetadata());

            this.recordUsage({
                type: 'assist',
                timestamp: Date.now(),
                question: question || 'What to Answer',
                answer: fullAnswer
            });

            this.emit('suggested_answer', fullAnswer, question || 'What to Answer', confidence);

            this.setMode('idle');
            return fullAnswer;

        } catch (error) {
            if (task?.signal.aborted || task !== this.activeGenerationTask) throw error;
            if (isSpeculative) { this.speculativeText = null; this.speculativeTextExpiry = Infinity; }
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

    async runFollowUpInner(intent: string, userRequest?: string): Promise<string | null> {
        console.log(`[IntelligenceEngine] runFollowUp called with intent: ${intent}`);
        const lastMsg = this.session.getLastAssistantMessage();
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

            const context = this.buildPreparedTranscriptContext(120) || this.session.getFormattedContextWithInterim(60);
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

                const intentMap: Record<string, string> = {
                    'expand': 'Expand Answer',
                    'rephrase': 'Rephrase Answer',
                    'add_example': 'Add Example',
                    'more_confident': 'Make More Confident',
                    'more_casual': 'Make More Casual',
                    'more_formal': 'Make More Formal',
                    'simplify': 'Simplify Answer'
                };

                const displayQuestion = userRequest || intentMap[intent] || `Refining: ${intent}`;

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

    async runRecapInner(): Promise<string | null> {
        console.log('[IntelligenceEngine] runRecap called');
        this.setMode('recap');

        try {
            if (!this.recapLLM) {
                console.error('[IntelligenceEngine] RecapLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(120);
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

    async runClarifyInner(): Promise<string | null> {
        console.log('[IntelligenceEngine] runClarify called');
        this.setMode('clarify');

        try {
            if (!this.clarifyLLM) {
                console.error('[IntelligenceEngine] ClarifyLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const rawContext = this.buildPreparedTranscriptContext(180);
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

    async runFollowUpQuestionsInner(): Promise<string | null> {
        console.log('[IntelligenceEngine] runFollowUpQuestions called');
        this.setMode('follow_up_questions');

        try {
            if (!this.followUpQuestionsLLM) {
                console.error('[IntelligenceEngine] FollowUpQuestionsLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.buildPreparedTranscriptContext(120);
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
     * MODE 5: Manual Answer (Fallback)
     * Explicit bypass when auto-detection fails
     */
    runManualAnswer(...args: Parameters<IntelligenceEngine['runManualAnswerInner']>): Promise<string | null> {
        return this.runGenerationRequest(() => this.runManualAnswerInner(...args));
    }

    async runManualAnswerInner(question: string): Promise<string | null> {
        this.emit('manual_answer_started');
        this.setMode('manual');

        try {
            if (!this.answerLLM) {
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(120);
            const answer = await this.answerLLM.generate(question, context);

            if (answer) {
                this.session.addAssistantMessage(answer, this.generationMetadata());
                this.emit('manual_answer_result', answer, question);

                this.recordUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: question,
                    answer: answer
                });
            }

            this.setMode('idle');
            return answer;

        } catch (error) {
            this.emit('error', error as Error, 'manual');
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

    async runCodeHintInner(imagePaths?: string[], problemStatement?: string): Promise<string | null> {
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }

        this.setMode('code_hint');

        try {
            if (!this.codeHintLLM) {
                this.setMode('idle');
                return "Please configure your API Keys in Settings to use this feature.";
            }

            // Resolve question context from available sources (priority order)
            const sessionQuestion = this.session.getDetectedCodingQuestion();
            const questionContext = problemStatement ?? sessionQuestion.question ?? null;
            const questionSource = problemStatement
                ? 'screenshot'
                : sessionQuestion.source;

            // Pull transcript as fallback context when no question is pinned
            const transcriptContext = questionContext === null
                ? this.session.getFormattedContext(180)
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

    /**
     * MODE 8: Brainstorm (Strategic Approach Generator)
     * Generates a spoken script outlining 2-3 problem-solving approaches with trade-offs.
     */
    runBrainstorm(...args: Parameters<IntelligenceEngine['runBrainstormInner']>): Promise<string | null> {
        return this.runGenerationRequest(() => this.runBrainstormInner(...args));
    }

    async runBrainstormInner(imagePaths?: string[], problemStatement?: string): Promise<string | null> {
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }

        this.setMode('brainstorm');

        try {
            if (!this.brainstormLLM) {
                this.setMode('idle');
                return "Please configure your API Keys in Settings to use this feature.";
            }

            let context = this.session.getFormattedContext(180);
            // Prepend the problem statement so the LLM knows exactly what to brainstorm
            const resolvedProblem = problemStatement?.trim() ||
                this.session.getDetectedCodingQuestion().question?.trim();

            if (!context.trim() && !resolvedProblem && (!imagePaths || imagePaths.length === 0)) {
                this.setMode('idle');
                const msg = "There's nothing to brainstorm right now. Make sure your question is visible or spoken aloud, then try again.";
                this.session.addAssistantMessage(msg, this.generationMetadata());
                this.emit('suggested_answer', msg, 'Brainstorming Approaches', 1.0);
                return msg;
            }

            if (resolvedProblem) {
                context = `<problem_statement>\n${resolvedProblem}\n</problem_statement>\n\n${context}`;
            }
            const generationId = ++this.currentGenerationId;
            let fullResult = "";
            const stream = this.brainstormLLM.generateStream(context, imagePaths);
            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] brainstorm stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('suggested_answer_token', token, 'Brainstorming Approaches', 1.0);
                fullResult += token;
            }

            if (streamAborted) {
                this.setMode('idle');
                return null;
            }

            if (!fullResult?.trim()) {
                fullResult = "I couldn't generate brainstorm approaches. Make sure your question is visible and try again.";
            }

            this.session.addAssistantMessage(fullResult, this.generationMetadata());
            this.recordUsage({
                type: 'assist',
                timestamp: Date.now(),
                question: 'Brainstorm',
                answer: fullResult
            });

            this.emit('suggested_answer', fullResult, 'Brainstorming Approaches', 1.0);
            this.setMode('idle');
            return fullResult;

        } catch (error) {
            this.emit('error', error as Error, 'brainstorm');
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
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }
        if (this.speculativeTimer !== null) {
            clearTimeout(this.speculativeTimer);
            this.speculativeTimer = null;
        }
        this.speculativeText = null;
        this.speculativeTextExpiry = Infinity;
    }
}
