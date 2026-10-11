import type { ProviderConfiguration, ProviderConfigurationSave, LlmProvider } from './llmTarget';
import type { GenerationPolicy } from './generationPolicy';
import type { CodexSourceConfig, CodexSourceUpdate, CodexSourceStatus } from './codexSource';
import type { CredentialDiscardResult, CredentialLoadStatus, CredentialSaveResult } from './credentialSave';

import type { DomesticSttProvider, DomesticSttSettings } from './domesticStt';
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
  getDomesticStt: (provider: DomesticSttProvider) => Promise<{ hasKey: boolean; workspaceId: string; appId: string }>;
  saveDomesticStt: (provider: DomesticSttProvider, input: DomesticSttSettings) => Promise<CredentialSaveResult>;
  testDomesticStt: (provider: DomesticSttProvider) => Promise<{ success: boolean; error?: string }>;
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  onToggleExpand: (callback: () => void) => () => void
  getRecognitionLanguages: () => Promise<Record<string, any>>
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>
  deleteScreenshot: (path: string) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onScreenshotAttached: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onCaptureAndProcess: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onSolutionsReady: (callback: (solutions: string) => void) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void
  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void
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

  analyzeImageFile: (path: string) => Promise<void>
  quitApp: () => Promise<void>
  toggleWindow: () => Promise<void>
  showWindow: (inactive?: boolean) => Promise<void>
  hideWindow: () => Promise<void>
  showOverlay: () => Promise<void>
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
  setUndetectable: (state: boolean) => Promise<{ success: boolean; error?: string }>
  getUndetectable: () => Promise<boolean>
  setOverlayMousePassthrough: (enabled: boolean) => Promise<{ success: boolean }>
  toggleOverlayMousePassthrough: () => Promise<{ success: boolean; enabled: boolean }>
  getOverlayMousePassthrough: () => Promise<boolean>
  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => () => void
  setDisguise: (mode: 'terminal' | 'settings' | 'activity' | 'none') => Promise<{ success: boolean; error?: string }>
  getDisguise: () => Promise<'none' | 'terminal' | 'settings' | 'activity'>
  onDisguiseChanged: (callback: (mode: 'terminal' | 'settings' | 'activity' | 'none') => void) => () => void
  setOpenAtLogin: (open: boolean) => Promise<{ success: boolean; error?: string }>
  getOpenAtLogin: () => Promise<boolean>
  onSettingsVisibilityChange: (callback: (isVisible: boolean) => void) => () => void
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>
  openSettingsTab: (tab: string) => Promise<void>
  onOpenSettingsTab: (callback: (tab: string) => void) => () => void

  // LLM Model Management
  getCurrentLlmConfig: () => Promise<{ provider: LlmProvider | "codex-cli"; model: string }>
  switchToGemini: (apiKey?: string, modelId?: string) => Promise<CredentialSaveResult>
  testLlmConnection: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey?: string) => Promise<{ success: boolean; error?: string }>

  // API Key Management
  setProviderConfiguration: (value: ProviderConfigurationSave) => Promise<CredentialSaveResult>;
  getGenerationPolicy: () => Promise<GenerationPolicy>;
  setGenerationPolicy: (value: GenerationPolicy) => Promise<CredentialSaveResult>;
  setGeminiApiKey: (apiKey: string) => Promise<CredentialSaveResult>
  setGroqApiKey: (apiKey: string) => Promise<CredentialSaveResult>
  setOpenaiApiKey: (apiKey: string) => Promise<CredentialSaveResult>
  setClaudeApiKey: (apiKey: string) => Promise<CredentialSaveResult>
  setDeepseekApiKey: (apiKey: string) => Promise<CredentialSaveResult>
  getCredentialLoadStatus: () => Promise<CredentialLoadStatus>
  discardUnreadableCredentials: () => Promise<CredentialDiscardResult>
  getStoredCredentials: () => Promise<{ providerConfigurations: Record<LlmProvider, ProviderConfiguration>; hasGeminiKey: boolean; hasGroqKey: boolean; hasOpenaiKey: boolean; hasClaudeKey: boolean; hasDeepseekKey: boolean; sttProvider: 'none' | 'groq' | 'openai' | 'soniox' | 'aliyun' | 'doubao'; hasSttGroqKey: boolean; hasSttOpenaiKey: boolean; groqSttModel?: string; hasSonioxKey?: boolean; geminiPreferredModel?: string; groqPreferredModel?: string; openaiPreferredModel?: string; claudePreferredModel?: string; deepseekPreferredModel?: string; sttGroqKey?: string; sttOpenaiKey?: string; sttSonioxKey?: string; openAiSttBaseUrl?: string }>
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
  setSonioxApiKey: (apiKey: string) => Promise<CredentialSaveResult>
  testSttConnection: (provider: 'groq' | 'openai' | 'soniox', apiKey: string) => Promise<{ success: boolean; error?: string }>

  // STT Config Events (fired when STT provider/key changes during a meeting)
  onSttConfigChanged: (callback: (data: { configured: boolean; provider: string }) => void) => () => void
  onCredentialsChanged: (callback: () => void) => () => void

  // Native Audio Service Events
  onNativeAudioTranscript: (callback: (transcript: { speaker: string; text: string; final: boolean }) => void) => () => void
  onNativeAudioSuggestion: (callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void) => () => void
  onNativeAudioConnected: (callback: () => void) => () => void
  onNativeAudioDisconnected: (callback: () => void) => () => void
  onSuggestionGenerated: (callback: (data: { question: string; suggestion: string; confidence: number }) => void) => () => void
  onSuggestionProcessingStart: (callback: () => void) => () => void
  onSuggestionError: (callback: (error: { error: string }) => void) => () => void
  generateSuggestion: (context: string, lastQuestion: string) => Promise<{ suggestion: string }>
  getInputDevices: () => Promise<Array<{ id: string; name: string }>>
  getOutputDevices: () => Promise<Array<{ id: string; name: string }>>
  setRecognitionLanguage: (key: string) => Promise<CredentialSaveResult>
  getAiResponseLanguages: () => Promise<Array<{ label: string; code: string }>>
  setAiResponseLanguage: (language: string) => Promise<CredentialSaveResult>
  getSttLanguage: () => Promise<string>
  getAiResponseLanguage: () => Promise<string>
  onSttLanguageAutoDetected: (callback: (bcp47: string) => void) => () => void
  onSystemAudioPermissionDenied: (callback: (message: string) => void) => () => void
  onDeviceSelectionApplied: (callback: (payload: { kind: 'input' | 'output'; requested: string | null; actual: string | null; fellBack: boolean; reason?: string }) => void) => () => void
  onAudioCaptureFailed: (callback: (payload: { channel: 'system' | 'mic'; message: string; attempt: number; maxAttempts: number; terminal?: boolean; stuck?: boolean }) => void) => () => void

  // STT Status Events
  onSttStatusChanged: (callback: (data: { state: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio'; provider: string; error?: string; channel: 'user' | 'interviewer'; reconnectAttempts?: number }) => void) => () => void

  getNativeAudioStatus: () => Promise<{ connected: boolean }>

  // Intelligence Mode IPC
  generateAssist: () => Promise<{ insight: string | null }>
  generateWhatToSay: (question?: string, imagePaths?: string[]) => Promise<{
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
  generateBrainstorm: (imagePaths?: string[], problemStatement?: string) => Promise<{ script: string | null }>
  generateFollowUp: (intent: string, userRequest?: string) => Promise<{ refined: string | null; intent: string }>
  generateFollowUpQuestions: () => Promise<{ questions: string | null }>
  generateRecap: () => Promise<{ summary: string | null }>
  submitManualQuestion: (question: string) => Promise<{ answer: string | null; question: string }>
  getIntelligenceContext: () => Promise<{ context: string; lastAssistantMessage: string | null; activeMode: string }>
  resetIntelligence: () => Promise<{ success: boolean; error?: string }>

  // Dynamic Action Button Mode
  getActionButtonMode: () => Promise<'recap' | 'brainstorm'>
  setActionButtonMode: (mode: 'recap' | 'brainstorm') => Promise<{ success: boolean }>
  onActionButtonModeChanged: (callback: (mode: 'recap' | 'brainstorm') => void) => () => void


  // Meeting Lifecycle
  startMeeting: (metadata?: any) => Promise<{ success: boolean; error?: string }>
  endMeeting: () => Promise<{ success: boolean; error?: string }>
  finalizeMicSTT: () => Promise<void>
  getRecentMeetings: () => Promise<Array<{ id: string; title: string; date: string; duration: string; summary: string }>>
  getMeetingDetails: (id: string) => Promise<any>
  updateMeetingTitle: (id: string, title: string) => Promise<boolean>
  deleteMeeting: (id: string) => Promise<boolean>
  setWindowMode: (mode: 'launcher' | 'overlay', inactive?: boolean) => Promise<void>
  setMeetingInterfaceTheme: (theme: string) => void
  onMeetingInterfaceThemeChanged: (callback: (theme: string) => void) => () => void

  // Intelligence Mode Events
  onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => () => void
  onIntelligenceSuggestedAnswerToken: (callback: (data: { token: string; question: string; confidence: number }) => void) => () => void
  onIntelligenceSuggestedAnswer: (callback: (data: { answer: string; question: string; confidence: number }) => void) => () => void
  // Sprint 9: time-batched IPC token channel.
  onIntelligenceTokenBatch: (callback: (data: { kind: 'suggested_answer' | 'refined_answer' | 'recap' | 'clarify' | 'follow_up_questions'; items: any[] }) => void) => () => void
  onIntelligenceRefinedAnswerToken: (callback: (data: { token: string; intent: string }) => void) => () => void
  onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string }) => void) => () => void
  onIntelligenceFollowUpQuestionsUpdate: (callback: (data: { questions: string }) => void) => () => void
  onIntelligenceFollowUpQuestionsToken: (callback: (data: { token: string }) => void) => () => void
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => () => void
  onIntelligenceRecapToken: (callback: (data: { token: string }) => void) => () => void
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => () => void
  onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => () => void
  onIntelligenceManualStarted: (callback: () => void) => () => void
  onIntelligenceManualResult: (callback: (data: { answer: string; question: string }) => void) => () => void
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => () => void
  onIntelligenceError: (callback: (data: { error: string, mode: string }) => void) => () => void;
  // Session Management
  onSessionReset: (callback: () => void) => () => void;

  // Streaming listeners
  streamGeminiChat: (message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean, ignoreKnowledgeMode?: boolean, owner?: string, generationKind?: 'interview' | 'written' }) => Promise<void>
  onGeminiStreamToken: (callback: (token: string) => void, owner?: string) => () => void
  onGeminiStreamDone: (callback: (metadata?: import('./generationMetadata').GenerationMetadata) => void, owner?: string) => () => void
  onGeminiStreamError: (callback: (error: string, metadata?: import('./generationMetadata').GenerationMetadata) => void, owner?: string) => () => void;
  onIntelligenceGenerationStarted: (callback: (metadata: import('./generationMetadata').GenerationMetadata) => void) => () => void;
  cancelIntelligenceGeneration: () => Promise<void>;
  onIntelligenceGenerationTerminal: (callback: (metadata: import('./generationMetadata').GenerationMetadata & { error?: string }) => void) => () => void;
  cancelChatStream: (owner?: string) => void;

  // Model Management
  getDefaultModel: () => Promise<{ model: string }>;
  setModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  setDefaultModel: (modelId: string) => Promise<CredentialSaveResult>;
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

  // Demo
  seedDemo: () => Promise<{ success: boolean }>;

  // Audio Test
  startAudioTest: (deviceId?: string) => Promise<{ success: boolean }>;
  stopAudioTest: () => Promise<{ success: boolean }>;
  onAudioTestLevel: (callback: (level: number) => void) => () => void;
  // UX4: parallel system-audio probe — level + error events emitted during
  // the same startAudioTest lifecycle.
  onAudioTestSystemLevel: (callback: (level: number) => void) => () => void;
  onAudioTestSystemError: (callback: (errorMessage: string) => void) => () => void;

  // Database
  flushDatabase: () => Promise<{ success: boolean }>;

  onUndetectableChanged: (callback: (state: boolean) => void) => () => void;
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
  setKeybind: (id: string, accelerator: string) => Promise<boolean>
  resetKeybinds: () => Promise<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>
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
  setProviderPreferredModel: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', modelId: string) => Promise<CredentialSaveResult>

  // Overlay Opacity (Stealth Mode)
  setOverlayOpacity: (opacity: number) => Promise<void>;
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => () => void;

  // Verbose / Debug Logging
  getVerboseLogging: () => Promise<boolean>;
  setVerboseLogging: (enabled: boolean) => Promise<{ success: boolean }>;
  getMeetingRetention: () => Promise<'forever' | '7d' | '30d' | 'never'>;
  setMeetingRetention: (retention: 'forever' | '7d' | '30d' | 'never') => Promise<{ success: boolean; error?: string }>;
  onMeetingRetentionChanged: (callback: (retention: 'forever' | '7d' | '30d' | 'never') => void) => () => void;
  getProviderDataScopes: () => Promise<{ transcript?: boolean; screenshots?: boolean; profile_history?: boolean }>;
  setProviderDataScopes: (scopes: { transcript?: boolean; screenshots?: boolean; profile_history?: boolean }) => Promise<{ success: boolean; error?: string }>;
  onProviderDataScopesChanged: (callback: (scopes: { transcript?: boolean; screenshots?: boolean; profile_history?: boolean }) => void) => () => void;
  getTechnicalInterviewVisionFirst: () => Promise<boolean>;
  setTechnicalInterviewVisionFirst: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  onTechnicalInterviewVisionFirstChanged: (callback: (enabled: boolean) => void) => () => void;
  /** @deprecated alias retained for older renderer builds — maps to technicalInterviewVisionFirst */
  getTechnicalInterviewDirectVision: () => Promise<boolean>;
  /** @deprecated alias retained for older renderer builds — maps to technicalInterviewVisionFirst */
  setTechnicalInterviewDirectVision: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  /** @deprecated alias retained for older renderer builds — maps to technicalInterviewVisionFirstChanged */
  onTechnicalInterviewDirectVisionChanged: (callback: (enabled: boolean) => void) => () => void;
  getLogFilePath: () => Promise<string | null>;
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

  // Skills
  skillsRefresh: () => Promise<SkillSummary[]>;
  skillsOpenFolder: () => Promise<{ success: boolean; path: string; error?: string }>;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'userData';
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
