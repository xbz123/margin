// ipcHandlers.ts

import * as crypto from 'crypto';
import { LLM_PRESETS, modelTargetId, type LlmProvider, type ProviderConfigurationSave } from '../src/types/llmTarget';
import { resolveModelTarget } from './llm/llmTarget';
import type { GenerationTask } from './llm/generateTask';
import { app, BrowserWindow, dialog, ipcMain, shell, systemPreferences } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AudioDevices } from './audio/AudioDevices';
import { DatabaseManager } from './db/DatabaseManager'; // Import Database Manager
import { AppState } from './main';
import { DEFAULT_CODEX_SOURCE_CONFIG } from '../src/types/codexSource';
import { SettingsManager } from './services/SettingsManager';
import { mainText } from './services/mainStrings';
import { isUiLanguage, type UiLanguageResult } from '../src/types/uiLanguage';
import { SkillsManager } from './services/SkillsManager';
import { PromptSettingsError } from './services/PromptSettingsStore';
import { scenarioPrompt } from './llm/scenarioPrompts';
import type { PromptScene, PromptSettingsResult } from '../src/types/promptSettings';

import { AI_RESPONSE_LANGUAGES, RECOGNITION_LANGUAGES } from './config/languages';
import type { CredentialSaveResult } from '../src/types/credentialSave';
import { outboundAxios as axios, openAiSttEndpoint } from './services/outbound';
import { openExternalLink } from './services/navigationPolicy';
import { APP_IDENTITY } from './margin/appIdentity';
import { validateImagePath } from './utils/imagePathValidation';
import { registerDomesticSttHandlers } from './ipc/sttHandlers';
import { registerLocalContextHandlers } from './ipc/localContextHandlers';
import { SpeechActions, SpeechActionError, type SpeechAction, type SpeechActionKind } from './ipc/speechActions';
import { formatTranscriptItems, type TranscriptView } from './SessionTracker';
import type { ProviderDataScope } from './llm/ProviderRouter';
import { manualAnswerError, MANUAL_ANSWER_UNCONFIGURED, MANUAL_ANSWER_CANCELLED, InvalidImagePathError } from './direct-assist/errors';

// Interview actions that read speech: the action kind and the argument index of its action reference.
const SPEECH_ACTION_CHANNELS: Record<string, [SpeechActionKind, number]> = {
  'generate-what-to-say': ['what-to-say', 2], 'generate-clarify': ['clarify', 0], 'generate-follow-up': ['follow-up', 2],
  'generate-recap': ['recap', 0], 'generate-follow-up-questions': ['follow-up-questions', 0],
  'generate-code-hint': ['code-hint', 2], 'generate-brainstorm': ['brainstorm', 2],
};

export function initializeIpcHandlers(appState: AppState): void {
  const validateImages = (value: unknown): string[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 5 || value.some(item => typeof item !== 'string' || !item.trim())) throw new InvalidImagePathError();
    const paths = value.map(imagePath => {
      const result = validateImagePath(imagePath, app.getPath('userData'));
      if (!result.isValid) throw new InvalidImagePathError();
      return result.resolvedPath!;
    });
    const helper = appState.processingHelper.getLLMHelper();
    const task = helper.getCurrentGenerationTask();
    if (task) helper.dependPreparedImages(task, paths);
    return paths;
  };
  const persistCredentials = async (
    save: () => CredentialSaveResult,
    apply?: () => void | Promise<void>,
    applyWarning = 'Saved, but the running service could not apply the change. Restart the application to use the saved configuration.',
  ): Promise<CredentialSaveResult> => {
    let result: CredentialSaveResult;
    try {
      result = save();
    } catch {
      return { ok: false, code: 'write_failed', message: 'Credentials could not be saved. The previous credentials were kept.' };
    }
    if (!result.ok) return result;
    try {
      await apply?.();
      return result;
    } catch {
      return { ok: true, warning: applyWarning };
    }
  };
  const discardRemovedSttKey = (provider: string, key: string): void => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    if (!key.trim() && CredentialsManager.getInstance().getSttProvider() === provider) {
      appState.discardSttProviders();
    }
  };
  const speechActions = new SpeechActions({
    beginTask: startedAt => appState.processingHelper.getLLMHelper().beginGenerationTask('interview', undefined, undefined, startedAt),
    collect: options => appState.collectSpeech(options),
    markDictation: at => appState.markDictation(at),
    captureBase: cutoffAt => appState.getIntelligenceManager().captureBase(cutoffAt),
  });
  const visibleOwners = new Set<number>();
  const beginSpeech = (owner: any, payload: any) => {
    const helper = appState.processingHelper.getLLMHelper();
    const receipt = speechActions.begin(owner, payload);
    helper.clearPreparedInput(owner.id);
    return receipt;
  };
  appState.prepareCaptureAction = owner => beginSpeech(owner, { clientActionId: crypto.randomUUID(), kind: 'what-to-say', clickedAt: Date.now() });
  appState.cancelCaptureAction = (owner, id) => speechActions.cancelAction(owner, id);
  appState.isCaptureActionPending = (owner, id) => speechActions.isPending(owner, id);
  // The view an action reads once its speech is frozen. Previous assistant suggestions are
  // profile_history: left out when denied, otherwise declared so every later send rechecks them.
  const frozenView = (action: SpeechAction, declare: (scope: ProviderDataScope) => void, exclude?: Set<string>): Promise<TranscriptView> =>
    action.frozen.then(frozen => {
      action.task.speechEndedAt = frozen.frozenAt;
      const includeHistory = appState.processingHelper.getLLMHelper().deniedDataScopes(['profile_history']).length === 0;
      const view = appState.getIntelligenceManager().frozenView(frozen, action.base, exclude, includeHistory);
      if (includeHistory && (view.getLastAssistantMessage() !== null || view.getContext(Number.MAX_SAFE_INTEGER).some(item => item.role === 'assistant'))) declare('profile_history');
      return view;
    });
  const safeHandle = (
    channel: string,
    listener: (event: any, ...args: any[]) => Promise<any> | any,
  ) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      if (!['generate-assist', 'generate-what-to-say', 'generate-clarify', 'generate-follow-up', 'generate-recap', 'generate-follow-up-questions', 'submit-manual-question', 'generate-code-hint', 'generate-brainstorm'].includes(channel)) return listener(event, ...args);
      const helper = appState.processingHelper.getLLMHelper();
      const speech = SPEECH_ACTION_CHANNELS[channel];
      let task: GenerationTask<any> | undefined;
      let run = () => listener(event, ...args);
      try {
        if (speech) {
          // The action began at the click; its task and speech cut are reused exactly once.
          const action = speechActions.take(event.sender, args[speech[1]], speech[0]);
          task = action.task;
          const fixed = Array.from({ length: speech[1] }, (_, index) => args[index]);
          run = () => helper.withDeclaredScopes(declare => listener(event, ...fixed, () => frozenView(action, declare)));
        } else {
          speechActions.cancel(event.sender);
          task = helper.beginGenerationTask(); task.rendererOwner = event.sender;
        }
        helper.attachPresentation(task, event.sender, speech?.[0] ?? channel, visibleOwners.has(event.sender.id));
        const result = await helper.runGeneration(async () => {
          const value = await run();
          task!.terminalStatus ??= (value as any)?.error ? 'failed' : 'empty';
          return value;
        }, 'interview', undefined, task);
        task.terminalStatus ??= (result as any)?.error ? 'failed' : 'empty';
        if (visibleOwners.has(event.sender.id) && !event.sender.isDestroyed()) event.sender.send('intelligence-generation-terminal', helper.getTaskMetadata(task));
        return { ...(result as any), ...helper.getTaskMetadata(task) };
      } catch (error) {
        if (channel !== 'generate-what-to-say') throw error;
        return { answer: null, ...(task ? helper.getTaskMetadata(task) : { status: 'failed' }),
          error: !task && !(error instanceof SpeechActionError) ? MANUAL_ANSWER_UNCONFIGURED : task?.terminalStatus === 'cancelled' ? MANUAL_ANSWER_CANCELLED : manualAnswerError(error) };
      } finally { task?.close(); }
    });
  };

  registerLocalContextHandlers(safeHandle, () => {
    const helper = appState.processingHelper.getLLMHelper();
    helper.revokePreparedContext(); helper.cancelGenerationTasks('Local Context changed');
  }, english => mainText(english));

  const safeOn = (
    channel: string,
    listener: (event: any, ...args: any[]) => void,
  ) => {
    ipcMain.removeAllListeners(channel);
    ipcMain.on(channel, listener);
  };

  safeHandle('generation:presentation-ready', event => {
    if (!visibleOwners.has(event.sender.id)) {
      visibleOwners.add(event.sender.id);
      event.sender.once('destroyed', () => visibleOwners.delete(event.sender.id));
    }
  });
  safeOn('generation:first-visible', (event, requestId: unknown) => {
    try { appState.processingHelper.getLLMHelper().acknowledgeVisible(event.sender, requestId); } catch { /* An expired receipt cannot revive a task. */ }
  });
  safeHandle('generation:retry', async (event, requestId: unknown, clickedAt: unknown) => {
    const helper = appState.processingHelper.getLLMHelper();
    if (typeof clickedAt !== 'number' || !Number.isFinite(clickedAt) || clickedAt <= 0) throw new Error('Invalid retry time.');
    const { task, input } = helper.beginPreparedRetry(event.sender, requestId, Math.min(clickedAt, Date.now()), visibleOwners.has(event.sender.id));
    try {
      const answer = await helper.runGeneration(() => appState.getIntelligenceManager().runPreparedRetry(input), task.kind, undefined, task);
      if (!event.sender.isDestroyed()) event.sender.send('intelligence-generation-terminal', helper.getTaskMetadata(task));
      return { answer, ...helper.getTaskMetadata(task) };
    } catch (error: any) {
      if (!event.sender.isDestroyed()) event.sender.send('intelligence-generation-terminal', { ...helper.getTaskMetadata(task), error: error?.message });
      return { answer: null, error: error?.message ?? 'Generation failed', ...helper.getTaskMetadata(task) };
    } finally { task.close(); }
  });

  safeHandle('get-recognition-languages', async () => {
    return RECOGNITION_LANGUAGES;
  });

  safeHandle('get-ai-response-languages', async () => {
    return AI_RESPONSE_LANGUAGES;
  });

  safeHandle('set-ai-response-language', async (_, language: string) => {
    if (typeof language !== 'string' || !language.trim()) return { ok: false, code: 'write_failed', message: 'Invalid language value' };
    const sanitizedLanguage = language.trim();
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setAiResponseLanguage(sanitizedLanguage), () => {
      appState.processingHelper?.getLLMHelper?.()?.setAiResponseLanguage(sanitizedLanguage);
    });
  });

  safeHandle('get-stt-language', async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return CredentialsManager.getInstance().getSttLanguage();
  });

  safeHandle('get-ai-response-language', async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return CredentialsManager.getInstance().getAiResponseLanguage();
  });
  safeHandle(
    'update-content-dimensions',
    async (event, { width, height }: { width: number; height: number }) => {
      if (!width || !height) return;

      const senderWebContents = event.sender;
      const settingsWin = appState.settingsWindowHelper.getSettingsWindow();
      const overlayWin = appState.getWindowHelper().getOverlayWindow();
      const launcherWin = appState.getWindowHelper().getLauncherWindow();

      if (
        settingsWin &&
        !settingsWin.isDestroyed() &&
        settingsWin.webContents.id === senderWebContents.id
      ) {
        appState.settingsWindowHelper.setWindowDimensions(settingsWin, width, height);
      } else if (
        overlayWin &&
        !overlayWin.isDestroyed() &&
        overlayWin.webContents.id === senderWebContents.id
      ) {
        // NativelyInterface logic - Resize ONLY the overlay window using dedicated method
        appState.getWindowHelper().setOverlayDimensions(width, height);
      } else if (
        launcherWin &&
        !launcherWin.isDestroyed() &&
        launcherWin.webContents.id === senderWebContents.id
      ) {
        // EC-05 fix: launcher window resize events were previously silently ignored.
        // Log them so that if the launcher ever sends this IPC it's visible in logs.
        console.log(
          `[IPC] update-content-dimensions: launcher window resize request ${width}x${height} (ignored — launcher has fixed dimensions)`,
        );
      }
    },
  );

  // Centered variant: keeps horizontal center fixed during width changes.
  // Used by code-expansion animations to prevent the top pill from sliding sideways.
  safeHandle(
    'update-content-dimensions-centered',
    async (event, { width, height }: { width: number; height: number }) => {
      if (!width || !height) return;
      const senderWebContents = event.sender;
      const overlayWin = appState.getWindowHelper().getOverlayWindow();
      if (
        overlayWin &&
        !overlayWin.isDestroyed() &&
        overlayWin.webContents.id === senderWebContents.id
      ) {
        appState.getWindowHelper().setOverlayDimensionsCentered(width, height);
      }
    },
  );

  safeHandle('set-window-mode', async (event, mode: 'launcher' | 'overlay', inactive?: boolean) => {
    appState.getWindowHelper().setWindowMode(mode, inactive);
    return { success: true };
  });

  safeHandle('delete-screenshot', async (event, filePath: string) => {
    // Guard: only allow deletion of files within the app's own userData directory
    const userDataDir = app.getPath('userData');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn('[IPC] delete-screenshot: path outside userData rejected:', filePath);
      return { success: false, error: 'Path not allowed' };
    }
    const checked = validateImagePath(resolved, userDataDir);
    appState.processingHelper.getLLMHelper().revokePreparedImages(checked.resolvedPath ?? resolved);
    return appState.deleteScreenshot(resolved);
  });

  safeHandle('take-screenshot', async () => {
    try {
      const screenshotPath = await appState.takeScreenshot();
      const preview = await appState.getImagePreview(screenshotPath);
      return { path: screenshotPath, preview };
    } catch (error) {
      // console.error("Error taking screenshot:", error)
      throw error;
    }
  });

  safeHandle('take-selective-screenshot', async () => {
    try {
      const screenshotPath = await appState.takeSelectiveScreenshot();
      const preview = await appState.getImagePreview(screenshotPath);
      return { path: screenshotPath, preview };
    } catch (error) {
      // EC-04 fix: cast unknown error to Error before accessing .message
      if ((error as Error).message === 'Selection cancelled') {
        return { cancelled: true };
      }
      throw error;
    }
  });

  safeHandle('get-screenshots', async () => {
    // console.log({ view: appState.getView() })
    try {
      let previews = [];
      if (appState.getView() === 'queue') {
        previews = await Promise.all(
          appState.getScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path),
          })),
        );
      } else {
        previews = await Promise.all(
          appState.getExtraScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path),
          })),
        );
      }
      // previews.forEach((preview: any) => console.log(preview.path))
      return previews;
    } catch (error) {
      // console.error("Error getting screenshots:", error)
      throw error;
    }
  });

  safeHandle('toggle-window', async () => {
    appState.toggleMainWindow();
  });

  safeHandle('show-window', async (event, inactive?: boolean) => {
    // Default show main window (Launcher usually)
    appState.showMainWindow(inactive);
  });

  safeHandle('hide-window', async () => {
    appState.hideMainWindow();
  });

  safeHandle('show-overlay', async () => {
    appState.getWindowHelper().showOverlay();
  });

  safeHandle('hide-overlay', async () => {
    appState.getWindowHelper().hideOverlay();
  });

  safeHandle('get-meeting-active', async () => {
    return appState.getIsMeetingActive();
  });

  safeHandle('reset-queues', async () => {
    try {
      appState.clearQueues();
      // console.log("Screenshot queues have been cleared.")
      return { success: true };
    } catch (error: any) {
      // console.error("Error resetting queues:", error)
      return { success: false, error: error.message };
    }
  });

  // Generate suggestion from transcript - Natively-style text-only reasoning
  safeHandle('generate-suggestion', async (event, context: string, lastQuestion: string) => {
    try {
      const suggestion = await appState.processingHelper
        .getLLMHelper()
        .generateSuggestion(context, lastQuestion);
      return { suggestion };
    } catch (error: any) {
      // console.error("Error generating suggestion:", error)
      throw error;
    }
  });

  // Begin returns at once: providers keep running and the action channel freezes the speech.
  safeHandle('speech-action:begin', (event, payload: unknown) => beginSpeech(event.sender, payload));
  safeHandle('dictation:begin', (event, payload: unknown) => {
    const receipt = speechActions.beginDictation(event.sender, payload);
    appState.processingHelper.getLLMHelper().clearPreparedInput(event.sender.id);
    return receipt;
  });
  // Stop freezes its question in main; the chat request then consumes the same action.
  safeHandle('speech-action:freeze', async (event, ref: unknown) => {
    const action = speechActions.take(event.sender, ref, 'answer', false);
    const frozen = await action.frozen;
    action.question ??= frozen.dictation ?? '';
    return { speechActionId: action.id, question: action.question };
  });

  // IPC handler for analyzing image from file path
  safeHandle('analyze-image-file', async (event, filePath: string) => {
    const resolved = validateImages([filePath])![0];
    try {
      const result = await appState.processingHelper.getLLMHelper().analyzeImageFiles([resolved]);
      return result;
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle(
    'gemini-chat',
    async (
      event,
      message: string,
      imagePaths?: string[],
      context?: string,
      options?: { skipSystemPrompt?: boolean },
    ) => {
      try {
        imagePaths = validateImages(imagePaths);
        const result = await appState.processingHelper
          .getLLMHelper()
          .chatWithGemini(message, imagePaths, context, options?.skipSystemPrompt);

        console.log(`[IPC] gemini - chat response received`, { length: result?.length ?? 0 });

        // Don't process empty responses
        if (!result || result.trim().length === 0) {
          console.warn('[IPC] Empty response from LLM, not updating IntelligenceManager');
          return "I apologize, but I couldn't generate a response. Please try again.";
        }

        // Sync with IntelligenceManager so Follow-Up/Recap work
        const intelligenceManager = appState.getIntelligenceManager();

        // 1. Add user question to context (as 'user')
        // CRITICAL: Skip refinement check to prevent auto-triggering follow-up logic
        // The user's manual question is a NEW input, not a refinement of previous answer.
        intelligenceManager.addTranscript(
          {
            text: message,
            speaker: 'user',
            timestamp: Date.now(),
            final: true,
          },
          true,
        );

        // 2. Add assistant response and set as last message
        console.log(`[IPC] Updating IntelligenceManager with assistant message...`);
        intelligenceManager.addAssistantMessage(result);
        console.log(`[IPC] Updated IntelligenceManager.Last message`, {
          length: intelligenceManager.getLastAssistantMessage()?.length ?? 0,
        });

        // Log Usage
        intelligenceManager.logUsage('chat', message, result);

        return result;
      } catch (error: any) {
        // console.error("Error in gemini-chat handler:", error);
        throw error;
      }
    },
  );

  // Streaming IPC Handler
  let _chatStreamId = 0;
  // Keep IDs globally unique; supersession is per sender.
  const _chatStreamsBySender = new Map<number, { streamId: number; controller: AbortController }>();

  // Matches narrow identity/meta probes only. Kept tight so coding/normal asks don't trip it.
  // Prevents the small fast-mode model from over-firing the "I'm Margin" canned reply
  // (which used to escape the prompt's hard rule for any ambiguous input).
  const IDENTITY_PROBE_RE =
    /^\s*(who\s+(are|r)\s+(you|u|this|margin)|what\s+(are|r)\s+(you|u)|are\s+you\s+(chatgpt|gpt[-\s]?\d?|claude|gemini|llama|an?\s+(ai|bot|llm|model|assistant))|what('?s|\s+is)\s+your\s+(name|model)|which\s+(ai|model|llm)\s+are\s+you|who\s+(made|built|created|developed|trained)\s+(you|this|margin)|what\s+model\s+(are\s+you|do\s+you\s+use)|introduce\s+yourself)\s*\??\s*$/i;

  safeHandle(
    'gemini-chat-stream',
    async (
      event,
      message: string,
      imagePaths?: string[],
      context?: string,
      options?: { skipSystemPrompt?: boolean; ignoreKnowledgeMode?: boolean; clientStreamId?: number; generationKind?: 'interview' | 'written'; speechActionId?: string; clickedAt?: number; owner?: string },
    ) => {
      let myController: AbortController | null = null;
      let chatTask: GenerationTask<any> | undefined;
      // The preload's id for this request, sent back with every event so the window
      // can drop events of a cancelled or superseded stream (PLAN.md AG-17 review).
      const clientStreamId = options?.clientStreamId;
      try {
        console.log('[IPC] gemini-chat-stream started using LLMHelper.streamChat');
        appState.processingHelper.getLLMHelper().clearPreparedInput(event.sender.id);
        imagePaths = validateImages(imagePaths);
        const llmHelper = appState.processingHelper.getLLMHelper();
        myController = new AbortController();
        if (options?.owner !== undefined && !['natively', 'global', 'meeting'].includes(options.owner)) throw new Error('Invalid question owner.');
        if (options?.generationKind !== undefined && !['interview', 'written'].includes(options.generationKind)) throw new Error('Invalid question mode');
        // Stop sends the question main froze for its action and reuses that action's interview task.
        const speechAction = options?.speechActionId === undefined ? undefined
          : speechActions.take(event.sender, { speechActionId: options.speechActionId }, 'answer');
        if (!speechAction) speechActions.cancel(event.sender);
        const generationKind = speechAction ? 'interview' : options?.generationKind ?? 'written';
        if (speechAction) {
          const task = speechAction.task;
          chatTask = task;
          const controller = myController;
          controller.signal.addEventListener('abort', () => task.controller.abort(controller.signal.reason), { once: true });
          if (speechAction.question === undefined || message !== speechAction.question) throw new SpeechActionError();
        } else {
          const clickedAt = options?.clickedAt;
          if (clickedAt !== undefined && (typeof clickedAt !== 'number' || !Number.isFinite(clickedAt) || clickedAt <= 0)) throw new Error('Invalid question time.');
          chatTask = llmHelper.beginGenerationTask(generationKind, myController.signal, undefined, Math.min(clickedAt ?? Date.now(), Date.now()));
        }
        llmHelper.attachPresentation(chatTask, event.sender, speechAction ? 'answer' : 'text', visibleOwners.has(event.sender.id) && (!options?.owner || options.owner === 'natively'));
        llmHelper.dependPreparedImages(chatTask, imagePaths ?? []);
        chatTask.deferVisibleText = true;

        const senderId = event.sender.id;
        const myStreamId = ++_chatStreamId;
        const priorStream = _chatStreamsBySender.get(senderId);
        if (priorStream) {
          try { priorStream.controller.abort(); } catch { /* noop */ }
        }
        _chatStreamsBySender.set(senderId, { streamId: myStreamId, controller: myController });

        const intelligenceManager = appState.getIntelligenceManager();

        // Identity probe short-circuit — bypasses the LLM entirely so small models can't
        // reframe the canned reply or misfire it on coding asks (the original bug).
        // Regex is `^...$` anchored, so non-probe questions cannot match.
        if (!imagePaths?.length && typeof message === 'string') {
          const identityHit = IDENTITY_PROBE_RE.test(message)
            ? `I'm ${APP_IDENTITY.name}, an AI assistant.`
            : null;
          if (identityHit) {
            intelligenceManager.addTranscript(
              { text: message, speaker: 'user', timestamp: Date.now(), final: true },
              true,
            );
            // Guard against a newer chat stream having taken over while we were computing
            // the canned reply — matches the protection the LLM path uses around its token
            // loop. Prevents cross-stream UI bleed.
            if (_chatStreamsBySender.get(senderId)?.streamId !== myStreamId) {
              console.log(
                `[IPC] gemini-chat-stream ${myStreamId} (identity probe) superseded for sender ${senderId}, skipping emit.`,
              );
              return null;
            }
            event.sender.send('gemini-stream-token', identityHit, clientStreamId, { ...llmHelper.getTaskMetadata(chatTask), provider: 'application', model: APP_IDENTITY.name });
            chatTask.markVisible(identityHit);
            chatTask.terminalStatus = 'completed';
            await chatTask.waitForVisible();
            event.sender.send('gemini-stream-done', clientStreamId, { ...llmHelper.getTaskMetadata(chatTask), provider: 'application', model: APP_IDENTITY.name });
            intelligenceManager.addAssistantMessage(identityHit);
            intelligenceManager.logUsage('chat', message, identityHit);
            return null;
          }
        }

        // Capture rolling context BEFORE adding the new user message — otherwise the
        // 100s window would echo back the user's just-typed message as both context and
        // question, confusing small models (the "20-char context" log line was just an echo).
        let autoContextSnapshot: string | undefined;
        const declaredScopes: ProviderDataScope[] = [];
        if (speechAction) {
          // Both channels as frozen for the action, without the dictated question itself.
          const frozen = await speechAction.frozen;
          const view = await frozenView(speechAction, scope => declaredScopes.push(scope), new Set(frozen.dictationKeys));
          const transcript = formatTranscriptItems(view.getContext(100));
          if (transcript.trim()) context = context ? `${context}\n\nRecent conversation:\n${transcript}` : transcript;
        } else if (!context) {
          try {
            const snap = intelligenceManager.getFormattedContext(100);
            if (snap && snap.trim().length > 0) autoContextSnapshot = snap;
          } catch (ctxErr) {
            console.warn('[IPC] Failed to capture pre-turn context:', ctxErr);
          }
        }

        // Now add USER message to IntelligenceManager (after context snapshot)
        intelligenceManager.addTranscript(
          {
            text: message,
            speaker: 'user',
            timestamp: Date.now(),
            final: true,
          },
          true,
        );

        let fullResponse = '';

        if (!context && autoContextSnapshot) {
          context = autoContextSnapshot;
          console.log(
            `[IPC] Auto-injected 100s context for gemini-chat-stream (${context.length} chars)`,
          );
        }

        // Typed questions default to written; the existing Question mode can override it.
        const systemPromptOverride = options?.skipSystemPrompt ? '' : scenarioPrompt(generationKind, llmHelper.getPromptTier() === 'tiny');

        try {
          // USE streamChat which handles routing. Pass the abort signal as
          // the trailing arg so the generator stops yielding when this stream
          // is superseded or explicitly cancelled via gemini-chat-stream-stop.
          // The signature accepts a final optional `abortSignal?: AbortSignal`
          // that streamChat extracts from its variadic args.
          const stream = llmHelper.runGenerationStream(() => llmHelper.streamChat(
            message,
            imagePaths,
            context,
            systemPromptOverride,
            options?.ignoreKnowledgeMode,
            true, // scenarioPrompt already includes the settled default layers
            declaredScopes, // extraDataScopes
            myController!.signal,
          ), generationKind, myController.signal, chatTask);

          for await (const token of stream) {
            // Bail if a newer stream has taken over (user triggered a new request)
            if (_chatStreamsBySender.get(senderId)?.streamId !== myStreamId) {
              console.log(
                `[IPC] gemini-chat-stream ${myStreamId} superseded for sender ${senderId}, stopping.`,
              );
              return null;
            }
            chatTask.markVisible(token);
            chatTask.displayedText += token;
            event.sender.send('gemini-stream-token', token, clientStreamId, llmHelper.getTaskMetadata(chatTask));
            fullResponse += token;
          }

          // Final check: only send done if we are still the active stream
          if (_chatStreamsBySender.get(senderId)?.streamId === myStreamId) {
            event.sender.send('gemini-stream-done', clientStreamId, llmHelper.getTaskMetadata(chatTask));

            // Update IntelligenceManager with ASSISTANT message after completion
            if (fullResponse.trim().length > 0) {
              intelligenceManager.addAssistantMessage(fullResponse, llmHelper.getTaskMetadata(chatTask));
              // Log Usage for streaming chat
              intelligenceManager.logUsage('chat', message, fullResponse, llmHelper.getTaskMetadata(chatTask));
            }
          }
        } catch (streamError: any) {
          console.error('[IPC] Streaming error:', streamError);
          if (chatTask) {
            if (fullResponse.trim()) intelligenceManager.addAssistantMessage(fullResponse, llmHelper.getTaskMetadata(chatTask));
            intelligenceManager.logUsage('chat', message, fullResponse, llmHelper.getTaskMetadata(chatTask));
          }
          if (_chatStreamsBySender.get(senderId)?.streamId === myStreamId) {
            event.sender.send(
              'gemini-stream-error',
              streamError.message || 'Unknown streaming error',
              clientStreamId,
              llmHelper.getTaskMetadata(chatTask),
            );
          }
        }

        return null; // Return null as data is sent via events
      } catch (error: any) {
        console.error('[IPC] Error in gemini-chat-stream setup:', error);
        throw error;
      } finally {
        chatTask?.close();
        if (myController) {
          const current = _chatStreamsBySender.get(event.sender.id);
          if (current?.controller === myController) {
            _chatStreamsBySender.delete(event.sender.id);
          }
        }
      }
    },
  );

  // Renderer-driven cancellation for the sender's active chat stream.
  safeOn('gemini-chat-stream-stop', (event) => {
    const senderId = event.sender.id;
    const stream = _chatStreamsBySender.get(senderId);
    if (stream) appState.processingHelper.getLLMHelper().clearPreparedInput(senderId);
    if (stream) {
      try { stream.controller.abort(); } catch { /* noop */ }
      _chatStreamsBySender.delete(senderId);
    }
  });

  safeHandle('quit-app', () => {
    app.quit();
  });

  safeHandle('delete-meeting', async (_, id: string) => {
    return DatabaseManager.getInstance().deleteMeeting(id);
  });

  // Window movement handlers
  safeHandle('move-window-left', async () => {
    appState.moveWindowLeft();
  });

  safeHandle('move-window-right', async () => {
    appState.moveWindowRight();
  });

  safeHandle('move-window-up', async () => {
    appState.moveWindowUp();
  });

  safeHandle('move-window-down', async () => {
    appState.moveWindowDown();
  });

  safeHandle('center-and-show-window', async () => {
    appState.centerAndShowWindow();
  });

  // Window Controls
  safeHandle('window-minimize', async () => {
    appState.getWindowHelper().minimizeWindow();
  });

  safeHandle('window-maximize', async () => {
    appState.getWindowHelper().maximizeWindow();
  });

  safeHandle('window-close', async () => {
    appState.getWindowHelper().closeWindow();
  });

  safeHandle('window-is-maximized', async () => {
    return appState.getWindowHelper().isMainWindowMaximized();
  });

  // Settings Window
  safeHandle('toggle-settings-window', (event, { x, y } = {}) => {
    appState.settingsWindowHelper.toggleWindow(x, y);
  });

  // Open the launcher's SettingsOverlay on a specific tab (callable from any window)
  safeHandle('settings:open-tab', (_, tab: string) => {
    const launcherWin = appState.getWindowHelper().getLauncherWindow();
    if (launcherWin && !launcherWin.isDestroyed()) {
      launcherWin.webContents.send('settings:open-tab', tab);
      if (appState.getUndetectable()) {
        launcherWin.showInactive();
      } else {
        launcherWin.show();
        launcherWin.focus();
      }
    }
  });

  safeHandle('close-settings-window', () => {
    appState.settingsWindowHelper.closeWindow();
  });

  safeHandle('set-undetectable', async (_, state: boolean) => {
    appState.setUndetectable(state);
    // Return the AUTHORITATIVE final state so the renderer can reconcile / roll
    // back its optimistic toggle instead of assuming success (RC-2).
    return { success: true, state: appState.getUndetectable() };
  });

  safeHandle('set-disguise', async (_, mode: 'terminal' | 'settings' | 'activity' | 'none') => {
    appState.setDisguise(mode);
    return { success: true };
  });

  safeHandle('get-undetectable', async () => {
    return appState.getUndetectable();
  });

  // Adapted from public PR #113
  safeHandle('set-overlay-mouse-passthrough', async (_, enabled: boolean) => {
    appState.setOverlayMousePassthrough(enabled);
    // Authoritative final state for renderer reconciliation (RC-2).
    return { success: true, enabled: appState.getOverlayMousePassthrough() };
  });

  safeHandle('toggle-overlay-mouse-passthrough', async () => {
    const enabled = appState.toggleOverlayMousePassthrough();
    return { success: true, enabled };
  });

  safeHandle('get-overlay-mouse-passthrough', async () => {
    return appState.getOverlayMousePassthrough();
  });

  safeHandle('get-disguise', async () => {
    return appState.getDisguise();
  });

  safeHandle('set-open-at-login', async (_, openAtLogin: boolean) => {
    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: false,
      path: app.getPath('exe'), // Explicitly point to executable for production reliability
    });
    return { success: true };
  });

  safeHandle('get-open-at-login', async () => {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  });

  safeHandle('get-verbose-logging', async () => {
    return appState.getVerboseLogging();
  });

  safeHandle('set-verbose-logging', async (_, enabled: boolean) => {
    appState.setVerboseLogging(enabled);
    return { success: true };
  });

  safeHandle('get-meeting-retention', async () => {
    return SettingsManager.getInstance().get('meetingRetention') ?? 'forever';
  });

  safeHandle('ui-language:get', () => SettingsManager.getInstance().getUiLanguage());

  // Saved before any window or menu changes, so a failed write leaves every surface unchanged.
  safeHandle('ui-language:set', (_, language: unknown): UiLanguageResult => {
    if (!isUiLanguage(language)) return { ok: false, message: 'Unsupported interface language.' };
    try {
      SettingsManager.getInstance().saveUiLanguage(language);
    } catch {
      return { ok: false, message: 'The interface language could not be saved.' };
    }
    try {
      appState.refreshLocalizedMenus();
    } catch (error) {
      console.warn('[ui-language:set] Menus could not be rebuilt:', error);
    }
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send('ui-language:changed', language);
      } catch {
        // Renderer may be tearing down between isDestroyed() and send.
      }
    });
    return { ok: true, language };
  });

  safeHandle('set-meeting-retention', async (_, retention: 'forever' | '7d' | '30d' | 'never') => {
    if (!['forever', '7d', '30d', 'never'].includes(retention)) {
      return { success: false, error: 'invalid_retention' };
    }
    SettingsManager.getInstance().set('meetingRetention', retention);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('meeting-retention-changed', retention);
      }
    });
    return { success: true };
  });

  safeHandle('get-provider-data-scopes', async () => {
    return SettingsManager.getInstance().get('providerDataScopes') ?? {};
  });

  safeHandle('set-provider-data-scopes', async (_, scopes: Record<string, boolean>) => {
    if (!scopes || typeof scopes !== 'object') {
      return { success: false, error: 'invalid_scopes' };
    }
    const allowedKeys = new Set([
      'transcript',
      'screenshots',
      'profile_history',
    ]);
    const sanitized: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(scopes)) {
      if (allowedKeys.has(key) && typeof value === 'boolean') {
        sanitized[key] = value;
      }
    }
    SettingsManager.getInstance().set('providerDataScopes', sanitized as any);
    appState.processingHelper.getLLMHelper().cancelGenerationTasks('Provider data scopes changed');
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('provider-data-scopes-changed', sanitized);
      }
    });
    return { success: true };
  });

  safeHandle('get-technical-interview-vision-first', async () => {
    return SettingsManager.getInstance().getTechnicalInterviewVisionFirst();
  });

  safeHandle('set-technical-interview-vision-first', async (_, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'invalid_value' };
    }
    SettingsManager.getInstance().set('technicalInterviewVisionFirst', enabled);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('technical-interview-vision-first-changed', enabled);
      }
    });
    return { success: true };
  });

  // Legacy alias for renderer builds that still call the old IPC name.
  // Maps the deprecated technicalInterviewDirectVision channel onto the new
  // technicalInterviewVisionFirst getter/setter so old renderer builds keep working.
  safeHandle('get-technical-interview-direct-vision', async () => {
    return SettingsManager.getInstance().getTechnicalInterviewVisionFirst();
  });
  safeHandle('set-technical-interview-direct-vision', async (_, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'invalid_value' };
    }
    SettingsManager.getInstance().set('technicalInterviewVisionFirst', enabled);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('technical-interview-vision-first-changed', enabled);
      }
    });
    return { success: true };
  });

  safeHandle('get-log-file-path', async () => {
    try {
      return path.join(app.getPath('logs'), 'debug.log');
    } catch {
      return null;
    }
  });

  safeHandle('open-log-file', async () => {
    try {
      const logPath = path.join(app.getPath('logs'), 'debug.log');
      // Ensure the file exists before opening
      if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, '', { mode: 0o600 });
      }
      await shell.openPath(logPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Fire-and-forget: renderer forwards its console output to the main-process log file.
  // Only written when verbose logging is enabled. Hardened against log injection
  // (CWE-117) and rotation thrash by validating types, capping length, stripping
  // control characters, and rate-limiting per sender.
  const FORWARD_LOG_MAX_LEN = 4 * 1024;
  const FORWARD_LOG_RATE_REFILL_MS = 1_000;
  const FORWARD_LOG_RATE_BUCKET = 200;
  const _forwardLogBuckets = new Map<number, { tokens: number; lastRefill: number }>();
  safeOn('forward-log-to-file', (event, level: unknown, msg: unknown) => {
    if (!appState.getVerboseLogging()) return;
    if (typeof level !== 'string' || typeof msg !== 'string') return;

    const senderId = event.sender?.id ?? -1;
    const now = Date.now();
    let bucket = _forwardLogBuckets.get(senderId);
    if (!bucket) {
      bucket = { tokens: FORWARD_LOG_RATE_BUCKET, lastRefill: now };
      _forwardLogBuckets.set(senderId, bucket);
      // Reap the bucket when the renderer goes away so the Map cannot grow
      // unbounded across renderer reloads / hidden-window churn.
      try {
        event.sender?.once?.('destroyed', () => {
          _forwardLogBuckets.delete(senderId);
        });
      } catch { /* noop */ }
    } else {
      const elapsed = now - bucket.lastRefill;
      if (elapsed > 0) {
        const refill = Math.floor((elapsed * FORWARD_LOG_RATE_BUCKET) / FORWARD_LOG_RATE_REFILL_MS);
        if (refill > 0) {
          bucket.tokens = Math.min(FORWARD_LOG_RATE_BUCKET, bucket.tokens + refill);
          bucket.lastRefill += Math.floor((refill * FORWARD_LOG_RATE_REFILL_MS) / FORWARD_LOG_RATE_BUCKET);
        }
      }
    }
    if (bucket.tokens <= 0) return;
    bucket.tokens -= 1;

    const tag =
      level === 'error' ? '[RENDERER-ERROR]' : level === 'warn' ? '[RENDERER-WARN]' : '[RENDERER]';
    const sanitized = msg
      .replace(/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ')
      .slice(0, FORWARD_LOG_MAX_LEN);
    console.log(`${tag}[${senderId}] ${sanitized}`);
  });

  // Meeting interface theme cross-window broadcast. The settings window writes
  // localStorage + sends this IPC; main re-broadcasts to every renderer so the
  // overlay window's React state updates without depending on the same-origin
  // `storage` event (which does not cross BrowserWindow boundaries in Electron).
  // Without this, switching the meeting interface theme while the overlay is
  // hidden leaves it with stale CSS on the next meeting start — manifest as a
  // half-painted UI that requires force-quit.
  // Allowlist must mirror MeetingInterfaceTheme in src/lib/meetingInterfaceTheme.ts.
  // Any string that reaches a renderer via interface-theme:changed ends up in
  // a `data-interface-theme={value}` DOM attribute on the overlay's wrapper
  // div (NativelyInterface.tsx). Without an allowlist, a compromised or buggy
  // renderer could broadcast an arbitrary string — at best CSS selector
  // mismatch (overlay falls back to default), at worst an attribute-injection
  // vector if any consumer ever switched from `setAttribute` to template
  // literals. Hardening the trust boundary at the broadcast point is cheap.
  const VALID_INTERFACE_THEMES = new Set(['default', 'liquid-glass', 'modern']);
  safeOn('interface-theme:set', (_event, theme: string) => {
    if (typeof theme !== 'string' || !VALID_INTERFACE_THEMES.has(theme)) {
      // Truncate + strip control chars before logging — a 64-char payload can
      // still embed \n/\r to forge log lines if a future log shipper parses
      // newline-delimited records.
      const safe = typeof theme === 'string'
        ? theme.slice(0, 64).replace(/[\r\n\x00-\x1f]/g, '?')
        : typeof theme;
      console.warn(`[interface-theme:set] Rejected unknown theme: ${safe}`);
      return;
    }
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send('interface-theme:changed', theme);
      } catch {
        // Renderer may be tearing down between isDestroyed() and send.
      }
    });
  });

  safeHandle('get-arch', async () => {
    return process.arch;
  });

  safeHandle('get-os-version', async () => {
    const platform = process.platform;
    if (platform === 'darwin') {
      const darwinMajor = parseInt(os.release().split('.')[0] || '0', 10);
      // Darwin 25+ = macOS 26+ (calendar-year scheme), Darwin 20-24 = macOS 11-15
      const macosMajor =
        darwinMajor >= 25 ? darwinMajor + 1 : darwinMajor >= 20 ? darwinMajor - 9 : null;
      return macosMajor ? `macOS ${macosMajor}` : `macOS ${os.release()}`;
    }
    if (platform === 'win32') {
      const release = os.release();
      // Windows 11 build starts at 22000
      const majorBuild = parseInt(release.split('.')[2] || '0', 10);
      return majorBuild >= 22000 ? `Windows 11` : `Windows 10`;
    }
    return os.type();
  });

  // LLM Model Management Handlers
  safeHandle('get-current-llm-config', async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return {
        provider: llmHelper.getCurrentProvider(),
        model: llmHelper.getCurrentModelSelection(),
      };
    } catch (error: any) {
      // console.error("Error getting current LLM config:", error);
      throw error;
    }
  });

  safeHandle('switch-to-gemini', async (_, apiKey?: string, modelId?: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(
      () => apiKey ? CredentialsManager.getInstance().setGeminiApiKey(apiKey) : { ok: true },
      () => appState.processingHelper.getLLMHelper().switchToGemini(apiKey, modelId),
      apiKey ? undefined : 'No credentials were saved. The provider switch could not be applied. Please try again.',
    );
  });

  safeHandle('set-provider-configuration', async (_, value: ProviderConfigurationSave) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    const manager = CredentialsManager.getInstance();
    return persistCredentials(() => manager.setProviderConfiguration(value), () => {
      const helper = appState.processingHelper.getLLMHelper();
      helper.configureProvider(manager.getProviderConfigurations()[value.provider], manager.getProviderApiKey(value.provider));
      appState.getIntelligenceManager().resetEngine();
      appState.getIntelligenceManager().initializeLLMs();
      appState.sendModelChanged(helper.getCurrentModelSelection());
    });
  });

  safeHandle('get-generation-policy', async () => require('./services/CredentialsManager').CredentialsManager.getInstance().getGenerationPolicy());
  safeHandle('set-generation-policy', async (_, value) => {
    const manager = require('./services/CredentialsManager').CredentialsManager.getInstance();
    const helper = appState.processingHelper.getLLMHelper();
    return persistCredentials(() => { helper.validateGenerationTargets(helper.getCurrentModelSelection(), value); return manager.setGenerationPolicy(value, helper.getCodexCliConfig(), helper.getGroqFastTextMode()); }, () => helper.setGenerationPolicy(manager.getGenerationPolicy()));
  });

  // Dedicated API key setters (for Settings UI Save buttons)
  safeHandle('set-gemini-api-key', async (_, apiKey: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setGeminiApiKey(apiKey), () => {
      appState.processingHelper.getLLMHelper().setApiKey(apiKey);
      appState.getIntelligenceManager().resetEngine();
      appState.getIntelligenceManager().initializeLLMs();
    });
  });

  safeHandle('set-groq-api-key', async (_, apiKey: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setGroqApiKey(apiKey), () => {
      appState.processingHelper.getLLMHelper().setGroqApiKey(apiKey);
      appState.getIntelligenceManager().resetEngine();
      appState.getIntelligenceManager().initializeLLMs();
    });
  });

  safeHandle('set-openai-api-key', async (_, apiKey: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setOpenaiApiKey(apiKey), () => {
      appState.processingHelper.getLLMHelper().setOpenaiApiKey(apiKey);
      appState.getIntelligenceManager().resetEngine();
      appState.getIntelligenceManager().initializeLLMs();
    });
  });

  safeHandle('set-claude-api-key', async (_, apiKey: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setClaudeApiKey(apiKey), () => {
      appState.processingHelper.getLLMHelper().setClaudeApiKey(apiKey);
      appState.getIntelligenceManager().resetEngine();
      appState.getIntelligenceManager().initializeLLMs();
    });
  });

  safeHandle('set-deepseek-api-key', async (_, apiKey: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setDeepseekApiKey(apiKey), () => {
      appState.processingHelper.getLLMHelper().setDeepseekApiKey(apiKey);
      appState.getIntelligenceManager().resetEngine();
      appState.getIntelligenceManager().initializeLLMs();
    });
  });

  // Get stored API keys (masked for UI display)
  // A credential file that could not be decrypted blocks every save (AG-22). Settings
  // shows that state and offers a confirmed discard that keeps a backup.
  safeHandle('credentials-load-status', async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return CredentialsManager.getInstance().getLoadStatus();
  });

  safeHandle('credentials-discard-unreadable', async () => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return CredentialsManager.getInstance().discardUnreadableCredentials();
  });

  safeHandle('get-stored-credentials', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const creds = CredentialsManager.getInstance().getAllCredentials();
      // Return masked versions for security (just indicate if set)
      const hasKey = (key?: string) => !!(key && key.trim().length > 0);

      return {
        providerConfigurations: CredentialsManager.getInstance().getProviderConfigurations(),
        hasGeminiKey: hasKey(creds.geminiApiKey),
        hasGroqKey: hasKey(creds.groqApiKey),
        hasOpenaiKey: hasKey(creds.openaiApiKey),
        hasClaudeKey: hasKey(creds.claudeApiKey),
        hasDeepseekKey: hasKey(creds.deepseekApiKey),
        sttProvider: CredentialsManager.getInstance().getSttProvider(),
        groqSttModel: creds.groqSttModel || 'whisper-large-v3-turbo',
        hasSttGroqKey: hasKey(creds.groqSttApiKey),
        hasSttOpenaiKey: hasKey(creds.openAiSttApiKey),
        hasSonioxKey: hasKey(creds.sonioxApiKey),
        // STT key values — returned so the settings UI can pre-populate input fields.
        // SECURITY FIX (P0): Return masked keys only, never raw API keys.
        // The hasSttGroqKey boolean tells UI if key exists — no raw key needed.
        sttGroqKey: creds.groqSttApiKey ? `sk-...${creds.groqSttApiKey.slice(-4)}` : '',
        sttOpenaiKey: creds.openAiSttApiKey ? `sk-...${creds.openAiSttApiKey.slice(-4)}` : '',
        sttSonioxKey: creds.sonioxApiKey ? `sk-...${creds.sonioxApiKey.slice(-4)}` : '',
        openAiSttBaseUrl: creds.openAiSttBaseUrl || '',
        // Dynamic Model Discovery - preferred models
        geminiPreferredModel: creds.geminiPreferredModel || undefined,
        groqPreferredModel: creds.groqPreferredModel || undefined,
        openaiPreferredModel: creds.openaiPreferredModel || undefined,
        claudePreferredModel: creds.claudePreferredModel || undefined,
        deepseekPreferredModel: creds.deepseekPreferredModel || undefined,
      };
    } catch (error: any) {
      // SECURITY FIX (P0): Error fallback returns masked keys, not raw strings
      return {
        hasGeminiKey: false,
        hasGroqKey: false,
        hasOpenaiKey: false,
        hasClaudeKey: false,
        hasDeepseekKey: false,
        sttProvider: 'none',
        groqSttModel: 'whisper-large-v3-turbo',
        hasSttGroqKey: false,
        hasSttOpenaiKey: false,
        hasSonioxKey: false,
        sttGroqKey: '',
        sttOpenaiKey: '',
        sttSonioxKey: '',
      };
    }
  });

  // ==========================================
  // Dynamic Model Discovery Handlers
  // ==========================================

  safeHandle(
    'fetch-provider-models',
    async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey: string) => {
      try {
        // Fall back to stored key if no key was explicitly provided
        let key = apiKey?.trim();
        if (!key) {
          const { CredentialsManager } = require('./services/CredentialsManager');
          const cm = CredentialsManager.getInstance();
          if (provider === 'gemini') key = cm.getGeminiApiKey();
          else if (provider === 'groq') key = cm.getGroqApiKey();
          else if (provider === 'openai') key = cm.getOpenaiApiKey();
          else if (provider === 'claude') key = cm.getClaudeApiKey();
          else if (provider === 'deepseek') key = cm.getDeepseekApiKey();
        }

        if (!key) {
          return { success: false, error: 'No API key available. Please save a key first.' };
        }

        const { fetchProviderModels } = require('./utils/modelFetcher');
        if (apiKey?.trim()) throw new Error('Save the complete provider configuration before fetching models.');
        const { CredentialsManager } = require('./services/CredentialsManager');
        const models = await fetchProviderModels(provider, key, CredentialsManager.getInstance().getProviderConfigurations()[provider]);
        return { success: true, models };
      } catch (error: any) {
        console.error(`[IPC] Failed to fetch ${provider} models`);
        const msg =
          error?.response?.data?.error?.message || error.message || 'Failed to fetch models';
        return { success: false, error: msg };
      }
    },
  );

  safeHandle(
    'set-provider-preferred-model',
    async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', modelId: string) => {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const manager = CredentialsManager.getInstance();
      return persistCredentials(() => manager.setPreferredModel(provider, modelId), () => {
        const helper = appState.processingHelper.getLLMHelper();
        helper.configureProvider(manager.getProviderConfigurations()[provider], manager.getProviderApiKey(provider));
        appState.sendModelChanged(helper.getCurrentModelSelection());
      });
    },
  );

  // ==========================================
  // STT Provider Management Handlers
  // ==========================================

  registerDomesticSttHandlers(safeHandle, async () => {
    await appState.reconfigureSttProvider();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('credentials-changed');
    }
  });

  safeHandle(
    'set-stt-provider',
    async (_, provider: 'none' | 'groq' | 'openai' | 'soniox' | 'aliyun' | 'doubao') => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setSttProvider(provider), async () => {
      await appState.reconfigureSttProvider();
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
    });
  },
  );

  safeHandle('get-stt-provider', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      return CredentialsManager.getInstance().getSttProvider();
    } catch (error: any) {
      return 'none';
    }
  });

  safeHandle('set-groq-stt-api-key', async (_, apiKey: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setGroqSttApiKey(apiKey), async () => {
      discardRemovedSttKey('groq', apiKey);
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
    });
  });

  safeHandle('set-openai-stt-api-key', async (_, apiKey: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setOpenAiSttApiKey(apiKey), async () => {
      discardRemovedSttKey('openai', apiKey);
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
    });
  });

  safeHandle('set-openai-stt-base-url', async (_, url: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setOpenAiSttBaseUrl(url), async () => {
      await appState.reconfigureSttProvider();
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
    });
  });

  safeHandle('set-groq-stt-model', async (_, model: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setGroqSttModel(model), async () => {
      await appState.reconfigureSttProvider();
    });
  });

  safeHandle('set-soniox-api-key', async (_, apiKey: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setSonioxApiKey(apiKey), async () => {
      discardRemovedSttKey('soniox', apiKey);
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
    });
  });

  // Helper to sanitize error messages (remove API key references)
  const sanitizeErrorMessage = (msg: string): string => {
    // Remove patterns like ": sk-***...***" or ": sdasdada***...dwwC"
    return msg.replace(/:\s*[a-zA-Z0-9*]+\*+[a-zA-Z0-9*]+\.?$/g, '').trim();
  };

  safeHandle(
    'test-stt-connection',
    async (
      _,
      provider: 'groq' | 'openai' | 'soniox',
      apiKey: string,
    ) => {
      console.log(`[IPC] Received test - stt - connection request for provider: ${provider} `);
      try {
        if (!['groq', 'openai', 'soniox'].includes(provider)) return { success: false, error: 'Invalid STT provider' };

        if (provider === 'soniox') {
          // Test Soniox via WebSocket connection.
          // With a valid key, Soniox accepts the config and then silently waits for audio —
          // it never sends a response message. With an invalid key it immediately sends an
          // error message and closes. So the strategy is:
          //   • If we receive an error message → fail
          //   • If the connection errors at the WS level → fail
          //   • If 2.5 s pass after sending the config with no error → success
          const WebSocket = require('ws');
          return await new Promise<{ success: boolean; error?: string }>((resolve) => {
            let resolved = false;
            const done = (result: { success: boolean; error?: string }) => {
              if (resolved) return;
              resolved = true;
              try {
                ws.close();
              } catch {}
              resolve(result);
            };

            const ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');

            // Hard connect timeout — server unreachable
            const connectTimeout = setTimeout(() => {
              done({ success: false, error: 'Connection timed out' });
            }, 10000);

            ws.on('open', () => {
              clearTimeout(connectTimeout);
              ws.send(
                JSON.stringify({
                  api_key: apiKey,
                  model: 'stt-rt-v4',
                  audio_format: 'pcm_s16le',
                  sample_rate: 16000,
                  num_channels: 1,
                }),
              );
              // Give Soniox 2.5 s to reject the key; silence means the key is valid
              setTimeout(() => done({ success: true }), 2500);
            });

            ws.on('message', (msg: any) => {
              try {
                const res = JSON.parse(msg.toString());
                if (res.error_code) {
                  done({ success: false, error: `${res.error_code}: ${res.error_message}` });
                }
                // Non-error message is unexpected but treat as success
              } catch {
                // Unparseable message — treat as success
              }
            });

            ws.on('error', (err: any) => {
              clearTimeout(connectTimeout);
              done({ success: false, error: err.message || 'Connection failed' });
            });

            ws.on('close', (code: number) => {
              // Abnormal close before we resolved means the server rejected us
              if (!resolved && code !== 1000) {
                done({ success: false, error: `Server closed connection (code ${code})` });
              }
            });
          });
        }

        const FormData = require('form-data');

        // Generate a tiny silent WAV (0.5s of silence at 16kHz mono 16-bit)
        const numSamples = 8000;
        const pcmData = Buffer.alloc(numSamples * 2);
        const wavHeader = Buffer.alloc(44);
        wavHeader.write('RIFF', 0);
        wavHeader.writeUInt32LE(36 + pcmData.length, 4);
        wavHeader.write('WAVE', 8);
        wavHeader.write('fmt ', 12);
        wavHeader.writeUInt32LE(16, 16);
        wavHeader.writeUInt16LE(1, 20);
        wavHeader.writeUInt16LE(1, 22);
        wavHeader.writeUInt32LE(16000, 24);
        wavHeader.writeUInt32LE(32000, 28);
        wavHeader.writeUInt16LE(2, 32);
        wavHeader.writeUInt16LE(16, 34);
        wavHeader.write('data', 36);
        wavHeader.writeUInt32LE(pcmData.length, 40);
        const testWav = Buffer.concat([wavHeader, pcmData]);

        // Groq / OpenAI: multipart FormData
        let openAiEndpoint = 'https://api.openai.com/v1/audio/transcriptions';
        if (provider === 'openai') {
          // If a custom OpenAI-compatible base URL is configured, test against it.
          const { CredentialsManager } = require('./services/CredentialsManager');
          const customBase = (
            CredentialsManager.getInstance().getOpenAiSttBaseUrl() || ''
          ).trim();
          if (customBase) {
            openAiEndpoint = openAiSttEndpoint(customBase);
          }
        }
        const endpoint =
          provider === 'groq'
            ? 'https://api.groq.com/openai/v1/audio/transcriptions'
            : openAiEndpoint;
        const model = provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1';

        const form = new FormData();
        form.append('file', testWav, { filename: 'test.wav', contentType: 'audio/wav' });
        form.append('model', model);

        await axios.post(endpoint, form, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...form.getHeaders(),
          },
          timeout: 15000,
        });

        return { success: true };
      } catch (error: any) {
        const respData = error?.response?.data;
        const rawMsg =
          respData?.error?.message ||
          respData?.detail?.message ||
          respData?.message ||
          error.message ||
          'Connection failed';
        const msg = sanitizeErrorMessage(rawMsg);
        console.error('STT connection test failed:', msg);
        return { success: false, error: msg };
      }
    },
  );

  safeHandle(
    'test-llm-connection',
    async (_, provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey?: string) => {
      console.log(`[IPC] Received test-llm-connection request for provider: ${provider}`);
      try {
        if (!apiKey || !apiKey.trim()) {
          const { CredentialsManager } = require('./services/CredentialsManager');
          const creds = CredentialsManager.getInstance();
          if (provider === 'gemini') apiKey = creds.getGeminiApiKey();
          else if (provider === 'groq') apiKey = creds.getGroqApiKey();
          else if (provider === 'openai') apiKey = creds.getOpenaiApiKey();
          else if (provider === 'claude') apiKey = creds.getClaudeApiKey();
          else if (provider === 'deepseek') apiKey = creds.getDeepseekApiKey();
        }

        if (!apiKey || !apiKey.trim()) {
          return { success: false, error: 'No API key provided' };
        }

        if (apiKey) {
          const { CredentialsManager } = require('./services/CredentialsManager');
          if (apiKey !== CredentialsManager.getInstance().getProviderApiKey(provider)) {
            return { success: false, error: 'Save the complete provider configuration before testing.' };
          }
        }
        const text = await appState.processingHelper.getLLMHelper().testProviderConnection(provider);
        return { success: !!text.trim(), ...(text.trim() ? {} : { error: 'The provider returned an empty response.' }) };

      } catch (error: any) {
        // CRITICAL: do NOT log the raw axios error — it includes the request config
        // with the Authorization header (full API key) and is dumped verbatim by
        // Node's util.inspect. Strip to a safe shape before logging.
        const safeInfo = {
          provider,
          status: error?.response?.status,
          statusText: error?.response?.statusText,
          code: error?.code,
          message: error?.message,
          responseError: error?.response?.data?.error?.message || error?.response?.data?.message,
        };
        console.error('LLM connection test failed:', safeInfo);
        const rawMsg =
          error?.response?.data?.error?.message ||
          error?.response?.data?.message ||
          (error.response?.data?.error?.type
            ? `${error.response.data.error.type}: ${error.response.data.error.message}`
            : error.message) ||
          'Connection failed';
        const msg = sanitizeErrorMessage(rawMsg);
        return { success: false, error: msg };
      }
    },
  );

  safeHandle('get-groq-fast-text-mode', () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return { enabled: llmHelper.getGroqFastTextMode() };
    } catch (error: any) {
      return { enabled: false };
    }
  });

  // Set Groq Fast Text Mode
  safeHandle('set-groq-fast-text-mode', (_, enabled: boolean) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setGroqFastTextMode(enabled);

      const { SettingsManager } = require('./services/SettingsManager');
      SettingsManager.getInstance().set('groqFastTextMode', enabled);

      // Broadcast to all windows
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('groq-fast-text-changed', enabled);
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('get-codex-cli-config', () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      return llmHelper.getCodexCliConfig();
    } catch {
      return { ...DEFAULT_CODEX_SOURCE_CONFIG };
    }
  });

  safeHandle('set-codex-cli-config', (_, config: any) => {
    try {
      const helper = appState.processingHelper.getLLMHelper();
      const sm = SettingsManager.getInstance();
      // Withdrawal closes the live gate even if persistence fails.
      if (config?.enabled === false) { sm.withdrawCodexSourceConsent(); helper.setCodexCliConfig(sm.getCodexSourceConfig()); }
      const normalized = sm.saveCodexSourceConfig(config, candidate => helper.validateGenerationTargets(undefined, undefined, candidate));
      helper.setCodexCliConfig(normalized);
      appState.sendModelChanged(helper.getCurrentModelSelection());
      return { success: true, config: normalized };
    } catch (error: any) {
      return { success: false, error: 'Unable to save Codex configuration. If withdrawing consent, this session is disabled; restart persistence is unconfirmed.', config: appState.processingHelper.getLLMHelper().getCodexCliConfig() };
    }
  });

  safeHandle('test-codex-cli', async () => {
    try {
      return await appState.processingHelper.getLLMHelper().checkCodexSourceStatus();
    } catch {
      return { success: false, status: 'file-unavailable', message: 'Local Codex file check failed. Service connectivity is unverified.' };
    }
  });

  safeHandle('set-model', async (_, modelId: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      llmHelper.setModel(modelId);
      modelId = llmHelper.getCurrentModelSelection();
      appState.sendModelChanged(modelId);

      // Close the selector window if open
      appState.modelSelectorWindowHelper.hideWindow();

      return { success: true };
    } catch (error: any) {
      console.error('Error setting model:', error);
      return { success: false, error: error.message };
    }
  });

  // Persist default model (from Settings), update runtime, and notify model UI surfaces
  safeHandle('set-default-model', async (_, modelId: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => {
      const helper = appState.processingHelper.getLLMHelper(); helper.validateGenerationTargets(modelId);
      return CredentialsManager.getInstance().setDefaultModel(modelId, helper.getCodexCliConfig(), helper.getGroqFastTextMode());
    }, () => {
      const helper = appState.processingHelper.getLLMHelper();
      helper.setModel(modelId);
      modelId = helper.getCurrentModelSelection();
      appState.sendModelChanged(modelId);
      appState.modelSelectorWindowHelper.hideWindow();
    });
  });

  // Read the persisted default model
  safeHandle('get-default-model', async () => {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const cm = CredentialsManager.getInstance();
      const model = cm.getDefaultModel();
      return { model: model.startsWith('codex-cli') ? model : modelTargetId(resolveModelTarget(model, cm.getProviderConfigurations())) };
    } catch (error: any) {
      console.error('Error getting default model:', error);
      return { model: modelTargetId(LLM_PRESETS.gemini) };
    }
  });

  // --- Model Selector Window IPC ---

  safeHandle('show-model-selector', (_, coords: { x: number; y: number; activate?: boolean }) => {
    appState.modelSelectorWindowHelper.showWindow(coords.x, coords.y, { activate: coords.activate });
  });

  safeHandle('hide-model-selector', () => {
    appState.modelSelectorWindowHelper.hideWindow();
  });

  safeHandle('toggle-model-selector', (_, coords: { x: number; y: number; activate?: boolean }) => {
    appState.modelSelectorWindowHelper.toggleWindow(coords.x, coords.y, { activate: coords.activate });
  });

  // ROUND 3 FIX (#4): click-outside close for ModelSelector. With panel-
  // nonactivating + becomesKeyOnlyIfNeeded, the on('blur') auto-close in
  // ModelSelectorWindowHelper fires unreliably (panel may never become key
  // → never receives blur). The overlay's renderer fires this IPC on every
  // mousedown that isn't on the toggle button itself; if the model selector
  // is open, we close it. No-op when closed (toggleWindow handled the open).
  safeHandle('model-selector:close-if-open', () => {
    const win = appState.modelSelectorWindowHelper.getWindow();
    if (win && !win.isDestroyed() && win.isVisible()) {
      appState.modelSelectorWindowHelper.hideWindow();
    }
  });

  // Native Audio Service Handlers
  // Native Audio handlers removed as part of migration to driverless architecture
  safeHandle('native-audio-status', async () => {
    // Always return true or pseudo-status since it's "driverless"
    return { connected: true };
  });

  safeHandle('get-input-devices', async () => {
    return AudioDevices.getInputDevices();
  });

  safeHandle('get-output-devices', async () => {
    return AudioDevices.getOutputDevices();
  });

  safeHandle('start-audio-test', async (event, deviceId?: string) => {
    await appState.startAudioTest(deviceId);
    return { success: true };
  });

  safeHandle('stop-audio-test', async () => {
    await appState.stopAudioTest();
    return { success: true };
  });

  safeHandle('set-recognition-language', async (_, key: string) => appState.setRecognitionLanguage(key));

  // ==========================================
  // Meeting Lifecycle Handlers
  // ==========================================

  safeHandle('start-meeting', async (event, metadata?: any) => {
    try {
      await appState.startMeeting(metadata);
      return { success: true };
    } catch (error: any) {
      console.error('Error starting meeting:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('end-meeting', async () => {
    appState.processingHelper.getLLMHelper().clearPreparedInput();
    try {
      speechActions.cancel();
      await appState.endMeeting();
      return { success: true };
    } catch (error: any) {
      console.error('Error ending meeting:', error);
      return { success: false, error: error.message };
    }
  });

  safeHandle('get-recent-meetings', async () => {
    // Fetch from SQLite (limit 50)
    return DatabaseManager.getInstance().getRecentMeetings(50);
  });

  safeHandle('get-meeting-details', async (event, id) => {
    // Helper to fetch full details
    return DatabaseManager.getInstance().getMeetingDetails(id);
  });

  safeHandle('update-meeting-title', async (_, { id, title }: { id: string; title: string }) => {
    return DatabaseManager.getInstance().updateMeetingTitle(id, title);
  });

  safeHandle('seed-demo', async () => {
    DatabaseManager.getInstance().seedDemoMeeting();
    return { success: true };
  });

  safeHandle('flush-database', async () => {
    const result = DatabaseManager.getInstance().clearAllData();
    return { success: result };
  });

  // UX2: in-app TCC repair button.
  //
  // Runs `tccutil reset Microphone <bundleId>` AND
  // `tccutil reset ScreenCapture <bundleId>` to clear stale macOS TCC entries
  // for Natively. This is the user-facing self-service recovery for the
  // dominant "permissions appear granted in System Settings but capture is
  // silently zero-filled" failure mode — which is caused by TCC binding the
  // grant to a binary's cdhash, and the cdhash changing on every rebuild
  // (ad-hoc-signed builds — see AUDIO_RELIABILITY_REPORT.md §3 A1).
  //
  // After tccutil reset, the user MUST force-quit and relaunch the app for
  // the next TCC prompt to appear cleanly. We return the prompt copy so the
  // renderer can show a "Quit & relaunch" CTA.
  //
  // Service-name capitalization MATTERS: Apple requires capital `Microphone`
  // and `ScreenCapture` — lowercase fails with "Invalid Service Name." This
  // is the most common implementation bug.
  safeHandle('repair-tcc-permissions', async () => {
    if (process.platform !== 'darwin') {
      return { ok: false, error: 'TCC repair is macOS-only.' };
    }

    // Bundle ID resolution: prefer the live Electron app identifier (handles
    // signed packaged builds and dev-mode Electron alike). Falls back to the
    // package.json appId if app.getAppPath() inspection somehow fails.
    let bundleId: string;
    try {
      // app.isPackaged → packaged Info.plist CFBundleIdentifier
      //                  (== package.json build.appId for electron-builder)
      // !app.isPackaged → 'com.github.Electron' (the dev Electron binary's
      //                   bundle id; TCC entries land here in dev mode)
      bundleId = app.isPackaged ? 'com.electron.meeting-notes' : 'com.github.Electron';
    } catch {
      bundleId = 'com.electron.meeting-notes';
    }

    const { execFile } = require('node:child_process');
    const { promisify } = require('node:util');
    const execFileAsync = promisify(execFile);

    const services = ['Microphone', 'ScreenCapture']; // Capital letters REQUIRED.
    const results: Array<{ service: string; ok: boolean; output: string }> = [];

    for (const service of services) {
      try {
        // Absolute path — defense-in-depth against PATH shadowing. tccutil is
        // a SIP-protected stock macOS binary at /usr/bin/tccutil; using the
        // bare name would resolve via inherited PATH, which a user-modified
        // shell could in theory redirect.
        const { stdout, stderr } = await execFileAsync('/usr/bin/tccutil', ['reset', service, bundleId], {
          timeout: 5000,
        });
        results.push({ service, ok: true, output: (stdout || stderr || '').toString().trim() });
        console.log(`[IPC] tccutil reset ${service} ${bundleId}: OK`);
      } catch (err: any) {
        const msg = err?.stderr?.toString?.() || err?.message || String(err);
        results.push({ service, ok: false, output: msg.trim() });
        console.warn(`[IPC] tccutil reset ${service} ${bundleId} failed: ${msg}`);
      }
    }

    const anyOk = results.some((r) => r.ok);
    return {
      ok: anyOk,
      bundleId,
      results,
      promptRelaunch: anyOk,
      message: anyOk
        ? `Permissions reset. Quit ${APP_IDENTITY.name} completely (Cmd+Q) and reopen — macOS will ask you to grant Microphone and Screen Recording again. Approve both to restore audio capture.`
        : `Permission reset failed for ${bundleId}. ${results
            .filter((r) => !r.ok)
            .map((r) => `${r.service}: ${r.output}`)
            .join('; ')}`,
    };
  });

  // Same rule as followed links and window.open (navigationPolicy): https, or the
  // macOS settings scheme on macOS only (issue #252: unknown schemes on Windows).
  safeHandle('open-external', async (event, url: string) => {
    if (typeof url !== 'string') {
      console.warn('[IPC] Blocked invalid open-external request', { reason: 'non-string' });
      return;
    }
    await openExternalLink(url);
  });

  // ==========================================
  // Intelligence Mode Handlers
  // ==========================================

  // MODE 1: Assist (Passive observation)
  safeHandle('generate-assist', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const insight = await intelligenceManager.runAssistMode();
      return { insight };
    } catch (error: any) {
      throw error;
    }
  });

  const promptOperation = (action: (event: any, input: any) => Promise<void> | void, changes = true) =>
    async (event: any, input?: any): Promise<PromptSettingsResult> => {
      try {
        if (!BrowserWindow.fromWebContents(event.sender)) throw new PromptSettingsError('The settings window is unavailable.');
        await action(event, input);
        const settings = SkillsManager.getInstance().promptSettings().read();
        if (changes) {
          const helper = appState.processingHelper.getLLMHelper();
          helper.revokePreparedContext(); helper.cancelGenerationTasks('Prompt settings changed');
        }
        return { ok: true, settings };
      } catch (error) {
        // Main and standalone service bundles have separate class identities.
        const failure = error as PromptSettingsError;
        return { ok: false, error: failure?.name === 'PromptSettingsError' ? failure.message : 'Prompt settings could not be saved. Previous settings were kept.',
          recovery: failure?.name === 'PromptSettingsError' && failure.recovery === true };
      }
    };
  safeHandle('prompt-settings:get', promptOperation(() => {}, false));
  safeHandle('prompt-settings:save', promptOperation((_event, input) => {
    if (!input || typeof input !== 'object') throw new PromptSettingsError('Invalid prompt settings.');
    SkillsManager.getInstance().promptSettings().configure(input.scene as PromptScene, input.skillId, input.additional);
  }));
  safeHandle('prompt-settings:clear', promptOperation(() => { SkillsManager.getInstance().promptSettings().clear(); }));
  safeHandle('prompt-settings:remove', promptOperation((_event, id) => {
    if (typeof id !== 'string') throw new PromptSettingsError('Invalid prompt skill.');
    SkillsManager.getInstance().promptSettings().remove(id);
  }));
  safeHandle('prompt-settings:import', promptOperation(async event => {
    const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
      properties: ['openFile'], filters: [{ name: mainText('Prompt Skill'), extensions: ['md'] }],
    }) as unknown as Electron.OpenDialogReturnValue;
    if (!selected.canceled && selected.filePaths.length === 1) SkillsManager.getInstance().importPromptSkill(selected.filePaths[0]);
  }));

  // MODE 2: User-triggered answer using the current session.
  //
  // Validated original images reach the selected answer task without generative preanalysis.
  safeHandle(
    'generate-what-to-say',
    async (
      _,
      question?: string,
      imagePaths?: string[],
      freeze?: () => Promise<TranscriptView>,
    ) => {
      const helper = appState.processingHelper.getLLMHelper();
      let task: GenerationTask<any> | undefined;
      let ownsTask = false;
      try {
        const inherited = helper.getCurrentGenerationTask();
        ownsTask = !inherited;
        task = inherited ?? helper.beginGenerationTask('interview');
        task.rendererOwner = _.sender;
        imagePaths = validateImages(imagePaths);
        let screenContext: any;
        let screenContextStatus: 'not_available' | 'available' | 'failed' = 'not_available';
        let visionFailureReason: string | undefined;

        const validatedImagePaths = imagePaths?.length ? imagePaths : undefined;

        const intelligenceManager = appState.getIntelligenceManager();
        // Question and imagePaths are now optional - IntelligenceManager infers from transcript
        const answer = await helper.runGeneration(() => intelligenceManager.runWhatShouldISay(
          question,
          0.8,
          validatedImagePaths,
          {
            manual: true,
            beforeGenerate: async () => freeze?.(),
            errorDelivery: 'caller',
            screenContext,
          },
        ), 'interview', undefined, task);
        const metadata = helper.getTaskMetadata(task);
        return {
          answer,
          question: question || 'inferred from context',
          screenContextStatus,
          visionProviderUsed: metadata.usedImageInput ? metadata.provider : undefined,
          visionModelUsed: metadata.usedImageInput ? metadata.model : undefined,
          visionAttempts: metadata.attempts,
          generationStatus: metadata.status,
          ...metadata,
          visionFailureReason,
          imageCount: metadata.imageCount,
          usedImageInput: metadata.usedImageInput,
        };
      } catch (error: any) {
        console.error('[IPC] generate-what-to-say error:', error);
        return {
          answer: null,
          question: question || 'unknown',
          error: task?.terminalStatus === 'cancelled' ? MANUAL_ANSWER_CANCELLED : manualAnswerError(error),
          generationStatus: task?.terminalStatus,
        };
      } finally {
        if (ownsTask) task?.close();
      }
    },
  );

  safeHandle('generate-clarify', async (_, freeze: () => Promise<TranscriptView>) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const clarification = await intelligenceManager.runClarify(await freeze());
      // If null returned without throwing, the engine already set mode to idle.
      // We must still ensure the frontend un-sticks — emit an error so onIntelligenceError fires.
      if (clarification === null) {
        const win = appState.getMainWindow();
        win?.webContents.send('intelligence-error', {
          error:
            'Could not generate a clarifying question. Try again after some audio context is available.',
          mode: 'clarify',
        });
      }
      return { clarification };
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle('generate-code-hint', async (_, imagePaths: string[] | undefined, problemStatement: string | undefined, freeze: () => Promise<TranscriptView>) => {
    try {
      // If no explicit images were passed from the frontend, fall back to the
      // screenshot queue so the AI can always "see" the user's screen.
      const resolvedImagePaths = validateImages(imagePaths === undefined || Array.isArray(imagePaths) && imagePaths.length === 0
        ? appState.getScreenshotQueue() : imagePaths)!;

      console.log(
        `[IPC] generate-code-hint: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? 'explicit' : 'queue fallback'})`,
      );

      // LLMHelper.processImage shrinks and JPEG-encodes every image it sends.
      const intelligenceManager = appState.getIntelligenceManager();
      const hint = await intelligenceManager.runCodeHint(
        resolvedImagePaths.length > 0 ? resolvedImagePaths : undefined,
        problemStatement,
        await freeze(),
      );
      return { hint };
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle('generate-brainstorm', async (_, imagePaths: string[] | undefined, problemStatement: string | undefined, freeze: () => Promise<TranscriptView>) => {
    try {
      // If no explicit images were passed from the frontend, fall back to the
      // screenshot queue so the AI can always "see" the user's screen.
      const resolvedImagePaths = validateImages(imagePaths === undefined || Array.isArray(imagePaths) && imagePaths.length === 0
        ? appState.getScreenshotQueue() : imagePaths)!;

      console.log(
        `[IPC] generate-brainstorm: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? 'explicit' : 'queue fallback'})`,
      );

      const intelligenceManager = appState.getIntelligenceManager();
      const script = await intelligenceManager.runBrainstorm(
        resolvedImagePaths.length > 0 ? resolvedImagePaths : undefined,
        problemStatement,
        await freeze(),
      );
      return { script };
    } catch (error: any) {
      throw error;
    }
  });

  // Dynamic Action Button Mode (Recap vs Brainstorm)
  safeHandle('get-action-button-mode', () => {
    const { SettingsManager } = require('./services/SettingsManager');
    const sm = SettingsManager.getInstance();
    return sm.get('actionButtonMode') ?? 'recap';
  });

  safeHandle('set-action-button-mode', (_, mode: 'recap' | 'brainstorm') => {
    const { SettingsManager } = require('./services/SettingsManager');
    const sm = SettingsManager.getInstance();
    sm.set('actionButtonMode', mode);

    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('action-button-mode-changed', mode);
      }
    });

    return { success: true };
  });

  // MODE 3: Follow-Up (Refinement)
  safeHandle('generate-follow-up', async (_, intent: string, userRequest: string | undefined, freeze: () => Promise<TranscriptView>) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const refined = await intelligenceManager.runFollowUp(intent, userRequest, await freeze());
      return { refined, intent };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 4: Recap (Summary)
  safeHandle('generate-recap', async (_, freeze: () => Promise<TranscriptView>) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const summary = await intelligenceManager.runRecap(await freeze());
      return { summary };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 6: Follow-Up Questions
  safeHandle('generate-follow-up-questions', async (_, freeze: () => Promise<TranscriptView>) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const questions = await intelligenceManager.runFollowUpQuestions(await freeze());
      return { questions };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 5: Manual Answer (Fallback)
  safeHandle('submit-manual-question', async (_, question: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const answer = await intelligenceManager.runManualAnswer(question);
      return { answer, question };
    } catch (error: any) {
      throw error;
    }
  });

  // Get current intelligence context
  safeHandle('get-intelligence-context', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      return {
        context: intelligenceManager.getFormattedContext(),
        lastAssistantMessage: intelligenceManager.getLastAssistantMessage(),
        activeMode: intelligenceManager.getActiveMode(),
      };
    } catch (error: any) {
      throw error;
    }
  });

  // Reset intelligence state
  safeHandle('cancel-intelligence-generation', (event) => {
    appState.processingHelper.getLLMHelper().clearPreparedInput(event.sender.id);
    speechActions.cancel(event.sender);
    appState.getIntelligenceManager().resetEngine();
  });

  safeHandle('reset-intelligence', async () => {
    appState.processingHelper.getLLMHelper().clearPreparedInput();
    try {
      speechActions.cancel();
      const intelligenceManager = appState.getIntelligenceManager();
      intelligenceManager.reset();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle(
    'test-inject-transcript',
    async (_, segment: { speaker: string; text: string; timestamp?: number; final?: boolean }) => {
      try {
        if (process.env.NODE_ENV !== 'test') return { success: false, error: 'test_only' };
        const intelligenceManager = appState.getIntelligenceManager();
        intelligenceManager.addTranscript(
          {
            speaker: segment.speaker,
            text: segment.text,
            timestamp: segment.timestamp ?? Date.now(),
            final: segment.final ?? true,
          },
          true,
        );
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  );



  // ==========================================
  // Theme System Handlers
  // ==========================================

  safeHandle('theme:get-mode', () => {
    const tm = appState.getThemeManager();
    return {
      mode: tm.getMode(),
      resolved: tm.getResolvedTheme(),
    };
  });

  safeHandle('theme:set-mode', (_, mode: 'system' | 'light' | 'dark') => {
    appState.getThemeManager().setMode(mode);
    return { success: true };
  });

  // ==========================================
  // Overlay Opacity (Stealth Mode)
  // ==========================================

  safeHandle('set-overlay-opacity', async (_, opacity: number) => {
    // Clamp to valid range
    const clamped = Math.min(1.0, Math.max(0.35, opacity));
    // Broadcast to all renderer windows so the overlay picks it up in real-time
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('overlay-opacity-changed', clamped);
      }
    });
    return;
  });

  // ── Permissions ──────────────────────────────────────────────
  safeHandle('permissions:check', async () => {
    if (process.platform === 'darwin') {
      const mic = systemPreferences.getMediaAccessStatus('microphone');
      const screen = systemPreferences.getMediaAccessStatus('screen');
      return { microphone: mic, screen, platform: 'darwin' };
    }
    // Windows/Linux: no TCC — permissions handled by OS at install/first-use time
    return { microphone: 'granted', screen: 'granted', platform: process.platform };
  });

  safeHandle('permissions:request-mic', async () => {
    if (process.platform !== 'darwin') return true;
    try {
      return await systemPreferences.askForMediaAccess('microphone');
    } catch {
      return false;
    }
  });

}
