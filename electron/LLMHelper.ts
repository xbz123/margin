import { GoogleGenAI } from "@google/genai"
import Groq from "groq-sdk"
import OpenAI from "openai"
import { LLM_PRESETS, modelTargetId, type LlmProvider, type ProviderConfiguration, type ModelTarget } from '../src/types/llmTarget';
import { effectiveProviderConfiguration, resolveModelTarget, validateProviderConfiguration } from './llm/llmTarget';
import { outboundFetch } from './services/outbound';
import Anthropic from "@anthropic-ai/sdk"
import fs from "fs"
import { AsyncLocalStorage } from "async_hooks"
import { createHash } from "crypto"
import sharp from "sharp"
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
import { GenerationResultError, rethrowTerminalGenerationError, type GenerateEvent, type GenerateRequest } from './llm/generateContract';
import { assertProviderDataScopes, getDeniedDataScopes, ProviderScopeError, type ProviderDataScope, type ProviderDataScopePolicy } from "./llm/ProviderRouter"
import type { TranscriptTurn } from "./llm/transcriptCleaner"
import { createProviderRateLimiters } from './services/RateLimiter';
import { CodexAuthSource } from './services/CodexAuthSource';
import { DEFAULT_CODEX_SOURCE_CONFIG, assertCodexConsent, codexImageTarget, isCodexSelection, validateCodexModel, validateCodexSourceConfig, type CodexSourceConfig } from '../src/types/codexSource';
import { GenerationTask, generateTask, generationTasks, withGenerationTask, awaitGeneration, type GenerationKind } from './llm/generateTask';
import { DEFAULT_GENERATION_POLICY, validateGenerationPolicy, type GenerationPolicy } from '../src/types/generationPolicy';
import { assertModelImageSupport } from '../src/types/modelImageSupport';

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
const GEMINI_FLASH_MODEL = "gemini-3.1-flash-lite-preview"
const GEMINI_PRO_MODEL = "gemini-3.1-pro-preview"
const GROQ_MODEL = "llama-3.3-70b-versatile"
const CLAUDE_MODEL = "claude-sonnet-4-6"
const DEEPSEEK_MODEL = "deepseek-v4-flash"
const MAX_OUTPUT_TOKENS = 65536

// Simple prompt for image analysis (not interview copilot - kept separate)
const IMAGE_ANALYSIS_PROMPT = `Analyze concisely. Be direct. No markdown formatting. Return plain text only.`

export class LLMHelper {
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
    return { requestId: task.requestId, provider: task.actualTarget.target.provider,
      model: task.actualTarget.target.model, status: task.terminalStatus, attempts: task.sends, partial: task.hasText && task.terminalStatus !== 'completed',
      ...(task.signal.reason?.name === 'GenerationTimeoutError' ? { timeout: task.signal.reason.deadline as 'first-token' | 'total' } : {}),
      usedImageInput: task.imageCount > 0, imageCount: task.imageCount };
  }

  public runGeneration<T>(factory: () => Promise<T>, kind: GenerationKind = 'interview', signal?: AbortSignal, supplied?: GenerationTask<any>): Promise<T> {
    const inherited = generationTasks.getStore();
    const task = supplied ?? inherited ?? this.beginGenerationTask(kind, signal);
    return (async () => { task.check(); return await awaitGeneration(task, Promise.resolve().then(() => generationTasks.run(task, factory))); })()
      .catch(error => { if (!task.signal.aborted && !['refused', 'incomplete', 'empty'].includes(task.terminalStatus ?? '')) task.terminalStatus = 'failed'; throw error; })
      .finally(() => { if (task !== inherited) task.close(); });
  }

  public runGenerationStream<T>(factory: () => AsyncGenerator<T>, kind: GenerationKind = 'interview', signal?: AbortSignal, supplied?: GenerationTask<any>): AsyncGenerator<T> {
    const inherited = generationTasks.getStore();
    const task = supplied ?? inherited ?? this.beginGenerationTask(kind, signal);
    const source = (async function* () { yield* factory(); })();
    return withGenerationTask(task, source, task !== inherited);
  }

  public beginGenerationTask(kind: GenerationKind = 'interview', signal?: AbortSignal, primary?: ModelTarget): GenerationTask<GenerationTargetSnapshot> {
    if (this.generationClosed) throw new DOMException('Application quit', 'AbortError');
    const configs = this.providerConfigurations ?? LLM_PRESETS;
    const context = { language: this.aiResponseLanguage ?? 'auto', customNotes: this.customNotes ?? '', personaPrompt: this.personaPrompt ?? '', fastMode: this.groqFastTextMode };
    const snapshot = (target: ModelTarget): GenerationTargetSnapshot => ({ kind: 'api', target: { ...target, baseUrl: effectiveProviderConfiguration(target).baseUrl },
      language: this.aiResponseLanguage ?? 'auto', customNotes: this.customNotes ?? '', personaPrompt: this.personaPrompt ?? '', fastMode: this.groqFastTextMode,
      custom: effectiveProviderConfiguration(configs[target.provider]).custom,
      client: target.provider === 'gemini' ? this.client : target.provider === 'groq' ? this.groqClient
        : target.provider === 'openai' ? this.openaiClient : target.provider === 'claude' ? this.claudeClient : this.deepseekClient });
    const codexSnapshot = (selection: string, fast = false, imageConfirmation?: string, backup = false): GenerationTargetSnapshot => {
      const codex = this.getCodexCliConfig(), model = fast ? codex.fastModel : selection.startsWith('codex-cli:') ? validateCodexModel(selection.slice(10)) : codex.model;
      return { ...context, kind: 'codex', target: { provider: 'codex-cli', protocol: 'responses', model }, codex,
        imageSupportConfirmedFor: backup ? imageConfirmation : fast ? codex.fastImageSupportConfirmedFor : model === codex.model ? codex.imageSupportConfirmedFor : model === codex.fastModel ? codex.fastImageSupportConfirmedFor : undefined };
    };
    const selected = !primary && this.isCodexCliModel(this.currentModelId ?? '') ? codexSnapshot(this.currentModelId, this.groqFastTextMode)
      : snapshot(primary ?? this.selectedTarget ?? resolveModelTarget(this.currentModelId ?? GEMINI_FLASH_MODEL, configs));
    const policy = this.getGenerationPolicy();
    const backup = kind !== 'compatibility' && policy.backupModel ? isCodexSelection(policy.backupModel)
      ? codexSnapshot(policy.backupModel, false, policy.backupImageSupportConfirmedFor, true)
      : snapshot({ ...resolveModelTarget(policy.backupModel, configs), imageSupportConfirmedFor: policy.backupImageSupportConfirmedFor }) : undefined;
    if (backup && backup.kind === selected.kind && backup.target.provider === selected.target.provider && backup.target.model === selected.target.model) throw new Error('Primary and backup model must differ.');
    const task = new GenerationTask(selected, backup, policy, kind, signal);
    this.activeGenerationTasks ??= new Set();
    if (!task.signal.aborted) this.activeGenerationTasks.add(task);
    task.signal.addEventListener('abort', () => this.activeGenerationTasks.delete(task), { once: true });
    return task;
  }

  private selectedGeneration(userContent: string, imagePaths: string[] | undefined, systemInstruction: string | undefined,
    stream: boolean, purpose: GenerateRequest['purpose'], supplied?: GenerationTask<GenerationTargetSnapshot>, preparedContents?: any[], outputLimit?: number): AsyncGenerator<string> {
    const inherited = supplied ?? generationTasks.getStore();
    const task = inherited ?? this.beginGenerationTask(purpose === 'summary' ? 'background' : purpose === 'structured' ? 'written' : 'interview');
    const self = this;
    const source = (async function* () {
      const contents: any[] = preparedContents ?? [{ text: userContent }];
      for (const path of imagePaths ?? []) {
        task.check();
        const image = await awaitGeneration(task, self.processImage(path));
        contents.push({ inlineData: image });
      }
      const dataScopes = self.scopesForPayload(userContent, /"inlineData"/.test(JSON.stringify(contents)) ? ['inline-image'] : imagePaths);
      let cacheReference: string | undefined;
      const codexSession = (self.codexAuthSource ??= new CodexAuthSource()).session(() => { task.check(); assertCodexConsent(self.getCodexCliConfig()); assertProviderDataScopes('codex', dataScopes, self.getProviderScopePolicy()); });
      const options = { get cacheReference() { return cacheReference; }, invalidateCache: () => {
        if (cacheReference) self.geminiPromptCache.invalidate(cacheReference);
      }, recoverAuthentication: (snapshot: GenerationTargetSnapshot, error: unknown) => snapshot.kind === 'codex' ? codexSession.recover(error) : Promise.resolve(false) };
      try { for await (const event of generateTask(task, (snapshot: GenerationTargetSnapshot, signal, recovery) => (async function* () {
        const { target } = snapshot;
        const imageCount = contents.reduce((count, part) => count + (part.inlineData ? 1 : 0) + (part.parts?.filter((item: any) => item.inlineData).length ?? 0), 0);
        if (snapshot.kind === 'codex') {
          const assertImages = () => { if (imageCount && snapshot.imageSupportConfirmedFor !== codexImageTarget(target.model)) throw new Error('Image support is unconfirmed for this Codex model and backend. Confirm it in Settings; attachments were kept.'); };
          assertImages();
          yield* codexSession.generate(snapshot.codex, { model: target.model, contents, systemInstruction, signal }, () => {
            task.check(); assertCodexConsent(self.getCodexCliConfig()); assertProviderDataScopes('codex', dataScopes, self.getProviderScopePolicy()); assertImages();
            task.claimSend(snapshot); task.imageCount = imageCount;
          }); return;
        }
        const { client, custom } = snapshot;
        const apiTarget = snapshot.target;
        if (imageCount) assertModelImageSupport(apiTarget);
        if (!client) throw new Error(`${target.provider} client not initialized`);
        self.assertOutboundScopes(apiTarget.provider, userContent, imagePaths);
        const limiter = self.rateLimiters?.[apiTarget.provider];
        if (limiter) await awaitGeneration(task, limiter.acquire(signal));
        cacheReference = undefined;
        if (apiTarget.provider === 'gemini' && !custom && systemInstruction && !recovery) {
          cacheReference = (await awaitGeneration(task, self.geminiPromptCache.getOrCreate(client, target.model, systemInstruction,
            () => self.assertOutboundScopes(apiTarget.provider, userContent, imagePaths), signal))) ?? undefined;
        }
        yield* generateOnce({ protocol: target.protocol, model: target.model, purpose, contents,
          systemInstruction, cacheReference, stream, signal, dataScopes,
          maxOutputTokens: outputLimit ?? (target.provider === 'claude' ? self.getClaudeMaxOutput(target.model) : ['deepseek', 'groq'].includes(target.provider) ? 8192 : MAX_OUTPUT_TOKENS),
          ...(['gemini', 'groq'].includes(target.provider) ? { temperature: purpose === 'summary' ? 0.3 : 0.4 } : {}),
          providerOptions: {
            outputTokenField: ['groq', 'deepseek', 'claude'].includes(target.provider) ? 'max_tokens' : 'max_completion_tokens',
            ...(target.provider === 'openai' && !custom && systemInstruction ? { prompt_cache_key: self.getOpenAiPromptCacheKey(systemInstruction) } : {}),
            ...(target.provider === 'claude' && !custom && systemInstruction ? { systemBlocks: self.buildClaudeSystemBlocks(systemInstruction, target.model) } : {}),
          },
        }, { client, beforeSend: () => {
          assertProviderDataScopes(apiTarget.provider, dataScopes, self.getProviderScopePolicy());
          if (imageCount) assertModelImageSupport(apiTarget);
          task.claimSend(snapshot);
          task.imageCount = contents.reduce((count, part) => count + (part.inlineData ? 1 : 0)
            + (part.parts?.filter((item: any) => item.inlineData).length ?? 0), 0);
        } });
      })(), options)) {
        if (event.type === 'delta') yield event.text;
        else { if (event.status === 'cancelled') task.check(); self.generationFinish(event, task.hasText); }
      } } finally { codexSession.dispose(); }
    })();
    return withGenerationTask(task, source, !inherited);
  }
  private providerConfigurations: Record<LlmProvider, ProviderConfiguration> = { ...LLM_PRESETS };
  private selectedTarget: ModelTarget | undefined;
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
    // Keyword fallback for context a window sends itself. The meeting chat's context is
    // built in the main process with explicit scopes (meetingChatContext.ts); its
    // headings are recognized here too (PLAN.md AG-17 fifth review).
    if (/<meeting_history|USER-PROVIDED PERSONA CONTEXT|<user_context|\[RECENT ASSISTANT RESPONSES\]|^MEETING: /im.test(context)) scopes.push('profile_history');
    if (/<post_call_summary|meeting summary|silent meeting summarizer|silent meeting note-taker|^(?:SUMMARY|KEY POINTS|ACTION ITEMS):/im.test(context)) scopes.push('post_call_summary');
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




  public configureProvider(value: ProviderConfiguration, key?: string): void {
    const config = effectiveProviderConfiguration(value);
    const nextConfigurations = { ...(this.providerConfigurations ?? LLM_PRESETS), [config.provider]: validateProviderConfiguration(value) };
    const nextTarget = this.selectedTarget?.provider === config.provider ? value : this.selectedTarget;
    const backup = this.getGenerationPolicy().backupModel;
    if (backup && nextTarget && modelTargetId(nextTarget) === modelTargetId(resolveModelTarget(backup, nextConfigurations))) {
      throw new Error('Primary and backup model must differ. Change the backup first.');
    }
    this.providerConfigurations = nextConfigurations;
    const apiKey = key?.trim() || null;
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
      this.groqClient = apiKey ? config.custom
        ? new OpenAI({ apiKey, baseURL: config.baseUrl, fetch: outboundFetch, maxRetries: 0 })
        : new Groq({ apiKey, baseURL: 'https://api.groq.com', fetch: outboundFetch, maxRetries: 0 }) : null;
    } else {
      this.deepseekApiKey = apiKey;
      this.deepseekClient = apiKey ? new OpenAI({ apiKey, baseURL: config.baseUrl, fetch: outboundFetch, maxRetries: 0 }) : null;
    }
    if (this.selectedTarget?.provider === config.provider) {
      this.selectedTarget = validateProviderConfiguration(value);
      this.currentModelId = this.selectedTarget.model;
      if (config.provider === 'gemini') this.geminiModel = this.selectedTarget.model;
    }
    this.refreshDiscoveryKeys();
  }

  private refreshDiscoveryKeys(): void {
    const configs = this.providerConfigurations ?? LLM_PRESETS;
    this.modelVersionManager?.setApiKeys({
      openai: effectiveProviderConfiguration(configs.openai).custom ? null : this.openaiApiKey,
      gemini: effectiveProviderConfiguration(configs.gemini).custom ? null : this.apiKey,
      claude: effectiveProviderConfiguration(configs.claude).custom ? null : this.claudeApiKey,
      groq: effectiveProviderConfiguration(configs.groq).custom ? null : this.groqApiKey,
    });
  }

  public async testProviderConnection(provider: LlmProvider): Promise<string> {
    const target = { ...(this.providerConfigurations ?? LLM_PRESETS)[provider] };
    const task = this.beginGenerationTask('compatibility', undefined, target);
    try {
      let text = '';
      for await (const chunk of this.selectedGeneration('Hello', undefined, undefined, false, 'compatibility', task, undefined, 64)) text += chunk;
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

  constructor(apiKey?: string, groqApiKey?: string, openaiApiKey?: string, claudeApiKey?: string, deepseekApiKey?: string) {

    // Initialize rate limiters
    this.rateLimiters = createProviderRateLimiters();

    // Initialize model version manager
    this.modelVersionManager = new ModelVersionManager();

    for (const [provider, key] of Object.entries({ gemini: apiKey, groq: groqApiKey, openai: openaiApiKey, claude: claudeApiKey, deepseek: deepseekApiKey })) {
      if (key) this.configureProvider(LLM_PRESETS[provider as LlmProvider], key);
    }
  }


  public setApiKey(apiKey: string) {
    this.configureProvider((this.providerConfigurations ?? LLM_PRESETS).gemini, apiKey);
  }

  public setGroqApiKey(apiKey: string) {
    this.configureProvider((this.providerConfigurations ?? LLM_PRESETS).groq, apiKey);
  }

  public setOpenaiApiKey(apiKey: string) {
    this.configureProvider((this.providerConfigurations ?? LLM_PRESETS).openai, apiKey);
  }

  public setClaudeApiKey(apiKey: string) {
    this.configureProvider((this.providerConfigurations ?? LLM_PRESETS).claude, apiKey);
  }

  public setDeepseekApiKey(apiKey: string) {
    this.configureProvider((this.providerConfigurations ?? LLM_PRESETS).deepseek, apiKey);
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

  private generationSelectionId(id: string, primary = false, config = this.getCodexCliConfig()): string {
    if (isCodexSelection(id)) return `codex-cli:${primary && this.groqFastTextMode ? config.fastModel : id.startsWith('codex-cli:') ? validateCodexModel(id.slice(10)) : config.model}`;
    return modelTargetId(resolveModelTarget(id, this.providerConfigurations ?? LLM_PRESETS));
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

  // Tripped when local Groq returns 401 (invalid key). Prevents re-trying every chat
  // turn for the rest of the session — saves ~200-500ms per turn. Reset on key update
  // via setGroqApiKey().

  public setModel(modelId: string) {
    // Map UI short codes to internal Model IDs
    let targetModelId = modelId;
    if (modelId === 'gemini') targetModelId = GEMINI_FLASH_MODEL;
    if (modelId === 'gemini-pro') targetModelId = GEMINI_PRO_MODEL;
    if (modelId === 'claude') targetModelId = CLAUDE_MODEL;
    if (modelId === 'llama') targetModelId = GROQ_MODEL;
    if (modelId === 'deepseek') targetModelId = DEEPSEEK_MODEL;
    if (isCodexSelection(targetModelId) && targetModelId.startsWith('codex-cli:')) validateCodexModel(targetModelId.slice(10));

    const selection = this.isCodexCliModel(targetModelId) ? undefined : resolveModelTarget(targetModelId, this.providerConfigurations ?? LLM_PRESETS);
    const backup = this.getGenerationPolicy().backupModel;
    this.validateGenerationTargets(targetModelId);
    if ((selection ? modelTargetId(selection) : targetModelId) !== this.getCurrentModelSelection()) {
      for (const task of this.activeGenerationTasks ?? []) task.controller.abort(new DOMException('Model selection changed', 'AbortError'));
    }
    if (!this.isCodexCliModel(targetModelId)) {
      this.selectedTarget = resolveModelTarget(targetModelId, this.providerConfigurations ?? LLM_PRESETS);
      targetModelId = this.selectedTarget.model;
    } else this.selectedTarget = undefined;
    this.currentModelId = targetModelId;

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
   * Generate content using Gemini 3 Flash (text reasoning)
   * Used by IntelligenceManager for mode-specific prompts
   * NOTE: Migrated from Pro to Flash for consistency
   */
  public async generateWithPro(contents: any[], purpose: GenerateRequest['purpose'] = 'answer'): Promise<string> { const inherited = generationTasks.getStore();
    const task = inherited ?? this.beginGenerationTask(purpose === 'summary' ? 'background' : 'interview', undefined, { ...LLM_PRESETS.gemini, model: GEMINI_PRO_MODEL });
    try {
      let text = '';
      for await (const chunk of this.selectedGeneration(JSON.stringify(contents), undefined, undefined, false, purpose, task, contents)) text += chunk;
      return text;
    } finally { if (!inherited) task.close(); } }

  /**
   * Generate content using Gemini 3 Flash (audio + fast multimodal)
   * CRITICAL: Audio input MUST use this model, not Pro
   */
  public async generateWithFlash(contents: any[], purpose: GenerateRequest['purpose'] = 'answer'): Promise<string> { const inherited = generationTasks.getStore();
    const task = inherited ?? this.beginGenerationTask(purpose === 'summary' ? 'background' : 'interview', undefined, { ...LLM_PRESETS.gemini, model: GEMINI_FLASH_MODEL });
    try {
      let text = '';
      for await (const chunk of this.selectedGeneration(JSON.stringify(contents), undefined, undefined, false, purpose, task, contents)) text += chunk;
      return text;
    } finally { if (!inherited) task.close(); } }

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
   * NEW: Helper to process image: resize to max 1536px and compress to JPEG 80%
   * drastically reduces token usage and upload time.
   */
  private async processImage(path: string): Promise<{ mimeType: string, data: string }> {
    try {
      const imageBuffer = await fs.promises.readFile(path);

      // Resize and compress
      const processedBuffer = await sharp(imageBuffer)
        .resize({
          width: 1536,
          height: 1536,
          fit: 'inside', // Maintain aspect ratio, max dimension 1536
          withoutEnlargement: true
        })
        .jpeg({ quality: 80 }) // 80% quality JPEG is much smaller than PNG
        .toBuffer();

      return {
        mimeType: "image/jpeg",
        data: processedBuffer.toString("base64")
      };
    } catch (error) {
      console.error("[LLMHelper] Failed to process image with sharp:", error);
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
    yield* withRequestDataScopes({ scopes: new Set(declared) }, this._streamChatBody(...args));
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
    if (!skipModeInjection && !isUniversalOverride) {
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
      if (deniedOutboundScopes.includes('post_call_summary')) context = undefined;
      if (deniedOutboundScopes.includes('screenshots')) imagePaths = undefined;
    }
    // The context that is kept carries its scopes to every send of this request.
    const requestStore = requestDataScopes.getStore();
    if (requestStore) for (const scope of this.inferContextScopes(context)) requestStore.scopes.add(scope);

    // Determine the system prompt to use
    // logic: if override provided, use it. otherwise use HARD_SYSTEM_PROMPT (which is the universal base)
    const baseSystemPrompt = systemPromptOverride || HARD_SYSTEM_PROMPT;
    const finalSystemPrompt = this.injectLanguageInstruction(baseSystemPrompt);
    const cloudCombinedContext = context;

    // Helper to build combined user message
    const userContent = cloudCombinedContext
      ? `CONTEXT:\n${cloudCombinedContext}\n\nUSER QUESTION:\n${message}`
      : message;

    yield* this.selectedGeneration(userContent, imagePaths, finalSystemPrompt, stream, purpose);
  }

  public getCurrentProvider(): LlmProvider | "codex-cli" {
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

  public async generateMeetingSummary(systemPrompt: string, context: string, _groqSystemPrompt?: string, extraDataScopes: ProviderDataScope[] = []): Promise<string> {
    const task = this.beginGenerationTask('background');
    try {
      if (!context.trim()) return '';
      const scopes: ProviderDataScope[] = ['transcript', 'post_call_summary', ...extraDataScopes];
      const denied = getDeniedDataScopes(scopes, this.getProviderScopePolicy());
      if (denied.length) { for (const scope of denied) this.logScopeFallback(scope); return ''; }
      return await requestDataScopes.run({ scopes: new Set(scopes) }, async () => {
        let text = '';
        for await (const chunk of this.selectedGeneration(`Context:\n${context}`, undefined, systemPrompt, false, 'summary', task)) text += chunk;
        return this.processResponse(text);
      });
    } catch (error) {
      if (!(error instanceof ProviderScopeError)) throw error;
      for (const scope of error.deniedScopes) this.logScopeFallback(scope);
      return '';
    } finally { task.close(); }
  }

  public async switchToGemini(apiKey?: string, modelId?: string): Promise<void> {
    if (modelId) {
      this.geminiModel = modelId;
    }

    if (apiKey) {
      this.setApiKey(apiKey);
    } else if (!this.client) {
      throw new Error("No Gemini API key provided and no existing client");
    }

    // console.log(`[LLMHelper] Switched to Gemini: ${this.geminiModel}`);
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
