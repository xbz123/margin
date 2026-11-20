import type { AnswerReasoningState, ReasoningChoice } from './answerReasoning';
import type { WrittenExamSettings, WrittenExamStatus, WrittenExamCapture } from './writtenExam';
import type { ProviderConfiguration, ProviderConfigurationSave, LlmProvider, AnswerProvider, GatewayConfiguration, GatewayConfigurationSave, GatewaySummary } from './llmTarget';
import type { GenerationPolicy } from './generationPolicy';
import type { CodexSourceConfig, CodexSourceUpdate, CodexSourceStatus } from './codexSource';
import type { CredentialDiscardResult, CredentialLoadStatus, CredentialSaveResult } from './credentialSave';
import type { UiLanguage, UiLanguageResult } from './uiLanguage';
import type { PendingUnsavedMeetingCode, UnsavedMeeting, UnsavedMeetingCommandResult } from './meetingSave';
import type { KeybindResult, WindowPreferenceResult } from './windowPreferences';

import type { DomesticSttProvider, DomesticSttPublicConfig, DomesticSttSettings } from './domesticStt';
import type { AudioCaptureFailedPayload } from './audioCaptureFailed';
export interface ElectronAPI {
  getPromptSettings: () => Promise<import('./promptSettings').PromptSettingsResult>;
  savePromptSettings: (input: { scene: import('./promptSettings').PromptScene; skillId: string | null; additional: string }) => Promise<import('./promptSettings').PromptSettingsResult>;
  clearPromptSettings: () => Promise<import('./promptSettings').PromptSettingsResult>;
  importPromptSkill: () => Promise<import('./promptSettings').PromptSettingsResult>;
  removePromptSkill: (id: string) => Promise<import('./promptSettings').PromptSettingsResult>;
  listLocalContext: () => Promise<import('./localContext').LocalContextResult>;
  clearLocalContext: () => Promise<import('./localContext').LocalContextResult>;
  addLocalContext: () => Promise<import('./localContext').LocalContextResult>;
  removeLocalContext: (id: string) => Promise<import('./localContext').LocalContextResult>;
  getDomesticStt: (provider: DomesticSttProvider) => Promise<DomesticSttPublicConfig>;
  saveDomesticStt: (provider: DomesticSttProvider, input: DomesticSttSettings) => Promise<CredentialSaveResult>;
  testDomesticStt: (provider: DomesticSttProvider) => Promise<{ success: boolean; error?: string }>;
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  onToggleExpand: (callback: () => void) => () => void
  getRecognitionLanguages: () => Promise<Record<string, any>>
  deleteScreenshot: (path: string) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onCaptureAndProcess: (
    callback: (data: { path: string; preview: string; speechActionId?: string }) => void
  ) => () => void
  takeScreenshot: () => Promise<{ path: string; preview: string }>
  takeSelectiveScreenshot: () => Promise<{ path: string; preview: string; cancelled?: boolean }>
  moveWindowLeft: () => Promise<void>
  moveWindowRight: () => Promise<void>
  moveWindowUp: () => Promise<void>
  moveWindowDown: () => Promise<void>
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>

  quitApp: () => Promise<void>
  toggleWindow: () => Promise<void>
  showWindow: (inactive?: boolean) => Promise<void>
  hideWindow: () => Promise<void>
  hideOverlay: () => Promise<void>
  getMeetingActive: () => Promise<boolean>
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => () => void
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void
  onEnsureExpanded: (callback: () => void) => () => void
  openExternal: (url: string) => Promise<void>
  // UX2: in-app TCC repair. macOS only; returns { ok, bundleId, results, message, promptRelaunch }.
  repairTccPermissions: () => Promise<{
    ok: boolean
    bundleId?: string
    results?: Array<{ service: string; ok: boolean; output: string }>
    promptRelaunch?: boolean
    error?: string
    message: string
  }>
  getWindowPreferences: () => Promise<WindowPreferenceResult[]>
  onWindowPreferenceResult: (callback: (result: WindowPreferenceResult) => void) => () => void
  setUndetectable: (state: boolean) => Promise<WindowPreferenceResult>
  getUndetectable: () => Promise<boolean>
  setOverlayMousePassthrough: (enabled: boolean) => Promise<WindowPreferenceResult>
  getOverlayMousePassthrough: () => Promise<boolean>
  setDisguise: (mode: 'terminal' | 'settings' | 'activity' | 'none') => Promise<WindowPreferenceResult>
  getDisguise: () => Promise<'none' | 'terminal' | 'settings' | 'activity'>
  setOpenAtLogin: (open: boolean) => Promise<{ success: boolean; error?: string }>
  getOpenAtLogin: () => Promise<boolean>
  onSettingsVisibilityChange: (callback: (isVisible: boolean) => void) => () => void
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>
  openSettingsTab: (tab: string) => Promise<void>
  onOpenSettingsTab: (callback: (tab: string) => void) => () => void

  // LLM Model Management
  getCurrentLlmConfig: () => Promise<{ provider: LlmProvider | "gateway" | "codex-cli" | "unavailable"; model: string }>
  testLlmConnection: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey?: string, expected?: ProviderConfiguration, model?: string) => Promise<{ success: boolean; error?: string }>
  testGatewayConnection: (id: string, expected?: GatewayConfiguration) => Promise<{ success: boolean; error?: string }>

  // API Key Management
  setProviderConfiguration: (value: ProviderConfigurationSave) => Promise<CredentialSaveResult>;
  setGatewayConfiguration: (value: GatewayConfigurationSave) => Promise<CredentialSaveResult & { gatewayId?: string }>;
  removeGateway: (id: string) => Promise<CredentialSaveResult>;
  getGenerationPolicy: () => Promise<GenerationPolicy>;
  setGenerationPolicy: (value: GenerationPolicy) => Promise<CredentialSaveResult>;
  removeProviderApiKey: (provider: AnswerProvider) => Promise<CredentialSaveResult>
  getCredentialLoadStatus: () => Promise<CredentialLoadStatus>
  discardUnreadableCredentials: () => Promise<CredentialDiscardResult>
  getStoredCredentials: () => Promise<{ providerConfigurations: Record<LlmProvider, ProviderConfiguration>; gateways?: GatewaySummary[]; providerAddressOverrides?: Partial<Record<LlmProvider, string>>; hasGeminiKey: boolean; hasGroqKey: boolean; hasOpenaiKey: boolean; hasClaudeKey: boolean; hasDeepseekKey: boolean; sttProvider: 'none' | 'groq' | 'openai' | 'soniox' | 'aliyun' | 'doubao'; hasSttGroqKey: boolean; hasSttOpenaiKey: boolean; groqSttModel?: string; sttTermPrompt?: string; hasSonioxKey?: boolean; geminiPreferredModel?: string; groqPreferredModel?: string; openaiPreferredModel?: string; claudePreferredModel?: string; deepseekPreferredModel?: string; sttGroqKey?: string; sttOpenaiKey?: string; sttSonioxKey?: string; openAiSttBaseUrl?: string }>
  // Permissions
  checkPermissions:     () => Promise<{ microphone: 'granted'|'denied'|'not-determined'|'restricted'; screen: 'granted'|'denied'|'not-determined'|'restricted'; platform: string }>
  requestMicPermission: () => Promise<boolean>

  // STT Provider Management
  setSttProvider: (provider: 'none' | 'groq' | 'openai' | 'soniox' | 'aliyun' | 'doubao') => Promise<CredentialSaveResult>
  getSttProvider: () => Promise<string>
  setGroqSttApiKey: (apiKey: string) => Promise<CredentialSaveResult>
  setOpenAiSttApiKey: (apiKey: string) => Promise<CredentialSaveResult>
  setOpenAiSttBaseUrl: (url: string) => Promise<CredentialSaveResult>
  setGroqSttModel: (model: string) => Promise<CredentialSaveResult>
  setSttTermPrompt: (prompt: string) => Promise<CredentialSaveResult>
  setSonioxApiKey: (apiKey: string) => Promise<CredentialSaveResult>
  testSttConnection: (provider: 'groq' | 'openai' | 'soniox', apiKey: string) => Promise<{ success: boolean; error?: string }>

  // STT Config Events (fired when STT provider/key changes during a meeting)
  onSttConfigChanged: (callback: (data: { configured: boolean; provider: string }) => void) => () => void
  onCredentialsChanged: (callback: () => void) => () => void

  // Native Audio Service Events
  onNativeAudioTranscript: (callback: (transcript: { speaker: string; text: string; final: boolean }) => void) => () => void
  getInputDevices: () => Promise<Array<{ id: string; name: string }>>
  getOutputDevices: () => Promise<Array<{ id: string; name: string }>>
  setRecognitionLanguage: (key: string) => Promise<CredentialSaveResult>
  getAiResponseLanguages: () => Promise<Array<{ label: string; code: string }>>
  setAiResponseLanguage: (language: string) => Promise<CredentialSaveResult>
  getSttLanguage: () => Promise<string>
  getAiResponseLanguage: () => Promise<string>
  onSystemAudioPermissionDenied: (callback: (message: string) => void) => () => void
  onDeviceSelectionApplied: (callback: (payload: { kind: 'input' | 'output'; requested: string | null; actual: string | null; fellBack: boolean; reason?: string }) => void) => () => void
  onAudioCaptureFailed: (callback: (payload: AudioCaptureFailedPayload) => void) => () => void

  // STT Status Events
  onSttStatusChanged: (callback: (data: { state: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio'; provider: string; error?: string; channel: 'user' | 'interviewer'; reconnectAttempts?: number }) => void) => () => void


  // Intelligence Mode IPC
  generateWhatToSay: (question?: string, imagePaths?: string[], speechActionId?: string) => Promise<{
    answer: string | null;
    question?: string;
    error?: string;
    /** Vision pipeline outcome — replaces legacy screenContextStatus/ocrTextLength fields */
    generationStatus?: string;
    screenContextStatus?: 'not_available' | 'available' | 'failed';
    visionProviderUsed?: string;
    visionModelUsed?: string;
    visionAttempts?: number;
    visionFailureReason?: 'no_vision_provider' | 'all_vision_failed' | 'scope_blocked' | 'provider_timeout';
    imageCount?: number;
    usedImageInput?: boolean;
  }>
  generateClarify: () => Promise<{ clarification: string | null }>
  generateCodeHint: (imagePaths?: string[], problemStatement?: string) => Promise<{ hint: string | null }>
  generateFollowUp: (intent: string, userRequest?: string) => Promise<{ refined: string | null; intent: string }>
  generateFollowUpQuestions: () => Promise<{ questions: string | null }>
  generateRecap: () => Promise<{ summary: string | null }>
  beginDictation: () => Promise<void>
  finishDictation: () => Promise<{ speechActionId: string; question: string; interviewerHeard?: boolean }>
  resetIntelligence: () => Promise<{ success: boolean; error?: string }>


  // Meeting Lifecycle
  startMeeting: (metadata?: any) => Promise<{ success: boolean; error?: string; code?: PendingUnsavedMeetingCode }>
  endMeeting: () => Promise<{ success: boolean; error?: string }>
  getUnsavedMeeting: () => Promise<UnsavedMeeting | null>
  retryUnsavedMeeting: (id: string) => Promise<UnsavedMeetingCommandResult>
  discardUnsavedMeeting: (id: string) => Promise<UnsavedMeetingCommandResult>
  onUnsavedMeetingChanged: (callback: (meeting: UnsavedMeeting | null) => void) => () => void
  getRecentMeetings: () => Promise<Array<{ id: string; title: string; date: string; duration: string }>>
  getMeetingDetails: (id: string) => Promise<any>
  updateMeetingTitle: (id: string, title: string) => Promise<boolean>
  deleteMeeting: (id: string) => Promise<boolean>
  setWindowMode: (mode: 'launcher' | 'overlay', inactive?: boolean) => Promise<void>
  setMeetingInterfaceTheme: (theme: string) => void
  onMeetingInterfaceThemeChanged: (callback: (theme: string) => void) => () => void
  getWrittenExam: () => Promise<WrittenExamStatus>;
  skipWrittenExamCapture: (generation: number) => Promise<void>;
  saveWrittenExam: (settings: Partial<WrittenExamSettings>) => Promise<WrittenExamStatus>;
  setWrittenExamRunning: (running: boolean) => Promise<WrittenExamStatus>;
  setInterviewMode: (enabled: boolean) => Promise<WrittenExamStatus>;
  onWrittenExamStatus: (callback: (status: WrittenExamStatus) => void) => () => void;
  onWrittenExamCapture: (callback: (capture: WrittenExamCapture) => void) => () => void;
  getUiLanguage: () => Promise<UiLanguage>
  setUiLanguage: (language: UiLanguage) => Promise<UiLanguageResult>
  onUiLanguageChanged: (callback: (language: UiLanguage) => void) => () => void

  // Intelligence Mode Events
  onIntelligenceSuggestedAnswer: (callback: (data: { answer: string; question: string; confidence: number }) => void) => () => void
  // Sprint 9: time-batched IPC token channel.
  onIntelligenceTokenBatch: (callback: (data: { kind: 'suggested_answer' | 'refined_answer' | 'recap' | 'clarify' | 'follow_up_questions'; items: any[] }) => void) => () => void
  onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string }) => void) => () => void
  onIntelligenceFollowUpQuestionsUpdate: (callback: (data: { questions: string }) => void) => () => void
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => () => void
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => () => void
  onIntelligenceError: (callback: (data: { error: string, mode: string }) => void) => () => void;
  // Session Management
  onSessionReset: (callback: () => void) => () => void;

  // Streaming listeners
  streamGeminiChat: (message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean, ignoreKnowledgeMode?: boolean, owner?: string, generationKind?: 'interview' | 'written', speechActionId?: string, clickedAt?: number; examGeneration?: number }) => Promise<void>
  onGeminiStreamToken: (callback: (token: string, metadata?: import('./generationMetadata').GenerationMetadata) => void, owner?: string) => () => void
  enableGenerationPresentation: () => Promise<void>;
  reportFirstVisible: (requestId: string) => void;
  retryGeneration: (requestId: string) => Promise<import('./generationMetadata').GenerationMetadata & { answer: string | null; error?: string }>;
  onGeminiStreamDone: (callback: (metadata?: import('./generationMetadata').GenerationMetadata) => void, owner?: string) => () => void
  onGeminiStreamError: (callback: (error: string, metadata?: import('./generationMetadata').GenerationMetadata) => void, owner?: string) => () => void;
  onIntelligenceGenerationStarted: (callback: (metadata: import('./generationMetadata').GenerationMetadata) => void) => () => void;
  cancelIntelligenceGeneration: () => Promise<void>;
  onIntelligenceGenerationTerminal: (callback: (metadata: import('./generationMetadata').GenerationMetadata & { error?: string }) => void) => () => void;
  cancelChatStream: (owner?: string) => void;

  // Model Management
  getDefaultModel: () => Promise<{ model: string; unavailable?: string }>;
  setModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  setDefaultModel: (modelId: string) => Promise<CredentialSaveResult>;
  /** S48: saved default and session reasoning, computed by the main process for the exact models. */
  getAnswerReasoning: () => Promise<AnswerReasoningState>;
  /** `expected` is the state's saved target; a write for an older primary model is refused. */
  setDefaultReasoning: (expected: string, value: ReasoningChoice) => Promise<CredentialSaveResult>;
  /** `expected` is the state's session target; a write for an older running model is refused. */
  setSessionReasoning: (expected: string, value: ReasoningChoice) => Promise<{ ok: true } | { ok: false; message: string }>;
  onAnswerReasoningChanged: (callback: (state: AnswerReasoningState) => void) => () => void;
  toggleModelSelector: (coords: { x: number; y: number; activate?: boolean }) => Promise<void>;
  modelSelectorCloseIfOpen: () => Promise<void>;

  // Settings Window
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>;

  // Groq Fast Text Mode
  getGroqFastTextMode: () => Promise<{ enabled: boolean }>;
  setGroqFastTextMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  getCodexCliConfig: () => Promise<CodexSourceConfig>;
  setCodexCliConfig: (config: CodexSourceUpdate) => Promise<{ success: boolean; error?: string; config?: CodexSourceConfig }>;
  testCodexCli: () => Promise<CodexSourceStatus>;

  // Audio Test
  startAudioTest: (deviceId?: string) => Promise<{ success: boolean }>;
  stopAudioTest: () => Promise<{ success: boolean }>;
  onAudioTestLevel: (callback: (level: number) => void) => () => void;
  // UX4: parallel system-audio probe — level + error events emitted during
  // the same startAudioTest lifecycle.
  onAudioTestSystemLevel: (callback: (level: number) => void) => () => void;
  onAudioTestSystemError: (callback: (errorMessage: string) => void) => () => void;

  onGroqFastTextChanged: (callback: (enabled: boolean) => void) => () => void;
  onModelChanged: (callback: (modelId: string) => void) => () => void;

  onMeetingsUpdated: (callback: () => void) => () => void

  // Theme API
  getThemeMode: () => Promise<{ mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }>
  setThemeMode: (mode: 'system' | 'light' | 'dark') => Promise<void>
  onThemeChanged: (callback: (data: { mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }) => void) => () => void

  // Auto-Update

  // Keybind Management
  getKeybinds: () => Promise<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>
  getKeybindStatus: () => Promise<KeybindResult>
  onKeybindResult: (callback: (result: KeybindResult) => void) => () => void
  setKeybind: (id: string, accelerator: string) => Promise<KeybindResult>
  resetKeybinds: () => Promise<KeybindResult>
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => () => void
  onKeybindRegistrationFailed: (callback: (data: { id: string; accelerator: string }) => void) => () => void
  onGlobalShortcut: (callback: (data: { action: string }) => void) => () => void

  // CGEventTap-backed stealth typing (macOS only — graceful degradation elsewhere)
  stealthTapAvailable: () => Promise<boolean>
  stealthTapOpenSettings: () => Promise<void>
  stealthTapStop: () => Promise<void>
  stealthTapStart: () => Promise<boolean>
  /** False on macOS when a composition IME (Pinyin/Hangul/Kanji/…) is
   *  enabled — the tap captures below the IME and breaks composition, so
   *  the renderer falls back to plain DOM focus on click. */
  stealthTapShouldAutoEngage: () => Promise<boolean>
  stealthTapRefreshIme: () => Promise<boolean>
  onStealthTapState: (cb: (state: { active: boolean; reason?: string }) => void) => () => void
  onStealthKeyCaptured: (cb: (ev: { keyCode: number; chars: string; flags: number; isKeyDown: boolean }) => void) => () => void

  // Profile Engine API

  // JD & Research API

  // Dynamic Model Discovery
  fetchProviderModels: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey: string) => Promise<{ success: boolean; models?: {id: string, label: string}[]; error?: string }>
  fetchGatewayModels: (id: string) => Promise<{ success: boolean; models?: {id: string, label: string}[]; error?: string }>
  setProviderPreferredModel: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', modelId: string) => Promise<CredentialSaveResult>

  // Overlay Opacity (Stealth Mode)
  setOverlayOpacity: (opacity: number) => Promise<void>;
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => () => void;

  // Verbose / Debug Logging
  getVerboseLogging: () => Promise<boolean>;
  setVerboseLogging: (enabled: boolean) => Promise<{ success: boolean }>;
  getMeetingRetention: () => Promise<'forever' | 'never'>;
  setMeetingRetention: (retention: 'forever' | 'never') => Promise<{ success: boolean; error?: string }>;
  onMeetingRetentionChanged: (callback: (retention: 'forever' | 'never') => void) => () => void;
  getProviderDataScopes: () => Promise<{ transcript?: boolean; screenshots?: boolean; profile_history?: boolean }>;
  setProviderDataScopes: (scopes: { transcript?: boolean; screenshots?: boolean; profile_history?: boolean }) => Promise<{ success: boolean; error?: string }>;
  onProviderDataScopesChanged: (callback: (scopes: { transcript?: boolean; screenshots?: boolean; profile_history?: boolean }) => void) => () => void;
  openLogFile: () => Promise<{ success: boolean; error?: string }>;

  // Arch
  getArch: () => Promise<string>;
  getOsVersion: () => Promise<string>;

  // Cropper API
  cropperConfirmed: (bounds: { x: number; y: number; width: number; height: number }) => void;
  cropperCancelled: () => void;
  onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => () => void;

  // Platform
  platform: NodeJS.Platform;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
