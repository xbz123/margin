// ipcHandlers.ts

import * as crypto from 'crypto';
import { LLM_PRESETS, modelTargetId, type LlmProvider, type ProviderConfigurationSave } from '../src/types/llmTarget';
import { resolveModelTarget } from './llm/llmTarget';
import { app, BrowserWindow, dialog, ipcMain, shell, systemPreferences } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AudioDevices } from './audio/AudioDevices';
import { DatabaseManager } from './db/DatabaseManager'; // Import Database Manager
import { AppState } from './main';
import { CodexCliService } from './services/CodexCliService';
import { SettingsManager } from './services/SettingsManager';
import { SkillsManager } from './services/SkillsManager';

import { AI_RESPONSE_LANGUAGES, RECOGNITION_LANGUAGES } from './config/languages';
import { CHAT_MODE_PROMPT } from './llm/prompts';
import { buildMeetingChatContext } from './services/meetingChatContext';
import type { CredentialSaveResult } from '../src/types/credentialSave';
import { outboundAxios as axios, regionalSttEndpoint, openAiSttEndpoint } from './services/outbound';
import { openExternalLink } from './services/navigationPolicy';
import { APP_IDENTITY } from './margin/appIdentity';
import { loadGoogleServiceAccount, googleSpeechClientOptions } from './services/googleServiceAccount';

export function initializeIpcHandlers(appState: AppState): void {
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
  const safeHandle = (
    channel: string,
    listener: (event: any, ...args: any[]) => Promise<any> | any,
  ) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, listener);
  };

  const safeOn = (
    channel: string,
    listener: (event: any, ...args: any[]) => void,
  ) => {
    ipcMain.removeAllListeners(channel);
    ipcMain.on(channel, listener);
  };

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

  safeHandle('finalize-mic-stt', async () => {
    appState.finalizeMicSTT();
  });

  // IPC handler for analyzing image from file path
  safeHandle('analyze-image-file', async (event, filePath: string) => {
    // Guard: only allow reading files within the app's own userData directory
    const userDataDir = app.getPath('userData');
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(userDataDir + path.sep)) {
      console.warn('[IPC] analyze-image-file: path outside userData rejected:', filePath);
      throw new Error('Path not allowed');
    }
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
  // Prevents the small fast-mode model from over-firing the "I'm Natively" canned reply
  // (which used to escape the prompt's hard rule for any ambiguous input).
  const IDENTITY_PROBE_RE =
    /^\s*(who\s+(are|r)\s+(you|u|this|natively)|what\s+(are|r)\s+(you|u)|are\s+you\s+(chatgpt|gpt[-\s]?\d?|claude|gemini|llama|an?\s+(ai|bot|llm|model|assistant))|what('?s|\s+is)\s+your\s+(name|model)|which\s+(ai|model|llm)\s+are\s+you|who\s+(made|built|created|developed|trained)\s+(you|this|natively)|what\s+model\s+(are\s+you|do\s+you\s+use)|introduce\s+yourself)\s*\??\s*$/i;
  const CREATOR_PROBE_RE =
    /^\s*(who\s+(made|built|created|developed|trained)\s+(you|this|natively))\s*\??\s*$/i;

  safeHandle(
    'gemini-chat-stream',
    async (
      event,
      message: string,
      imagePaths?: string[],
      context?: string,
      options?: { skipSystemPrompt?: boolean; ignoreKnowledgeMode?: boolean; clientStreamId?: number; meetingId?: unknown },
    ) => {
      let myController: AbortController | null = null;
      // Scopes of the data in this request beyond the transcript; streamChat refuses
      // the request when one of them is denied. Set only here in the main process, from
      // data it reads itself (PLAN.md AG-17 fourth and fifth reviews).
      let declaredScopes: Array<'profile_history' | 'post_call_summary'> = [];
      // A question about a saved meeting, and its answer, are not part of the current
      // conversation: they are not added to the live session, which would carry them into
      // the next meeting's transcript, usage and summary (PLAN.md AG-17 sixth review).
      const recordInSession = options?.meetingId === undefined;
      // The preload's id for this request, sent back with every event so the window
      // can drop events of a cancelled or superseded stream (PLAN.md AG-17 review).
      const clientStreamId = options?.clientStreamId;
      try {
        console.log('[IPC] gemini-chat-stream started using LLMHelper.streamChat');
        const llmHelper = appState.processingHelper.getLLMHelper();

        // Meeting chat: the window sends only the meeting id. The context comes from the
        // saved meeting, with the summary left out when post_call_summary is denied; a
        // context sent by the window is ignored. A saved meeting is profile_history data,
        // so with that scope denied streamChat refuses the request.
        if (options?.meetingId !== undefined) {
          const meeting = typeof options.meetingId === 'string'
            ? DatabaseManager.getInstance().getMeetingDetails(options.meetingId)
            : null;
          if (!meeting) throw new Error('Meeting not found for chat');
          const includeSummary = llmHelper.deniedDataScopes(['post_call_summary']).length === 0;
          const built = buildMeetingChatContext(meeting, includeSummary);
          context = built.context;
          declaredScopes = built.scopes as Array<'profile_history' | 'post_call_summary'>;
        }

        const senderId = event.sender.id;
        const myStreamId = ++_chatStreamId;
        const priorStream = _chatStreamsBySender.get(senderId);
        if (priorStream) {
          try { priorStream.controller.abort(); } catch { /* noop */ }
        }
        myController = new AbortController();
        _chatStreamsBySender.set(senderId, { streamId: myStreamId, controller: myController });

        const intelligenceManager = appState.getIntelligenceManager();

        // Identity probe short-circuit — bypasses the LLM entirely so small models can't
        // reframe the canned reply or misfire it on coding asks (the original bug).
        // Regex is `^...$` anchored, so non-probe questions cannot match.
        if (!imagePaths?.length && typeof message === 'string') {
          const identityHit = CREATOR_PROBE_RE.test(message)
            ? 'I was developed by Evin John.'
            : IDENTITY_PROBE_RE.test(message)
              ? `I'm ${APP_IDENTITY.name}, an AI assistant.`
              : null;
          if (identityHit) {
            if (recordInSession) intelligenceManager.addTranscript(
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
            event.sender.send('gemini-stream-token', identityHit, clientStreamId);
            event.sender.send('gemini-stream-done', clientStreamId);
            if (recordInSession) {
              intelligenceManager.addAssistantMessage(identityHit);
              intelligenceManager.logUsage('chat', message, identityHit);
            }
            return null;
          }
        }

        // Capture rolling context BEFORE adding the new user message — otherwise the
        // 100s window would echo back the user's just-typed message as both context and
        // question, confusing small models (the "20-char context" log line was just an echo).
        let autoContextSnapshot: string | undefined;
        if (!context) {
          try {
            const snap = intelligenceManager.getFormattedContext(100);
            if (snap && snap.trim().length > 0) autoContextSnapshot = snap;
          } catch (ctxErr) {
            console.warn('[IPC] Failed to capture pre-turn context:', ctxErr);
          }
        }

        // Now add USER message to IntelligenceManager (after context snapshot)
        if (recordInSession) intelligenceManager.addTranscript(
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

        // Use CHAT_MODE_PROMPT for general chat — bypasses the interview-copilot
        // framing in HARD_SYSTEM_PROMPT/ASSIST_MODE_PROMPT that was causing coding
        // questions to be answered with "At Aetherbot AI, I was responsible for..."
        // (resume hijack via CONTEXT_INTELLIGENCE_LAYER's "you ARE the user").
        const systemPromptOverride: string | undefined = options?.skipSystemPrompt
          ? ''
          : CHAT_MODE_PROMPT;

        try {
          // USE streamChat which handles routing. Pass the abort signal as
          // the trailing arg so the generator stops yielding when this stream
          // is superseded or explicitly cancelled via gemini-chat-stream-stop.
          // The signature accepts a final optional `abortSignal?: AbortSignal`
          // that streamChat extracts from its variadic args.
          const stream = llmHelper.streamChat(
            message,
            imagePaths,
            context,
            systemPromptOverride,
            options?.ignoreKnowledgeMode,
            false, // skipModeInjection
            declaredScopes, // extraDataScopes
            myController.signal,
          );

          for await (const token of stream) {
            // Bail if a newer stream has taken over (user triggered a new request)
            if (_chatStreamsBySender.get(senderId)?.streamId !== myStreamId) {
              console.log(
                `[IPC] gemini-chat-stream ${myStreamId} superseded for sender ${senderId}, stopping.`,
              );
              return null;
            }
            event.sender.send('gemini-stream-token', token, clientStreamId);
            fullResponse += token;
          }

          // Final check: only send done if we are still the active stream
          if (_chatStreamsBySender.get(senderId)?.streamId === myStreamId) {
            event.sender.send('gemini-stream-done', clientStreamId);

            // Update IntelligenceManager with ASSISTANT message after completion
            if (recordInSession && fullResponse.trim().length > 0) {
              intelligenceManager.addAssistantMessage(fullResponse);
              // Log Usage for streaming chat
              intelligenceManager.logUsage('chat', message, fullResponse);
            }
          }
        } catch (streamError: any) {
          console.error('[IPC] Streaming error:', streamError);
          if (_chatStreamsBySender.get(senderId)?.streamId === myStreamId) {
            event.sender.send(
              'gemini-stream-error',
              streamError.message || 'Unknown streaming error',
              clientStreamId,
            );
          }
        }

        return null; // Return null as data is sent via events
      } catch (error: any) {
        console.error('[IPC] Error in gemini-chat-stream setup:', error);
        throw error;
      } finally {
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
      'post_call_summary',
    ]);
    const sanitized: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(scopes)) {
      if (allowedKeys.has(key) && typeof value === 'boolean') {
        sanitized[key] = value;
      }
    }
    SettingsManager.getInstance().set('providerDataScopes', sanitized as any);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('provider-data-scopes-changed', sanitized);
      }
    });
    return { success: true };
  });

  safeHandle('get-screen-understanding-mode', async () => {
    return SettingsManager.getInstance().getScreenUnderstandingMode();
  });

  safeHandle(
    'set-screen-understanding-mode',
    async (_, mode: 'vision_first' | 'vision_only') => {
      if (!['vision_first', 'vision_only'].includes(mode)) {
        return { success: false, error: 'invalid_mode' };
      }
      SettingsManager.getInstance().setScreenUnderstandingMode(mode);
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('screen-understanding-mode-changed', mode);
        }
      });
      return { success: true };
    },
  );

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
      let googleServiceAccountPath = creds.googleServiceAccountPath || null;
      if (googleServiceAccountPath) {
        try { googleSpeechClientOptions(loadGoogleServiceAccount(googleServiceAccountPath)); }
        catch { googleServiceAccountPath = null; }
      }

      // Return masked versions for security (just indicate if set)
      const hasKey = (key?: string) => !!(key && key.trim().length > 0);

      return {
        providerConfigurations: CredentialsManager.getInstance().getProviderConfigurations(),
        hasGeminiKey: hasKey(creds.geminiApiKey),
        hasGroqKey: hasKey(creds.groqApiKey),
        hasOpenaiKey: hasKey(creds.openaiApiKey),
        hasClaudeKey: hasKey(creds.claudeApiKey),
        hasDeepseekKey: hasKey(creds.deepseekApiKey),
        googleServiceAccountPath,
        sttProvider: CredentialsManager.getInstance().getSttProvider(),
        groqSttModel: creds.groqSttModel || 'whisper-large-v3-turbo',
        hasSttGroqKey: hasKey(creds.groqSttApiKey),
        hasSttOpenaiKey: hasKey(creds.openAiSttApiKey),
        hasDeepgramKey: hasKey(creds.deepgramApiKey),
        hasElevenLabsKey: hasKey(creds.elevenLabsApiKey),
        hasAzureKey: hasKey(creds.azureApiKey),
        azureRegion: creds.azureRegion || 'eastus',
        hasIbmWatsonKey: hasKey(creds.ibmWatsonApiKey),
        ibmWatsonRegion: creds.ibmWatsonRegion || 'us-south',
        hasSonioxKey: hasKey(creds.sonioxApiKey),
        // STT key values — returned so the settings UI can pre-populate input fields.
        // SECURITY FIX (P0): Return masked keys only, never raw API keys.
        // The hasSttGroqKey boolean tells UI if key exists — no raw key needed.
        sttGroqKey: creds.groqSttApiKey ? `sk-...${creds.groqSttApiKey.slice(-4)}` : '',
        sttOpenaiKey: creds.openAiSttApiKey ? `sk-...${creds.openAiSttApiKey.slice(-4)}` : '',
        sttDeepgramKey: creds.deepgramApiKey ? `sk-...${creds.deepgramApiKey.slice(-4)}` : '',
        sttElevenLabsKey: creds.elevenLabsApiKey ? `sk-...${creds.elevenLabsApiKey.slice(-4)}` : '',
        sttAzureKey: creds.azureApiKey ? `sk-...${creds.azureApiKey.slice(-4)}` : '',
        sttIbmKey: creds.ibmWatsonApiKey ? `sk-...${creds.ibmWatsonApiKey.slice(-4)}` : '',
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
        googleServiceAccountPath: null,
        sttProvider: 'none',
        groqSttModel: 'whisper-large-v3-turbo',
        hasSttGroqKey: false,
        hasSttOpenaiKey: false,
        hasDeepgramKey: false,
        hasElevenLabsKey: false,
        hasAzureKey: false,
        azureRegion: 'eastus',
        hasIbmWatsonKey: false,
        ibmWatsonRegion: 'us-south',
        hasSonioxKey: false,
        sttGroqKey: '',
        sttOpenaiKey: '',
        sttDeepgramKey: '',
        sttElevenLabsKey: '',
        sttAzureKey: '',
        sttIbmKey: '',
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

  safeHandle(
    'set-stt-provider',
    async (_, provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox') => {
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

  safeHandle('set-deepgram-api-key', async (_, apiKey: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setDeepgramApiKey(apiKey), async () => {
      discardRemovedSttKey('deepgram', apiKey);
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

  safeHandle('set-elevenlabs-api-key', async (_, apiKey: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setElevenLabsApiKey(apiKey), async () => {
      discardRemovedSttKey('elevenlabs', apiKey);
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('credentials-changed');
      });
    });
  });

  safeHandle('set-azure-api-key', async (_, apiKey: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setAzureApiKey(apiKey), () => discardRemovedSttKey('azure', apiKey));
  });

  safeHandle('set-azure-region', async (_, region: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setAzureRegion(region), async () => {
      await appState.reconfigureSttProvider();
    });
  });

  safeHandle('set-ibmwatson-api-key', async (_, apiKey: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setIbmWatsonApiKey(apiKey), () => discardRemovedSttKey('ibmwatson', apiKey));
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

  safeHandle('set-ibmwatson-region', async (_, region: string) => {
    const { CredentialsManager } = require('./services/CredentialsManager');
    return persistCredentials(() => CredentialsManager.getInstance().setIbmWatsonRegion(region), async () => {
      await appState.reconfigureSttProvider();
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
      provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox',
      apiKey: string,
      region?: string,
    ) => {
      console.log(`[IPC] Received test - stt - connection request for provider: ${provider} `);
      try {
        if (!['groq', 'openai', 'deepgram', 'elevenlabs', 'azure', 'ibmwatson', 'soniox'].includes(provider)) return { success: false, error: 'Invalid STT provider' };
        if (provider === 'deepgram') {
          const WebSocket = require('ws');
          const token = apiKey.trim();
          return await new Promise<{ success: boolean; error?: string }>((resolve) => {
            const url =
              'wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&channels=1';
            const ws = new WebSocket(url, {
              headers: { Authorization: `Token ${token}` },
            });

            const timeout = setTimeout(() => {
              ws.close();
              console.error('[IPC] Deepgram test failed: Connection timed out');
              resolve({ success: false, error: 'Connection timed out' });
            }, 15000);

            ws.on('open', () => {
              clearTimeout(timeout);
              try {
                ws.send(JSON.stringify({ type: 'CloseStream' }));
              } catch {}
              ws.close();
              resolve({ success: true });
            });

            ws.on('unexpected-response', (request: any, response: any) => {
              clearTimeout(timeout);
              const status = response.statusCode;
              let body = '';
              response.on('data', (chunk: Buffer) => {
                body += chunk.toString();
              });
              response.on('end', () => {
                const errMsg = `Unexpected server response: ${status} - ${body}`;
                console.error(`[IPC] Deepgram test failed: ${errMsg}`);
                resolve({ success: false, error: errMsg });
              });
            });

            ws.on('error', (err: any) => {
              clearTimeout(timeout);
              console.error(`[IPC] Deepgram test error: ${err.message}`);
              resolve({ success: false, error: err.message || 'Connection failed' });
            });
          });
        }

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

        if (provider === 'elevenlabs') {
          // ElevenLabs: Use /v1/voices to validate the API key (minimal scope required).
          // Scoped keys may lack speech_to_text or user_read but still be usable once permissions are added.
          try {
            await axios.get('https://api.elevenlabs.io/v1/voices', {
              headers: { 'xi-api-key': apiKey },
              timeout: 10000,
            });
          } catch (elErr: any) {
            if (elErr?.response?.status >= 300 && elErr?.response?.status < 400) throw elErr;
            const elStatus = elErr?.response?.data?.detail?.status;
            // If the error is "invalid_api_key", the key itself is wrong — fail.
            // Any other error (missing permission, etc.) means the key IS valid, just possibly scoped.
            if (elStatus === 'invalid_api_key') {
              throw elErr;
            }
            // Key is valid but scoped — pass with a warning
            console.log(
              '[IPC] ElevenLabs key is valid but may have restricted scopes. Saving key.',
            );
          }
        } else if (provider === 'azure') {
          // Azure: raw binary with subscription key
          const azureRegion = region || 'eastus';
          await axios.post(
            regionalSttEndpoint('azure', azureRegion),
            testWav,
            {
              headers: { 'Ocp-Apim-Subscription-Key': apiKey, 'Content-Type': 'audio/wav' },
              timeout: 15000,
            },
          );
        } else if (provider === 'ibmwatson') {
          // IBM Watson: raw binary with Basic auth
          const ibmRegion = region || 'us-south';
          await axios.post(
            regionalSttEndpoint('ibmwatson', ibmRegion),
            testWav,
            {
              headers: {
                Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}`,
                'Content-Type': 'audio/wav',
              },
              timeout: 15000,
            },
          );
        } else {
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
        }

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
      return CodexCliService.normalizeConfig({});
    }
  });

  safeHandle('set-codex-cli-config', (_, config: any) => {
    try {
      const normalized = CodexCliService.normalizeConfig(config || {});
      const sm = SettingsManager.getInstance();
      sm.set('codexCliEnabled', normalized.enabled);
      sm.set('codexCliPath', normalized.path);
      sm.set('codexCliModel', normalized.model);
      sm.set('codexCliFastModel', normalized.fastModel);
      sm.set('codexCliTimeoutMs', normalized.timeoutMs);
      sm.set('codexCliSandboxMode', normalized.sandboxMode);
      sm.set('codexCliServiceTier', normalized.serviceTier);
      sm.set('codexCliModelReasoningEffort', normalized.modelReasoningEffort);
      appState.processingHelper.getLLMHelper().setCodexCliConfig(normalized);
      return { success: true, config: normalized };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  safeHandle('test-codex-cli', async (_, config?: any) => {
    try {
      const current = appState.processingHelper.getLLMHelper().getCodexCliConfig();
      const normalized = CodexCliService.normalizeConfig({ ...current, ...(config || {}) });
      const result = await CodexCliService.validateExecutable(normalized.path);
      // If auto-detection found a different working path, persist it so
      // subsequent chat calls don't re-ENOENT.
      if (result.success && result.resolvedPath && result.resolvedPath !== normalized.path) {
        const updated = CodexCliService.normalizeConfig({
          ...normalized,
          path: result.resolvedPath,
        });
        const sm = SettingsManager.getInstance();
        sm.set('codexCliPath', updated.path);
        appState.processingHelper.getLLMHelper().setCodexCliConfig(updated);
        return { success: true, resolvedPath: result.resolvedPath, config: updated };
      }
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
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
    return persistCredentials(() => CredentialsManager.getInstance().setDefaultModel(modelId), () => {
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
    try {
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

  safeHandle('update-meeting-summary', async (_, { id, updates }: { id: string; updates: any }) => {
    return DatabaseManager.getInstance().updateMeetingSummary(id, updates);
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

  // MODE 2: What Should I Say (Primary auto-answer)
  //
  // VISION-FIRST: image paths are validated and forwarded to IntelligenceManager
  // which routes them through the vision provider fallback chain.
  // OCR was removed (PLAN.md AG-16): the app answers from the image directly via a
  // vision-capable provider.
  safeHandle(
    'generate-what-to-say',
    async (
      _,
      question?: string,
      imagePaths?: string[],
    ) => {
      try {
        let screenContext: any;
        let screenContextStatus: 'not_available' | 'available' | 'failed' = 'not_available';
        let visionProviderUsed: string | undefined;
        let visionModelUsed: string | undefined;
        let visionAttempts: number | undefined;
        let visionFailureReason: string | undefined;

        const validatedImagePaths: string[] | undefined = imagePaths?.length ? [] : undefined;

        // SECURITY (P0): Validate image paths if provided from renderer
        if (imagePaths && imagePaths.length > 0) {
          if (
            !Array.isArray(imagePaths) ||
            imagePaths.length > 5 ||
            imagePaths.some(
              (imagePath) => typeof imagePath !== 'string' || imagePath.trim().length === 0,
            )
          ) {
            console.warn('[IPC] generate-what-to-say: malformed image path payload rejected');
            return {
              answer: null,
              question: question || 'unknown',
              screenContextStatus,
              error: 'Invalid image path payload',
            };
          }

          const { app } = require('electron');
          const { validateImagePath } = require('./utils/imagePathValidation');
          const userDataDir = app.getPath('userData');

          for (const imagePath of imagePaths) {
            const validation = validateImagePath(imagePath, userDataDir);
            if (!validation.isValid) {
              console.warn(
                `[IPC] generate-what-to-say: invalid image path rejected: ${validation.reason}`,
              );
              return {
                answer: null,
                question: question || 'unknown',
                screenContextStatus,
                error: `Invalid image path: ${validation.reason}`,
              };
            }
            validatedImagePaths!.push(imagePath);
          }

          // Vision-first: run the ScreenUnderstandingService so the image is hashed, optimized,
          // and routed through the vision provider fallback chain. The structured result becomes
          // the screenContext that PromptAssembler consumes.
          try {
            const {
              getScreenUnderstandingService,
            } = require('./services/screen/ScreenUnderstandingService');
            const { CredentialsManager } = require('./services/CredentialsManager');
            const sus = getScreenUnderstandingService();
            const settings = SettingsManager.getInstance();
            const credentials = CredentialsManager.getInstance();
            const providerScopes = settings.get('providerDataScopes') || {};
            if (providerScopes.screenshots === false) {
              console.warn('[ScopeFallback] screenshots denied for cloud providers; omitting from context');
            }

            const sur = await sus.understand({
              modeId: 'what-to-say',
              transcript: question,
              userAction: 'what_to_say',
              qualityMode: 'balanced',
              imagePaths: validatedImagePaths,
              screenUnderstandingMode: settings.getScreenUnderstandingMode(),
              technicalInterviewVisionFirst: settings.getTechnicalInterviewVisionFirst(),
              providerPolicy: {
                allowScreenshots: providerScopes.screenshots !== false,
                visionAvailable: credentials.anyVisionProviderConfigured?.() ?? true,
              },
            });

            screenContext = sur.status === 'available' ? sur : undefined;
            screenContextStatus =
              sur.status === 'available'
                ? 'available'
                : sur.status === 'failed'
                  ? 'failed'
                  : 'not_available';
            visionProviderUsed = sur.providerUsed;
            visionModelUsed = sur.modelUsed;
            visionAttempts = Array.isArray(sur.attempts) ? sur.attempts.length : undefined;
            visionFailureReason = sur.failureReason;
          } catch (sErr: any) {
            screenContextStatus = 'failed';
            console.warn('[IPC] generate-what-to-say: ScreenUnderstandingService failed', {
              errorClass: sErr?.name || 'Error',
            });
          }
        }

        const intelligenceManager = appState.getIntelligenceManager();
        // Question and imagePaths are now optional - IntelligenceManager infers from transcript
        const answer = await intelligenceManager.runWhatShouldISay(
          question,
          0.8,
          validatedImagePaths,
          {
            skipCooldown: process.env.NODE_ENV === 'test',
            screenContext,
          },
        );
        return {
          answer,
          question: question || 'inferred from context',
          screenContextStatus,
          visionProviderUsed,
          visionModelUsed,
          visionAttempts,
          visionFailureReason,
          imageCount: validatedImagePaths?.length || 0,
          usedImageInput: Boolean(validatedImagePaths?.length),
        };
      } catch (error: any) {
        console.error('[IPC] generate-what-to-say error:', error);
        return {
          answer: null,
          question: question || 'unknown',
          error: error?.message || 'unknown_error',
        };
      }
    },
  );

  safeHandle('generate-clarify', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const clarification = await intelligenceManager.runClarify();
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

  // Shared helper: validate, then run images through the vision-first ImageOptimizer
  // so downstream provider calls send compressed JPEG payloads instead of raw retina PNGs.
  // Falls back to the original paths if optimization fails — image input is more important
  // than payload size, so a Sharp failure must not block the request.
  async function optimizeImagesForVision(
    paths: string[],
    handlerLabel: string,
    profile: 'fast' | 'balanced' | 'technical' | 'best' = 'technical',
  ): Promise<string[]> {
    if (paths.length === 0) return paths;
    try {
      const { getImageOptimizer } = require('./services/screen/ImageOptimizer');
      const optimizer = getImageOptimizer();
      const optimized: string[] = [];
      for (const p of paths) {
        try {
          const out = await optimizer.optimize(p, { profile, provider: 'openai', cacheKey: p });
          optimized.push(out.path);
        } catch (err: any) {
          console.warn(
            `[IPC] ${handlerLabel}: image optimization failed for ${p}, using original`,
            { errorClass: err?.name },
          );
          optimized.push(p);
        }
      }
      return optimized;
    } catch {
      return paths;
    }
  }

  safeHandle('generate-code-hint', async (_, imagePaths?: string[], problemStatement?: string) => {
    try {
      // If no explicit images were passed from the frontend, fall back to the
      // screenshot queue so the AI can always "see" the user's screen.
      const screenshotQueue = appState.getScreenshotQueue();
      const resolvedImagePaths: string[] =
        imagePaths && imagePaths.length > 0 ? imagePaths : screenshotQueue;

      // SECURITY (P0): Validate image paths if provided from renderer
      if (imagePaths && imagePaths.length > 0) {
        const { app } = require('electron');
        const { validateImagePath } = require('./utils/imagePathValidation');
        const userDataDir = app.getPath('userData');

        for (const imagePath of imagePaths) {
          const validation = validateImagePath(imagePath, userDataDir);
          if (!validation.isValid) {
            console.warn(
              `[IPC] generate-code-hint: invalid image path rejected: ${validation.reason}`,
            );
            return { error: `Invalid image path: ${validation.reason}`, hint: null };
          }
        }
      }

      console.log(
        `[IPC] generate-code-hint: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? 'explicit' : 'queue fallback'})`,
      );

      // VISION-FIRST: optimize the screenshot(s) with Sharp before they reach the LLM,
      // using the 'technical' profile so code text stays sharp at 1536px.
      const optimizedPaths = await optimizeImagesForVision(
        resolvedImagePaths,
        'generate-code-hint',
        'technical',
      );

      const intelligenceManager = appState.getIntelligenceManager();
      const hint = await intelligenceManager.runCodeHint(
        optimizedPaths.length > 0 ? optimizedPaths : undefined,
        problemStatement,
      );
      return { hint };
    } catch (error: any) {
      throw error;
    }
  });

  safeHandle('generate-brainstorm', async (_, imagePaths?: string[], problemStatement?: string) => {
    try {
      // If no explicit images were passed from the frontend, fall back to the
      // screenshot queue so the AI can always "see" the user's screen.
      const screenshotQueue = appState.getScreenshotQueue();
      const resolvedImagePaths: string[] =
        imagePaths && imagePaths.length > 0 ? imagePaths : screenshotQueue;

      // SECURITY (P0): Validate image paths if provided from renderer
      if (imagePaths && imagePaths.length > 0) {
        const { app } = require('electron');
        const { validateImagePath } = require('./utils/imagePathValidation');
        const userDataDir = app.getPath('userData');

        for (const imagePath of imagePaths) {
          const validation = validateImagePath(imagePath, userDataDir);
          if (!validation.isValid) {
            console.warn(
              `[IPC] generate-brainstorm: invalid image path rejected: ${validation.reason}`,
            );
            return { error: `Invalid image path: ${validation.reason}`, script: null };
          }
        }
      }

      console.log(
        `[IPC] generate-brainstorm: using ${resolvedImagePaths.length} image(s) (${imagePaths?.length ? 'explicit' : 'queue fallback'})`,
      );

      // VISION-FIRST: balanced profile (1280px) — brainstorm doesn't need code-sharp text.
      const optimizedPaths = await optimizeImagesForVision(
        resolvedImagePaths,
        'generate-brainstorm',
        'balanced',
      );

      const intelligenceManager = appState.getIntelligenceManager();
      const script = await intelligenceManager.runBrainstorm(
        optimizedPaths.length > 0 ? optimizedPaths : undefined,
        problemStatement,
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
  safeHandle('generate-follow-up', async (_, intent: string, userRequest?: string) => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const refined = await intelligenceManager.runFollowUp(intent, userRequest);
      return { refined, intent };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 4: Recap (Summary)
  safeHandle('generate-recap', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const summary = await intelligenceManager.runRecap();
      return { summary };
    } catch (error: any) {
      throw error;
    }
  });

  // MODE 6: Follow-Up Questions
  safeHandle('generate-follow-up-questions', async () => {
    try {
      const intelligenceManager = appState.getIntelligenceManager();
      const questions = await intelligenceManager.runFollowUpQuestions();
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
  safeHandle('reset-intelligence', async () => {
    try {
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

  // Service Account Selection
  safeHandle('select-service-account', async () => {
    try {
      const selected: any = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (selected.canceled || selected.filePaths.length === 0) return { cancelled: true };
      const filePath = selected.filePaths[0];
      const account = loadGoogleServiceAccount(filePath);
      googleSpeechClientOptions(account);
      const { CredentialsManager } = require('./services/CredentialsManager');
      const result = await persistCredentials(
        () => CredentialsManager.getInstance().setGoogleServiceAccountPath(filePath, account),
        () => appState.updateGoogleCredentials(filePath, account),
      );
      return result.ok ? { ...result, path: filePath } : result;
    } catch {
      return { ok: false, code: 'write_failed', message: 'The service account file could not be selected or saved.' };
    }
  });

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

  safeHandle('skills:list', () => {
    try {
      return SkillsManager.getInstance().listSkills();
    } catch (e: any) {
      console.warn('[IPC] skills:list error:', e?.message || e);
      return [];
    }
  });

  safeHandle('skills:open-folder', async () => {
    try {
      return await SkillsManager.getInstance().openSkillsFolder();
    } catch (e: any) {
      console.warn('[IPC] skills:open-folder error:', e?.message || e);
      return { success: false, path: '', error: e?.message || 'failed to open skills folder' };
    }
  });
}
