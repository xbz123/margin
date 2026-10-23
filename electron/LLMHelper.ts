import { GoogleGenAI } from "@google/genai"
import Groq from "groq-sdk"
import OpenAI from "openai"
import { LLM_PRESETS, candidateConfiguration, modelTargetId, gatewayTarget, type LlmProvider, type ProviderConfiguration, type ModelTarget, type GatewayConfiguration } from '../src/types/llmTarget';
import { blockedEnvironmentOverride, effectiveProviderConfiguration, followSelection, resolveModelTarget, validateGatewayConfiguration, validateProviderConfiguration } from './llm/llmTarget';
import { NOT_AVAILABLE_NOTICE, capabilityTarget, controlState, effectiveReasoning, reasoningApplies, type SavedReasoning } from './llm/answerReasoning';
import { isReasoningChoice, officialCapability, type ReasoningChoice } from '../src/types/modelCapabilities';
import type { ReasoningControlState } from '../src/types/answerReasoning';
import { outboundFetch } from './services/outbound';
import Anthropic from "@anthropic-ai/sdk"
import fs from "fs"
import { AsyncLocalStorage } from "async_hooks"
import { createHash } from "crypto"
import { toJpeg } from "./services/screen/imageCodec"
import { ModelVersionManager } from './services/ModelVersionManager'
import {
  HARD_SYSTEM_PROMPT,
  UNIVERSAL_SYSTEM_PROMPT, UNIVERSAL_ANSWER_PROMPT, UNIVERSAL_WHAT_TO_ANSWER_PROMPT,
  UNIVERSAL_RECAP_PROMPT, UNIVERSAL_FOLLOWUP_PROMPT, UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT, UNIVERSAL_ASSIST_PROMPT,
  CHAT_MODE_PROMPT, DEFAULT_ANSWER_PROMPT_SUFFIX
} from "./llm/prompts"
import { TINY_PROMPTS_SET } from "./llm/tinyPrompts"
import { getModelCapabilities, selectPromptTier, estimateTokens, truncateTranscriptToFit, type PromptTier, type ModelCapabilities } from "./llm/modelCapabilities"
import { GeminiPromptCache } from "./llm/GeminiPromptCache"
import { generateOnce } from './llm/generateOnce';
import { app } from 'electron';
import { join } from 'node:path';
import { LocalContextStore } from './services/LocalContextStore';
import { PromptSettingsStore } from './services/PromptSettingsStore';
import { scenarioPrompt, appendPromptGuidance } from './llm/scenarioPrompts';
import { attachLocalContext } from './llm/localContextRequest';
import { GenerationResultError, rethrowTerminalGenerationError, type GenerateEvent, type GenerateRequest } from './llm/generateContract';
import { assertProviderDataScopes, getDeniedDataScopes, ProviderScopeError, type ProviderDataScope, type ProviderDataScopePolicy } from "./llm/ProviderRouter"
import type { TranscriptTurn } from "./llm/transcriptCleaner"
import { createProviderRateLimiters } from './services/RateLimiter';
import { CodexAuthSource } from './services/CodexAuthSource';
import { DEFAULT_CODEX_SOURCE_CONFIG, assertCodexConsent, codexImageTarget, isCodexSelection, validateCodexModel, validateCodexSourceConfig, type CodexSourceConfig } from '../src/types/codexSource';
import { GenerationTask, generateTask, generationTasks, withGenerationTask, awaitGeneration, type GenerationKind } from './llm/generateTask';
import { DEFAULT_GENERATION_POLICY, validateGenerationPolicy, type GenerationPolicy } from '../src/types/generationPolicy';
import { assertModelImageSupport } from '../src/types/modelImageSupport';
import { PreparedInputs, copyPreparedInput, type PreparedInput, type PresentationOwner } from './llm/preparedInput';

type SnapshotContext = { language: string; customNotes: string; personaPrompt: string; fastMode: boolean };
type GenerationTargetSnapshot = SnapshotContext & ({ kind: 'api'; target: ModelTarget; client: any; custom: boolean }
  | { kind: 'codex'; target: { provider: 'codex-cli'; protocol: 'responses'; model: string }; codex: CodexSourceConfig; imageSupportConfirmedFor?: string });

// Data scopes of the request being served, beyond what each payload shows: the scopes
// its caller declared and those recognized in its context when it started. Every send
// checks them again against the current settings right before it goes out, so a scope
// turned off while a request waits (rate limiter, a failed provider, a retry) stops
// the later sends of that request too (PLAN.md AG-17 seventh review).
type RequestDataScopes = { scopes: Set<ProviderDataScope> };
const requestDataScopes = new AsyncLocalStorage<RequestDataScopes>();

// Steps a generator with the request's scopes in effect: the generator resumes inside
// each `next()` call, so its sends see them.
async function* withRequestDataScopes<T>(store: RequestDataScopes, gen: AsyncGenerator<T, void, unknown>): AsyncGenerator<T, void, unknown> {
  let finished = false;
  try {
    for (;;) {
      const step: IteratorResult<T, void> = await requestDataScopes.run(store, () => gen.next());
      if (step.done) { finished = true; return; }
      yield step.value as T;
    }
  } finally {
    if (!finished) await requestDataScopes.run(store, () => gen.return(undefined)).catch((): undefined => undefined);
  }
}

// Model constant for Gemini 3 Flash
const GEMINI_FLASH_MODEL = LLM_PRESETS.gemini.model
const withReasoning = <T extends ModelTarget>(target: T, reasoning: ModelTarget['reasoning']): T => {
  const { reasoning: _old, ...rest } = target;
  return (reasoning ? { ...rest, reasoning } : rest) as T;
};
const GEMINI_PRO_MODEL = "gemini-3.1-pro-preview"
const GROQ_MODEL = "llama-3.3-70b-versatile"
const CLAUDE_MODEL = "claude-sonnet-4-6"
const DEEPSEEK_MODEL = "deepseek-v4-flash"
const MAX_OUTPUT_TOKENS = 65536

// Simple prompt for image analysis (not interview copilot - kept separate)
const IMAGE_ANALYSIS_PROMPT = `Analyze concisely. Be direct. No markdown formatting. Return plain text only.`

export class LLMHelper {
  private preparedInputs?: PreparedInputs;
  private inputs(): PreparedInputs { return this.preparedInputs ??= new PreparedInputs(); }

  public attachPresentation(task: GenerationTask<any>, owner: PresentationOwner, entryPoint: string, receipt = false): void {
    task.rendererOwner = owner;
    task.entryPoint = entryPoint;
    task.requireVisibleReceipt = receipt;
    this.inputs().begin(owner, task);
  }

  public acknowledgeVisible(owner: PresentationOwner, requestId: unknown): void { this.inputs().visible(owner, requestId); }
  public clearPreparedInput(ownerId?: number): void { this.inputs().clear(ownerId); }
  public dependPreparedImages(task: GenerationTask<any>, paths: string[]): void { this.inputs().depend(task, paths); }
  public revokePreparedImages(path: string): void { this.inputs().revoke(input => input.imagePaths.includes(path)); }
  public revokePreparedContext(): void {
    const entries = new LocalContextStore(join(app.getPath('userData'), 'local-context.json')).list();
    const prompts = JSON.stringify(new PromptSettingsStore(join(app.getPath('userData'), 'prompt-settings.json')).read());
    this.inputs().revoke(input => input.localContext.some(prior => !entries.some(entry => entry.id === prior.id && entry.content === prior.content && entry.name === prior.name))
      || input.promptDependency !== undefined && input.promptDependency !== prompts);
  }

  public beginPreparedRetry(owner: PresentationOwner, requestId: unknown, startedAt: number, receipt = false) {
    this.revokePreparedContext();
    const { input, prior } = this.inputs().take(owner, requestId);
    const task = this.beginGenerationTask(prior.kind, undefined, undefined, startedAt);
    task.rendererOwner = owner; task.entryPoint = prior.entryPoint;
    task.questionId = prior.questionId; task.retryOf = prior.requestId;
    task.requireVisibleReceipt = receipt;
    this.inputs().begin(owner, task, input);
    return { task, input };
  }

  public replayPrepared(input: PreparedInput): AsyncGenerator<string> {
    const replay = copyPreparedInput(input);
    const source = this.selectedGeneration(replay.userContent, undefined, replay.systemInstruction, replay.stream, replay.purpose, undefined, undefined, replay.outputLimit, replay);
    return (async function* () {
      const { reduceDashesInChunk } = await import('./llm/postProcessor');
      for await (const token of source) yield reduceDashesInChunk(token);
    })();
  }
  private generationPolicy: GenerationPolicy = { ...DEFAULT_GENERATION_POLICY };
  private activeGenerationTasks = new Set<GenerationTask>();
  private generationClosed = false;

  public setGenerationPolicy(policy: GenerationPolicy): void {
    const validated = validateGenerationPolicy(policy);
    this.validateGenerationTargets(this.getCurrentModelSelection(), validated);
    if (JSON.stringify(this.generationPolicy) !== JSON.stringify(validated)) this.cancelGenerationTasks('Generation policy changed');
    this.generationPolicy = validated;
  }

  public getGenerationPolicy(): GenerationPolicy { return { ...(this.generationPolicy ?? DEFAULT_GENERATION_POLICY) }; }
  public getCurrentGenerationTask(): GenerationTask<GenerationTargetSnapshot> | undefined { return generationTasks.getStore(); }

  public getTaskMetadata(task: GenerationTask<GenerationTargetSnapshot>) {
    return { requestId: task.requestId, questionId: task.questionId, retryOf: task.retryOf, retryable: this.inputs().retryable(task), entryPoint: task.entryPoint,
      timing: { speechMs: Math.max(0, (task.speechEndedAt ?? task.startedAt) - task.startedAt),
        preparationMs: task.firstSendAt === undefined ? undefined : Math.max(0, task.firstSendAt - (task.speechEndedAt ?? task.startedAt)),
        modelToVisibleMs: task.firstVisibleAt === undefined || task.firstSendAt === undefined ? undefined : Math.max(0, task.firstVisibleAt - task.firstSendAt),
        firstVisibleMs: task.firstVisibleAt === undefined ? undefined : Math.max(0, task.firstVisibleAt - task.startedAt) }, provider: task.actualTarget.target.provider,
      model: task.actualTarget.target.model, status: task.terminalStatus, attempts: task.sends, partial: task.hasText && task.terminalStatus !== 'completed',
      ...(task.signal.reason?.name === 'GenerationTimeoutError' ? { timeout: task.signal.reason.deadline as 'first-token' | 'total' } : {}),
      usedImageInput: task.imageCount > 0, imageCount: task.imageCount };
  }

  public runGeneration<T>(factory: () => Promise<T>, kind: GenerationKind = 'interview', signal?: AbortSignal, supplied?: GenerationTask<any>): Promise<T> {
    const inherited = generationTasks.getStore();
    const task = supplied ?? inherited ?? this.beginGenerationTask(kind, signal);
    return (async () => { task.check(); const result = await awaitGeneration(task, Promise.resolve().then(() => generationTasks.run(task, factory)));
      if (task !== inherited) await task.waitForVisible(); return result; })()
      .catch(error => { if (!task.signal.aborted && !['refused', 'incomplete', 'empty'].includes(task.terminalStatus ?? '')) task.terminalStatus = 'failed'; throw error; })
      .finally(() => { if (task !== inherited) task.close(); });
  }

  public runGenerationStream<T>(factory: () => AsyncGenerator<T>, kind: GenerationKind = 'interview', signal?: AbortSignal, supplied?: GenerationTask<any>): AsyncGenerator<T> {
    const inherited = generationTasks.getStore();
    const task = supplied ?? inherited ?? this.beginGenerationTask(kind, signal);
    const source = (async function* () { yield* factory(); })();
    return withGenerationTask(task, source, task !== inherited);
  }

  public beginGenerationTask(kind: GenerationKind = 'interview', signal?: AbortSignal, primary?: ModelTarget, startedAt?: number): GenerationTask<GenerationTargetSnapshot> {
    if (this.generationClosed) throw new DOMException('Application quit', 'AbortError');
    const configs = this.providerConfigurations ?? LLM_PRESETS;
    const context = { language: this.aiResponseLanguage ?? 'auto', customNotes: this.customNotes ?? '', personaPrompt: this.personaPrompt ?? '', fastMode: this.groqFastTextMode };
    // A gateway target only ever uses its own client; a missing gateway or key fails, never an official client.
    // Reasoning is fixed here for the whole task (S48 C3): the selected primary takes the session or saved
    // default; an official backup or an explicit target (connection test) takes the provider default.
    const reasoningSource = this.reasoningSource();
    const snapshot = (target: ModelTarget, selectedPrimary = false): GenerationTargetSnapshot => target.provider === 'gateway'
      ? { ...context, kind: 'api', target, custom: true, client: this.gatewayClients?.get(target.gatewayId!) ?? null }
      : { ...context, kind: 'api', target: withReasoning({ ...target, baseUrl: effectiveProviderConfiguration(target as ProviderConfiguration).baseUrl },
          selectedPrimary ? effectiveReasoning(target, reasoningSource) : undefined),
        custom: effectiveProviderConfiguration(configs[target.provider]).custom,
        client: target.provider === 'gemini' ? this.client : target.provider === 'groq' ? this.groqClient
          : target.provider === 'openai' ? this.openaiClient : target.provider === 'claude' ? this.claudeClient : this.deepseekClient };
    const codexSnapshot = (selection: string, fast = false, imageConfirmation?: string, backup = false): GenerationTargetSnapshot => {
      const codex = this.getCodexCliConfig(), model = fast ? codex.fastModel : selection.startsWith('codex-cli:') ? validateCodexModel(selection.slice(10)) : codex.model;
      return { ...context, kind: 'codex', target: { provider: 'codex-cli', protocol: 'responses', model }, codex,
        imageSupportConfirmedFor: backup ? imageConfirmation : fast ? codex.fastImageSupportConfirmedFor : model === codex.model ? codex.imageSupportConfirmedFor : model === codex.fastModel ? codex.fastImageSupportConfirmedFor : undefined };
    };
    if (!primary && this.selectionError) throw new Error(this.selectionError);
    const selected = !primary && this.isCodexCliModel(this.currentModelId ?? '') ? codexSnapshot(this.currentModelId, this.groqFastTextMode)
      : primary ? snapshot(primary) : snapshot(this.selectedTarget ?? this.resolve(this.currentModelId ?? GEMINI_FLASH_MODEL), true);
    const policy = this.getGenerationPolicy();
    const backup = kind !== 'compatibility' && policy.backupModel ? isCodexSelection(policy.backupModel)
      ? codexSnapshot(policy.backupModel, false, policy.backupImageSupportConfirmedFor, true)
      : snapshot({ ...this.resolve(policy.backupModel), imageSupportConfirmedFor: policy.backupImageSupportConfirmedFor }) : undefined;
    if (backup && backup.kind === selected.kind && backup.target.provider === selected.target.provider && (backup.target as ModelTarget).gatewayId === (selected.target as ModelTarget).gatewayId
      && backup.target.model === selected.target.model) throw new Error('Primary and backup model must differ.');
    const task = new GenerationTask(selected, backup, policy, kind, signal, startedAt);
    this.activeGenerationTasks ??= new Set();
    if (!task.signal.aborted) this.activeGenerationTasks.add(task);
    task.signal.addEventListener('abort', () => this.activeGenerationTasks.delete(task), { once: true });
    return task;
  }

  private selectedGeneration(userContent: string, imagePaths: string[] | undefined, systemInstruction: string | undefined,
    stream: boolean, purpose: GenerateRequest['purpose'], supplied?: GenerationTask<GenerationTargetSnapshot>, preparedContents?: any[], outputLimit?: number, replay?: PreparedInput): AsyncGenerator<string> {
    const inherited = supplied ?? generationTasks.getStore();
    const task = inherited ?? this.beginGenerationTask(purpose === 'summary' ? 'background' : purpose === 'structured' ? 'written' : 'interview');
    const self = this;
    if (!replay) this.inputs().depend(task, imagePaths ?? []);
    const source = (async function* () {
      if (!task.primary.target.model.trim()) throw new Error('Selected model client is not configured.');
      if (task.primary.kind === 'api' && !task.primary.client) throw new Error(self.clientError(task.primary.target));
      const contents: any[] = replay?.contents ?? preparedContents ?? [{ text: userContent }];
      for (const path of replay ? [] : imagePaths ?? []) {
        task.check();
        const image = await awaitGeneration(task, self.processImage(path));
        contents.push({ inlineData: image });
      }
      const dataScopes = replay?.dataScopes ?? self.scopesForPayload(userContent, /"inlineData"/.test(JSON.stringify(contents)) ? ['inline-image'] : imagePaths);
      const localContext = replay?.localContext ?? (purpose === 'compatibility' ? [] : new LocalContextStore(join(app.getPath('userData'), 'local-context.json')).list());
      const ownedInput = replay ?? (task.rendererOwner ? copyPreparedInput({ userContent, systemInstruction, contents, dataScopes, localContext,
          promptDependency: systemInstruction ? JSON.stringify(new PromptSettingsStore(join(app.getPath('userData'), 'prompt-settings.json')).read()) : undefined,
          imagePaths: imagePaths ?? [], stream, purpose, outputLimit }) : undefined);
      if (ownedInput) self.inputs().capture(task, ownedInput);
      const checkInput = () => {
        if (ownedInput) {
          self.revokePreparedContext();
          task.check();
        }
      };
      let cacheReference: string | undefined;
      const codexSession = (self.codexAuthSource ??= new CodexAuthSource()).session(() => { task.check(); assertCodexConsent(self.getCodexCliConfig()); assertProviderDataScopes('codex', dataScopes, self.getProviderScopePolicy()); });
      const options = { get cacheReference() { return cacheReference; }, invalidateCache: () => {
        if (cacheReference) self.geminiPromptCache.invalidate(cacheReference);
      }, recoverAuthentication: (snapshot: GenerationTargetSnapshot, error: unknown) => snapshot.kind === 'codex' ? codexSession.recover(error) : Promise.resolve(false) };
      try { for await (const event of generateTask(task, (snapshot: GenerationTargetSnapshot, signal, recovery) => (async function* () {
        const { target } = snapshot;
        checkInput();
        const request = attachLocalContext({ protocol: target.protocol, model: target.model, purpose, contents,
          systemInstruction, stream, signal, dataScopes,
          maxOutputTokens: outputLimit ?? Math.min(getModelCapabilities(target.model).tier === 'local-small' ? getModelCapabilities(target.model).outputBudgetTokens : Infinity,
            target.protocol === 'messages' ? self.getClaudeMaxOutput(target.model) : ['deepseek', 'groq'].includes(target.provider) ? 8192 : MAX_OUTPUT_TOKENS),
        }, localContext);
        const imageCount = contents.reduce((count, part) => count + (part.inlineData ? 1 : 0) + (part.parts?.filter((item: any) => item.inlineData).length ?? 0), 0);
        if (snapshot.kind === 'codex') {
          const assertImages = () => { if (imageCount && snapshot.imageSupportConfirmedFor !== codexImageTarget(target.model)) throw new Error('Image support is unconfirmed for this Codex model and backend. Confirm it in Settings; attachments were kept.'); };
          assertImages();
          yield* codexSession.generate(snapshot.codex, { model: target.model, contents: request.contents, systemInstruction, signal }, () => {
            checkInput();
            task.check(); assertCodexConsent(self.getCodexCliConfig()); assertProviderDataScopes('codex', dataScopes, self.getProviderScopePolicy()); assertImages();
            task.claimSend(snapshot); task.imageCount = imageCount;
          }); return;
        }
        const { client, custom } = snapshot;
        const apiTarget = snapshot.target;
        // Check the attempted target, not every configured backup before a valid primary can run.
        const unavailable = officialCapability(apiTarget)?.answerUnavailable;
        if (unavailable) throw new Error(unavailable);
        if (imageCount) assertModelImageSupport(apiTarget);
        if (!client) throw new Error(self.clientError(apiTarget));
        assertProviderDataScopes(apiTarget.provider, dataScopes, self.getProviderScopePolicy());
        const limiter = apiTarget.provider === 'gateway' ? undefined : self.rateLimiters?.[apiTarget.provider];
        if (limiter) await awaitGeneration(task, limiter.acquire(signal));
        cacheReference = undefined;
        if (apiTarget.provider === 'gemini' && !custom && systemInstruction && !recovery) {
          cacheReference = (await awaitGeneration(task, self.geminiPromptCache.getOrCreate(client, target.model, systemInstruction,
            () => { checkInput(); assertProviderDataScopes(apiTarget.provider, dataScopes, self.getProviderScopePolicy()); }, signal))) ?? undefined;
        }
        yield* generateOnce({ ...request, cacheReference, ...(apiTarget.reasoning ? { reasoning: apiTarget.reasoning } : {}),
          ...(target.protocol === 'gemini' || target.provider === 'groq' ? { temperature: purpose === 'summary' ? 0.3 : 0.4 } : {}),
          providerOptions: {
            outputTokenField: ['groq', 'deepseek', 'claude'].includes(target.provider) ? 'max_tokens' : 'max_completion_tokens',
            ...(target.provider === 'openai' && !custom && systemInstruction ? { prompt_cache_key: self.getOpenAiPromptCacheKey(systemInstruction) } : {}),
            ...(target.provider === 'claude' && !custom && systemInstruction ? { systemBlocks: self.buildClaudeSystemBlocks(systemInstruction, target.model) } : {}),
          },
        }, { client, beforeSend: () => {
          checkInput();
          assertProviderDataScopes(apiTarget.provider, dataScopes, self.getProviderScopePolicy());
          if (imageCount) assertModelImageSupport(apiTarget);
          task.claimSend(snapshot);
          task.imageCount = contents.reduce((count, part) => count + (part.inlineData ? 1 : 0)
            + (part.parts?.filter((item: any) => item.inlineData).length ?? 0), 0);
        } });
      })(), options)) {
        if (event.type === 'delta') yield event.text;
        else { if (event.status === 'cancelled') task.check(); self.generationFinish(event, task.hasText); }
      } } catch (error: any) {
        // Retry classification has finished. Never expose a gateway's echoed credentials or raw SDK payload.
        if (task.actualTarget.kind === 'api' && task.actualTarget.target.provider === 'gateway' && task.sends > 0
          && !task.signal.aborted && !(error instanceof ProviderScopeError)) {
          const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
          const httpStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined;
          const safe = error instanceof GenerationResultError ? new GenerationResultError(error.status, error.partial)
            : new Error(`Gateway request failed${httpStatus ? ` (HTTP ${httpStatus})` : ''}. Check the gateway configuration and try again.`);
          throw Object.assign(safe, { generationTaskTerminal: true, ...(httpStatus ? { status: httpStatus } : {}) });
        }
        throw error;
      } finally { codexSession.dispose(); }
    })();
    return withGenerationTask(task, source, !inherited);
  }
  private providerConfigurations: Record<LlmProvider, ProviderConfiguration> = { ...LLM_PRESETS };
  private gateways: Record<string, GatewayConfiguration> = {};
  private gatewayClients = new Map<string, GoogleGenAI | OpenAI | Anthropic>();
  /** Why an official provider is paused (production address variable set); it is never redirected or used. */
  private blockedProviders: Partial<Record<LlmProvider, string>> = {};
  private selectedTarget: ModelTarget | undefined;
  /** Set when the saved selection cannot be used (retired Groq, removed gateway); answers refuse until a new choice. */
  private selectionError: string | undefined;
  private client: GoogleGenAI | null = null
  private groqClient: Groq | OpenAI | null = null
  private openaiClient: OpenAI | null = null
  private claudeClient: Anthropic | null = null
  // DeepSeek is OpenAI-compatible; reuse the OpenAI SDK with a custom baseURL.
  // Kept as a separate client so credentials/scope/telemetry stay provider-specific.
  private deepseekClient: OpenAI | null = null
  private apiKey: string | null = null
  private groqApiKey: string | null = null
  private openaiApiKey: string | null = null
  private claudeApiKey: string | null = null
  private deepseekApiKey: string | null = null
  private geminiModel: string = GEMINI_FLASH_MODEL
  private groqFastTextMode: boolean = false;
  private codexCliConfig: CodexSourceConfig = { ...DEFAULT_CODEX_SOURCE_CONFIG };
  private codexAuthSource = new CodexAuthSource();
  private codexStatusController?: AbortController;
  private customNotes: string = '';
  private personaPrompt: string = '';
  private aiResponseLanguage: string = 'auto';
  private sttLanguage: string = 'english-us';

  // Rate limiters per provider to prevent 429 errors on free tiers
  private rateLimiters: ReturnType<typeof createProviderRateLimiters>;

  // Self-improving model version manager for vision analysis
  private modelVersionManager: ModelVersionManager;

  // Process-local cache of Gemini explicit context caches (caches.create).
  // Lifecycle and contract documented in GeminiPromptCache.ts.
  private geminiPromptCache: GeminiPromptCache = new GeminiPromptCache();


  private getProviderScopePolicy(): ProviderDataScopePolicy | undefined {
    try {
      const { SettingsManager } = require('./services/SettingsManager');
      return SettingsManager.getInstance().get('providerDataScopes');
    } catch {
      return undefined;
    }
  }

  private inferContextScopes(context?: string): ProviderDataScope[] {
    const scopes: ProviderDataScope[] = [];
    if (!context?.trim()) return scopes;
    // Keyword fallback for context a window sends itself (PLAN.md AG-17 fifth review).
    if (/<meeting_history|USER-PROVIDED PERSONA CONTEXT|<user_context|\[RECENT ASSISTANT RESPONSES\]|^MEETING: /im.test(context)) scopes.push('profile_history');
    return scopes;
  }

  // Any text counts as transcript, also when other scopes are declared for it: a
  // declared scope adds to the transcript, it does not replace it (PLAN.md AG-17
  // fourth review).
  private scopesForPayload(text: string, imagePaths?: string[], extraScopes: ProviderDataScope[] = []): ProviderDataScope[] {
    const scopes = new Set<ProviderDataScope>(extraScopes);
    for (const scope of requestDataScopes.getStore()?.scopes ?? []) scopes.add(scope);
    if (text.trim().length > 0) scopes.add('transcript');
    if (imagePaths?.length) scopes.add('screenshots');
    return [...scopes];
  }

  private assertOutboundScopes(provider: string, text: string, imagePaths?: string[], extraScopes: ProviderDataScope[] = []): void {
    assertProviderDataScopes(provider, this.scopesForPayload(text, imagePaths, extraScopes), this.getProviderScopePolicy());
  }


  private generationFinish(event: Extract<GenerateEvent, { type: 'finish' }>, partial: boolean): void {
    if (event.status === 'failed' && !partial) throw event.error ?? new Error('Generation failed');
    if (event.status !== 'completed' && event.status !== 'cancelled') throw new GenerationResultError(event.status, partial);
  }




  private resolve(id: string): ModelTarget {
    return resolveModelTarget(id, this.providerConfigurations ?? LLM_PRESETS, this.gateways ?? {});
  }

  private clientError(target: Pick<ModelTarget, 'provider' | 'gatewayId'>): string {
    if (target.provider === 'gateway') return 'This gateway has no saved API key. Save the gateway in Settings.';
    const reason = this.blockedProviders?.[target.provider];
    if (reason) return reason;
    return `${target.provider} client not initialized`;
  }

  /** Re-resolves the runtime selection after one target was explicitly saved or removed. */
  private refreshSelection(previous?: ModelTarget, next?: ModelTarget): void {
    if (!this.selectedTarget) return;
    let id = modelTargetId(this.selectedTarget);
    if (previous && next) id = followSelection(id, previous, next);
    try { this.selectedTarget = this.resolve(id); this.currentModelId = this.selectedTarget.model; }
    catch (error) { this.selectUnavailable(id, error instanceof Error ? error.message : 'The selected model is unavailable.'); }
  }

  /** Refuses, before any change, a save that would make the running selection equal the backup. */
  private assertFollowedDistinct(previous: ModelTarget, next: ModelTarget, configs = this.providerConfigurations ?? LLM_PRESETS, gateways = this.gateways ?? {}): void {
    const backup = this.getGenerationPolicy().backupModel;
    if (!backup || !this.selectedTarget || isCodexSelection(backup)) return;
    const followed = followSelection(modelTargetId(this.selectedTarget), previous, next);
    let backupId: string;
    try { backupId = modelTargetId(resolveModelTarget(backup, configs, gateways)); } catch { return; }
    if (followed === backupId) throw new Error('Primary and backup model must differ. Change the backup first.');
  }

  public configureProvider(value: ProviderConfiguration, key?: string): void {
    const config = effectiveProviderConfiguration(value);
    const previous = (this.providerConfigurations ?? LLM_PRESETS)[config.provider];
    const validated = validateProviderConfiguration(value);
    this.assertFollowedDistinct(previous, validated, { ...(this.providerConfigurations ?? LLM_PRESETS), [config.provider]: validated });
    this.providerConfigurations = { ...(this.providerConfigurations ?? LLM_PRESETS), [config.provider]: validated };
    const variable = blockedEnvironmentOverride(config.provider);
    const blocked = (variable && `${variable} is set, so this official provider is paused. Remove the variable or use a gateway; keys are not sent to an address you did not choose.`);
    this.blockedProviders = { ...this.blockedProviders, [config.provider]: blocked || undefined };
    const apiKey = blocked ? null : key?.trim() || null;
    if (config.provider === 'gemini') {
      this.apiKey = apiKey;
      this.client = apiKey ? new GoogleGenAI({ apiKey, httpOptions: { baseUrl: config.baseUrl, apiVersion: 'v1alpha', retryOptions: { attempts: 1 } } }) : null;
      this.geminiPromptCache.clear();
    } else if (config.provider === 'claude') {
      this.claudeApiKey = apiKey;
      this.claudeClient = apiKey ? new Anthropic({ apiKey, baseURL: config.baseUrl.replace(/\/v1$/, ''), fetch: outboundFetch, maxRetries: 0 }) : null;
    } else if (config.provider === 'openai') {
      this.openaiApiKey = apiKey;
      this.openaiClient = apiKey ? new OpenAI({ apiKey, baseURL: config.baseUrl, fetch: outboundFetch, maxRetries: 0 }) : null;
    } else if (config.provider === 'groq') {
      this.groqApiKey = apiKey;
      this.groqClient = apiKey ? new Groq({ apiKey, baseURL: 'https://api.groq.com', fetch: outboundFetch, maxRetries: 0 }) : null;
    } else {
      this.deepseekApiKey = apiKey;
      this.deepseekClient = apiKey ? new OpenAI({ apiKey, baseURL: config.baseUrl, fetch: outboundFetch, maxRetries: 0 }) : null;
    }
    this.refreshSelection(previous, validated);
    if (config.provider === 'gemini' && this.selectedTarget?.provider === 'gemini') this.geminiModel = this.selectedTarget.model;
    this.refreshDiscoveryKeys();
  }

  /** The adapter follows the gateway's protocol only; its key is never shared with an official client. */
  public configureGateway(value: GatewayConfiguration, key?: string): void {
    const config = validateGatewayConfiguration(value);
    const previous = this.gateways?.[config.id];
    if (previous) this.assertFollowedDistinct(gatewayTarget(previous), gatewayTarget(config), undefined, { ...this.gateways, [config.id]: config });
    this.gateways = { ...this.gateways, [config.id]: config };
    this.gatewayClients ??= new Map();
    const apiKey = key?.trim();
    if (!apiKey) this.gatewayClients.delete(config.id);
    else this.gatewayClients.set(config.id, config.protocol === 'gemini'
      ? new GoogleGenAI({ apiKey, httpOptions: { baseUrl: config.baseUrl, apiVersion: 'v1alpha', retryOptions: { attempts: 1 } } })
      : config.protocol === 'messages' ? new Anthropic({ apiKey, baseURL: config.baseUrl.replace(/\/v1$/, ''), fetch: outboundFetch, maxRetries: 0 })
        : new OpenAI({ apiKey, baseURL: config.baseUrl, fetch: outboundFetch, maxRetries: 0 }));
    if (previous) this.cancelGatewayTasks(config.id, 'Gateway configuration changed');
    this.refreshSelection(previous && gatewayTarget(previous), gatewayTarget(config));
  }

  public removeGateway(id: string): void {
    this.cancelGatewayTasks(id, 'Gateway removed');
    const { [id]: _removed, ...rest } = this.gateways ?? {};
    this.gateways = rest;
    this.gatewayClients?.delete(id);
    this.refreshSelection();
  }

  private cancelGatewayTasks(id: string, reason: string): void {
    for (const task of this.activeGenerationTasks ?? []) {
      if ([task.primary, task.backup].some((snapshot: GenerationTargetSnapshot | undefined) => (snapshot?.target as ModelTarget | undefined)?.gatewayId === id)) task.controller.abort(new DOMException(reason, 'AbortError'));
    }
  }

  /** Saved default reasoning (applied by startup and every save); in-flight tasks keep their snapshot. */
  private savedReasoning: SavedReasoning = { choice: 'default' };
  /** Session override: undefined inherits the saved default; 'default' explicitly uses the provider default. */
  private sessionReasoning: ReasoningChoice | undefined;

  public setSavedReasoning(saved: SavedReasoning): void { this.savedReasoning = saved; }
  private reasoningSource(): SavedReasoning | ReasoningChoice { return this.sessionReasoning ?? this.savedReasoning ?? { choice: 'default' }; }
  public clearSessionReasoning(): void { this.sessionReasoning = undefined; }

  /** Sets the session level for `expected`, which must still be the running selection. */
  public setSessionReasoning(expected: unknown, choice: unknown): void {
    if (typeof expected !== 'string' || !isReasoningChoice(choice)) throw new Error('Invalid reasoning setting');
    if (expected !== this.getCurrentModelSelection()) throw new Error('The answer model changed. Choose the reasoning level again.');
    const target = this.selectedTarget;
    if (!target || target.provider === 'gateway') throw new Error('This answer model sets reasoning in its own configuration.');
    if (!reasoningApplies(target, choice)) throw new Error('This reasoning level is not available for the selected model.');
    this.sessionReasoning = choice;
  }

  /**
   * After the running model changed: a session level the new model does not take becomes an explicit
   * provider default, never a silently mapped level. Returns the notice to show. An inherited saved
   * default is left inheriting; it is checked against each target where it is used.
   */
  public reconcileSessionReasoning(): string | undefined {
    const target = this.selectedTarget;
    if (this.sessionReasoning === undefined || !target || target.provider === 'gateway') return undefined;
    if (reasoningApplies(target, this.sessionReasoning)) return undefined;
    this.sessionReasoning = 'default';
    return NOT_AVAILABLE_NOTICE;
  }

  /** The session control: what the next answer uses for the running selection. */
  public getSessionReasoningState(): ReasoningControlState & { overridden: boolean } {
    const selection = this.getCurrentModelSelection();
    const state = controlState(selection, this.selectedTarget, this.reasoningSource(), !!this.selectionError);
    return { ...state, overridden: this.sessionReasoning !== undefined };
  }

  /** Keeps an unusable saved selection visible and refuses answers until the user picks another model. */
  public selectUnavailable(modelId: string, reason: string): void {
    if (modelId !== this.getCurrentModelSelection()) this.cancelGenerationTasks('Model selection changed');
    this.selectedTarget = undefined;
    this.currentModelId = modelId;
    this.selectionError = reason;
  }

  private refreshDiscoveryKeys(): void {
    const configs = this.providerConfigurations ?? LLM_PRESETS;
    this.modelVersionManager?.setApiKeys({
      openai: effectiveProviderConfiguration(configs.openai).custom ? null : this.openaiApiKey,
      gemini: effectiveProviderConfiguration(configs.gemini).custom ? null : this.apiKey,
      claude: effectiveProviderConfiguration(configs.claude).custom ? null : this.claudeApiKey,
      groq: null,
    });
  }

  /** Tests exactly one saved candidate of an official provider (its first by default) or a gateway; nothing else is tried. */
  public async testProviderConnection(provider: LlmProvider | { gatewayId: string }, model?: string): Promise<string> {
    let target: ModelTarget;
    if (typeof provider === 'object') {
      const gateway = this.gateways?.[provider.gatewayId];
      if (!gateway) throw new Error('This gateway no longer exists.');
      target = gatewayTarget(gateway);
    } else {
      const config = (this.providerConfigurations ?? LLM_PRESETS)[provider];
      const candidate = candidateConfiguration(config, model ?? config.model);
      if (!candidate) throw new Error('This model is not a saved candidate. Save it before testing.');
      // The test sends the provider default reasoning, never the primary or session level (S48 C3).
      const { reasoning: _reasoning, imageSupportConfirmedFor: _image, ...rest } = candidate;
      target = rest;
    }
    const task = this.beginGenerationTask('compatibility', undefined, target);
    try {
      let text = '';
      // Explicit reasoning is part of the tested target; leave it room to finish visibly.
      // A model that may reason without a reasoning field needs room before visible text.
      const thinks = target.reasoning || (target.provider !== 'gateway' && officialCapability(capabilityTarget(target))?.reasoning?.reasonsByDefault);
      for await (const chunk of this.selectedGeneration('Hello', undefined, undefined, false, 'compatibility', task, undefined, thinks ? 2048 : 64)) text += chunk;
      return text;
    } finally { task.close(); }
  }



  // For callers that build a request: which of these scopes the user has denied, so
  // they can leave that content out before sending.
  public deniedDataScopes(scopes: ProviderDataScope[]): ProviderDataScope[] {
    return getDeniedDataScopes(scopes, this.getProviderScopePolicy());
  }

  private getDeniedOutboundScopes(text: string, imagePaths?: string[], extraScopes: ProviderDataScope[] = []): ProviderDataScope[] {
    return getDeniedDataScopes(this.scopesForPayload(text, imagePaths, extraScopes), this.getProviderScopePolicy());
  }

  private logScopeFallback(scope: ProviderDataScope): void {
    console.warn(`[ScopeFallback] ${scope} denied for cloud providers; omitting from context`);
  }

  constructor() {

    // Initialize rate limiters
    this.rateLimiters = createProviderRateLimiters();

    // Initialize model version manager
    this.modelVersionManager = new ModelVersionManager();
  }

  /**
   * Initialize the self-improving model version manager.
   * Should be called after all API keys are configured.
   * Triggers initial model discovery and starts background scheduler.
   */
  public async initModelVersionManager(): Promise<void> {
    this.refreshDiscoveryKeys();
    await this.modelVersionManager.initialize();
    console.log(this.modelVersionManager.getSummary());
  }

  public setGroqFastTextMode(enabled: boolean) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid fast-mode flag');
    this.validateGenerationTargets(undefined, undefined, undefined, enabled);
    if (this.groqFastTextMode !== enabled) this.cancelGenerationTasks('Fast model changed');
    this.groqFastTextMode = enabled;
    console.log(`[LLMHelper] Groq Fast Text Mode: ${enabled}`);
  }

  public scrubKeys(): void {
    this.generationClosed = true;
    this.codexStatusController?.abort(new DOMException('Application quit', 'AbortError'));
    for (const task of this.activeGenerationTasks) task.controller.abort(new DOMException('Application quit', 'AbortError'));
    this.apiKey = null; this.groqApiKey = null; this.openaiApiKey = null; this.claudeApiKey = null; this.deepseekApiKey = null;
    this.gatewayClients?.clear();
    this.client = null; this.groqClient = null; this.openaiClient = null; this.claudeClient = null; this.deepseekClient = null;
    if (this.rateLimiters) Object.values(this.rateLimiters).forEach(limiter => limiter.destroy());
    this.modelVersionManager.stopScheduler();
  }

  public getGroqFastTextMode(): boolean {
    return this.groqFastTextMode;
  }

  public cancelGenerationTasks(reason = 'Generation configuration changed'): void {
    this.codexStatusController?.abort(new DOMException(reason, 'AbortError'));
    for (const task of this.activeGenerationTasks ?? []) task.controller.abort(new DOMException(reason, 'AbortError'));
  }

  public setCodexCliConfig(config: Partial<CodexSourceConfig>) {
    const next = validateCodexSourceConfig(config);
    if (next.enabled) this.validateGenerationTargets(undefined, undefined, next);
    if (JSON.stringify(this.codexCliConfig) !== JSON.stringify(next)) this.cancelGenerationTasks('Codex source configuration changed');
    this.codexCliConfig = next;
  }

  public getCodexCliConfig(): CodexSourceConfig {
    return validateCodexSourceConfig(this.codexCliConfig ?? DEFAULT_CODEX_SOURCE_CONFIG);
  }

  public async checkCodexSourceStatus() {
    const discarded = () => ({ success: false, status: 'disabled' as const, message: 'Configuration changed or application closed; the local check result was discarded.' });
    if (this.generationClosed) return discarded();
    const config = this.getCodexCliConfig();
    this.codexStatusController?.abort(new DOMException('Local check superseded', 'AbortError'));
    const controller = new AbortController(); this.codexStatusController = controller;
    try {
      const result = await (this.codexAuthSource ??= new CodexAuthSource()).status(config, controller.signal);
      return controller.signal.aborted || JSON.stringify(config) !== JSON.stringify(this.getCodexCliConfig()) ? discarded() : result;
    } catch (error) { if (controller.signal.aborted) return discarded(); throw error; }
    finally { if (this.codexStatusController === controller) this.codexStatusController = undefined; }
  }

  public validateGenerationTargets(primary: string = this.getCurrentModelSelection(), policy = this.getGenerationPolicy(), config = this.getCodexCliConfig(), fast = this.groqFastTextMode): void {
    validateGenerationPolicy(policy);
    if (policy.backupModel && this.generationSelectionId(isCodexSelection(primary) && fast ? `codex-cli:${config.fastModel}` : primary, false, config) === this.generationSelectionId(policy.backupModel, false, config)) throw new Error('Primary and backup model must differ.');
  }

  // An unavailable selection compares as written; using it is refused when a task starts.
  private generationSelectionId(id: string, primary = false, config = this.getCodexCliConfig()): string {
    if (isCodexSelection(id)) return `codex-cli:${primary && this.groqFastTextMode ? config.fastModel : id.startsWith('codex-cli:') ? validateCodexModel(id.slice(10)) : config.model}`;
    try { return modelTargetId(this.resolve(id)); } catch { return id; }
  }

  public getAiResponseLanguage(): string {
    return this.aiResponseLanguage;
  }

  /**
   * Per-model max output token ceiling. Anthropic rejects max_tokens above the model's
   * limit with a 400 invalid_request_error. claude-3.5/3.7 cap at 8K, opus-4 at 32K,
   * sonnet-4/haiku-4.5/mythos at 64K. Unknown models fall back to a safe 8192.
   */
  private getClaudeMaxOutput(modelId: string): number {
    const id = modelId.toLowerCase();
    if (id.startsWith("claude-3-5-") || id.startsWith("claude-3-7-") || id.startsWith("claude-3-haiku")) return 8192;
    if (id.startsWith("claude-opus-4-")) return 32000;
    if (id.startsWith("claude-sonnet-4-") || id.startsWith("claude-haiku-4-5") || id.startsWith("claude-mythos")) return 64000;
    return 8192;
  }

  /**
   * Per-model minimum prompt size for prompt caching to engage. Below this
   * threshold, Anthropic SILENTLY skips caching: the request still succeeds,
   * `cache_creation_input_tokens` is 0, and you pay full input price every
   * turn. Returns size in CHARS (≈4 chars/token) so we can cheaply check
   * `text.length` without a tokenizer round-trip.
   *
   *   Opus 4.7 / 4.6 / 4.5     → 4,096 tokens
   *   Sonnet 4.6                → 2,048 tokens
   *   Sonnet 4.5 / 4 + Opus 4.1 → 1,024 tokens
   *   Haiku 4.5                 → 4,096 tokens
   *   Haiku 3.5                 → 2,048 tokens
   *
   * Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
   */
  private getClaudeCacheMinChars(modelId: string): number {
    const id = modelId.toLowerCase();
    if (id.startsWith("claude-opus-4-7") || id.startsWith("claude-opus-4-6") || id.startsWith("claude-opus-4-5") || id.startsWith("claude-haiku-4-5")) return 4096 * 4;
    if (id.startsWith("claude-sonnet-4-6")) return 2048 * 4;
    if (id.startsWith("claude-3-5-haiku") || id.startsWith("claude-haiku-3-5")) return 2048 * 4;
    if (id.startsWith("claude-")) return 1024 * 4;
    return 4096 * 4; // unknown model → conservative
  }

  private isCodexCliModel(modelId: string): boolean {
    return isCodexSelection(modelId);
  }
  // ---------------------------

  private currentModelId: string = GEMINI_FLASH_MODEL;

  public setModel(modelId: string) {
    // Map UI short codes to internal Model IDs
    let targetModelId = modelId;
    if (modelId === 'gemini') targetModelId = GEMINI_FLASH_MODEL;
    if (modelId === 'gemini-pro') targetModelId = GEMINI_PRO_MODEL;
    if (modelId === 'claude') targetModelId = CLAUDE_MODEL;
    if (modelId === 'llama') targetModelId = GROQ_MODEL;
    if (modelId === 'deepseek') targetModelId = DEEPSEEK_MODEL;
    if (isCodexSelection(targetModelId) && targetModelId.startsWith('codex-cli:')) validateCodexModel(targetModelId.slice(10));

    const selection = this.isCodexCliModel(targetModelId) ? undefined : this.resolve(targetModelId);
    const backup = this.getGenerationPolicy().backupModel;
    this.validateGenerationTargets(targetModelId);
    if ((selection ? modelTargetId(selection) : targetModelId) !== this.getCurrentModelSelection()) {
      for (const task of this.activeGenerationTasks ?? []) task.controller.abort(new DOMException('Model selection changed', 'AbortError'));
    }
    if (!this.isCodexCliModel(targetModelId)) {
      this.selectedTarget = selection;
      targetModelId = selection!.model;
    } else this.selectedTarget = undefined;
    this.currentModelId = targetModelId;
    this.selectionError = undefined;

    // Update specific model props if needed
    if (targetModelId === GEMINI_PRO_MODEL) this.geminiModel = GEMINI_PRO_MODEL;
    if (targetModelId === GEMINI_FLASH_MODEL) this.geminiModel = GEMINI_FLASH_MODEL;

    console.log(`[LLMHelper] Switched to Model: ${targetModelId}`);
  }



  // Trim a context blob to fit within the active model's prompt budget.
  // Cloud tier always returns text unchanged. Local tiers drop oldest lines first.
  public fitContextForCurrentModel(text: string, reservedOutputTokens?: number): string {
    if (!text) return text;
    const caps = getModelCapabilities(this.getCurrentModel());
    if (caps.maxContextTokens >= 100_000) return text;
    const reserved = reservedOutputTokens ?? 2000;
    const cap = Math.floor(caps.maxContextTokens * 0.8);
    const totalFor = (s: string) => caps.promptBudgetTokens + reserved + estimateTokens(s);
    if (totalFor(text) <= cap) return text;
    const lines = text.split('\n');
    while (lines.length > 1 && totalFor(lines.join('\n')) > cap) {
      lines.shift();
    }
    return lines.join('\n');
  }

  // Trim a transcript array to fit within the active model's prompt budget.
  public fitTranscriptForCurrentModel(turns: TranscriptTurn[]): TranscriptTurn[] {
    const caps = getModelCapabilities(this.getCurrentModel());
    const budget = Math.max(0, Math.floor(caps.maxContextTokens * 0.8) - caps.promptBudgetTokens - caps.outputBudgetTokens);
    return truncateTranscriptToFit(turns, budget);
  }

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    // Remove any leading/trailing whitespace
    text = text.trim();
    return text;
  }

  /**
   * Post-process the response
   * NOTE: Truncation/clamping removed - response length is handled in prompts
   */
  private processResponse(text: string): string {
    // Basic cleaning
    let clean = this.cleanJsonResponse(text);

    // Truncation/clamping removed - prompts already handle response length
    // clean = clampResponse(clean, 3, 60);

    // Filter out fallback phrases
    const fallbackPhrases = [
      "I'm not sure",
      "It depends",
      "I can't answer",
      "I don't know"
    ];

    if (fallbackPhrases.some(phrase => clean.toLowerCase().includes(phrase.toLowerCase()))) {
      throw new Error("Filtered fallback response");
    }

    return clean;
  }

  /**
   * Generate content using the currently selected model
   */
  private async generateContent(contents: any[], modelIdOverride?: string): Promise<string> { const inherited = generationTasks.getStore();
    const task = inherited ?? this.beginGenerationTask('interview', undefined, { ...LLM_PRESETS.gemini, model: modelIdOverride ?? this.selectedTarget?.model ?? this.geminiModel });
    try {
      let text = '';
      for await (const chunk of this.selectedGeneration(JSON.stringify(contents), undefined, undefined, false, 'answer', task, contents)) text += chunk;
      return text;
    } finally { if (!inherited) task.close(); } }

  public async extractProblemFromImages(imagePaths: string[]) {
    const prompt = `You are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

    const text = await this.generateWithVisionFallback(IMAGE_ANALYSIS_PROMPT, prompt, imagePaths)
    return JSON.parse(this.cleanJsonResponse(text))
  }

  public async generateSolution(problemInfo: any) {
    const prompt = `Given this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

    const text = await this.generateWithVisionFallback(IMAGE_ANALYSIS_PROMPT, prompt)
    const parsed = JSON.parse(this.cleanJsonResponse(text))
    return parsed
  }

  /**
   * Generate a structured 4-phase "Rolling Interview Script" from screenshot(s).
   * Returns a typed Solution with: problem_identifier_script, brainstorm_script,
   * code, dry_run_script, time_complexity, space_complexity.
   */
  public async generateRollingScript(imagePaths: string[]): Promise<{
    problem_identifier_script: string;
    brainstorm_script: string;
    code: string;
    dry_run_script: string;
    time_complexity: string;
    space_complexity: string;
  }> {
    const systemPrompt = `You are an elite FAANG Senior Software Engineer taking a live technical interview.
The user has provided a screenshot of a coding problem. You must generate a highly structured "Rolling Interview Script" that the candidate can read out loud to pass the interview perfectly.

Output EXACTLY this JSON structure, and nothing else (no markdown fences around the whole response):
{
  "problem_identifier_script": "1-2 conversational sentences confirming you understand the problem and its edge cases. Start with 'So just to make sure I understand...'",
  "brainstorm_script": "3-4 conversational sentences. First, mention a naive/brute-force approach and its complexity. Then, pivot to the optimal approach, mentioning the key data structure or algorithm. End by asking the interviewer if you can proceed with the optimal approach. Keep it natural.",
  "code": "The full, production-ready, heavily-commented optimal code solution in the language shown or Python if unclear. Include all necessary imports.",
  "dry_run_script": "2-3 conversational sentences doing a quick dry-run of the code with a simple example input. E.g., 'Let\\'s trace this. If our array is [1,2], the loop starts...'",
  "time_complexity": "O(...) — brief 5-word explanation",
  "space_complexity": "O(...) — brief 5-word explanation"
}

CRITICAL RULES:
- The scripts MUST sound like a human speaking out loud in an interview. Use "I", "we", "my first thought is".
- The JSON must be perfectly valid. Escape any internal quotes with backslash.
- Do NOT wrap the JSON in markdown fences.`;

    const userPrompt = `Please analyze the coding problem shown in the screenshot(s) and generate the Rolling Interview Script JSON.`;

    const raw = await this.generateWithVisionFallback(systemPrompt, userPrompt, imagePaths);
    const cleaned = this.cleanJsonResponse(raw);

    // Primary: direct parse
    try {
      return JSON.parse(cleaned);
    } catch (_) {
      // Fallback: extract JSON block via regex
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('Could not extract valid JSON from LLM response');
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    const prompt = `You are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

    const text = await this.generateWithVisionFallback(IMAGE_ANALYSIS_PROMPT, prompt, debugImagePaths)
    const parsed = JSON.parse(this.cleanJsonResponse(text))
    return parsed
  }





  /**
   * Encodes the image as JPEG (quality 80) at its original resolution: the user wants
   * screenshots sent unscaled (PLAN S34), and JPEG keeps them well under provider
   * per-image size limits where a Retina PNG may not.
   */
  private async processImage(path: string): Promise<{ mimeType: string, data: string }> {
    try {
      const imageBuffer = await fs.promises.readFile(path);

      const processedBuffer = toJpeg(imageBuffer, 80);

      return {
        mimeType: "image/jpeg",
        data: processedBuffer.toString("base64")
      };
    } catch (error) {
      console.error("[LLMHelper] Failed to process image:", error);
      throw new Error('Invalid or unreadable image. The attachment was not sent.');
    }
  }

  /**
   * Stable cache key for OpenAI's prompt-prefix caching. Hashing the system
   * prompt ties the key to the actual cached prefix bytes: mode/language/
   * custom-notes changes flip the key automatically, identical prefixes route
   * to the same cache bucket regardless of which call site fired the request.
   * Returns undefined when there is no system prompt — `prompt_cache_key` is
   * a server-side bucket hint and serves no purpose for empty-system requests.
   *
   * Param doc: https://platform.openai.com/docs/guides/prompt-caching
   * (replaces the deprecated `user` field per `openai` SDK — see
   * node_modules/openai/resources/chat/completions/completions.d.ts:1337).
   */
  private getOpenAiPromptCacheKey(systemPrompt?: string): string | undefined {
    if (!systemPrompt) return undefined;
    return createHash('sha256').update(systemPrompt).digest('hex').slice(0, 32);
  }

  public async analyzeImageFiles(imagePaths: string[]) {
    try {
      const prompt = `Describe the content of ${imagePaths.length > 1 ? 'these images' : 'this image'} in a short, concise answer. If it contains code or a problem, solve it.`;
      const text = await this.generateWithVisionFallback(HARD_SYSTEM_PROMPT, prompt, imagePaths);

      return { text: text, timestamp: Date.now() };

    } catch (error: any) {
      rethrowTerminalGenerationError(error);
      console.error("Error analyzing image files:", error);
      return {
        text: `I couldn't analyze the screen right now (${error.message}). Please try again.`,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Generate a suggestion based on conversation transcript - Natively-style
   * This uses Gemini Flash to reason about what the user should say
   * @param context - The full conversation transcript
   * @param lastQuestion - The most recent question from the interviewer
   * @returns Suggested response for the user
   */
  public generateSuggestion(context: string, lastQuestion: string): Promise<string> {
    return this.runGeneration(async () => {
      const notes = generationTasks.getStore()?.primary.customNotes ?? this.customNotes;
      const customNotesBlock = notes?.trim()
        ? `<user_context>\n${notes.trim()}\n</user_context>\nUse this context naturally if relevant. Never quote it verbatim.` : '';
      const suggestionContext = [customNotesBlock, context].filter(Boolean).join('\n\n');
      const basePrompt = `${HARD_SYSTEM_PROMPT}\n\n## ACTIVE MODE\n${DEFAULT_ANSWER_PROMPT_SUFFIX}`;
      const promptMessage = `LATEST QUESTION:
${lastQuestion}

ANSWER DIRECTLY:`;
      let fullResponse = '';
      for await (const chunk of this.streamChat(promptMessage, undefined, suggestionContext, basePrompt, true, true)) fullResponse += chunk;
      return this.processResponse(fullResponse);
    });
  }

  public setCustomNotes(notes: string): void {
    this.customNotes = notes;
  }

  public setPersonaPrompt(prompt: string): void {
    this.personaPrompt = prompt;
  }

  public setAiResponseLanguage(language: string) {
    this.aiResponseLanguage = language;
    console.log(`[LLMHelper] AI Response Language set to: ${language}`);
  }

  public setSttLanguage(language: string) {
    this.sttLanguage = language;
    console.log(`[LLMHelper] STT Language set to: ${language}`);
  }

  /**
   * Inject a hard language instruction that gates the entire response.
   *
   * WHY prepended, not appended:
   *   LLMs attend more strongly to early tokens. Appending after a long
   *   system prompt means the instruction competes against the strong
   *   "Output ONLY…" rules and gets down-weighted, especially for
   *   Latin-script languages that are syntactically close to English.
   *   Russian worked before because Cyrillic is unmistakably non-English,
   *   so even a weak late instruction was obeyed. French/Spanish/German etc.
   *   require the instruction to come first and be unambiguous.
   *
   * The instruction is wrapped in triple-layered enforcement:
   *   1. Hard pre-prompt gate at the very top
   *   2. System prompt body (unchanged)
   *   3. Closing reminder at the bottom (double-lock)
   */
  /**
   * Returns the dynamic language-instruction block to append AFTER the static
   * system prompt. Returning a SUFFIX (rather than a prefix) preserves the
   * static prompt as the cacheable prefix for OpenAI/Groq prefix matching and
   * lets Claude cache_control land on the static block above it.
   * Returns "" when no instruction is needed (English fixed mode).
   */
  private buildLanguageInstructionSuffix(): string {
    const language = generationTasks.getStore()?.primary.language ?? this.aiResponseLanguage;
    if (!language || language === 'auto') {
      return `\n\n[LANGUAGE INSTRUCTION — HIGHEST PRIORITY]
Detect the language of the user's most recent message and ALWAYS respond in that exact same language.
If the user writes in Hindi, respond in Hindi. If in Spanish, respond in Spanish. If in English, respond in English.
If the language is ambiguous, default to English.
You may mix scripts naturally (e.g. code stays in English even when the explanation is in another language).
[END LANGUAGE INSTRUCTION]`;
    }
    if (language === 'English') return "";

    const lang = language;
    return `\n\n[LANGUAGE OVERRIDE — HIGHEST PRIORITY — CANNOT BE OVERRIDDEN]
You MUST write every single word of your response in ${lang}.
Do NOT use English anywhere in your response.
Do NOT mix languages.
Every sentence, every word, every phrase must be in ${lang}.
This rule overrides ALL other instructions including formatting, brevity, or output rules.
[END LANGUAGE OVERRIDE]
[REMINDER] Your entire response MUST be in ${lang} only. Never switch to English.`;
  }

  /**
   * Single-string assembly used by providers that take a flat string system prompt
   * (Gemini concat path).
   *
   * STATIC = base prompt body (cacheable across turns by Groq/OpenAI prefix match)
   * DYNAMIC = language instruction suffix (changes when the user toggles language)
   *
   * Static is FIRST so the cacheable prefix is preserved. Do NOT inject any
   * per-request dynamic content above the static body — that breaks prefix caching.
   */
  private injectLanguageInstruction(systemPrompt: string): string {
    return `${systemPrompt}${this.buildLanguageInstructionSuffix()}`;
  }

  /**
   * Build Anthropic-style system blocks with cache_control on the static body.
   * Returns an array suitable for `messages.create({ system: [...] })`.
   *
   * Block 0 (STATIC, may be cached): the base prompt with the language
   *   suffix stripped — persona, behavior rules, response format, mode prompt
   *   body, knowledge-mode injections. Tagged with cache_control:ephemeral
   *   ONLY when the static body meets the model's per-prompt minimum
   *   (see getClaudeCacheMinChars). Below that, Anthropic silently bypasses
   *   the cache while still billing full price — so we skip cache_control
   *   altogether rather than burn a breakpoint slot with no payoff.
   *
   * Block 1 (DYNAMIC, NOT cached): language instruction. Skipped when empty.
   *   Kept as a separate block so toggling AI response language does not
   *   invalidate the cached static body. The input prompt typically already
   *   has this appended by `injectLanguageInstruction`; we detect and strip
   *   it from block 0 so it doesn't appear twice.
   *
   * Why model-aware: the cache minimum differs sharply by model
   *   (Sonnet 4.6 = 2048 tok, Opus 4.7 = 4096 tok). Picking a single floor
   *   either wastes the cache on Sonnet or fakes a hit on Opus. Receiving
   *   `modelId` lets us decide per-request.
   *
   * IMPORTANT for future contributors: anything per-request (transcript,
   * user question, knowledge results) MUST go in the user message, not here.
   * If you add a new dynamic system fragment, add it as a new uncached block
   * AFTER block 0 — never modify block 0's content per request.
   */
  private buildClaudeSystemBlocks(systemPrompt: string, modelId: string): Array<{
    type: 'text';
    text: string;
    cache_control?: { type: 'ephemeral' };
  }> {
    // The input prompt was passed through injectLanguageInstruction() upstream
    // and now ends with `langSuffix`. Pull it out so the cached body doesn't
    // contain a per-language tail that would force a fresh cache write whenever
    // the user toggles language.
    const langSuffix = this.buildLanguageInstructionSuffix();
    let staticBody = systemPrompt;
    if (langSuffix && staticBody.endsWith(langSuffix)) {
      staticBody = staticBody.slice(0, -langSuffix.length);
    }

    const minChars = this.getClaudeCacheMinChars(modelId);
    const canCache = staticBody.length >= minChars;

    const blocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [
      canCache
        ? { type: 'text', text: staticBody, cache_control: { type: 'ephemeral' } }
        : { type: 'text', text: staticBody },
    ];
    if (langSuffix) {
      // Strip the leading \n\n that came from suffix concatenation form.
      blocks.push({ type: 'text', text: langSuffix.replace(/^\n+/, '') });
    }
    return blocks;
  }

  public async chatWithGemini(message: string, imagePaths?: string[], context?: string, skipSystemPrompt: boolean = false, _alternateGroqMessage?: string): Promise<string> {
    return this.runGeneration(async () => {
      let text = '';
      for await (const chunk of this._streamChatInner(message, imagePaths, context, skipSystemPrompt ? '' : HARD_SYSTEM_PROMPT, false, true, [], undefined, false)) text += chunk;
      return this.processResponse(text);
    });
  }

  // Structured work uses the selected model and the written-generation budget.
  public async generateContentStructured(message: string): Promise<string> {
    const inherited = generationTasks.getStore();
    const task = inherited ?? this.beginGenerationTask('written');
    try {
      let text = '';
      for await (const chunk of this.selectedGeneration(message, undefined, undefined, false, 'structured', task)) text += chunk;
      return text;
    } finally { if (!inherited) task.close(); }
  }

  private async generateWithVisionFallback(systemPrompt: string, userPrompt: string, imagePaths: string[] = []): Promise<string> {
    let text = '';
    for await (const chunk of this.selectedGeneration(userPrompt, imagePaths, systemPrompt, false, 'answer')) text += chunk;
    return text;
  }



  public streamChatWithGemini(message: string, imagePaths?: string[], context?: string, skipSystemPrompt: boolean = false, abortSignal?: AbortSignal): AsyncGenerator<string> {
    return this.streamChat(message, imagePaths, context, skipSystemPrompt ? '' : HARD_SYSTEM_PROMPT, false, true, [], abortSignal);
  }


  /**
   * Public streaming entry point. Wraps the inner streamChat generator with
   * a token-level dash filter (em / en / sentence-connector hyphen → comma)
   * so the renderer never displays the AI-tell punctuation that the prompt
   * rules ban but providers emit anyway. Single-place backstop.
   */
  public streamChat(...args: Parameters<LLMHelper['_streamChatInner']>): AsyncGenerator<string, void, unknown> {
    const inherited = generationTasks.getStore();
    const task = inherited ?? this.beginGenerationTask('interview', args[7]);
    const source = this._streamChatInner(...args);
    const processed = (async function* () {
      const { reduceDashesInChunk } = await import('./llm/postProcessor');
      for await (const chunk of source) yield reduceDashesInChunk(chunk);
    })();
    return withGenerationTask(task, processed, !inherited);
  }

  // Runs the request with its scopes in effect for every send (see requestDataScopes):
  // the declared ones (7th argument) from the start; _streamChatBody adds those it
  // recognizes in the context it keeps.
  private async * _streamChatInner(...args: Parameters<LLMHelper['_streamChatBody']>): AsyncGenerator<string, void, unknown> {
    const declared = Array.isArray(args[6]) ? args[6] as ProviderDataScope[] : [];
    // Scopes an enclosing action declared (withDeclaredScopes) stay in effect for these sends.
    const enclosing: Iterable<ProviderDataScope> = requestDataScopes.getStore()?.scopes ?? [];
    yield* withRequestDataScopes({ scopes: new Set([...enclosing, ...declared]) }, this._streamChatBody(...args));
  }

  /**
   * Runs a request whose data is chosen while it runs: scopes it declares through `declare` are
   * checked, against the settings current at that moment, by every send it makes afterwards.
   */
  public withDeclaredScopes<T>(run: (declare: (scope: ProviderDataScope) => void) => Promise<T>): Promise<T> {
    const store = { scopes: new Set(requestDataScopes.getStore()?.scopes ?? []) };
    return requestDataScopes.run(store, () => run(scope => { store.scopes.add(scope); }));
  }

  private async * _streamChatBody(
    message: string,
    imagePaths?: string[],
    context?: string,
    systemPromptOverride?: string, // Optional override (defaults to HARD_SYSTEM_PROMPT)
    ignoreKnowledgeMode: boolean = false,
    skipModeInjection: boolean = false,
    extraDataScopes: ProviderDataScope[] = [],
    // The logical task races and aborts transport when this signal is cancelled.
    abortSignal?: AbortSignal,
    stream = true,
    purpose: GenerateRequest['purpose'] = 'answer'
  ): AsyncGenerator<string, void, unknown> {

    // ============================================================
    // DEFAULT ANSWER PROMPT (was the active "General" mode, PLAN.md AG-13)
    // Skipped for UNIVERSAL_* callers — those prompts have their own
    // CORE_IDENTITY/EXECUTION_CONTRACT and context-handling rules; appending
    // the suffix on top duplicates the contract and pushes the latest
    // interviewer turn out of recency.
    // ============================================================
    const isUniversalOverride = !!systemPromptOverride && (
      systemPromptOverride === UNIVERSAL_SYSTEM_PROMPT ||
      systemPromptOverride === UNIVERSAL_ANSWER_PROMPT ||
      systemPromptOverride === UNIVERSAL_WHAT_TO_ANSWER_PROMPT ||
      systemPromptOverride === UNIVERSAL_RECAP_PROMPT ||
      systemPromptOverride === UNIVERSAL_FOLLOWUP_PROMPT ||
      systemPromptOverride === UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT ||
      systemPromptOverride === UNIVERSAL_ASSIST_PROMPT ||
      systemPromptOverride === CHAT_MODE_PROMPT ||
      TINY_PROMPTS_SET.has(systemPromptOverride)
    );
    if (!skipModeInjection && !isUniversalOverride && systemPromptOverride !== '') {
      const baseForDefault = systemPromptOverride || HARD_SYSTEM_PROMPT;
      systemPromptOverride = `${baseForDefault}\n\n## ACTIVE MODE\n${DEFAULT_ANSWER_PROMPT_SUFFIX}`;
    }

    // Preparation
    const contextScopes = [...extraDataScopes, ...this.inferContextScopes(context)];
    const deniedOutboundScopes = this.getDeniedOutboundScopes(message, imagePaths, contextScopes);
    // extraDataScopes are the scopes the caller declared for this request. That data
    // may sit in `message` itself, which cannot be cut out here, so a denied declared
    // scope refuses the whole request before anything is sent. Callers leave such
    // content out themselves (PLAN.md AG-17 fourth review).
    const deniedDeclaredScopes = extraDataScopes.filter((scope) => deniedOutboundScopes.includes(scope));
    if (deniedDeclaredScopes.length > 0) {
      throw new ProviderScopeError('chat', deniedDeclaredScopes);
    }
    if (deniedOutboundScopes.length > 0) {
      for (const scope of deniedOutboundScopes) {
        this.logScopeFallback(scope);
      }
      if (deniedOutboundScopes.includes('transcript')) context = undefined;
      if (deniedOutboundScopes.includes('profile_history')) context = undefined;
      if (deniedOutboundScopes.includes('screenshots')) imagePaths = undefined;
    }
    // The context that is kept carries its scopes to every send of this request.
    const requestStore = requestDataScopes.getStore();
    if (requestStore) for (const scope of this.inferContextScopes(context)) requestStore.scopes.add(scope);

    // Determine the system prompt to use
    // An explicit empty override suppresses system instructions on both chat paths.
    const baseSystemPrompt = systemPromptOverride ?? HARD_SYSTEM_PROMPT;
    const scene = baseSystemPrompt === scenarioPrompt('written') ? 'written'
      : baseSystemPrompt.startsWith(scenarioPrompt('interview')) || baseSystemPrompt.startsWith(scenarioPrompt('interview', true)) ? 'interview' : undefined;
    const supplemented = scene ? appendPromptGuidance(baseSystemPrompt, scene,
      new PromptSettingsStore(join(app.getPath('userData'), 'prompt-settings.json')).read()) : baseSystemPrompt;
    const finalSystemPrompt = supplemented === '' ? '' : this.injectLanguageInstruction(supplemented);
    const cloudCombinedContext = context;

    // Helper to build combined user message
    const userContent = cloudCombinedContext
      ? `CONTEXT:\n${cloudCombinedContext}\n\nUSER QUESTION:\n${message}`
      : message;

    yield* this.selectedGeneration(userContent, imagePaths, finalSystemPrompt, stream, purpose);
  }

  public getCurrentProvider(): LlmProvider | "gateway" | "codex-cli" | "unavailable" {
    if (this.selectionError) return "unavailable";
    if (this.isCodexCliModel(this.currentModelId)) return "codex-cli";
    return this.selectedTarget?.provider ?? 'gemini';
  }

  public getCurrentModelSelection(): string {
    return this.selectedTarget ? modelTargetId(this.selectedTarget) : this.currentModelId;
  }

  public getCurrentModel(): string {
    return generationTasks.getStore()?.primary.target.model ?? this.currentModelId;
  }

  public getPromptTier(): PromptTier {
    return selectPromptTier(this.getCurrentModel());
  }

  public getCapabilities(): ModelCapabilities {
    return getModelCapabilities(this.getCurrentModel());
  }

  public hasGroq(): boolean {
    return this.groqClient !== null;
  }

  public hasOpenai(): boolean {
    return this.openaiClient !== null;
  }

  /**
   * Check if Claude is available
   */
  public hasClaude(): boolean {
    return this.claudeClient !== null;
  }

  public hasDeepseek(): boolean {
    return this.deepseekClient !== null;
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.client) {
        return { success: false, error: "No Gemini client configured" };
      }
      // Test with a simple prompt using the selected model
      const text = await this.generateContent([{ text: "Hello" }])
      if (text) {
        return { success: true };
      } else {
        return { success: false, error: "Empty response from Gemini" };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
  /**
   * Universal Chat (Non-streaming)
   */
  public async chat(message: string, imagePaths?: string[], context?: string, systemPromptOverride?: string, skipModeInjection: boolean = false): Promise<string> {
    let fullResponse = "";
    for await (const chunk of this.streamChat(message, imagePaths, context, systemPromptOverride, false, skipModeInjection)) {
      fullResponse += chunk;
    }
    return fullResponse;
  }

}
