import { contextBridge, ipcRenderer } from 'electron';
import { installConsoleLogging } from './utils/consoleLogging';
import type { CredentialDiscardResult, CredentialLoadStatus, CredentialSaveResult, ServiceAccountSelectionResult } from '../src/types/credentialSave';

let verboseLog = false;
installConsoleLogging(console, (level, line) => {
  if (verboseLog) ipcRenderer.send('forward-log-to-file', level, line);
}, args => require('./utils/redactForLog').redactForLog(args));
ipcRenderer.invoke('get-verbose-logging').then((enabled: boolean) => { verboseLog = enabled === true; }).catch(() => {});
ipcRenderer.on('verbose-logging-changed', (_event: unknown, enabled: boolean) => { verboseLog = enabled === true; });

// The only ways a renderer opens the browser (navigationPolicy refuses window.open
// and navigation without opening anything). A trusted click on a link that leaves
// the page, not handled by the page itself, is opened here; scripts cannot create
// trusted events. openExternal below needs the frame's transient user activation,
// which only real input grants. The main process still checks the URL.
const userActivated = () => navigator.userActivation?.isActive === true;
function openClickedLink(event: MouseEvent): void {
  if (!event.isTrusted || event.defaultPrevented || (event.type === 'click' ? event.button !== 0 : event.button !== 1)) return;
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download')) return;
  const target = new URL(link.href);
  const here = new URL(window.location.href);
  if (target.protocol === here.protocol && target.host === here.host && target.pathname === here.pathname && target.search === here.search) return;
  event.preventDefault();
  void ipcRenderer.invoke('open-external', link.href).catch(() => {});
}
window.addEventListener('click', openClickedLink);
window.addEventListener('auxclick', openClickedLink);

// Types for the exposed Electron API
interface ElectronAPI {
  updateContentDimensions: (dimensions: { width: number; height: number }) => Promise<void>;
  updateContentDimensionsCentered: (dimensions: { width: number; height: number }) => Promise<void>;
  getRecognitionLanguages: () => Promise<Record<string, any>>;
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>;
  deleteScreenshot: (path: string) => Promise<{ success: boolean; error?: string }>;
  onScreenshotTaken: (callback: (data: { path: string; preview: string }) => void) => () => void;
  onScreenshotAttached: (callback: (data: { path: string; preview: string }) => void) => () => void;
  onCaptureAndProcess: (callback: (data: { path: string; preview: string }) => void) => () => void;
  onSolutionsReady: (callback: (solutions: string) => void) => () => void;
  onResetView: (callback: () => void) => () => void;
  onSolutionStart: (callback: () => void) => () => void;
  onDebugStart: (callback: () => void) => () => void;
  onDebugSuccess: (callback: (data: any) => void) => () => void;
  onSolutionError: (callback: (error: string) => void) => () => void;
  onProcessingNoScreenshots: (callback: () => void) => () => void;
  onProblemExtracted: (callback: (data: any) => void) => () => void;
  onSolutionSuccess: (callback: (data: any) => void) => () => void;

  onUnauthorized: (callback: () => void) => () => void;
  onDebugError: (callback: (error: string) => void) => () => void;
  takeScreenshot: () => Promise<void>;
  takeSelectiveScreenshot: () => Promise<{ path: string; preview: string; cancelled?: boolean }>;
  moveWindowLeft: () => Promise<void>;
  moveWindowRight: () => Promise<void>;
  moveWindowUp: () => Promise<void>;
  moveWindowDown: () => Promise<void>;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;

  analyzeImageFile: (path: string) => Promise<void>;
  quitApp: () => Promise<void>;

  // LLM Model Management
  getCurrentLlmConfig: () => Promise<{
    provider: 'gemini' | 'codex-cli';
    model: string;
  }>;
  switchToGemini: (
    apiKey?: string,
    modelId?: string,
  ) => Promise<CredentialSaveResult>;
  testLlmConnection: (
    provider: 'gemini' | 'groq' | 'openai' | 'claude',
    apiKey?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  selectServiceAccount: () => Promise<ServiceAccountSelectionResult>;

  // API Key Management
  setGeminiApiKey: (apiKey: string) => Promise<CredentialSaveResult>;
  setGroqApiKey: (apiKey: string) => Promise<CredentialSaveResult>;
  setOpenaiApiKey: (apiKey: string) => Promise<CredentialSaveResult>;
  setClaudeApiKey: (apiKey: string) => Promise<CredentialSaveResult>;
  setDeepseekApiKey: (apiKey: string) => Promise<CredentialSaveResult>;
  setProviderPreferredModel: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', modelId: string) => Promise<CredentialSaveResult>;
  getCredentialLoadStatus: () => Promise<CredentialLoadStatus>;
  discardUnreadableCredentials: () => Promise<CredentialDiscardResult>;
  getStoredCredentials: () => Promise<{
    hasGeminiKey: boolean;
    hasGroqKey: boolean;
    hasOpenaiKey: boolean;
    hasClaudeKey: boolean;
    hasDeepseekKey: boolean;
    googleServiceAccountPath: string | null;
    sttProvider: string;
    hasSttGroqKey: boolean;
    hasSttOpenaiKey: boolean;
    hasDeepgramKey: boolean;
    hasElevenLabsKey: boolean;
    hasAzureKey: boolean;
    azureRegion: string;
    hasIbmWatsonKey: boolean;
    ibmWatsonRegion: string;
    hasSonioxKey: boolean;
  }>;

  // STT Provider Management
  setSttProvider: (
    provider:
      | 'none'
      | 'google'
      | 'groq'
      | 'openai'
      | 'deepgram'
      | 'elevenlabs'
      | 'azure'
      | 'ibmwatson'
      | 'soniox',
  ) => Promise<CredentialSaveResult>;
  getSttProvider: () => Promise<string>;
  setGroqSttApiKey: (apiKey: string) => Promise<CredentialSaveResult>;
  setOpenAiSttApiKey: (apiKey: string) => Promise<CredentialSaveResult>;
  setOpenAiSttBaseUrl: (url: string) => Promise<CredentialSaveResult>;
  setDeepgramApiKey: (apiKey: string) => Promise<CredentialSaveResult>;
  setElevenLabsApiKey: (apiKey: string) => Promise<CredentialSaveResult>;
  setAzureApiKey: (apiKey: string) => Promise<CredentialSaveResult>;
  setAzureRegion: (region: string) => Promise<CredentialSaveResult>;
  setIbmWatsonApiKey: (apiKey: string) => Promise<CredentialSaveResult>;
  setGroqSttModel: (model: string) => Promise<CredentialSaveResult>;
  setSonioxApiKey: (apiKey: string) => Promise<CredentialSaveResult>;
  setIbmWatsonRegion: (region: string) => Promise<CredentialSaveResult>;
  testSttConnection: (
    provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox',
    apiKey: string,
    region?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // STT Config Events
  onSttConfigChanged: (
    callback: (data: { configured: boolean; provider: string }) => void,
  ) => () => void;
  onCredentialsChanged: (callback: () => void) => () => void;

  // Native Audio Service Events
  onNativeAudioTranscript: (
    callback: (transcript: { speaker: string; text: string; final: boolean }) => void,
  ) => () => void;
  onNativeAudioSuggestion: (
    callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void,
  ) => () => void;
  onNativeAudioConnected: (callback: () => void) => () => void;
  onNativeAudioDisconnected: (callback: () => void) => () => void;
  onSuggestionGenerated: (
    callback: (data: { question: string; suggestion: string; confidence: number }) => void,
  ) => () => void;
  onSuggestionProcessingStart: (callback: () => void) => () => void;
  onSuggestionError: (callback: (error: { error: string }) => void) => () => void;
  generateSuggestion: (context: string, lastQuestion: string) => Promise<{ suggestion: string }>;
  getInputDevices: () => Promise<Array<{ id: string; name: string }>>;
  getOutputDevices: () => Promise<Array<{ id: string; name: string }>>;
  setRecognitionLanguage: (key: string) => Promise<CredentialSaveResult>;
  getAiResponseLanguages: () => Promise<Array<{ label: string; code: string }>>;
  setAiResponseLanguage: (language: string) => Promise<CredentialSaveResult>;
  getSttLanguage: () => Promise<string>;
  getAiResponseLanguage: () => Promise<string>;
  onSttLanguageAutoDetected: (callback: (bcp47: string) => void) => () => void;
  onSystemAudioPermissionDenied: (callback: (message: string) => void) => () => void;
  getSystemAudioPermissionWarning: () => Promise<string | null>;
  onDeviceSelectionApplied: (
    callback: (payload: {
      kind: 'input' | 'output';
      requested: string | null;
      actual: string | null;
      fellBack: boolean;
      reason?: string;
    }) => void,
  ) => () => void;
  onAudioCaptureFailed: (
    callback: (payload: {
      channel: 'system' | 'mic';
      message: string;
      attempt: number;
      maxAttempts: number;
      terminal?: boolean;
      stuck?: boolean;
    }) => void,
  ) => () => void;

  // STT Status Events
  onSttStatusChanged: (
    callback: (data: {
      state: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio';
      provider: string;
      error?: string;
      channel: 'user' | 'interviewer';
      reconnectAttempts?: number;
    }) => void,
  ) => () => void;

  // Intelligence Mode IPC
  generateAssist: () => Promise<{ insight: string | null }>;
  generateWhatToSay: (
    question?: string,
    imagePaths?: string[],
  ) => Promise<{
    answer: string | null;
    question?: string;
    error?: string;
    screenContextStatus?: 'not_available' | 'available' | 'failed';
    ocrTextLength?: number;
    imageCount?: number;
    usedImageInput?: boolean;
  }>;
  generateFollowUp: (
    intent: string,
    userRequest?: string,
  ) => Promise<{ refined: string | null; intent: string }>;
  generateRecap: () => Promise<{ summary: string | null }>;
  submitManualQuestion: (question: string) => Promise<{ answer: string | null; question: string }>;
  getIntelligenceContext: () => Promise<{
    context: string;
    lastAssistantMessage: string | null;
    activeMode: string;
  }>;
  testInjectTranscript: (segment: {
    speaker: string;
    text: string;
    timestamp?: number;
    final?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  resetIntelligence: () => Promise<{ success: boolean; error?: string }>;

  // Meeting Lifecycle
  startMeeting: (metadata?: any) => Promise<{ success: boolean; error?: string }>;
  endMeeting: () => Promise<{ success: boolean; error?: string }>;
  finalizeMicSTT: () => Promise<void>;
  getRecentMeetings: () => Promise<
    Array<{ id: string; title: string; date: string; duration: string; summary: string }>
  >;
  getMeetingDetails: (id: string) => Promise<any>;
  updateMeetingTitle: (id: string, title: string) => Promise<boolean>;
  updateMeetingSummary: (
    id: string,
    updates: {
      overview?: string;
      actionItems?: string[];
      keyPoints?: string[];
      actionItemsTitle?: string;
      keyPointsTitle?: string;
    },
  ) => Promise<boolean>;
  onMeetingsUpdated: (callback: () => void) => () => void;

  // Intelligence Mode Events
  onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => () => void;
  onIntelligenceSuggestedAnswer: (
    callback: (data: { answer: string; question: string; confidence: number }) => void,
  ) => () => void;
  onIntelligenceRefinedAnswer: (
    callback: (data: { answer: string; intent: string }) => void,
  ) => () => void;
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => () => void;
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => () => void;
  onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => () => void;
  onIntelligenceManualStarted: (callback: () => void) => () => void;
  onIntelligenceManualResult: (
    callback: (data: { answer: string; question: string }) => void,
  ) => () => void;
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => () => void;
  onIntelligenceError: (callback: (data: { error: string; mode: string }) => void) => () => void;
  // Sprint 9: time-batched IPC token channel. Carries a batch of streaming
  // tokens for ANY of the 5 streaming kinds in one IPC send. Replaces
  // per-token sends to the 5 individual channels (which still exist as
  // unused defense-in-depth bridges).
  onIntelligenceTokenBatch: (
    callback: (data: {
      kind: 'suggested_answer' | 'refined_answer' | 'recap' | 'clarify' | 'follow_up_questions';
      items: any[];
    }) => void,
  ) => () => void;

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
  getCodexCliConfig: () => Promise<{
    enabled: boolean;
    path: string;
    model: string;
    fastModel: string;
    timeoutMs: number;
  }>;
  setCodexCliConfig: (config: {
    enabled: boolean;
    path: string;
    model: string;
    fastModel: string;
    timeoutMs: number;
  }) => Promise<{
    success: boolean;
    error?: string;
    config?: {
      enabled: boolean;
      path: string;
      model: string;
      fastModel: string;
      timeoutMs: number;
    };
  }>;
  testCodexCli: (config?: {
    enabled?: boolean;
    path?: string;
    model?: string;
    fastModel?: string;
    timeoutMs?: number;
  }) => Promise<{
    success: boolean;
    error?: string;
    resolvedPath?: string;
    config?: {
      enabled: boolean;
      path: string;
      model: string;
      fastModel: string;
      timeoutMs: number;
    };
  }>;

  // Demo
  seedDemo: () => Promise<{ success: boolean }>;

  // Audio Test
  startAudioTest: (deviceId?: string) => Promise<{ success: boolean }>;
  stopAudioTest: () => Promise<{ success: boolean }>;
  onAudioTestLevel: (callback: (level: number) => void) => () => void;
  // UX4: parallel system-audio probe — system audio level + error events
  // emitted during the same startAudioTest lifecycle.
  onAudioTestSystemLevel: (callback: (level: number) => void) => () => void;
  onAudioTestSystemError: (callback: (errorMessage: string) => void) => () => void;

  // Database
  flushDatabase: () => Promise<{ success: boolean }>;
  showWindow: () => Promise<void>;
  hideWindow: () => Promise<void>;
  showOverlay: () => Promise<void>;
  hideOverlay: () => Promise<void>;
  getMeetingActive: () => Promise<boolean>;
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => () => void;
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void;
  onEnsureExpanded: (callback: () => void) => () => void;
  onToggleExpand: (callback: () => void) => () => void;
  openSettingsTab: (tab: string) => Promise<void>;
  onOpenSettingsTab: (callback: (tab: string) => void) => () => void;
  setOverlayMousePassthrough: (enabled: boolean) => Promise<{ success: boolean }>;
  toggleOverlayMousePassthrough: () => Promise<{ success: boolean; enabled: boolean }>;
  getOverlayMousePassthrough: () => Promise<boolean>;
  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => () => void;

  // Streaming listeners
  streamGeminiChat: (
    message: string,
    imagePaths?: string[],
    context?: string,
    options?: { skipSystemPrompt?: boolean; ignoreKnowledgeMode?: boolean; meetingId?: string },
  ) => Promise<void>;
  onGeminiStreamToken: (callback: (token: string) => void) => () => void;
  onGeminiStreamDone: (callback: () => void) => () => void;
  onGeminiStreamError: (callback: (error: string) => void) => () => void;

  onUndetectableChanged: (callback: (state: boolean) => void) => () => void;
  onGroqFastTextChanged: (callback: (enabled: boolean) => void) => () => void;
  onModelChanged: (callback: (modelId: string) => void) => () => void;

  // Theme API
  getThemeMode: () => Promise<{ mode: 'system' | 'light' | 'dark'; resolved: 'light' | 'dark' }>;
  setThemeMode: (mode: 'system' | 'light' | 'dark') => Promise<void>;
  onThemeChanged: (
    callback: (data: { mode: 'system' | 'light' | 'dark'; resolved: 'light' | 'dark' }) => void,
  ) => () => void;



  // Keybind Management
  getKeybinds: () => Promise<
    Array<{
      id: string;
      label: string;
      accelerator: string;
      isGlobal: boolean;
      defaultAccelerator: string;
    }>
  >;
  setKeybind: (id: string, accelerator: string) => Promise<boolean>;
  resetKeybinds: () => Promise<
    Array<{
      id: string;
      label: string;
      accelerator: string;
      isGlobal: boolean;
      defaultAccelerator: string;
    }>
  >;
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => () => void;

  // Global shortcut events (stealth: fired even when window is not focused)
  onGlobalShortcut: (callback: (data: { action: string }) => void) => () => void;

  // CGEventTap-backed stealth keyboard tap (macOS only). Returns false on
  // non-macOS or when the native module / Accessibility permission is missing.
  // M5 cleanup: three dead query-style IPCs were removed — they never had
  // main-side handlers; tap state arrives via onStealthTapState instead.
  stealthTapAvailable: () => Promise<boolean>;
  stealthTapOpenSettings: () => Promise<void>;
  stealthTapStop: () => Promise<void>;
  stealthTapStart: () => Promise<boolean>;
  /** False on macOS when a composition IME (Pinyin/Hangul/Kanji/…) is
   *  enabled — the tap captures below the IME and breaks composition, so
   *  the renderer falls back to plain DOM focus on click. */
  stealthTapShouldAutoEngage: () => Promise<boolean>;
  stealthTapRefreshIme: () => Promise<boolean>;
  onStealthTapState: (cb: (state: { active: boolean; reason?: string }) => void) => () => void;
  onStealthKeyCaptured: (
    cb: (ev: { keyCode: number; chars: string; flags: number; isKeyDown: boolean }) => void,
  ) => () => void;




  // Overlay Opacity (Stealth Mode)
  setOverlayOpacity: (opacity: number) => Promise<void>;
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => () => void;

  // Verbose / Debug Logging
  getVerboseLogging: () => Promise<boolean>;
  setVerboseLogging: (enabled: boolean) => Promise<{ success: boolean }>;
  getMeetingRetention: () => Promise<'forever' | '7d' | '30d' | 'never'>;
  setMeetingRetention: (
    retention: 'forever' | '7d' | '30d' | 'never',
  ) => Promise<{ success: boolean; error?: string }>;
  onMeetingRetentionChanged: (
    callback: (retention: 'forever' | '7d' | '30d' | 'never') => void,
  ) => () => void;
  getProviderDataScopes: () => Promise<{
    transcript?: boolean;
    screenshots?: boolean;
    profile_history?: boolean;
    post_call_summary?: boolean;
  }>;
  setProviderDataScopes: (scopes: {
    transcript?: boolean;
    screenshots?: boolean;
    profile_history?: boolean;
    post_call_summary?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  onProviderDataScopesChanged: (
    callback: (scopes: {
      transcript?: boolean;
      screenshots?: boolean;
      profile_history?: boolean;
      post_call_summary?: boolean;
    }) => void,
  ) => () => void;
  getScreenUnderstandingMode: () => Promise<'vision_first' | 'vision_only'>;
  setScreenUnderstandingMode: (
    mode: 'vision_first' | 'vision_only',
  ) => Promise<{ success: boolean; error?: string }>;
  onScreenUnderstandingModeChanged: (
    callback: (mode: 'vision_first' | 'vision_only') => void,
  ) => () => void;
  getTechnicalInterviewVisionFirst: () => Promise<boolean>;
  setTechnicalInterviewVisionFirst: (
    enabled: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  onTechnicalInterviewVisionFirstChanged: (callback: (enabled: boolean) => void) => () => void;
  /** @deprecated alias for technicalInterviewVisionFirst — retained so older renderer builds keep working. */
  getTechnicalInterviewDirectVision: () => Promise<boolean>;
  /** @deprecated alias for technicalInterviewVisionFirst — retained so older renderer builds keep working. */
  setTechnicalInterviewDirectVision: (
    enabled: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  /** @deprecated alias for technicalInterviewVisionFirstChanged — retained so older renderer builds keep working. */
  onTechnicalInterviewDirectVisionChanged: (callback: (enabled: boolean) => void) => () => void;
  getLogFilePath: () => Promise<string | null>;
  openLogFile: () => Promise<{ success: boolean; error?: string }>;

  // Arch
  getArch: () => Promise<string>;
  getOsVersion: () => Promise<string>;

  // Cropper API
  cropperConfirmed: (bounds: Electron.Rectangle) => void;
  cropperCancelled: () => void;
  onResetCropper: (
    callback: (data: { hudPosition: { x: number; y: number } }) => void,
  ) => () => void;

  // Platform
  platform: NodeJS.Platform;

  // Meeting interface theme — cross-window propagation. The settings window
  // writes the new theme to localStorage and calls `setMeetingInterfaceTheme`,
  // which sends an IPC to main; main re-broadcasts to every window so the
  // overlay window's React state stays in sync with the launcher's. Without
  // this, the overlay reads stale theme on next meeting start (half-paint hang).
  setMeetingInterfaceTheme: (theme: string) => void;
  onMeetingInterfaceThemeChanged: (callback: (theme: string) => void) => () => void;

  // Cancel the in-flight gemini-chat-stream. Renderer wires this to "drop
  // the current answer" user actions (Escape, navigation, chat-overlay unmount).
  // Without explicit cancel the chat IPC handler keeps streaming tokens that
  // the renderer silently discards — wasting provider quota and feeling slow
  // because a subsequent question's first token has to wait for the prior
  // response to drain through the supersession check.
  cancelChatStream: () => void;
}

export const PROCESSING_EVENTS = {
  //global states
  UNAUTHORIZED: 'procesing-unauthorized',
  NO_SCREENSHOTS: 'processing-no-screenshots',

  //states for generating the initial solution
  INITIAL_START: 'initial-start',
  PROBLEM_EXTRACTED: 'problem-extracted',
  SOLUTION_SUCCESS: 'solution-success',
  INITIAL_SOLUTION_ERROR: 'solution-error',

  //states for processing the debugging
  DEBUG_START: 'debug-start',
  DEBUG_SUCCESS: 'debug-success',
  DEBUG_ERROR: 'debug-error',
} as const;

// Expose the Electron API to the renderer process
// Chat stream identity for this window (PLAN.md AG-17 review). streamGeminiChat()
// gives every request a new id, which the main process sends back with each token,
// done and error event; cancelChatStream() clears it. Only events carrying the active
// id reach the renderer, so nothing from a cancelled or superseded stream is shown:
// not in the gap after a cancel, and not after a new stream has started (events the
// old stream sent before main saw the stop can still be in flight). Events without an
// id are dropped too.
let chatStreamSeq = 0;
let activeChatStreamId: number | null = null;
const isActiveChatStream = (id: unknown) => activeChatStreamId !== null && id === activeChatStreamId;

contextBridge.exposeInMainWorld('electronAPI', {
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke('update-content-dimensions', dimensions),
  updateContentDimensionsCentered: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke('update-content-dimensions-centered', dimensions),
  getRecognitionLanguages: () => ipcRenderer.invoke('get-recognition-languages'),
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  takeSelectiveScreenshot: () => ipcRenderer.invoke('take-selective-screenshot'),
  getScreenshots: () => ipcRenderer.invoke('get-screenshots'),
  deleteScreenshot: (path: string) => ipcRenderer.invoke('delete-screenshot', path),

  // Event listeners
  onScreenshotTaken: (callback: (data: { path: string; preview: string }) => void) => {
    const subscription = (_: any, data: { path: string; preview: string }) => callback(data);
    ipcRenderer.on('screenshot-taken', subscription);
    return () => {
      ipcRenderer.removeListener('screenshot-taken', subscription);
    };
  },
  onScreenshotAttached: (callback: (data: { path: string; preview: string }) => void) => {
    const subscription = (_: any, data: { path: string; preview: string }) => callback(data);
    ipcRenderer.on('screenshot-attached', subscription);
    return () => {
      ipcRenderer.removeListener('screenshot-attached', subscription);
    };
  },
  onCaptureAndProcess: (callback: (data: { path: string; preview: string }) => void) => {
    const subscription = (_: any, data: { path: string; preview: string }) => callback(data);
    ipcRenderer.on('capture-and-process', subscription);
    return () => {
      ipcRenderer.removeListener('capture-and-process', subscription);
    };
  },
  onSolutionsReady: (callback: (solutions: string) => void) => {
    const subscription = (_: any, solutions: string) => callback(solutions);
    ipcRenderer.on('solutions-ready', subscription);
    return () => {
      ipcRenderer.removeListener('solutions-ready', subscription);
    };
  },
  onResetView: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('reset-view', subscription);
    return () => {
      ipcRenderer.removeListener('reset-view', subscription);
    };
  },
  onSolutionStart: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_START, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_START, subscription);
    };
  },
  onDebugStart: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_START, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_START, subscription);
    };
  },

  onDebugSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('debug-success', subscription);
    return () => {
      ipcRenderer.removeListener('debug-success', subscription);
    };
  },
  onDebugError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error);
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_ERROR, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_ERROR, subscription);
    };
  },
  onSolutionError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error);
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription);
    };
  },
  onProcessingNoScreenshots: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription);
    };
  },

  onProblemExtracted: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription);
    };
  },
  onSolutionSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription);
    };
  },
  onUnauthorized: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on(PROCESSING_EVENTS.UNAUTHORIZED, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.UNAUTHORIZED, subscription);
    };
  },
  moveWindowLeft: () => ipcRenderer.invoke('move-window-left'),
  moveWindowRight: () => ipcRenderer.invoke('move-window-right'),
  moveWindowUp: () => ipcRenderer.invoke('move-window-up'),
  moveWindowDown: () => ipcRenderer.invoke('move-window-down'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  analyzeImageFile: (path: string) => ipcRenderer.invoke('analyze-image-file', path),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  toggleWindow: () => ipcRenderer.invoke('toggle-window'),
  showWindow: (inactive?: boolean) => ipcRenderer.invoke('show-window', inactive),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  showOverlay: () => ipcRenderer.invoke('show-overlay'),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  getMeetingActive: () => ipcRenderer.invoke('get-meeting-active'),
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => {
    const subscription = (_: any, data: { isActive: boolean }) => callback(data);
    ipcRenderer.on('meeting-state-changed', subscription);
    return () => {
      ipcRenderer.removeListener('meeting-state-changed', subscription);
    };
  },
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => {
    const subscription = (_: any, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on('window-maximized-changed', subscription);
    return () => {
      ipcRenderer.removeListener('window-maximized-changed', subscription);
    };
  },
  onEnsureExpanded: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('ensure-expanded', subscription);
    return () => {
      ipcRenderer.removeListener('ensure-expanded', subscription);
    };
  },
  openSettingsTab: (tab: string) => ipcRenderer.invoke('settings:open-tab', tab),
  onOpenSettingsTab: (callback: (tab: string) => void) => {
    const subscription = (_: any, tab: string) => callback(tab);
    ipcRenderer.on('settings:open-tab', subscription);
    return () => {
      ipcRenderer.removeListener('settings:open-tab', subscription);
    };
  },
  openExternal: (url: string) => {
    if (userActivated()) return ipcRenderer.invoke('open-external', url);
    console.warn('[Navigation] Refused openExternal without user activation');
    return Promise.resolve();
  },
  // UX2: in-app TCC repair. Returns { ok, bundleId, results, promptRelaunch, message }.
  // Renderer should show the `message` and prompt the user to fully quit and reopen.
  repairTccPermissions: () => ipcRenderer.invoke('repair-tcc-permissions'),
  setUndetectable: (state: boolean) => ipcRenderer.invoke('set-undetectable', state),
  getUndetectable: () => ipcRenderer.invoke('get-undetectable'),
  setOverlayMousePassthrough: (enabled: boolean) =>
    ipcRenderer.invoke('set-overlay-mouse-passthrough', enabled),
  toggleOverlayMousePassthrough: () => ipcRenderer.invoke('toggle-overlay-mouse-passthrough'),
  getOverlayMousePassthrough: () => ipcRenderer.invoke('get-overlay-mouse-passthrough'),
  setOpenAtLogin: (open: boolean) => ipcRenderer.invoke('set-open-at-login', open),
  getOpenAtLogin: () => ipcRenderer.invoke('get-open-at-login'),
  setDisguise: (mode: 'terminal' | 'settings' | 'activity' | 'none') =>
    ipcRenderer.invoke('set-disguise', mode),
  getDisguise: () => ipcRenderer.invoke('get-disguise'),
  onDisguiseChanged: (callback: (mode: 'terminal' | 'settings' | 'activity' | 'none') => void) => {
    const subscription = (_: any, mode: any) => callback(mode);
    ipcRenderer.on('disguise-changed', subscription);
    return () => {
      ipcRenderer.removeListener('disguise-changed', subscription);
    };
  },

  // Skills — local SKILL.md instructions surfaced in Settings and the overlay.
  skillsRefresh: () => ipcRenderer.invoke('skills:list'),
  skillsOpenFolder: () => ipcRenderer.invoke('skills:open-folder'),

  onSettingsVisibilityChange: (callback: (isVisible: boolean) => void) => {
    const subscription = (_: any, isVisible: boolean) => callback(isVisible);
    ipcRenderer.on('settings-visibility-changed', subscription);
    return () => {
      ipcRenderer.removeListener('settings-visibility-changed', subscription);
    };
  },

  onToggleExpand: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('toggle-expand', subscription);
    return () => {
      ipcRenderer.removeListener('toggle-expand', subscription);
    };
  },

  // LLM Model Management
  getCurrentLlmConfig: () => ipcRenderer.invoke('get-current-llm-config'),
  switchToGemini: (apiKey?: string, modelId?: string) =>
    ipcRenderer.invoke('switch-to-gemini', apiKey, modelId),
  testLlmConnection: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey: string) =>
    ipcRenderer.invoke('test-llm-connection', provider, apiKey),
  selectServiceAccount: () => ipcRenderer.invoke('select-service-account'),

  // API Key Management
  setGeminiApiKey: (apiKey: string) => ipcRenderer.invoke('set-gemini-api-key', apiKey),
  setGroqApiKey: (apiKey: string) => ipcRenderer.invoke('set-groq-api-key', apiKey),
  setOpenaiApiKey: (apiKey: string) => ipcRenderer.invoke('set-openai-api-key', apiKey),
  setClaudeApiKey: (apiKey: string) => ipcRenderer.invoke('set-claude-api-key', apiKey),
  setDeepseekApiKey: (apiKey: string) => ipcRenderer.invoke('set-deepseek-api-key', apiKey),
  getStoredCredentials: () => ipcRenderer.invoke('get-stored-credentials'),
  getCredentialLoadStatus: () => ipcRenderer.invoke('credentials-load-status'),
  discardUnreadableCredentials: () => ipcRenderer.invoke('credentials-discard-unreadable'),

  // Permissions
  checkPermissions: () => ipcRenderer.invoke('permissions:check'),
  requestMicPermission: () => ipcRenderer.invoke('permissions:request-mic'),


  // STT Provider Management
  setSttProvider: (
    provider:
      | 'none'
      | 'google'
      | 'groq'
      | 'openai'
      | 'deepgram'
      | 'elevenlabs'
      | 'azure'
      | 'ibmwatson'
      | 'soniox',
  ) => ipcRenderer.invoke('set-stt-provider', provider),
  getSttProvider: () => ipcRenderer.invoke('get-stt-provider'),
  setGroqSttApiKey: (apiKey: string) => ipcRenderer.invoke('set-groq-stt-api-key', apiKey),
  setOpenAiSttApiKey: (apiKey: string) => ipcRenderer.invoke('set-openai-stt-api-key', apiKey),
  setOpenAiSttBaseUrl: (url: string) => ipcRenderer.invoke('set-openai-stt-base-url', url),
  setDeepgramApiKey: (apiKey: string) => ipcRenderer.invoke('set-deepgram-api-key', apiKey),
  setElevenLabsApiKey: (apiKey: string) => ipcRenderer.invoke('set-elevenlabs-api-key', apiKey),
  setAzureApiKey: (apiKey: string) => ipcRenderer.invoke('set-azure-api-key', apiKey),
  setAzureRegion: (region: string) => ipcRenderer.invoke('set-azure-region', region),
  setIbmWatsonApiKey: (apiKey: string) => ipcRenderer.invoke('set-ibmwatson-api-key', apiKey),
  setGroqSttModel: (model: string) => ipcRenderer.invoke('set-groq-stt-model', model),
  setSonioxApiKey: (apiKey: string) => ipcRenderer.invoke('set-soniox-api-key', apiKey),
  setIbmWatsonRegion: (region: string) => ipcRenderer.invoke('set-ibmwatson-region', region),
  testSttConnection: (
    provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox',
    apiKey: string,
    region?: string,
  ) => ipcRenderer.invoke('test-stt-connection', provider, apiKey, region),

  // STT Config Events (Adapted from public PR #173)
  onSttConfigChanged: (callback: (data: { configured: boolean; provider: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('stt-config-changed', subscription);
    return () => {
      ipcRenderer.removeListener('stt-config-changed', subscription);
    };
  },
  onCredentialsChanged: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('credentials-changed', subscription);
    return () => {
      ipcRenderer.removeListener('credentials-changed', subscription);
    };
  },

  // Native Audio Service Events
  onNativeAudioTranscript: (
    callback: (transcript: { speaker: string; text: string; final: boolean }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('native-audio-transcript', subscription);
    return () => {
      ipcRenderer.removeListener('native-audio-transcript', subscription);
    };
  },
  onNativeAudioSuggestion: (
    callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('native-audio-suggestion', subscription);
    return () => {
      ipcRenderer.removeListener('native-audio-suggestion', subscription);
    };
  },
  onNativeAudioConnected: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('native-audio-connected', subscription);
    return () => {
      ipcRenderer.removeListener('native-audio-connected', subscription);
    };
  },
  onNativeAudioDisconnected: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('native-audio-disconnected', subscription);
    return () => {
      ipcRenderer.removeListener('native-audio-disconnected', subscription);
    };
  },
  onSuggestionGenerated: (
    callback: (data: { question: string; suggestion: string; confidence: number }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('suggestion-generated', subscription);
    return () => {
      ipcRenderer.removeListener('suggestion-generated', subscription);
    };
  },
  onSuggestionProcessingStart: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('suggestion-processing-start', subscription);
    return () => {
      ipcRenderer.removeListener('suggestion-processing-start', subscription);
    };
  },
  onSuggestionError: (callback: (error: { error: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('suggestion-error', subscription);
    return () => {
      ipcRenderer.removeListener('suggestion-error', subscription);
    };
  },
  generateSuggestion: (context: string, lastQuestion: string) =>
    ipcRenderer.invoke('generate-suggestion', context, lastQuestion),

  getNativeAudioStatus: () => ipcRenderer.invoke('native-audio-status'),
  getInputDevices: () => ipcRenderer.invoke('get-input-devices'),
  getOutputDevices: () => ipcRenderer.invoke('get-output-devices'),
  setRecognitionLanguage: (key: string) => ipcRenderer.invoke('set-recognition-language', key),
  getAiResponseLanguages: () => ipcRenderer.invoke('get-ai-response-languages'),
  setAiResponseLanguage: (language: string) =>
    ipcRenderer.invoke('set-ai-response-language', language),
  getSttLanguage: () => ipcRenderer.invoke('get-stt-language'),
  getAiResponseLanguage: () => ipcRenderer.invoke('get-ai-response-language'),
  onSttLanguageAutoDetected: (callback: (bcp47: string) => void) => {
    const subscription = (_: any, bcp47: string) => callback(bcp47);
    ipcRenderer.on('stt-language-auto-detected', subscription);
    return () => {
      ipcRenderer.removeListener('stt-language-auto-detected', subscription);
    };
  },
  onSystemAudioPermissionDenied: (callback: (message: string) => void) => {
    const subscription = (_: any, message: string) => callback(message);
    ipcRenderer.on('system-audio-permission-denied', subscription);
    return () => {
      ipcRenderer.removeListener('system-audio-permission-denied', subscription);
    };
  },
  getSystemAudioPermissionWarning: () => ipcRenderer.invoke('get-system-audio-permission-warning'),
  onDeviceSelectionApplied: (
    callback: (payload: {
      kind: 'input' | 'output';
      requested: string | null;
      actual: string | null;
      fellBack: boolean;
      reason?: string;
    }) => void,
  ) => {
    const subscription = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('device-selection-applied', subscription);
    return () => {
      ipcRenderer.removeListener('device-selection-applied', subscription);
    };
  },
  onAudioCaptureFailed: (
    callback: (payload: {
      channel: 'system' | 'mic';
      message: string;
      attempt: number;
      maxAttempts: number;
      terminal?: boolean;
      stuck?: boolean;
    }) => void,
  ) => {
    const subscription = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('audio-capture-failed', subscription);
    return () => {
      ipcRenderer.removeListener('audio-capture-failed', subscription);
    };
  },

  // STT Status Events
  onSttStatusChanged: (
    callback: (data: {
      state: 'connected' | 'reconnecting' | 'failed';
      provider: string;
      error?: string;
      channel: 'user' | 'interviewer';
      reconnectAttempts?: number;
    }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('stt-status', subscription);
    return () => {
      ipcRenderer.removeListener('stt-status', subscription);
    };
  },

  // Intelligence Mode IPC
  generateAssist: () => ipcRenderer.invoke('generate-assist'),
  generateWhatToSay: (
    question?: string,
    imagePaths?: string[],
  ) => ipcRenderer.invoke('generate-what-to-say', question, imagePaths),
  generateClarify: () => ipcRenderer.invoke('generate-clarify'),
  generateCodeHint: (imagePaths?: string[], problemStatement?: string) =>
    ipcRenderer.invoke('generate-code-hint', imagePaths, problemStatement),
  generateBrainstorm: (imagePaths?: string[], problemStatement?: string) =>
    ipcRenderer.invoke('generate-brainstorm', imagePaths, problemStatement),
  generateFollowUp: (intent: string, userRequest?: string) =>
    ipcRenderer.invoke('generate-follow-up', intent, userRequest),
  generateFollowUpQuestions: () => ipcRenderer.invoke('generate-follow-up-questions'),
  generateRecap: () => ipcRenderer.invoke('generate-recap'),
  submitManualQuestion: (question: string) =>
    ipcRenderer.invoke('submit-manual-question', question),
  getIntelligenceContext: () => ipcRenderer.invoke('get-intelligence-context'),
  testInjectTranscript: (segment: {
    speaker: string;
    text: string;
    timestamp?: number;
    final?: boolean;
  }) => ipcRenderer.invoke('test-inject-transcript', segment),
  resetIntelligence: () => ipcRenderer.invoke('reset-intelligence'),

  // Action Button Mode (Dynamic Recap / Brainstorm toggle)
  getActionButtonMode: () => ipcRenderer.invoke('get-action-button-mode'),
  setActionButtonMode: (mode: 'recap' | 'brainstorm') =>
    ipcRenderer.invoke('set-action-button-mode', mode),
  onActionButtonModeChanged: (callback: (mode: 'recap' | 'brainstorm') => void) => {
    const subscription = (_: any, mode: 'recap' | 'brainstorm') => callback(mode);
    ipcRenderer.on('action-button-mode-changed', subscription);
    return () => {
      ipcRenderer.removeListener('action-button-mode-changed', subscription);
    };
  },

  // Meeting Lifecycle
  startMeeting: (metadata?: any) => ipcRenderer.invoke('start-meeting', metadata),
  endMeeting: () => ipcRenderer.invoke('end-meeting'),
  finalizeMicSTT: () => ipcRenderer.invoke('finalize-mic-stt'),
  getRecentMeetings: () => ipcRenderer.invoke('get-recent-meetings'),
  getMeetingDetails: (id: string) => ipcRenderer.invoke('get-meeting-details', id),
  updateMeetingTitle: (id: string, title: string) =>
    ipcRenderer.invoke('update-meeting-title', { id, title }),
  updateMeetingSummary: (id: string, updates: any) =>
    ipcRenderer.invoke('update-meeting-summary', { id, updates }),
  deleteMeeting: (id: string) => ipcRenderer.invoke('delete-meeting', id),

  onMeetingsUpdated: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('meetings-updated', subscription);
    return () => {
      ipcRenderer.removeListener('meetings-updated', subscription);
    };
  },

  // Window Mode
  setWindowMode: (mode: 'launcher' | 'overlay', inactive?: boolean) =>
    ipcRenderer.invoke('set-window-mode', mode, inactive),

  // Intelligence Mode Events
  onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-assist-update', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-assist-update', subscription);
    };
  },
  onIntelligenceSuggestedAnswerToken: (
    callback: (data: { token: string; question: string; confidence: number }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-suggested-answer-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-suggested-answer-token', subscription);
    };
  },
  onIntelligenceSuggestedAnswer: (
    callback: (data: { answer: string; question: string; confidence: number }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-suggested-answer', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-suggested-answer', subscription);
    };
  },
  // Sprint 9: time-batched IPC token channel.
  onIntelligenceTokenBatch: (callback: (data: { kind: string; items: any[] }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-token-batch', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-token-batch', subscription);
    };
  },
  onIntelligenceRefinedAnswerToken: (
    callback: (data: { token: string; intent: string }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-refined-answer-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-refined-answer-token', subscription);
    };
  },
  onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-refined-answer', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-refined-answer', subscription);
    };
  },
  onIntelligenceRecapToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-recap-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-recap-token', subscription);
    };
  },
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-recap', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-recap', subscription);
    };
  },
  onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-clarify-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-clarify-token', subscription);
    };
  },
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-clarify', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-clarify', subscription);
    };
  },
  onIntelligenceFollowUpQuestionsToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-follow-up-questions-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-follow-up-questions-token', subscription);
    };
  },
  onIntelligenceFollowUpQuestionsUpdate: (callback: (data: { questions: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-follow-up-questions-update', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-follow-up-questions-update', subscription);
    };
  },
  onIntelligenceManualStarted: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('intelligence-manual-started', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-manual-started', subscription);
    };
  },
  onIntelligenceManualResult: (callback: (data: { answer: string; question: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-manual-result', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-manual-result', subscription);
    };
  },
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-mode-changed', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-mode-changed', subscription);
    };
  },
  onIntelligenceError: (callback: (data: { error: string; mode: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-error', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-error', subscription);
    };
  },
  onSessionReset: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('session-reset', subscription);
    return () => {
      ipcRenderer.removeListener('session-reset', subscription);
    };
  },

  // Streaming Chat
  streamGeminiChat: (
    message: string,
    imagePaths?: string[],
    context?: string,
    options?: { skipSystemPrompt?: boolean; ignoreKnowledgeMode?: boolean; meetingId?: string },
  ) => {
    const clientStreamId = ++chatStreamSeq;
    activeChatStreamId = clientStreamId;
    return ipcRenderer.invoke('gemini-chat-stream', message, imagePaths, context, { ...options, clientStreamId });
  },

  onGeminiStreamToken: (callback: (token: string) => void) => {
    const subscription = (_: any, token: string, id?: number) => { if (isActiveChatStream(id)) callback(token); };
    ipcRenderer.on('gemini-stream-token', subscription);
    return () => {
      ipcRenderer.removeListener('gemini-stream-token', subscription);
    };
  },

  onGeminiStreamDone: (callback: () => void) => {
    const subscription = (_: any, id?: number) => { if (isActiveChatStream(id)) callback(); };
    ipcRenderer.on('gemini-stream-done', subscription);
    return () => {
      ipcRenderer.removeListener('gemini-stream-done', subscription);
    };
  },

  onGeminiStreamError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string, id?: number) => { if (isActiveChatStream(id)) callback(error); };
    ipcRenderer.on('gemini-stream-error', subscription);
    return () => {
      ipcRenderer.removeListener('gemini-stream-error', subscription);
    };
  },

  // Model Management
  getDefaultModel: () => ipcRenderer.invoke('get-default-model'),
  setModel: (modelId: string) => ipcRenderer.invoke('set-model', modelId),
  setDefaultModel: (modelId: string) => ipcRenderer.invoke('set-default-model', modelId),
  toggleModelSelector: (coords: { x: number; y: number; activate?: boolean }) =>
    ipcRenderer.invoke('toggle-model-selector', coords),
  modelSelectorCloseIfOpen: () => ipcRenderer.invoke('model-selector:close-if-open'),

  // Settings Window
  toggleSettingsWindow: (coords?: { x: number; y: number }) =>
    ipcRenderer.invoke('toggle-settings-window', coords),

  // Groq Fast Text Mode
  getGroqFastTextMode: () => ipcRenderer.invoke('get-groq-fast-text-mode'),
  setGroqFastTextMode: (enabled: boolean) => ipcRenderer.invoke('set-groq-fast-text-mode', enabled),
  getCodexCliConfig: () => ipcRenderer.invoke('get-codex-cli-config'),
  setCodexCliConfig: (config: {
    enabled: boolean;
    path: string;
    model: string;
    fastModel: string;
    timeoutMs: number;
  }) => ipcRenderer.invoke('set-codex-cli-config', config),
  testCodexCli: (config?: {
    enabled?: boolean;
    path?: string;
    model?: string;
    fastModel?: string;
    timeoutMs?: number;
  }) => ipcRenderer.invoke('test-codex-cli', config),

  // Demo
  seedDemo: () => ipcRenderer.invoke('seed-demo'),

  // Audio Test
  startAudioTest: (deviceId?: string) => ipcRenderer.invoke('start-audio-test', deviceId),
  stopAudioTest: () => ipcRenderer.invoke('stop-audio-test'),
  onAudioTestLevel: (callback: (level: number) => void) => {
    const subscription = (_: any, level: number) => callback(level);
    ipcRenderer.on('audio-test-level', subscription);
    return () => {
      ipcRenderer.removeListener('audio-test-level', subscription);
    };
  },
  // UX4: parallel system-audio probe level meter. Wired during the existing
  // startAudioTest so users see both mic AND system audio levels in Settings
  // before starting a meeting.
  onAudioTestSystemLevel: (callback: (level: number) => void) => {
    const subscription = (_: any, level: number) => callback(level);
    ipcRenderer.on('audio-test-system-level', subscription);
    return () => {
      ipcRenderer.removeListener('audio-test-system-level', subscription);
    };
  },
  onAudioTestSystemError: (callback: (errorMessage: string) => void) => {
    const subscription = (_: any, errorMessage: string) => callback(errorMessage);
    ipcRenderer.on('audio-test-system-error', subscription);
    return () => {
      ipcRenderer.removeListener('audio-test-system-error', subscription);
    };
  },

  // Database
  flushDatabase: () => ipcRenderer.invoke('flush-database'),

  onUndetectableChanged: (callback: (state: boolean) => void) => {
    const subscription = (_: any, state: boolean) => callback(state);
    ipcRenderer.on('undetectable-changed', subscription);
    return () => {
      ipcRenderer.removeListener('undetectable-changed', subscription);
    };
  },

  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on('overlay-mouse-passthrough-changed', subscription);
    return () => {
      ipcRenderer.removeListener('overlay-mouse-passthrough-changed', subscription);
    };
  },

  onGroqFastTextChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on('groq-fast-text-changed', subscription);
    return () => {
      ipcRenderer.removeListener('groq-fast-text-changed', subscription);
    };
  },

  onModelChanged: (callback: (modelId: string) => void) => {
    const subscription = (_: any, modelId: string) => callback(modelId);
    ipcRenderer.on('model-changed', subscription);
    return () => {
      ipcRenderer.removeListener('model-changed', subscription);
    };
  },

  // Theme API
  getThemeMode: () => ipcRenderer.invoke('theme:get-mode'),
  setThemeMode: (mode: 'system' | 'light' | 'dark') => ipcRenderer.invoke('theme:set-mode', mode),
  onThemeChanged: (
    callback: (data: { mode: 'system' | 'light' | 'dark'; resolved: 'light' | 'dark' }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('theme:changed', subscription);
    return () => {
      ipcRenderer.removeListener('theme:changed', subscription);
    };
  },



  // Keybind Management
  getKeybinds: () => ipcRenderer.invoke('keybinds:get-all'),
  setKeybind: (id: string, accelerator: string) =>
    ipcRenderer.invoke('keybinds:set', id, accelerator),
  resetKeybinds: () => ipcRenderer.invoke('keybinds:reset'),
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => {
    const subscription = (_: any, keybinds: any) => callback(keybinds);
    ipcRenderer.on('keybinds:update', subscription);
    return () => {
      ipcRenderer.removeListener('keybinds:update', subscription);
    };
  },
  onKeybindRegistrationFailed: (callback: (data: { id: string; accelerator: string }) => void) => {
    const subscription = (_: any, data: { id: string; accelerator: string }) => callback(data);
    ipcRenderer.on('keybinds:registration-failed', subscription);
    return () => {
      ipcRenderer.removeListener('keybinds:registration-failed', subscription);
    };
  },

  // Global shortcut listener — fired stealthily from main process without focusing the window
  onGlobalShortcut: (callback: (data: { action: string }) => void) => {
    const subscription = (_: any, data: { action: string }) => callback(data);
    ipcRenderer.on('global-shortcut', subscription);
    return () => {
      ipcRenderer.removeListener('global-shortcut', subscription);
    };
  },

  // Stealth keyboard tap bridge. Three dead query-style IPCs were dropped in
  // the M5 cleanup — they had no main-side handler and were not called from
  // src/; tap state arrives via onStealthTapState instead.
  stealthTapAvailable: () => ipcRenderer.invoke('stealth-tap:available'),
  stealthTapOpenSettings: () => ipcRenderer.invoke('stealth-tap:open-settings'),
  stealthTapStop: () => ipcRenderer.invoke('stealth-tap:stop'),
  stealthTapStart: () => ipcRenderer.invoke('stealth-tap:start'),
  stealthTapShouldAutoEngage: () => ipcRenderer.invoke('stealth-tap:should-auto-engage'),
  stealthTapRefreshIme: () => ipcRenderer.invoke('stealth-tap:refresh-ime'),
  onStealthTapState: (cb: (state: { active: boolean; reason?: string }) => void) => {
    const sub = (_: any, state: { active: boolean; reason?: string }) => cb(state);
    ipcRenderer.on('stealth-tap-state', sub);
    return () => {
      ipcRenderer.removeListener('stealth-tap-state', sub);
    };
  },
  onStealthKeyCaptured: (
    cb: (ev: { keyCode: number; chars: string; flags: number; isKeyDown: boolean }) => void,
  ) => {
    const sub = (
      _: any,
      ev: { keyCode: number; chars: string; flags: number; isKeyDown: boolean },
    ) => cb(ev);
    ipcRenderer.on('stealth-key-captured', sub);
    return () => {
      ipcRenderer.removeListener('stealth-key-captured', sub);
    };
  },




  // Dynamic Model Discovery
  fetchProviderModels: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey: string) =>
    ipcRenderer.invoke('fetch-provider-models', provider, apiKey),
  setProviderPreferredModel: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', modelId: string) =>
    ipcRenderer.invoke('set-provider-preferred-model', provider, modelId),


  // Overlay Opacity (Stealth Mode)
  setOverlayOpacity: (opacity: number) => ipcRenderer.invoke('set-overlay-opacity', opacity),
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => {
    const subscription = (_: any, opacity: number) => callback(opacity);
    ipcRenderer.on('overlay-opacity-changed', subscription);
    return () => {
      ipcRenderer.removeListener('overlay-opacity-changed', subscription);
    };
  },

  // Verbose / Debug Logging
  getVerboseLogging: () => ipcRenderer.invoke('get-verbose-logging'),
  setVerboseLogging: (enabled: boolean) => ipcRenderer.invoke('set-verbose-logging', enabled),
  getMeetingRetention: () => ipcRenderer.invoke('get-meeting-retention'),
  setMeetingRetention: (retention: 'forever' | '7d' | '30d' | 'never') =>
    ipcRenderer.invoke('set-meeting-retention', retention),
  onMeetingRetentionChanged: (
    callback: (retention: 'forever' | '7d' | '30d' | 'never') => void,
  ) => {
    const subscription = (_: any, retention: 'forever' | '7d' | '30d' | 'never') =>
      callback(retention);
    ipcRenderer.on('meeting-retention-changed', subscription);
    return () => {
      ipcRenderer.removeListener('meeting-retention-changed', subscription);
    };
  },
  getProviderDataScopes: () => ipcRenderer.invoke('get-provider-data-scopes'),
  setProviderDataScopes: (scopes: any) => ipcRenderer.invoke('set-provider-data-scopes', scopes),
  onProviderDataScopesChanged: (callback: (scopes: any) => void) => {
    const subscription = (_: any, scopes: any) => callback(scopes);
    ipcRenderer.on('provider-data-scopes-changed', subscription);
    return () => {
      ipcRenderer.removeListener('provider-data-scopes-changed', subscription);
    };
  },
  getScreenUnderstandingMode: () => ipcRenderer.invoke('get-screen-understanding-mode'),
  setScreenUnderstandingMode: (mode: 'vision_first' | 'vision_only') =>
    ipcRenderer.invoke('set-screen-understanding-mode', mode),
  onScreenUnderstandingModeChanged: (
    callback: (mode: 'vision_first' | 'vision_only') => void,
  ) => {
    const subscription = (_: any, mode: 'vision_first' | 'vision_only') =>
      callback(mode);
    ipcRenderer.on('screen-understanding-mode-changed', subscription);
    return () => {
      ipcRenderer.removeListener('screen-understanding-mode-changed', subscription);
    };
  },
  getTechnicalInterviewVisionFirst: () =>
    ipcRenderer.invoke('get-technical-interview-vision-first'),
  setTechnicalInterviewVisionFirst: (enabled: boolean) =>
    ipcRenderer.invoke('set-technical-interview-vision-first', enabled),
  onTechnicalInterviewVisionFirstChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on('technical-interview-vision-first-changed', subscription);
    return () => {
      ipcRenderer.removeListener('technical-interview-vision-first-changed', subscription);
    };
  },
  // Deprecated aliases — kept so renderer builds compiled against the old API keep working.
  getTechnicalInterviewDirectVision: () =>
    ipcRenderer.invoke('get-technical-interview-direct-vision'),
  setTechnicalInterviewDirectVision: (enabled: boolean) =>
    ipcRenderer.invoke('set-technical-interview-direct-vision', enabled),
  onTechnicalInterviewDirectVisionChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on('technical-interview-vision-first-changed', subscription);
    return () => {
      ipcRenderer.removeListener('technical-interview-vision-first-changed', subscription);
    };
  },
  getLogFilePath: () => ipcRenderer.invoke('get-log-file-path'),
  openLogFile: () => ipcRenderer.invoke('open-log-file'),

  // Arch
  getArch: () => ipcRenderer.invoke('get-arch'),
  getOsVersion: () => ipcRenderer.invoke('get-os-version'),

  // Cropper API
  cropperConfirmed: (bounds: Electron.Rectangle) => ipcRenderer.send('cropper-confirmed', bounds),
  cropperCancelled: () => ipcRenderer.send('cropper-cancelled'),
  onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => {
    const subscription = (
      _: Electron.IpcRendererEvent,
      data: { hudPosition: { x: number; y: number } },
    ) => callback(data);
    ipcRenderer.on('reset-cropper', subscription);
    return () => {
      ipcRenderer.removeListener('reset-cropper', subscription);
    };
  },

  // Platform
  platform: process.platform,

  // Meeting interface theme — see ElectronAPI interface for rationale.
  setMeetingInterfaceTheme: (theme: string) => {
    ipcRenderer.send('interface-theme:set', theme);
  },
  onMeetingInterfaceThemeChanged: (callback: (theme: string) => void) => {
    const handler = (_evt: unknown, theme: string) => callback(theme);
    ipcRenderer.on('interface-theme:changed', handler);
    return () => {
      ipcRenderer.removeListener('interface-theme:changed', handler);
    };
  },

  // Cancel the in-flight chat stream. See ElectronAPI interface for rationale.
  cancelChatStream: () => {
    activeChatStreamId = null;
    ipcRenderer.send('gemini-chat-stream-stop');
  },
} as ElectronAPI);
