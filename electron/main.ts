import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, systemPreferences, screen, desktopCapturer } from "electron"
import * as crypto from "crypto"
import path from "path"
import fs from "fs"
import { APP_IDENTITY } from './margin/appIdentity'
import { logAppEvent } from './utils/consoleLogging';
if (!app.isPackaged) {
  require('dotenv').config();
}


/**
 * Wraps a promise with a timeout. If the promise doesn't resolve within `ms`
 * milliseconds, rejects with an error whose message contains `tag`. This
 * prevents desktopCapturer.getSources (which can block indefinitely on TCC
 * dialogs or slow API responses) from hanging the Electron main process.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[withTimeout] ${tag} timed out after ${ms}ms`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}


async function ensureMacMicrophoneAccess(context: string): Promise<boolean> {
  if (process.platform !== 'darwin') return true;

  try {
    const currentStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log(`[Main] macOS microphone permission before ${context}: ${currentStatus}`);

    if (currentStatus === 'granted') {
      return true;
    }

    const granted = await systemPreferences.askForMediaAccess('microphone');
    console.log(
      `[Main] macOS microphone permission request during ${context}: ${granted ? 'granted' : 'denied'}`
    );
    return granted;
  } catch (error) {
    console.error(`[Main] Failed to check macOS microphone permission during ${context}:`, error);
    return false;
  }
}

/**
 * Check macOS Screen Recording (kTCCServiceScreenCapture) permission status.
 *
 * Electron has no askForMediaAccess('screen') API — macOS only shows the TCC
 * dialog when the app actually calls a protected API (SCK / CoreAudio tap).
 * If the permission is 'denied', we cannot re-prompt; the user must re-enable
 * manually in System Settings → Privacy & Security → Screen Recording.
 *
 * Returns false only when the permission is explicitly 'denied'. All other
 * statuses ('granted', 'not-determined', 'restricted') return true because:
 *   - 'granted':         already allowed — nothing to do.
 *   - 'not-determined':  macOS will show the dialog when SCK/CoreAudio tap runs.
 *   - 'restricted':      managed device policy — nothing we can do programmatically.
 */
type MacScreenCaptureStatus = 'granted' | 'denied' | 'not-determined' | 'restricted';

type MacScreenCaptureCapability = {
  status: MacScreenCaptureStatus;
  capturable: boolean;
  effectiveDenied: boolean;
  sourceCount: number;
  message?: string;
  error?: string;
};

let latestSystemAudioPermissionWarning: string | null = null;

function rememberSystemAudioPermissionWarning(message: string): void {
  latestSystemAudioPermissionWarning = message;
}

function clearSystemAudioPermissionWarning(): void {
  latestSystemAudioPermissionWarning = null;
}

/**
 * B5: Whether the dev-mode TCC bypass is enabled.
 *
 * Pre-fix this bypass was unconditional in dev mode: every `npm run app:dev`
 * launch reported screen-capture status as `'granted'` regardless of the
 * actual TCC state. Production bugs (the dominant "permissions granted but
 * no transcription" failure mode) were invisible during local dev.
 *
 * Now opt-in: default OFF in dev so devs see the real TCC status; set
 * `NATIVELY_DEV_BYPASS_SCREEN_TCC=1` to restore the legacy bypass for
 * smooth daily development.
 */
function isDevTccBypassEnabled(): boolean {
  return !app.isPackaged && process.env.NATIVELY_DEV_BYPASS_SCREEN_TCC === '1';
}

function getMacScreenCaptureStatus(): MacScreenCaptureStatus {
  if (process.platform !== 'darwin') return 'granted';

  // B5: opt-in dev bypass — see isDevTccBypassEnabled() for rationale.
  if (isDevTccBypassEnabled()) {
    console.log('[Main] Dev TCC bypass enabled (NATIVELY_DEV_BYPASS_SCREEN_TCC=1) — reporting screen capture as granted');
    return 'granted';
  }

  try {
    return systemPreferences.getMediaAccessStatus('screen') as MacScreenCaptureStatus;
  } catch (error) {
    console.error('[Main] Failed to check screen recording permission:', error);
    return 'not-determined';
  }
}

async function resolveMacScreenCaptureCapability(context: string): Promise<MacScreenCaptureCapability> {
  const status = getMacScreenCaptureStatus();

  const isMac = process.platform === 'darwin';
  // B5: Mirror getMacScreenCaptureStatus's opt-in bypass policy. Default in
  // dev is to run the full capability resolution so devs see the real path.
  if (!isMac || isDevTccBypassEnabled()) {
    clearSystemAudioPermissionWarning();
    return { status, capturable: true, effectiveDenied: false, sourceCount: 0 };
  }

  if (isMac && status === 'restricted') {
    const message = formatPermissionMessage('mac-screen-recording-restricted');
    rememberSystemAudioPermissionWarning(message);
    return { status, capturable: false, effectiveDenied: true, sourceCount: 0, message };
  }

  if (status !== 'denied') {
    clearSystemAudioPermissionWarning();
    return { status, capturable: true, effectiveDenied: false, sourceCount: 0 };
  }

  try {
    const sources = await withTimeout(
      desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
      }),
      5000,
      `screen-capture-probe-timeout-${context}`,
    );
    const sourceCount = sources.filter((source) => source.id.startsWith('screen:')).length;
    const capturable = sourceCount > 0;

    if (capturable) {
      clearSystemAudioPermissionWarning();
      console.warn(`[Main] Screen Recording status is denied during ${context}, but capture probe succeeded; continuing without permission banner.`);
    } else {
      rememberSystemAudioPermissionWarning(formatPermissionMessage('screen-recording-denied'));
    }

    return { status, capturable, effectiveDenied: !capturable, sourceCount };
  } catch (error: any) {
    // Did the timeout fire?
    if (error?.message?.includes('screen-capture-probe-timeout')) {
      const message = formatPermissionMessage('screen-recording-denied');
      rememberSystemAudioPermissionWarning(message + ' (probe timed out)');
      console.warn(`[Main] Screen Recording capture probe timed out during ${context} — treating as denied.`);
      return { status, capturable: false, effectiveDenied: true, sourceCount: 0, message, error: error.message };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    const message = formatPermissionMessage('screen-recording-denied');
    rememberSystemAudioPermissionWarning(message);
    console.warn(`[Main] Screen Recording capture probe failed during ${context}: ${errorMessage}`);
    return { status, capturable: false, effectiveDenied: true, sourceCount: 0, message, error: errorMessage };
  }
}

/**
 * Format a user-facing audio/permission message for the current platform.
 * macOS has TCC (Screen Recording, Microphone) panes under System Settings;
 * Windows has no equivalent for screen-capture (system audio loopback runs
 * via WASAPI without OS-level gating) and gates the microphone via
 * Settings → Privacy → Microphone. Reusing macOS copy on Windows is the
 * cross-contamination class behind issue #252.
 */
// Variants prefixed `mac-` are macOS-only and reference TCC / CoreAudio /
// ScreenCaptureKit concepts that don't exist on Windows. Call sites for those
// must themselves be gated behind `process.platform === 'darwin'` — the
// prefix makes that constraint visible during code review. Cross-platform
// variants have no prefix and branch internally on isMac.
type PermissionReason =
  | 'screen-recording-denied'
  | 'mac-screen-recording-restricted'
  | 'mac-screen-recording-revoked-rebuild'
  | 'mic-denied'
  | 'mic-zero-fill'
  | 'mac-same-device-input-output'
  | 'system-audio-stuck';
function formatPermissionMessage(reason: PermissionReason, extra?: { device?: string }): string {
  const isMac = process.platform === 'darwin';
  switch (reason) {
    case 'screen-recording-denied':
      return isMac
        ? 'Screen Recording permission denied. Interviewer audio will not be captured. Enable in System Settings → Privacy & Security → Screen Recording, then restart the app.'
        : 'System audio capture is unavailable. Interviewer audio will not be captured. Check your audio device routing in Settings and restart the meeting.';
    case 'mac-screen-recording-restricted':
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return `Screen Recording is restricted by device policy. Interviewer audio will not be captured. Contact your administrator to allow screen capture for ${APP_IDENTITY.name}.`;
    case 'mac-screen-recording-revoked-rebuild':
      // Defense-in-depth: even though all call sites must be darwin-gated
      // (the `mac-` prefix marks this constraint), if a future contributor
      // calls this from a cross-platform path we degrade gracefully rather
      // than leak macOS UI strings to Windows users.
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return `System audio is being captured but every sample is silent. This usually means macOS Screen Recording permission needs to be re-granted to this build of ${APP_IDENTITY.name}. Open System Settings → Privacy & Security → Screen Recording, toggle ${APP_IDENTITY.name} off and back on, then restart the app. (If you recently rebuilt or updated, the previous grant may not apply.)`;
    case 'mic-denied':
      return isMac
        ? `Microphone access denied. Please allow microphone access in System Settings → Privacy & Security → Microphone, then restart ${APP_IDENTITY.name}.`
        : `Microphone access denied. Please allow microphone access in Settings → Privacy → Microphone, then restart ${APP_IDENTITY.name}.`;
    case 'mic-zero-fill':
      return isMac
        ? `Microphone is producing silent audio. Check that the device is unmuted and that macOS Microphone permission is granted to ${APP_IDENTITY.name} in System Settings → Privacy & Security → Microphone.`
        : `Microphone is producing silent audio. Check that the device is unmuted and that ${APP_IDENTITY.name} has microphone access in Settings → Privacy → Microphone.`;
    case 'mac-same-device-input-output':
      // Defense-in-depth: see comment on `mac-screen-recording-revoked-rebuild`.
      // The CoreAudio Process Tap same-device limitation is macOS-specific;
      // on Windows WASAPI loopback works fine on the same device as the mic.
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return `Silent capture detected — input and output are the same device (${extra?.device ?? 'unknown'}). macOS cannot tap a device while it is also the active microphone. Switch input to built-in mic or output to built-in speakers.`;
    case 'system-audio-stuck':
      return 'No audio detected on system output for 8s. If your meeting app is using a different output device (Bluetooth headset, virtual cable, second monitor), switch it to your default output, or restart the meeting after switching.';
  }
}


import { initializeIpcHandlers } from "./ipcHandlers"
import { WindowHelper } from "./WindowHelper"
import { SettingsWindowHelper } from "./SettingsWindowHelper"
import { ModelSelectorWindowHelper } from "./ModelSelectorWindowHelper"
import { CropperWindowHelper } from "./CropperWindowHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { KeybindManager } from "./services/KeybindManager"
import { ProcessingHelper } from "./ProcessingHelper"

import { IntelligenceManager } from "./IntelligenceManager"
import { SystemAudioCapture } from "./audio/SystemAudioCapture"
import { MicrophoneCapture } from "./audio/MicrophoneCapture"
import { AudioDevices } from "./audio/AudioDevices"
import { MeetingAudioPipeline } from './audio/MeetingAudioPipeline';
import { MeetingSttSession, type CollectOptions, type DictationMark, type SessionTranscript, type SpeechCollector } from './audio/MeetingSttSession';
import { MeetingLifecycleQueue } from './audio/meetingLifecycleQueue';
import { TranscriptDisplayThrottle } from './audio/TranscriptDisplayThrottle';
import { registerOsEventSubscriptions } from './osEventSubscriptions';
import { loadNativeModule } from "./audio/nativeModuleLoader"
import { RestSTT } from "./audio/RestSTT"
import { SonioxStreamingSTT } from "./audio/SonioxStreamingSTT"
import { OpenAIStreamingSTT } from "./audio/OpenAIStreamingSTT"
import { AliyunStreamingSTT } from './audio/AliyunStreamingSTT';
import { DoubaoStreamingSTT } from './audio/DoubaoStreamingSTT';
import { ThemeManager } from "./ThemeManager"
import { DatabaseManager } from "./db/DatabaseManager"

/** Unified type for all STT providers with optional extended capabilities */
type STTProvider = (RestSTT | SonioxStreamingSTT | OpenAIStreamingSTT | AliyunStreamingSTT | DoubaoStreamingSTT) & {
  finalize?: () => void;
  setAudioChannelCount?: (count: number) => void;
  notifySpeechEnded?: () => void;
};

type ScreenshotWindowMode = 'launcher' | 'overlay';

/** Payload for stt-status IPC events broadcast from main to renderer */
interface SttStatusPayload {
  // 'awaiting-audio' (B2) is the post-meeting-start / pre-verified-audio state:
  // STT WS may be connected but no isFinal transcript has arrived yet, so we
  // cannot honestly claim 'connected' in the UI. Renderers should display this
  // as a neutral "Listening for audio…" indicator, NOT green/active.
  state: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio';
  provider: string;
  error?: string;
  channel: 'user' | 'interviewer';
  reconnectAttempts?: number;
}
type ScreenshotCaptureKind = 'full' | 'selective';

interface ScreenshotCaptureSession {
  captureKind: ScreenshotCaptureKind;
  wasMainWindowVisible: boolean;
  windowMode: ScreenshotWindowMode;
  wasSettingsVisible: boolean;
  wasModelSelectorVisible: boolean;
  overlayBounds: Electron.Rectangle | null;
  overlayDisplayId: number | null;
  restoreWithoutFocus: boolean;
}

import { CredentialsManager } from "./services/CredentialsManager"
import type { CredentialSaveResult } from '../src/types/credentialSave';
import { SettingsManager } from "./services/SettingsManager"
import { mainText } from "./services/mainStrings"
import { setVerboseLoggingFlag } from "./verboseLog"
import { decideToggle } from './services/toggleStateReducer'
import { isDisguiseMode, type WindowPreferenceKind, type WindowPreferenceResult } from '../src/types/windowPreferences';

export class AppState {
  public prepareCaptureAction?: (owner: Electron.WebContents) => { speechActionId: string };
  public cancelCaptureAction?: (owner: Electron.WebContents, speechActionId: string) => void;
  public isCaptureActionPending?: (owner: Electron.WebContents, speechActionId: string) => boolean;
  private static instance: AppState | null = null

  private windowHelper: WindowHelper
  public settingsWindowHelper: SettingsWindowHelper
  public modelSelectorWindowHelper: ModelSelectorWindowHelper
  public cropperWindowHelper: CropperWindowHelper
  private screenshotHelper: ScreenshotHelper
  public processingHelper: ProcessingHelper

  private intelligenceManager: IntelligenceManager
  private themeManager: ThemeManager
  private tray: Tray | null = null
  private disguiseMode: 'terminal' | 'settings' | 'activity' | 'none' = 'none'

  // View management
  private view: "queue" | "solutions" = "queue"
  private isUndetectable: boolean = false
  private _windowPreferenceRevision = { protection: 0, passthrough: 0, disguise: 0 };
  private _protectionApplyFailed = false;
  private _dockApplyTask: Promise<void> = Promise.resolve();
  private _settingsBlurRestoreTimer: NodeJS.Timeout | null = null;
  private _windowPreferenceResults: Partial<Record<WindowPreferenceKind, WindowPreferenceResult>> = {};

  private problemInfo: {
    problem_statement: string
    input_format: Record<string, any>
    output_format: Record<string, any>
    constraints: Array<Record<string, any>>
    test_cases: Array<Record<string, any>>
  } | null = null // Allow null

  private hasDebugged: boolean = false
  private isMeetingActive: boolean = false; // Guard for session state leaks
  private readonly meetingLifecycle = new MeetingLifecycleQueue();
  private activeAudioSession: string | null = null;
  private audioSuspended = false;
  private suspendTask: Promise<void> = Promise.resolve();
  private shutdownTask: Promise<void> | null = null;
  private readonly transcriptDisplay = new TranscriptDisplayThrottle(payload => this.sendToMeetingSurfaces('native-audio-transcript', payload));
  private readonly meetingStt = new MeetingSttSession<STTProvider>({
    create: channel => this.createSTTProvider(channel),
    onTranscript: event => this.handleSttTranscript(event),
  });
  private readonly meetingAudio = new MeetingAudioPipeline(this.meetingStt,
    () => ({ active: this.isMeetingActive && !this.audioSuspended, quitting: this._isQuitting, verbose: this._verboseLogging }), {
      captureFailed: payload => this.sendAudioCaptureFailed(payload),
      systemPermissionDenied: message => this.sendSystemAudioPermissionDenied(message),
      deviceSelection: payload => this.broadcastDeviceSelection(payload),
      monitorCapture: (capture, channel) => {
        if (channel === 'user') return this.wireMicCapture(capture as MicrophoneCapture);
        return this.wireSystemCapture(capture as SystemAudioCapture);
      },
    }, resolveMacScreenCaptureCapability);
  // Only this session's final transcripts are accepted while stopping.
  private _isDraining: boolean = false;
  private get _lastRequestedOutputDeviceId() { return this.meetingAudio._lastRequestedOutputDeviceId; }
  private _isQuitting: boolean = false;
  private _verboseLogging: boolean = false;
  private _disguiseTimers: NodeJS.Timeout[] = []; // Track forceUpdate timeouts
  private _dockReassertTimers: NodeJS.Timeout[] = []; // Re-assert dock-hidden state after show+focus
  private screenshotCaptureInProgress: boolean = false;


  // Processing events
  public readonly PROCESSING_EVENTS = {
    //global states
    UNAUTHORIZED: "procesing-unauthorized",
    NO_SCREENSHOTS: "processing-no-screenshots",

    //states for generating the initial solution
    INITIAL_START: "initial-start",
    PROBLEM_EXTRACTED: "problem-extracted",
    SOLUTION_SUCCESS: "solution-success",
    INITIAL_SOLUTION_ERROR: "solution-error",

    //states for processing the debugging
    DEBUG_START: "debug-start",
    DEBUG_SUCCESS: "debug-success",
    DEBUG_ERROR: "debug-error"
  } as const

  constructor() {
    // 1. Load boot-critical settings first (used by WindowHelpers)
    const settingsManager = SettingsManager.getInstance();
    this.isUndetectable = settingsManager.get('isUndetectable') === true;
    const savedDisguise = settingsManager.get('disguiseMode');
    this.disguiseMode = isDisguiseMode(savedDisguise) ? savedDisguise : 'none';
    this._verboseLogging = settingsManager.get('verboseLogging') ?? false;
    setVerboseLoggingFlag(this._verboseLogging);
    console.log(`[AppState] Initialized with isUndetectable=${this.isUndetectable}, disguiseMode=${this.disguiseMode}, verboseLogging=${this._verboseLogging}`);

    // 2. Initialize Helpers with loaded state
    this.windowHelper = new WindowHelper(this)
    this.settingsWindowHelper = new SettingsWindowHelper()
    this.modelSelectorWindowHelper = new ModelSelectorWindowHelper()
    this.cropperWindowHelper = new CropperWindowHelper(() => this.getDisguiseName(), () => this.reportProtectionFailure(), () => this.getDisguiseIconPath())

    // 3. Initialize other helpers
    this.screenshotHelper = new ScreenshotHelper(this.view)
    this.processingHelper = new ProcessingHelper(this)

    this.windowHelper.setContentProtection(this.isUndetectable);
    this.settingsWindowHelper.setContentProtection(this.isUndetectable);
    this.modelSelectorWindowHelper.setContentProtection(this.isUndetectable);
    this.cropperWindowHelper.setContentProtection(this.isUndetectable);

    if (process.platform === 'win32' || process.platform === 'darwin') {
      this.cropperWindowHelper.preload();
    }

    // Initialize KeybindManager
    const keybindManager = KeybindManager.getInstance();
    keybindManager.setWindowHelper(this.windowHelper);
    keybindManager.setupIpcHandlers();
    keybindManager.onUpdate(() => {
      this.updateTrayMenu();
    });

    // Stealth keyboard tap (CGEventTap) IPC. Renderer drives the permission
    // flow + queries availability/state; the tap itself is toggled by the
    // global shortcut handler above. Only registered on macOS — on other
    // platforms these handlers no-op so the renderer can render fallback UI.
    //
    // removeHandler-then-handle on each channel is defensive against a
    // second `app.ready` firing (rare but possible during dev HMR / single-
    // instance second-launch path) — `ipcMain.handle` throws on duplicate
    // registration, which would propagate as a renderer IPC rejection and
    // silently leave isCgEventTapAvailableRef at its safe-false default.
    const registerStealthHandler = (channel: string, fn: (...args: any[]) => any) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, fn);
    };
    registerStealthHandler('get-system-audio-permission-warning', () => latestSystemAudioPermissionWarning);
    if (process.platform === 'darwin') {
      const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
      const stealth = StealthKeyboardManager.getInstance();
      registerStealthHandler('stealth-tap:available', () => stealth.isAvailable());
      registerStealthHandler('stealth-tap:open-settings', () => { stealth.openSettings(); });
      registerStealthHandler('stealth-tap:stop', () => { stealth.stop(); });
      registerStealthHandler('stealth-tap:start', () => stealth.start());
      // IME users (Pinyin, Hangul, Kanji, …) cannot compose under the tap
      // because CGEventTap fires below TIS. Renderer consults this before
      // click-to-engage so it can fall back to plain DOM focus when an IME
      // is in play. See electron/services/ImeDetector.ts for the rationale.
      registerStealthHandler('stealth-tap:should-auto-engage', () => {
        const { shouldAutoEngageStealthTap } = require('./services/ImeDetector');
        return shouldAutoEngageStealthTap();
      });
      // Force a fresh IME probe and return the refined value. Renderer calls
      // this on window focus so users who add a Pinyin/Hangul source mid-
      // session don't silently break CJK composition the next time the tap
      // would auto-engage (the cached value from mount-time would be stale).
      registerStealthHandler('stealth-tap:refresh-ime', () => {
        const { refreshImeDetection, shouldAutoEngageStealthTap } = require('./services/ImeDetector');
        refreshImeDetection();
        return shouldAutoEngageStealthTap();
      });
    } else {
      registerStealthHandler('stealth-tap:available', () => false);
      registerStealthHandler('stealth-tap:open-settings', () => {});
      registerStealthHandler('stealth-tap:stop', () => {});
      registerStealthHandler('stealth-tap:start', () => false);
      // Non-darwin: returns true so the renderer's stealthAutoEngageOkRef
      // stays true and the explicit isCgEventTapAvailableRef guard (added in
      // PR #250) is what actually gates blockInputFocus. Inverted relative
      // to availability on purpose — see ImeDetector.ts:67.
      registerStealthHandler('stealth-tap:should-auto-engage', () => true);
      registerStealthHandler('stealth-tap:refresh-ime', () => true);
    }

    keybindManager.onShortcutTriggered(async (actionId) => {
      console.log(`[Main] Global shortcut triggered: ${actionId}`);
      try {
        if (actionId === 'general:toggle-visibility') {
          this.toggleMainWindow();
        } else if (actionId === 'general:toggle-mouse-passthrough') {
          // Adapted from public PR #113
          this.toggleOverlayMousePassthrough();
        } else if (actionId === 'general:take-screenshot') {
          // Route to renderer via global-shortcut so the renderer handles the
          // screenshot through the IPC invoke path (request/response guarantee).
          // The old pattern — main takes screenshot → fires screenshot-taken event →
          // renderer listener catches it — was unreliable in overlay mode because the
          // fire-and-forget event could be missed if the listener registration had any
          // timing gap. The invoke path used by generalHandlers.takeScreenshot() is
          // already proven to work for UI-button screenshots; reuse it here.
          const mainWindow = this.getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('global-shortcut', { action: 'takeScreenshot' });
          }
        } else if (actionId === 'general:selective-screenshot') {
          const mainWindow = this.getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('global-shortcut', { action: 'selectiveScreenshot' });
          }
        } else if (actionId === 'general:capture-and-process') {
          // Single-trigger: capture current screen then immediately request AI analysis
          const owner = this.getMainWindow()?.webContents;
          if (!owner || !this.prepareCaptureAction) return;
          const action = this.prepareCaptureAction(owner);
          let screenshotPath: string, preview: string;
          try {
            screenshotPath = await this.takeScreenshot(false);
            preview = await this.getImagePreview(screenshotPath);
          } catch (error) { this.cancelCaptureAction?.(owner, action.speechActionId); throw error; }
          // A newer action, cancel or reset during the screenshot supersedes this one.
          if (!this.isCaptureActionPending?.(owner, action.speechActionId)) return;
          // Ensure the window is visible so the user can see the response without stealing focus
          this.showMainWindow(true);
          // win.focus() can cause macOS to re-activate the app. Re-hide the dock
          // if we are in undetectable mode.
          if (process.platform === 'darwin' && this.isUndetectable) {
            app.dock.hide();
          }
          const mainWindow = this.getMainWindow();
          if (mainWindow?.webContents === owner && !owner.isDestroyed()) {
            mainWindow.webContents.send("capture-and-process", {
              path: screenshotPath,
              preview,
              speechActionId: action.speechActionId
            });
          } else {
            this.cancelCaptureAction?.(owner, action.speechActionId);
          }

        // --- STEALTH SHORTCUTS: no focus, no show, pure IPC dispatch ---

        // Chat actions — fire into the renderer without focusing the window
        } else if (actionId === 'chat:focusInput') {
          // Toggle CGEventTap-backed stealth typing mode. While engaged, every
          // keystroke is captured at the OS event-pipeline layer and routed to
          // the renderer; the foreground app (Zoom/browser/etc.) does NOT
          // receive any key events and never loses key/frontmost status. This
          // is the only path that delivers true Cluely-grade undetectability
          // on macOS — NSPanel-nonactivating gets us 90% there, the tap closes
          // the remaining gap (the panel never even has to become key-window).
          //
          // Falls back to plain panel.focus() if the native tap is unavailable
          // (no rebuild yet, no Accessibility permission, or non-macOS).
          this.showMainWindow(true);
          const overlay = this.windowHelper.getOverlayWindow();
          if (overlay && !overlay.isDestroyed()) {
            overlay.webContents.send('ensure-expanded');
          }

          if (process.platform === 'darwin') {
            const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
            const mgr = StealthKeyboardManager.getInstance();
            if (mgr.isAvailable()) {
              mgr.toggle();
              return; // tap is the input path; no need to focus the panel
            }
          }

          // Fallback: panel-safe focus on macOS without tap, brief focus on Win.
          if (overlay && !overlay.isDestroyed()) {
            overlay.webContents.send('global-shortcut', { action: 'focusInput' });
            overlay.focus();
          }
        } else if (
          actionId === 'chat:whatToAnswer' ||
          actionId === 'chat:clarify' ||
          actionId === 'chat:followUp' ||
          actionId === 'chat:answer' ||
          actionId === 'chat:codeHint' ||
          actionId === 'chat:brainstorm' ||
          actionId === 'chat:dynamicAction4' ||
          actionId === 'chat:scrollUp' ||
          actionId === 'chat:scrollDown' ||
          actionId === 'chat:scrollLeft' ||
          actionId === 'chat:scrollRight'
        ) {
          const actionMap: Record<string, string> = {
            'chat:whatToAnswer': 'whatToAnswer',
            'chat:clarify': 'clarify',
            'chat:followUp': 'followUp',
            'chat:answer': 'answer',
            'chat:codeHint': 'codeHint',
            'chat:brainstorm': 'brainstorm',
            'chat:dynamicAction4': 'dynamicAction4',
            'chat:scrollUp': 'scrollUp',
            'chat:scrollDown': 'scrollDown',
            'chat:scrollLeft': 'scrollLeft',
            'chat:scrollRight': 'scrollRight',
          };
          const action = actionMap[actionId];
          this.sendToMeetingSurfaces('global-shortcut', { action });

        // Window movement — move window position without focus change
        } else if (actionId === 'window:move-up') {
          this.windowHelper.moveWindowUp();
        } else if (actionId === 'window:move-down') {
          this.windowHelper.moveWindowDown();
        } else if (actionId === 'window:move-left') {
          this.windowHelper.moveWindowLeft();
        } else if (actionId === 'window:move-right') {
          this.windowHelper.moveWindowRight();

        // General actions that are now global (stealth)
        } else if (actionId === 'general:process-screenshots') {
          this.sendToMeetingSurfaces('global-shortcut', { action: 'processScreenshots' });
        } else if (actionId === 'general:reset-cancel') {
          this.sendToMeetingSurfaces('global-shortcut', { action: 'resetCancel' });
        }
      } catch (e: any) {
        if (e.message !== "Selection cancelled" && e.message !== "Screenshot capture already in progress") {
          console.error(`[Main] Error handling global shortcut ${actionId}:`, e);
        }
      }
    });

    // Inject WindowHelper into other helpers
    this.settingsWindowHelper.setWindowHelper(this.windowHelper);
    this.modelSelectorWindowHelper.setWindowHelper(this.windowHelper);





    // Initialize IntelligenceManager with LLMHelper
    this.intelligenceManager = new IntelligenceManager(this.processingHelper.getLLMHelper())

    // Initialize ThemeManager
    this.themeManager = ThemeManager.getInstance()

    // Restore toggle states that live in LLMHelper memory.
    // This MUST happen here so that it runs unconditionally.
    {
      const llmHelper = this.processingHelper.getLLMHelper();
      if (settingsManager.get('groqFastTextMode')) {
        llmHelper.setGroqFastTextMode(true);
        console.log('[AppState] Fast mode restored from settings');
      }
      llmHelper.setCodexCliConfig(settingsManager.getCodexSourceConfig());
      // Restore custom notes
      try {
        const savedNotes = DatabaseManager.getInstance().getCustomNotes();
        if (savedNotes) {
          llmHelper.setCustomNotes(savedNotes);
        }
      } catch (_) {}
    }


    this.setupIntelligenceEvents()

  }

  private sendToWindow(win: BrowserWindow | null | undefined, channel: string, ...args: any[]): boolean {
    if (!win || win.isDestroyed()) return false;
    try {
      win.webContents.send(channel, ...args);
      return true;
    } catch {
      return false;
    }
  }

  private sendToMeetingSurfaces(channel: string, ...args: any[]): void {
    const sent = new Set<number>();
    const sendOnce = (win: BrowserWindow | null | undefined) => {
      if (!win || sent.has(win.id)) return;
      if (this.sendToWindow(win, channel, ...args)) sent.add(win.id);
    };
    sendOnce(this.windowHelper.getLauncherWindow());
    sendOnce(this.windowHelper.getOverlayWindow());
  }

  private sendToSettingsSurfaces(channel: string, ...args: any[]): void {
    const sent = new Set<number>();
    const sendOnce = (win: BrowserWindow | null | undefined) => {
      if (!win || sent.has(win.id)) return;
      if (this.sendToWindow(win, channel, ...args)) sent.add(win.id);
    };
    sendOnce(this.settingsWindowHelper.getSettingsWindow());
    sendOnce(this.windowHelper.getLauncherWindow());
  }

  // 'model-changed' listeners: the overlay (NativelyInterface) and the model
  // selector window. Other windows do not show the active model.
  public sendModelChanged(modelId: string): void {
    const sent = new Set<number>();
    const sendOnce = (win: BrowserWindow | null | undefined) => {
      if (!win || sent.has(win.id)) return;
      if (this.sendToWindow(win, 'model-changed', modelId)) sent.add(win.id);
    };
    sendOnce(this.windowHelper.getOverlayWindow());
    sendOnce(this.modelSelectorWindowHelper.getWindow());
  }

  private sendSttStatus(payload: any): void {
    this.sendToMeetingSurfaces('stt-status', payload);
  }

  // Public so initializeApp's startup permission checks (UX1) can emit the
  // banner symmetrically with sendSystemAudioPermissionDenied. Other in-class
  // call sites are unaffected.
  public sendAudioCaptureFailed(payload: any): void {
    this.sendToMeetingSurfaces('audio-capture-failed', payload);
  }

  public sendSystemAudioPermissionDenied(message: string): void {
    this.sendToMeetingSurfaces('system-audio-permission-denied', message);
  }

  private broadcast(channel: string, ...args: any[]): void {
    BrowserWindow.getAllWindows().forEach(win => {
      this.sendToWindow(win, channel, ...args);
    });
  }

  public getIsMeetingActive(): boolean {
    return this.isMeetingActive;
  }

  public isQuitting(): boolean {
    return this._isQuitting;
  }

  public setQuitting(value: boolean): void {
    this._isQuitting = value;
  }

  private broadcastMeetingState(): void {
    this.broadcast('meeting-state-changed', { isActive: this.isMeetingActive });
  }

  // New Property for System Audio & Microphone
  private get systemAudioCapture() { return this.meetingAudio.systemAudioCapture; }
  private get microphoneCapture() { return this.meetingAudio.microphoneCapture; }
  private audioTestCapture: MicrophoneCapture | null = null; // For audio settings test
  private _audioTestStarting = false;               // P2-12: in-flight guard against concurrent calls
  private get googleSTT() { return this.meetingStt.get('interviewer'); }
  private set googleSTT(value: STTProvider | null) { this.meetingStt.set('interviewer', value); }
  private get googleSTT_User() { return this.meetingStt.get('user'); }
  private set googleSTT_User(value: STTProvider | null) { this.meetingStt.set('user', value); }

  private handleSttTranscript(event: SessionTranscript): void {
    if (event.sessionId !== this.activeAudioSession || (!this.isMeetingActive && !(this._isDraining && event.final))) return;
    const payload = { speaker: event.channel, text: event.text, timestamp: event.timestamp, final: event.final, confidence: event.confidence };
    this.intelligenceManager.handleTranscript({ ...payload, segmentId: event.segmentId });
    this.transcriptDisplay.send(payload);
  }

  private createSTTProvider(speaker: 'interviewer' | 'user'): STTProvider | null {
    const { CredentialsManager } = require('./services/CredentialsManager');
    const sttProvider = CredentialsManager.getInstance().getSttProvider();
    const sttLanguage = CredentialsManager.getInstance().getSttLanguage();

    // 'none' means the user has explicitly disabled STT (no provider selected).
    // Return null so the pipeline skips STT without falling back to Google.
    if (sttProvider === 'none') {
      return null;
    }

    let stt: STTProvider;

    if (sttProvider === 'aliyun' || sttProvider === 'doubao') {
      const { createDomesticStt } = require('./ipc/sttHandlers');
      const domestic: AliyunStreamingSTT | DoubaoStreamingSTT | null = createDomesticStt(sttProvider);
      if (!domestic) return null;
      stt = domestic;
    } else if (sttProvider === 'soniox') {
      const apiKey = CredentialsManager.getInstance().getSonioxApiKey();
      if (apiKey?.trim()) {
        console.log(`[Main] Using SonioxStreamingSTT for ${speaker}`);
        stt = new SonioxStreamingSTT(apiKey);
      } else {
        console.warn(`[Main] No API key for Soniox STT; transcription disabled`);
        return null;
      }
    } else if (sttProvider === 'openai') {
      // OpenAI: WebSocket Realtime (gpt-4o-transcribe → gpt-4o-mini-transcribe) with whisper-1 REST fallback.
      // If a custom OpenAI-compatible base URL is configured (e.g. Speaches), the STT class
      // skips the Realtime WS path and uses REST against the custom endpoint.
      const apiKey = CredentialsManager.getInstance().getOpenAiSttApiKey();
      const baseUrl = CredentialsManager.getInstance().getOpenAiSttBaseUrl();
      if (apiKey?.trim()) {
        console.log(`[Main] Using OpenAIStreamingSTT for ${speaker}${baseUrl ? ` (custom endpoint: ${baseUrl})` : ' (WebSocket+REST fallback)'}`);
        stt = new OpenAIStreamingSTT(apiKey, baseUrl);
      } else {
        console.warn(`[Main] No API key for OpenAI STT; transcription disabled`);
        return null;
      }
    } else if (sttProvider === 'groq') {
      const apiKey = CredentialsManager.getInstance().getGroqSttApiKey();
      const modelOverride = CredentialsManager.getInstance().getGroqSttModel();

      if (apiKey?.trim()) {
        console.log(`[Main] Using RestSTT (${sttProvider}) for ${speaker}`);
        stt = new RestSTT(sttProvider, apiKey, modelOverride);
      } else {
        console.warn(`[Main] No API key for ${sttProvider} STT; transcription disabled`);
        return null;
      }
    } else return null;

    stt.setRecognitionLanguage(sttLanguage);

    // Consecutive failure counter — reset on any successful final transcript
    let _consecutiveErrors = 0;

    // B2: Track state so we broadcast 'connected' on recovery from failed/reconnecting.
    // Initialize to 'awaiting-audio' so the renderer's UI starts in the neutral
    // "Listening for audio…" state until the first isFinal transcript proves
    // the pipeline is actually flowing. Pre-fix this was 'reconnecting' which
    // implied a recovery state from the get-go.
    let _lastState: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio' = 'awaiting-audio';

    stt.on('error', (err: Error) => {
      if (this.meetingStt.get(speaker) !== stt || !this.isMeetingActive) return;
      // An idle-timeout closes the stream with code 11 ("Audio Timeout Error").
      // Downgrade to a one-liner here so a stray bubble-up doesn't cascade into stack-trace noise.
      const grpcCode = (err as any)?.code;
      if (grpcCode === 11 || /Audio Timeout Error/i.test(err.message || '')) {
        console.warn(`[Main] STT (${speaker}) idle-timed-out (provider's no-audio limit), reconnecting on next chunk.`);
        return;
      }

      console.error(`[Main] STT (${speaker}) Error:`, err);

      // Extract richer error info from Axios errors (RestSTT)
      let errorMessage = err.message;
      const axiosErr = err as any;
      const httpStatus = axiosErr?.response?.status || 0;
      if (axiosErr?.response?.data?.error) {
        const respErr = axiosErr.response.data.error;
        const respMsg = typeof respErr === 'string' ? respErr : (respErr.message || respErr.code || JSON.stringify(respErr));
        errorMessage = httpStatus ? `${httpStatus} ${respMsg}` : respMsg;
      } else if (httpStatus) {
        errorMessage = `${httpStatus} ${axiosErr.response.statusText}`;
      }

      // Immediately fatal: auth/account problems — no amount of retrying helps
      const isAuthError = httpStatus === 401
        || err.message.toLowerCase().includes('auth_timeout')
        || err.message.toLowerCase().includes('invalid_key')
        || err.message.toLowerCase().includes('invalid api')
        || err.message.toLowerCase().includes('authentication');

      const isQuotaError = err.message.toLowerCase().includes('transcription_quota_exceeded')
        || err.message.toLowerCase().includes('quota');

      if (isAuthError || grpcCode === 'configuration') {
        _consecutiveErrors = 0;
        _lastState = 'failed';
        this.sendSttStatus( {
          state: 'failed',
          provider: sttProvider,
          error: errorMessage,
          channel: speaker,
        } as SttStatusPayload);
        return;
      }

      // Retryable: network drop, timeout, 5xx, 400, 429, WS drop
      _consecutiveErrors++;
      const maxErrors = 5;

      if (_consecutiveErrors >= maxErrors || isQuotaError) {
        _lastState = 'failed';
        this.sendSttStatus( {
          state: 'failed',
          provider: sttProvider,
          error: isQuotaError
            ? errorMessage
            : `STT provider failed (${_consecutiveErrors} consecutive errors): ${errorMessage}`,
          channel: speaker,
          reconnectAttempts: _consecutiveErrors,
        } as SttStatusPayload);
      } else {
        _lastState = 'reconnecting';
        this.sendSttStatus( {
          state: 'reconnecting',
          provider: sttProvider,
          error: errorMessage,
          channel: speaker,
          reconnectAttempts: _consecutiveErrors,
        } as SttStatusPayload);
      }
    });

    // Track successful transcripts — resets consecutive error counter
    // Broadcasts 'connected' whenever we recover from reconnecting/failed
    stt.on('transcript', (segment: { text: string, isFinal: boolean, confidence: number }) => {
      if (this.meetingStt.get(speaker) !== stt || !this.isMeetingActive) return;
      if (segment.isFinal) {
        _consecutiveErrors = 0; // Success — reset counter
        if (_lastState !== 'connected') {
          _lastState = 'connected';
          this.sendSttStatus( {
            state: 'connected',
            provider: sttProvider,
            channel: speaker,
          } as SttStatusPayload);
        }
      }
    });

    // Non-fatal telemetry from providers (e.g. OpenAIStreamingSTT emits this
    // when the pre-session ring buffer evicts leading audio while waiting for
    // the WebSocket handshake). Surface it in the main-process log so the
    // signal isn't silently dropped — the event is informational, not a status
    // change, so we don't push it through the stt-status channel.
    stt.on('warning', (w: { code?: string; message?: string; droppedBytes?: number }) => {
      if (this.meetingStt.get(speaker) !== stt || !this.isMeetingActive) return;
      console.warn(`[Main] STT (${speaker}) warning: ${w?.code ?? 'unknown'}`,
        { provider: sttProvider, message: w?.message, droppedBytes: w?.droppedBytes });
    });

    // B2: Emit 'awaiting-audio' once the STT provider is wired up but before
    // any audio has flowed. Renderers that joined mid-session sync to this
    // unverified state and display "Listening for audio…" until the first
    // isFinal transcript fires the 'connected' transition above.
    this.sendSttStatus({
      state: 'awaiting-audio',
      provider: sttProvider,
      channel: speaker,
    } as SttStatusPayload);

    return stt;
  }

  // Keep baseline health calibration; the pipeline owns PCM, format and recovery.
  private wireSystemCapture(capture: SystemAudioCapture, label: string = ''): () => void {
    const prefix = label ? `[Main] ${label} ` : '[Main] ';
    let chunkCount = 0;
    // Watchdog: if no chunks arrive within 8s of capture start, the most likely
    // causes are (a) Screen Recording permission was revoked between the TCC
    // check and SCK init, (b) the meeting app routes audio to a device the
    // CoreAudio Tap isn't bound to, or (c) the system is genuinely silent.
    // Production-grade apps surface this so the user knows their interviewer's
    // audio isn't being picked up — instead of staring at an empty transcript.
    //
    // B11: timeout extended from 8000 → 12000ms. The ScreenCaptureKit fallback
    // path (macOS <14.4 hosts or where CoreAudio Tap init fails) takes 5-7s
    // to deliver its first audio buffer on a warm system, and ~8-10s on a
    // slower/contended host. The previous 8s timeout had only a 1-3s margin
    // and produced false-positive "0 chunks in 8s" banners during legitimate
    // SCK cold-start.
    const STUCK_WATCHDOG_MS = 12000;
    let stuckTimer: NodeJS.Timeout | null = null;
    const armStuckWatchdog = () => {
      if (stuckTimer) clearTimeout(stuckTimer);
      stuckTimer = setTimeout(() => {
        if (this.systemAudioCapture !== capture) return; // capture was replaced
        if (chunkCount > 0) return;                       // already producing
        if (!this.isMeetingActive) return;                // meeting ended

        // Bluetooth devices like AirPods register with separate identifiers
        // for input (cpal device name) and output (CoreAudio UID with
        // optional :input/:output suffix). When the user has the same
        // physical device on both sides of the pipeline, macOS cannot run a
        // CoreAudio Process Tap on it while it's also the active microphone
        // — the tap initializes "successfully" but every IO callback yields
        // zero frames. Surface the actual cause instead of a generic
        // "route mismatch" hint so the user knows what to change.
        // The same-device-input-output limitation is a CoreAudio Process Tap
        // constraint — only relevant on macOS. detectSameInputOutputDevice
        // is itself macOS-specific; skip the check on other platforms.
        const sameDeviceName = process.platform === 'darwin'
          ? this.detectSameInputOutputDevice()
          : null;
        if (sameDeviceName) {
          const msg = formatPermissionMessage('mac-same-device-input-output', { device: sameDeviceName });
          console.warn(`${prefix}SystemAudioCapture ${msg}`);
          this.sendAudioCaptureFailed( {
            channel: 'system',
            message: msg,
            attempt: 0,
            maxAttempts: 3,
            terminal: false,
            stuck: true,
          });
          return;
        }

        console.warn(`${prefix}SystemAudioCapture produced 0 chunks in ${STUCK_WATCHDOG_MS / 1000}s — likely silent capture (route mismatch or permission revoked).`);
        this.sendAudioCaptureFailed( {
          channel: 'system',
          message: formatPermissionMessage('system-audio-stuck'),
          attempt: 0,
          maxAttempts: 3,
          terminal: false,
          stuck: true,
        });
      }, STUCK_WATCHDOG_MS);
    };

    // TCC zero-fill detector. Apple's CoreAudio Process Tap returns zero-filled
    // buffers (instead of an OSStatus error) when the launched binary's
    // Screen Recording / audio-capture grant doesn't apply — typically after a
    // dev rebuild changes the bundle signature, or when the user revokes the
    // grant mid-session. Symptom: the IO proc fires at the correct cadence and
    // chunks flow normally, but every f32 sample is 0.0. Without a dedicated
    // detector, the no-chunks watchdog above never fires and the user just sees
    // an empty interviewer transcript with no idea why.
    //
    // Strategy: track the absolute peak of every chunk (cheap — 960 i16s per
    // 20ms chunk). After we've seen ZEROFILL_OBSERVATION_MS of nothing but
    // peak==0 chunks, broadcast a TCC-specific banner. Latch off the detector
    // permanently as soon as we see a single non-zero peak so a quiet meeting
    // doesn't trigger the warning later. The latency budget intentionally
    // exceeds the no-chunks watchdog (8s) so the two banners don't race.
    const ZEROFILL_OBSERVATION_MS = 12000;
    let firstChunkAt = 0;
    let zerofillLatched = false;       // true once a non-zero peak has been observed (detector off)
    let zerofillTriggered = false;     // true once we've already broadcast — prevent repeats
    // Synchronous disarm closure returned to the audio pipeline so endMeeting()
    // and abortStaleAudioInit() can cancel the stuck watchdog BEFORE stop()/destroy()
    // — without relying on the on('stop') event firing synchronously. Otherwise a
    // short meeting that produced 0 chunks can fire a false "system-audio-stuck"
    // banner up to 12s after the user already stopped.
    const disarmStuckWatchdog = () => {
      if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
    };
    capture.on('start', armStuckWatchdog);
    capture.on('stop', disarmStuckWatchdog);
    // Inter-chunk gap tracking. Normal cadence is one 20ms chunk every 20ms
    // (so ~50/sec). A gap >2s while the meeting is active and the capture is
    // still wired indicates a transient route change (AirPods plug/unplug,
    // HDMI attach, USB hot-plug). The 8s no-chunks watchdog above catches
    // longer outages; this just logs the in-between case so anyone reading
    // logs can correlate "transcript stuttered" with a route change instead
    // of suspecting STT or network problems. Deliberately not promoted to a
    // UI banner — that would spam during normal device juggling.
    let lastChunkAt = 0;
    capture.on('data', (chunk: Buffer) => {
      if (this.systemAudioCapture !== capture || !this.isMeetingActive) return;
      const now = Date.now();
      if (lastChunkAt > 0) {
        const gap = now - lastChunkAt;
        if (gap > 2000 && gap < 8000) {
          console.warn(`${prefix}SystemAudio chunk gap ${gap}ms — likely transient route change. Resuming.`);
        }
      }
      lastChunkAt = now;
      chunkCount++;
      if (chunkCount === 1 && stuckTimer) {
        clearTimeout(stuckTimer);
        stuckTimer = null;
      }
      if (chunkCount <= 3 || chunkCount % 500 === 0) {
        console.log(`${prefix}SystemAudio->STT: chunk #${chunkCount}, ${chunk.length}B, googleSTT=${this.googleSTT ? 'active' : 'NULL'}`);
      }

      // TCC zero-fill check. macOS-specific: WASAPI loopback on Windows does
      // not produce sustained zero-fill on permission revocation, so the
      // detector has no diagnostic value off Darwin and the suggested fix
      // (System Settings → Screen Recording) doesn't apply.
      if (process.platform === 'darwin' && !zerofillLatched && !zerofillTriggered) {
        if (firstChunkAt === 0) firstChunkAt = Date.now();
        // B10: peak-to-peak (max - min) detection instead of abs-peak. Pre-fix
        // used `Math.abs(sample) > 8` which false-latched on a muted-but-biased
        // mic with sustained DC offset (hardware bias of ±10..±50 is common on
        // certain USB and Bluetooth devices). A latched-true detector is
        // permanently disabled, so the user got NO banner even when audio
        // was actually dead. Peak-to-peak cancels out DC bias by construction:
        // pure DC has range 0; quantization noise has range ~2-4; thermal mic
        // noise has range ~20-100; quiet conversation has range >500. A
        // threshold of 100 reliably detects real (or even noise-floor-live)
        // mic activity while rejecting DC bias from a dead mic.
        let minS = 32767;
        let maxS = -32768;
        const stride = Math.max(2, (chunk.length >> 5) & ~1); // even byte offset
        for (let i = 0; i + 1 < chunk.length; i += stride) {
          const s = chunk.readInt16LE(i);
          if (s < minS) minS = s;
          if (s > maxS) maxS = s;
        }
        const peakToPeak = maxS - minS;
        if (peakToPeak > 100) {
          // Real audio (or live noise floor) observed — disable the detector for the rest of the session.
          zerofillLatched = true;
        } else if (Date.now() - firstChunkAt >= ZEROFILL_OBSERVATION_MS) {
          zerofillTriggered = true;
          console.warn(`${prefix}SystemAudio chunks all zero-filled (peak-to-peak < 100) for ${ZEROFILL_OBSERVATION_MS / 1000}s — TCC denial suspected (Screen Recording grant may not apply to this binary).`);
          this.sendAudioCaptureFailed( {
            channel: 'system',
            message: formatPermissionMessage('mac-screen-recording-revoked-rebuild'),
            attempt: 0,
            maxAttempts: 3,
            terminal: false,
            stuck: true,
          });
        }
      }
    });
    return disarmStuckWatchdog;
  }

  private wireMicCapture(capture: MicrophoneCapture, label: string = ''): () => void {
    const prefix = label ? `[Main] ${label} ` : '[Main] ';
    let chunkCount = 0;
    // Mirror of the system-audio stuck watchdog: if the cpal callback never
    // produces samples within STUCK_WATCHDOG_MS of start (USB mic that
    // disappears on open, exclusive-mode contention with another app,
    // default device returning a handle that's actually muted), surface a
    // clear UI signal instead of letting the user transcript silently die.
    //
    // B11: timeout extended from 8000 → 12000ms to mirror the system-audio
    // watchdog. cpal cold-start on USB hot-replug or Bluetooth HFP transition
    // can take 5-9s on contended hardware.
    const STUCK_WATCHDOG_MS = 12000;
    let stuckTimer: NodeJS.Timeout | null = null;
    const armStuckWatchdog = () => {
      if (stuckTimer) clearTimeout(stuckTimer);
      stuckTimer = setTimeout(() => {
        if (this.microphoneCapture !== capture) return;
        if (chunkCount > 0) return;
        if (!this.isMeetingActive) return;
        console.warn(`${prefix}MicrophoneCapture produced 0 chunks in ${STUCK_WATCHDOG_MS / 1000}s — likely silent capture (device contention, hot-unplug, or muted input).`);
        this.sendAudioCaptureFailed( {
          channel: 'mic',
          message: `No audio detected from your microphone for ${STUCK_WATCHDOG_MS / 1000}s. Check that your input device is unmuted and not in use by another app.`,
          attempt: 0,
          maxAttempts: 3,
          terminal: false,
          stuck: true,
        });
      }, STUCK_WATCHDOG_MS);
    };
    // Mirror wireSystemCapture: return a synchronous disarm closure so the mic
    // stuck watchdog can be cancelled BEFORE stop()/destroy() during teardown.
    const disarmStuckWatchdog = () => {
      if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
    };
    capture.on('start', armStuckWatchdog);
    capture.on('stop', disarmStuckWatchdog);
    // Inter-chunk gap tracking — see wireSystemCapture for rationale.
    let lastChunkAt = 0;
    // Mic TCC / muted-input zero-fill detector. cpal will happily open a mic
    // stream and deliver silent (peak=0) buffers when:
    //   - macOS Microphone permission was revoked between TCC check and start,
    //   - the OS muted the input via the menu bar mic indicator,
    //   - the hardware mic is physically muted (some Jabra/Bose headsets),
    //   - exclusive-mode contention with a meeting app (Zoom/Teams) on Windows.
    // Same shape as the system tap zero-fill: chunks arrive on cadence but every
    // sample is 0. Without this, the user just sees an empty user transcript
    // and assumes the meeting itself is broken.
    const ZEROFILL_OBSERVATION_MS = 12000;
    let firstChunkAt = 0;
    let zerofillLatched = false;
    let zerofillTriggered = false;
    capture.on('data', (chunk: Buffer) => {
      if (this.microphoneCapture !== capture || !this.isMeetingActive) return;
      const now = Date.now();
      if (lastChunkAt > 0) {
        const gap = now - lastChunkAt;
        if (gap > 2000 && gap < 8000) {
          console.warn(`${prefix}Mic chunk gap ${gap}ms — likely transient device change (USB hot-plug, BT reconnect). Resuming.`);
        }
      }
      lastChunkAt = now;
      chunkCount++;
      if (chunkCount === 1 && stuckTimer) {
        clearTimeout(stuckTimer);
        stuckTimer = null;
      }

      if (!zerofillLatched && !zerofillTriggered) {
        if (firstChunkAt === 0) firstChunkAt = now;
        // B10: peak-to-peak detection — see wireSystemCapture for full rationale.
        // Pre-fix `abs(sample) > 8` false-latched on DC bias from muted-but-biased
        // mics (USB/Bluetooth hardware bias of ±10..±50 is common), permanently
        // disabling the detector. Peak-to-peak (max - min) is DC-offset invariant.
        let minS = 32767;
        let maxS = -32768;
        const stride = Math.max(2, (chunk.length >> 5) & ~1);
        for (let i = 0; i + 1 < chunk.length; i += stride) {
          const s = chunk.readInt16LE(i);
          if (s < minS) minS = s;
          if (s > maxS) maxS = s;
        }
        const peakToPeak = maxS - minS;
        if (peakToPeak > 100) {
          zerofillLatched = true;
        } else if (now - firstChunkAt >= ZEROFILL_OBSERVATION_MS) {
          zerofillTriggered = true;
          console.warn(`${prefix}Mic chunks all zero-filled (peak-to-peak < 100) for ${ZEROFILL_OBSERVATION_MS / 1000}s — TCC denial or device-mute suspected.`);
          this.sendAudioCaptureFailed( {
            channel: 'mic',
            message: formatPermissionMessage('mic-zero-fill'),
            attempt: 0,
            maxAttempts: 3,
            terminal: false,
            stuck: true,
          });
        }
      }
    });
    return disarmStuckWatchdog;
  }

  /**
   * PERF: Pre-construct STT provider objects at app launch so the meeting-start
   * critical path doesn't pay for createSTTProvider (which does CredentialsManager
   * lookup + listener wiring + per-provider class init).
   *
   * NOTE: this only constructs the JS objects. Provider sockets are still opened
   * lazily on first .write() / .start() — opening idle sockets at app launch
   * would burn provider quota and is provider-specific behavior we don't want
   * to assume. The actual streaming-WebSocket cold-start is a separate (larger)
   * optimization that should be done per-provider.
   *
   * Existing session providers are reused without opening another connection.
   */
  public prewarmSttProviders(): void {
    if (this.googleSTT && this.googleSTT_User) return;
    try {
      if (!this.googleSTT) {
        console.log('[Main] Pre-warming interviewer STT provider...');
        this.googleSTT = this.createSTTProvider('interviewer');
      }
      if (!this.googleSTT_User) {
        console.log('[Main] Pre-warming user STT provider...');
        this.googleSTT_User = this.createSTTProvider('user');
      }
    } catch (err) {
      // The meeting pipeline retries provider creation on start.
      console.warn('[Main] STT pre-warm failed (will retry on meeting start):', err);
    }
  }


  public async restartCapturesAfterResume(): Promise<void> {
    const session = this.activeAudioSession;
    await this.suspendTask;
    this.audioSuspended = false;
    if (!this.isMeetingActive || this._isQuitting || session !== this.activeAudioSession) return;
    this.meetingAudio.resetRecovery();
    await this.reconfigureAudio(this.meetingAudio._lastRequestedInputDeviceId, this.meetingAudio._lastRequestedOutputDeviceId);
  }

  public suspendAudio(): Promise<void> {
    this.audioSuspended = true;
    this.suspendTask = this.meetingAudio.abortInit().then(() => this.meetingAudio.detachAndDestroy());
    return this.suspendTask;
  }

  public shutdownAudio(): Promise<void> {
    if (this.shutdownTask) return this.shutdownTask;
    this.setQuitting(true);
    this.shutdownTask = (async () => {
      const results = await Promise.allSettled([this.stopAudioTest(), this.endMeeting()]);
      // Quitting does not wait for an unsaved meeting; log only its metadata.
      const unsaved = this.intelligenceManager.getUnsavedMeeting();
      if (unsaved) {
        const { startedAt, durationMs, transcriptCount, reason } = unsaved;
        console.warn('[Main] Quitting with an unsaved meeting; it is lost on exit:', { startedAt, durationMs, transcriptCount, reason });
      }
      try { await this.suspendAudio(); }
      finally { await this.meetingStt.cancel(); }
      if (results.some(result => result.status === 'rejected')) throw new Error('Audio shutdown did not complete cleanly');
    })();
    return this.shutdownTask;
  }

  /**
   * Broadcast which device the main process actually opened, vs what the
   * renderer requested. Renderer subscribes to this so it can show a banner
   * when fallback to default occurred (e.g. saved AirPods name no longer in
   * the cpal list because they're disconnected). Without this signal the UI
   * shows "AirPods selected" but capture is silently using built-in mic.
   */
  private broadcastDeviceSelection(payload: {
    kind: 'input' | 'output';
    requested: string | null;
    actual: string | null;
    fellBack: boolean;
    reason?: string;
  }): void {
    console.log(`[Main] device-selection-applied:`, payload);
    this.sendToSettingsSurfaces('device-selection-applied', payload);
  }

  /**
   * Detect the case where the requested input and output devices are the same
   * physical hardware (typically AirPods on both sides). Input IDs come from
   * cpal (device name), output IDs come from CoreAudio (UID with optional
   * :input/:output suffix), so direct string comparison won't catch the
   * conflict. We resolve the output UID to a friendly name via
   * AudioDevices.getOutputDevices() and compare it to the input name (case-
   * insensitive). Returns the friendly name when a same-device conflict is
   * detected, undefined otherwise.
   */
  private detectSameInputOutputDevice(): string | undefined {
    return this.checkSameInputOutputDevice(this._lastRequestedInputDeviceId, this._lastRequestedOutputDeviceId);
  }

  /**
   * Pure variant of detectSameInputOutputDevice that takes the IDs as args
   * instead of reading from instance state. Used by reconfigureAudio so the
   * conflict check runs against the INCOMING request before instance state
   * is mutated, which would otherwise interact badly with the skip-if-
   * unchanged early-exit.
   */
  private checkSameInputOutputDevice(inputId?: string, outputId?: string): string | undefined {
    if (!inputId || !outputId) return undefined;

    // Strip the macOS CoreAudio :input/:output suffix before any comparison —
    // a single Bluetooth device can appear with both suffixes.
    const stripSuffix = (s: string) => s.replace(/:(input|output)$/i, '');
    const inputBase = stripSuffix(inputId).toLowerCase();
    const outputBase = stripSuffix(outputId).toLowerCase();
    if (inputBase === outputBase) {
      return stripSuffix(inputId);
    }

    // Resolve the output UID to its friendly name and compare to the input
    // name (input IDs from cpal ARE the device name, e.g. "Evin's AirPods Pro").
    try {
      const outputs = AudioDevices.getOutputDevices();
      const outputMatch = outputs.find(d => stripSuffix(d.id).toLowerCase() === outputBase);
      if (outputMatch && outputMatch.name) {
        if (outputMatch.name.toLowerCase() === inputId.toLowerCase()) {
          return outputMatch.name;
        }
      }
    } catch {
      // Native module unavailable — fall through to "no conflict detected".
    }
    return undefined;
  }


  private async reconfigureAudio(inputDeviceId?: string | null, outputDeviceId?: string | null): Promise<void> {
    await this.meetingAudio.reconfigureAudio(inputDeviceId, outputDeviceId);
  }


  public async reconfigureSttProvider(): Promise<void> {
    const session = this.activeAudioSession;
    await this.discardSttProviders();
    if (session !== this.activeAudioSession) return;
    await this.meetingAudio.reconfigureSttProvider();
    const provider = CredentialsManager.getInstance().getSttProvider();
    const configured = provider !== 'none';
    this.broadcast('stt-config-changed', { configured, provider });
  }


  public discardSttProviders(): Promise<void> {
    const revoked = this.meetingStt.stopChannels();
    void revoked.catch(() => console.error('[Main] STT revocation failed'));
    return revoked;
  }


  public stopDefaultOutputWatcherForShutdown(): void {
    this.meetingAudio.stopWatching();
  }
  /** Last input device id passed to reconfigureAudio; used by mic recovery. */
  private get _lastRequestedInputDeviceId() { return this.meetingAudio._lastRequestedInputDeviceId; }


  public async startAudioTest(deviceId?: string): Promise<void> {
    // P2-12: guard against two concurrent calls both passing the async permission check
    // before either has created a capture — the second call would orphan the first capture.
    if (this._audioTestStarting) return;
    // Block audio test while a meeting is live. Both code paths construct
    // their own MicrophoneCapture instance against the same device; on Windows
    // cpal grants exclusive access, so the second open silently degrades, and
    // on macOS the meeting's capture and the test capture compete for the
    // same input handle — symptom: meeting transcript stalls until the test
    // is closed. Reject the request loudly via the IPC error path so the
    // renderer can disable the Test button instead of letting the user think
    // their mic is broken.
    if (this.isMeetingActive) {
      throw new Error('Audio test is unavailable while a meeting is active. End the meeting first, then test your microphone.');
    }
    this._audioTestStarting = true;
    try {
      await this._startAudioTestImpl(deviceId);
    } finally {
      this._audioTestStarting = false;
    }
  }

  // UX4: system-audio probe runs in parallel with the mic test so users can
  // verify their system-audio capture path BEFORE starting a meeting.
  // Without this, the only signals were post-meeting watchdogs (8-12s after
  // meeting start), which is too late for a smooth "verify and proceed"
  // onboarding flow.
  private audioTestSystemCapture: SystemAudioCapture | null = null;
  // UX4 hardening (code-review HIGH): bumped on every startAudioTest call
  // AND every stopAudioTest call. The system-audio probe awaits
  // resolveMacScreenCaptureCapability for ~seconds; if the user closes the
  // Audio tab during that await, stopAudioTest fires but the subsequent
  // `new SystemAudioCapture(); start()` would orphan a capture with no
  // shutdown path. Snapshot this token before the await and bail if it has
  // changed by the time the await resolves.
  private _audioTestEpoch = 0;
  private audioTestRelease: Promise<void> = Promise.resolve();

  private async _startAudioTestImpl(deviceId?: string): Promise<void> {
    console.log(`[Main] Starting Audio Test on device: ${deviceId || 'default'}`);
    const stopping = this.stopAudioTest();
    // UX4 hardening: snapshot epoch BEFORE the system-audio probe's awaited
    // permission probe. If stopAudioTest fires while we're awaiting, the
    // post-await check below catches it and skips system-capture construction.
    const startEpoch = this._audioTestEpoch;
    const isCurrentTest = () => this._audioTestEpoch === startEpoch && !this.isMeetingActive && !this._isQuitting;
    await stopping;
    if (!isCurrentTest()) return;

    if (!(await ensureMacMicrophoneAccess('audio test'))) {
      throw new Error(formatPermissionMessage('mic-denied'));
    }
    if (!isCurrentTest()) return;

    const broadcastTargets = (): BrowserWindow[] =>
      [
        this.settingsWindowHelper.getSettingsWindow(),
        this.getWindowHelper().getLauncherWindow(),
        this.getWindowHelper().getOverlayWindow(),
      ].filter((win): win is BrowserWindow => !!win && !win.isDestroyed());

    const computeRmsLevel = (chunk: Buffer): number => {
      let sum = 0;
      const step = 10;
      const len = chunk.length;
      for (let i = 0; i < len; i += 2 * step) {
        const val = chunk.readInt16LE(i);
        sum += val * val;
      }
      const count = len / (2 * step);
      if (count <= 0) return 0;
      const rms = Math.sqrt(sum / count);
      return Math.min(rms / 10000, 1.0);
    };

    const attachAudioTestListeners = (capture: MicrophoneCapture) => {
      capture.on('data', (chunk: Buffer) => {
        const targets = broadcastTargets();
        if (targets.length === 0) return;
        const level = computeRmsLevel(chunk);
        for (const target of targets) {
          target.webContents.send('audio-test-level', level);
        }
      });

      capture.on('error', (err: Error) => {
        console.error('[Main] AudioTest Error:', err);
      });
    };

    // UX4: parallel system-audio probe. Wired AFTER the mic capture so a
    // missing screen-recording grant doesn't block the mic level meter.
    // Listeners include a TCC zero-fill detector (peak-to-peak < 100 for
    // the entire probe = TCC silently denied even though SCK started).
    const attachSystemTestListeners = (capture: SystemAudioCapture) => {
      capture.on('data', (chunk: Buffer) => {
        const targets = broadcastTargets();
        if (targets.length === 0) return;
        const level = computeRmsLevel(chunk);
        for (const target of targets) {
          target.webContents.send('audio-test-system-level', level);
        }
      });
      capture.on('error', (err: Error) => {
        console.error('[Main] AudioTest System Error:', err);
        for (const target of broadcastTargets()) {
          target.webContents.send('audio-test-system-error', err.message || String(err));
        }
      });
    };

    try {
      this.audioTestCapture = new MicrophoneCapture(deviceId || undefined);
      attachAudioTestListeners(this.audioTestCapture);
      this.audioTestCapture.start();
    } catch (err) {
      console.warn('[Main] Failed to start audio test on preferred device. Falling back to default.', err);
      // RC-02 fix: explicitly stop and null the failed capture before creating
      // the fallback to prevent a brief double-microphone-capture window.
      try { this.audioTestCapture?.stop(); } catch { /* ignore errors on already-failed capture */ }
      this.audioTestCapture = null;
      try {
        this.audioTestCapture = new MicrophoneCapture();
        attachAudioTestListeners(this.audioTestCapture);
        this.audioTestCapture.start();
      } catch (fallbackErr) {
        console.error('[Main] Failed to start audio test:', fallbackErr);
        throw fallbackErr;
      }
    }

    // Independent system-audio probe — failure here does NOT abort the mic
    // test. The renderer renders the system-level bar greyed-out + a
    // permission-denied notice if the screen capture probe couldn't start.
    try {
      const screenCapability = await resolveMacScreenCaptureCapability('audio test');
      // UX4 hardening: bail if a stopAudioTest fired during the await.
      // Constructing+starting a SystemAudioCapture after stop would orphan
      // the capture with no shutdown path.
      if (!isCurrentTest()) {
        console.log('[Main] Audio test was stopped during permission probe — skipping system capture construction.');
        return;
      }
      if (screenCapability.effectiveDenied) {
        for (const target of broadcastTargets()) {
          target.webContents.send(
            'audio-test-system-error',
            screenCapability.message ?? formatPermissionMessage('screen-recording-denied'),
          );
        }
      } else {
        this.audioTestSystemCapture = new SystemAudioCapture();
        attachSystemTestListeners(this.audioTestSystemCapture);
        this.audioTestSystemCapture.start();
        // Final defense: if epoch changed between the start() call setup
        // and now (unlikely but possible if start() is sync-throwing-then-
        // recovering), tear down immediately.
        if (!isCurrentTest()) {
          try { this.audioTestSystemCapture?.stop(); } catch { /* ignore */ }
          this.audioTestSystemCapture = null;
        }
      }
    } catch (sysErr: any) {
      console.warn('[Main] Failed to start system-audio probe:', sysErr);
      for (const target of broadcastTargets()) {
        target.webContents.send(
          'audio-test-system-error',
          sysErr?.message || 'System audio probe failed to start.',
        );
      }
    }
  }


  public stopAudioTest(): Promise<void> {
    this._audioTestEpoch++;
    const captures = [this.audioTestCapture, this.audioTestSystemCapture];
    this.audioTestCapture = null;
    this.audioTestSystemCapture = null;
    this.audioTestRelease = Promise.allSettled([this.audioTestRelease, ...captures.map(async capture => { await capture?.destroy(); })]).then(results => {
      if (results.some(result => result.status === 'rejected')) throw new Error('Audio test capture release failed');
    });
    void this.audioTestRelease.catch(() => {});
    return this.audioTestRelease;
  }

  /** Starts collecting both channels for one manual action; providers' tasks keep running. */
  public collectSpeech(options: CollectOptions): SpeechCollector {
    return this.meetingStt.collect(options);
  }

  public markDictation(at: number): DictationMark {
    return this.meetingStt.markDictation(at);
  }


  public async startMeeting(metadata?: any): Promise<void> {
    return this.meetingLifecycle.start(async () => {
      // Before any STT, permission, audio or window step: a meeting whose save failed
      // must be saved or discarded first (PLAN §8, failed meeting save).
      if (this.intelligenceManager.getUnsavedMeeting()) {
        throw Object.assign(new Error('Save or discard the unsaved meeting before starting a new one.'), { code: 'pending-unsaved-meeting' });
      }
      if (this._isQuitting) throw new Error('Application is quitting');
      CredentialsManager.getInstance().requireSttConfigured();
      await this.meetingAudio.waitForRelease();
      if (!(await ensureMacMicrophoneAccess('meeting start'))) throw new Error(formatPermissionMessage('mic-denied'));
      if (this._isQuitting) throw new Error('Application is quitting');
      await this.stopAudioTest();
      this.windowHelper.resetOverlayPosition();
      this.windowHelper.setWindowMode('overlay');
      this.intelligenceManager.reset();
      if (metadata) this.intelligenceManager.setMeetingMetadata(metadata);
      this.activeAudioSession = crypto.randomUUID();
      this.meetingStt.begin(this.activeAudioSession);
      this.isMeetingActive = true;
      this.broadcastMeetingState();
      this.sendToMeetingSurfaces('session-reset');
      this.meetingAudio.begin({ audio: metadata?.audio });
    });
  }


  public async endMeeting(): Promise<void> {
    this.processingHelper.cancelOngoingRequests();
    this.intelligenceManager.resetEngine();
    return this.meetingLifecycle.stop(async () => {
      if (this.overlayMousePassthrough) this.setOverlayMousePassthrough(false);
      this.windowHelper.setWindowMode('launcher');
      this.isMeetingActive = false;
      this._isDraining = true;
      this.broadcastMeetingState();
      let captureError: unknown;
      try {
        await this.meetingAudio.abortInit();
        try { await this.meetingAudio.detachAndDestroy(); }
        catch (error) { captureError = error; }
        if (this.activeAudioSession === null) {
          await this.meetingStt.cancel();
          if (captureError) throw captureError;
          return;
        }
        const result = await this.meetingStt.drain(5000);
        if (result.timedOut || result.failedChannels.length) {
          this.sendAudioCaptureFailed({ channel: 'audio', message: 'Transcription tail could not be completely drained', terminal: true });
        }
        await this.intelligenceManager.stopMeeting();
        try {
          let defaultModel = CredentialsManager.getInstance().getDefaultModel();
          console.log('[Main] Reverting model to default');
          this.processingHelper.getLLMHelper().setModel(defaultModel);
          defaultModel = this.processingHelper.getLLMHelper().getCurrentModelSelection();
          this.sendModelChanged(defaultModel);
        } catch (error) { console.error('[Main] Failed to revert model:', error); }
        if (captureError) throw captureError;
      } finally {
        this.activeAudioSession = null;
        this._isDraining = false;
        this.transcriptDisplay.clear();
      }
    });
  }

  private setupIntelligenceEvents(): void {
    const mainWindow = this.getMainWindow.bind(this)
    const owners = new Map<string, Electron.WebContents>();
    const currentByOwner = new Map<number, string>();
    const send = (channel: string, data: any, metadata?: import('../src/types/generationMetadata').GenerationMetadata) => {
      const owner = metadata ? owners.get(metadata.requestId) : mainWindow()?.webContents;
      if (!owner || owner.isDestroyed() || (metadata && currentByOwner.get(owner.id) !== metadata.requestId)) return;
      owner.send(channel, { ...data, ...metadata });
    };
    this.intelligenceManager.on('generation_started', (metadata, owner?: Electron.WebContents) => {
      owner ??= mainWindow()?.webContents;
      if (!owner || owner.isDestroyed()) return;
      const previous = currentByOwner.get(owner.id);
      if (previous) owners.delete(previous);
      owners.set(metadata.requestId, owner);
      currentByOwner.set(owner.id, metadata.requestId);
      send('intelligence-generation-started', {}, metadata);
    });

    // Sprint 9: time-batched IPC token sends.
    //
    // Each LLM streaming token previously fired one webContents.send → one
    // structured-clone serialization → one IPC message. For a 400-token
    // answer at 100 tok/s that's 400 IPC messages over 4 seconds. With
    // Groq at 200+ tok/s the rate gets uncomfortable.
    //
    // Coalesce per-tick: a token arriving in the current libuv iteration
    // adds to a per-kind buffer. The first add schedules a setImmediate
    // flush that drains all buffers in one webContents.send per kind
    // (carrying an items array). Net: ~3-5× fewer IPC messages on hot
    // streams with no perceptible latency cost (sub-frame).
    //
    // The old per-token channels (intelligence-suggested-answer-token, etc.)
    // are NO LONGER USED for these 5 streams. The single
    // 'intelligence-token-batch' channel replaces them. The old channel
    // names + preload bridges are kept (defense-in-depth, no callers).
    type BatchKind = 'suggested_answer' | 'refined_answer' | 'recap' | 'clarify' | 'follow_up_questions';
    const tokenBatches = new Map<string, { kind: BatchKind; items: any[]; metadata: any }>();
    let batchFlushScheduled = false;
    let pendingFlushHandle: NodeJS.Immediate | null = null;
    const flushBatchesNow = () => {
      // A synchronous flush (before a final answer) cancels the queued one, so
      // nothing queued earlier can arrive after the final answer.
      if (pendingFlushHandle) {
        clearImmediate(pendingFlushHandle);
        pendingFlushHandle = null;
      }
      batchFlushScheduled = false;
      for (const { kind, items, metadata } of tokenBatches.values()) {
        if (items.length > 0) {
          send('intelligence-token-batch', { kind, items }, metadata);
        }
      }
      tokenBatches.clear();
    };
    const scheduleBatchFlush = () => {
      if (batchFlushScheduled) return;
      batchFlushScheduled = true;
      pendingFlushHandle = setImmediate(() => {
        pendingFlushHandle = null;
        flushBatchesNow();
      });
    };
    const queueBatch = (kind: BatchKind, item: any, metadata: any) => {
      if (!metadata?.requestId) return;
      const key = `${metadata.requestId}:${kind}`;
      let batch = tokenBatches.get(key);
      if (!batch) { batch = { kind, items: [], metadata }; tokenBatches.set(key, batch); }
      batch.items.push({ ...item, ...metadata });
      scheduleBatchFlush();
    };
    // ORDER: every final-answer handler must call this BEFORE its own send so
    // the renderer sees (..., last tokens, final answer) and not (..., final
    // answer, trailing tokens) — the latter would clobber the just-finalized
    // row with appended text from a pending setImmediate batch.
    const flushBatchesBeforeFinal = flushBatchesNow;

    // Forward intelligence events to renderer
    this.intelligenceManager.on('assist_update', (insight: string, metadata) => {
      send('intelligence-assist-update', { insight }, metadata);
    })

    this.intelligenceManager.on('suggested_answer', (answer: string, question: string, confidence: number, metadata) => {
      flushBatchesBeforeFinal();
      send('intelligence-suggested-answer', { answer, question, confidence }, metadata);

    })

    this.intelligenceManager.on('suggested_answer_token', (token: string, question: string, confidence: number, metadata) => {
      // Sprint 9: batch instead of per-token webContents.send.
      queueBatch('suggested_answer', { token, question, confidence }, metadata);
    })

    this.intelligenceManager.on('refined_answer_token', (token: string, intent: string, metadata) => {
      // Sprint 9: batch.
      queueBatch('refined_answer', { token, intent }, metadata);
    })

    this.intelligenceManager.on('refined_answer', (answer: string, intent: string, metadata) => {
      flushBatchesBeforeFinal();
      send('intelligence-refined-answer', { answer, intent }, metadata);

    })

    this.intelligenceManager.on('recap', (summary: string, metadata) => {
      flushBatchesBeforeFinal();
      send('intelligence-recap', { summary }, metadata);
    })

    this.intelligenceManager.on('recap_token', (token: string, metadata) => {
      // Sprint 9: batch.
      queueBatch('recap', { token }, metadata);
    })

    this.intelligenceManager.on('clarify', (clarification: string, metadata) => {
      flushBatchesBeforeFinal();
      send('intelligence-clarify', { clarification }, metadata);
    })

    this.intelligenceManager.on('clarify_token', (token: string, metadata) => {
      // Sprint 9: batch.
      queueBatch('clarify', { token }, metadata);
    })

    this.intelligenceManager.on('follow_up_questions_update', (questions: string, metadata) => {
      flushBatchesBeforeFinal();
      send('intelligence-follow-up-questions-update', { questions }, metadata);
    })

    this.intelligenceManager.on('follow_up_questions_token', (token: string, metadata) => {
      // Sprint 9: batch.
      queueBatch('follow_up_questions', { token }, metadata);
    })

    this.intelligenceManager.on('manual_answer_started', (metadata) => {
      send('intelligence-manual-started', {}, metadata);
    })

    this.intelligenceManager.on('manual_answer_result', (answer: string, question: string, metadata) => {
      send('intelligence-manual-result', { answer, question }, metadata);

    })

    this.intelligenceManager.on('mode_changed', (mode: string, metadata) => {
      send('intelligence-mode-changed', { mode }, metadata);
    })

    this.intelligenceManager.on('error', (error: Error, mode: string, metadata) => {
      console.error(`[IntelligenceManager] Error in ${mode}:`, error)
      send('intelligence-error', { error: error.message, mode }, metadata);
    })
    this.intelligenceManager.on('generation_terminal', (metadata) => {
      if (metadata.status === 'cancelled') {
        for (const [key, batch] of tokenBatches) {
          if (batch.metadata.requestId === metadata.requestId) tokenBatches.delete(key);
        }
      }
      flushBatchesBeforeFinal();
      send('intelligence-generation-terminal', {}, metadata);
      owners.delete(metadata.requestId);
    });
  }





  public setRecognitionLanguage(key: string): CredentialSaveResult {
    const { CredentialsManager } = require('./services/CredentialsManager');
    const result = CredentialsManager.getInstance().setSttLanguage(key);
    if (!result.ok) return result;

    // 'auto' needs server-side language detection, which no remaining provider offers.
    const effectiveKey = key === 'auto' ? 'english-us' : key;

    try {
      this.googleSTT?.setRecognitionLanguage(effectiveKey);
      this.googleSTT_User?.setRecognitionLanguage(effectiveKey);
      this.processingHelper.getLLMHelper().setSttLanguage(effectiveKey);
      return result;
    } catch {
      return { ok: true, warning: 'Saved, but the running service could not apply the language. Restart the application to use the saved configuration.' };
    }
  }

  public static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState()
    }
    return AppState.instance
  }

  // Getters and Setters
  public getMainWindow(): BrowserWindow | null {
    return this.windowHelper.getMainWindow()
  }

  public getWindowHelper(): WindowHelper {
    return this.windowHelper
  }

  public getIntelligenceManager(): IntelligenceManager {
    return this.intelligenceManager
  }

  public getThemeManager(): ThemeManager {
    return this.themeManager
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
    this.screenshotHelper.setView(view)
  }

  public isVisible(): boolean {
    return this.windowHelper.isVisible()
  }

  public getScreenshotHelper(): ScreenshotHelper {
    return this.screenshotHelper
  }

  public getProblemInfo(): any {
    return this.problemInfo
  }

  public setProblemInfo(problemInfo: any): void {
    this.problemInfo = problemInfo
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotHelper.getScreenshotQueue()
  }

  public getExtraScreenshotQueue(): string[] {
    return this.screenshotHelper.getExtraScreenshotQueue()
  }

  // Window management methods
  public createWindow(): void {
    this.windowHelper.createWindow()
  }

  public hideMainWindow(): void {
    this.windowHelper.hideMainWindow()
  }

  public showMainWindow(inactive?: boolean): void {
    if (this.windowHelper) {
      this.windowHelper.showMainWindow(inactive)
    }
  }

  public toggleMainWindow(): void {
    console.log(
      "Screenshots: ",
      this.screenshotHelper.getScreenshotQueue().length,
      "Extra screenshots: ",
      this.screenshotHelper.getExtraScreenshotQueue().length
    )

    const mode = this.windowHelper.getCurrentWindowMode();

    if (mode === 'launcher') {
      // In launcher mode, just physically hide/show the window
      this.windowHelper.toggleMainWindow();
    } else {
      // In overlay mode, send toggle-expand IPC to expand/collapse the UI
      const targetWindow = this.windowHelper.getOverlayWindow();
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('toggle-expand');
      }
    }
  }

  public setWindowDimensions(width: number, height: number): void {
    this.windowHelper.setWindowDimensions(width, height)
  }

  public clearQueues(): void {
    this.screenshotHelper.clearQueues()

    // Clear problem info
    this.problemInfo = null

    // Reset view to initial state
    this.setView("queue")
  }

  private createScreenshotCaptureSession(
    captureKind: ScreenshotCaptureKind,
    restoreFocus: boolean
  ): ScreenshotCaptureSession {
    const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
    const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();

    return {
      captureKind,
      wasMainWindowVisible: this.windowHelper.isVisible(),
      windowMode: this.windowHelper.getCurrentWindowMode(),
      wasSettingsVisible: !!settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible(),
      wasModelSelectorVisible: !!modelSelectorWindow && !modelSelectorWindow.isDestroyed() && modelSelectorWindow.isVisible(),
      overlayBounds: this.windowHelper.getLastOverlayBounds(),
      overlayDisplayId: this.windowHelper.getLastOverlayDisplayId(),
      restoreWithoutFocus: process.platform === 'darwin' || !restoreFocus
    };
  }

  private getDisplayById(displayId: number | null): Electron.Display | undefined {
    if (displayId === null) return undefined;
    return screen.getAllDisplays().find(display => display.id === displayId);
  }

  private getTargetDisplayForFullScreenshot(session: ScreenshotCaptureSession): Electron.Display {
    if (session.windowMode === 'overlay' && session.overlayBounds) {
      return screen.getDisplayMatching(session.overlayBounds);
    }

    const lastOverlayDisplay = this.getDisplayById(session.overlayDisplayId);
    if (lastOverlayDisplay) {
      return lastOverlayDisplay;
    }

    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  private hideWindowsForScreenshot(session: ScreenshotCaptureSession): void {
    if (session.wasModelSelectorVisible) {
      this.modelSelectorWindowHelper.hideWindow();
    }

    if (session.wasSettingsVisible) {
      this.settingsWindowHelper.closeWindow();
    }

    if (session.wasMainWindowVisible) {
      this.hideMainWindow();
    }
  }

  private restoreWindowsAfterScreenshot(session: ScreenshotCaptureSession): void {
    const activate = !session.restoreWithoutFocus;
    const shouldRestoreMainWindow = session.wasMainWindowVisible;

    if (shouldRestoreMainWindow) {
      if (session.windowMode === 'overlay') {
        this.windowHelper.switchToOverlay(!activate);
      } else {
        this.windowHelper.switchToLauncher(!activate);
      }
    }

    if (session.wasSettingsVisible) {
      const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        const { x, y } = settingsWindow.getBounds();
        this.settingsWindowHelper.showWindow(x, y, { activate });
      }
    }

    if (session.wasModelSelectorVisible) {
      const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();
      if (modelSelectorWindow && !modelSelectorWindow.isDestroyed()) {
        const { x, y } = modelSelectorWindow.getBounds();
        this.modelSelectorWindowHelper.showWindow(x, y, { activate });
      }
    }
  }

  private async withScreenshotCaptureSession<T>(
    captureKind: ScreenshotCaptureKind,
    restoreFocus: boolean,
    capture: (session: ScreenshotCaptureSession) => Promise<T>
  ): Promise<T> {
    if (!this.getMainWindow()) {
      throw new Error("No main window available");
    }

    if (this.screenshotCaptureInProgress) {
      throw new Error("Screenshot capture already in progress");
    }

    const session = this.createScreenshotCaptureSession(captureKind, restoreFocus);
    this.screenshotCaptureInProgress = true;

    try {
      this.hideWindowsForScreenshot(session);
      // setOpacity(0) makes the window invisible to the compositor immediately
      // (within the current frame). hide() removes it from the event dispatch
      // tree synchronously. One compositor frame flush (~16ms) is enough for
      // macOS to stop including the window in the next capture frame. We wait
      // 80ms to give the GPU render server one full v-sync cycle + overhead,
      // which consistently avoids the black-frame artifact without the
      // excessive 150ms latency the old value imposed.
      await new Promise(resolve => setTimeout(resolve, process.platform === 'darwin' ? 80 : 40));
      return await capture(session);
    } finally {
      try {
        this.restoreWindowsAfterScreenshot(session);
      } finally {
        this.screenshotCaptureInProgress = false;
      }
    }
  }

  // Screenshot management methods
  public async takeScreenshot(restoreFocus: boolean = true): Promise<string> {
    return this.withScreenshotCaptureSession('full', restoreFocus, (session) =>
      this.screenshotHelper.takeScreenshot(this.getTargetDisplayForFullScreenshot(session))
    )
  }

  public async takeSelectiveScreenshot(restoreFocus: boolean = true): Promise<string> {
    return this.withScreenshotCaptureSession('selective', restoreFocus, async () => {
      let captureArea: Electron.Rectangle | undefined;

      if (process.platform === 'win32' || process.platform === 'darwin') {
        captureArea = await this.cropperWindowHelper.showCropper();

        if (!captureArea) {
          throw new Error("Selection cancelled");
        }
      }

      return this.screenshotHelper.takeSelectiveScreenshot(captureArea)
    })
  }

  public async getImagePreview(filepath: string): Promise<string> {
    return this.screenshotHelper.getImagePreview(filepath)
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.screenshotHelper.deleteScreenshot(path)
  }

  // New methods to move the window
  public moveWindowLeft(): void {
    this.windowHelper.moveWindowLeft()
  }

  public moveWindowRight(): void {
    this.windowHelper.moveWindowRight()
  }
  public moveWindowDown(): void {
    this.windowHelper.moveWindowDown()
  }
  public moveWindowUp(): void {
    this.windowHelper.moveWindowUp()
  }

  public centerAndShowWindow(): void {
    this.windowHelper.centerAndShowWindow()
  }

  public createTray(): void {
    this.showTray();
  }

  public showTray(): void {
    if (this.tray) return;

    const resourcesPath = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const iconToUse = path.join(resourcesPath, 'assets', process.platform === 'darwin' ? 'iconTemplate.png' : 'icons/png/icon_16x16.png');
    // createFromPath keeps the generated 16pt image and its 32px @2x companion.
    const trayIcon = nativeImage.createFromPath(iconToUse);
    trayIcon.setTemplateImage(process.platform === 'darwin');

    this.tray = new Tray(trayIcon)
    this.tray.setToolTip(APP_IDENTITY.name)
    this.updateTrayMenu();

    // Double-click to show window
    this.tray.on('double-click', () => {
      this.centerAndShowWindow()
    })
  }

  public updateTrayMenu() {
    if (!this.tray) return;

    const keybindManager = KeybindManager.getInstance();
    const screenshotAccel = keybindManager.getKeybind('general:take-screenshot') || 'CommandOrControl+H';

    console.log('[Main] updateTrayMenu called. Screenshot Accelerator:', screenshotAccel);

    // Update tooltip for verification
    this.tray.setToolTip(APP_IDENTITY.name);

    // Helper to format accelerator for display (e.g. CommandOrControl+H -> Cmd+H)
    const formatAccel = (accel: string) => {
      return accel
        .replace('CommandOrControl', 'Cmd')
        .replace('Command', 'Cmd')
        .replace('Control', 'Ctrl')
        .replace('OrControl', '') // Cleanup just in case
        .replace(/\+/g, '+');
    };

    const displayScreenshot = formatAccel(screenshotAccel);
    // We can also get the toggle visibility shortcut if desired
    const toggleKb = keybindManager.getKeybind('general:toggle-visibility');
    const toggleAccel = toggleKb || 'CommandOrControl+B';
    const displayToggle = formatAccel(toggleAccel);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: mainText('Show {name}', { name: APP_IDENTITY.name }),
        click: () => {
          this.centerAndShowWindow()
        }
      },
      {
        label: mainText('Toggle Window ({shortcut})', { shortcut: displayToggle }),
        click: () => {
          this.toggleMainWindow()
        }
      },
      {
        type: 'separator'
      },
      {
        label: mainText('Take Screenshot ({shortcut})', { shortcut: displayScreenshot }),
        accelerator: screenshotAccel,
        click: async () => {
          try {
            const screenshotPath = await this.takeScreenshot()
            const preview = await this.getImagePreview(screenshotPath)
            const mainWindow = this.getMainWindow()
            if (mainWindow) {
              mainWindow.webContents.send("screenshot-taken", {
                path: screenshotPath,
                preview
              })
            }
          } catch (error) {
            console.error("Error taking screenshot from tray:", error)
          }
        }
      },
      {
        type: 'separator'
      },
      {
        label: mainText('Quit'),
        accelerator: 'Command+Q',
        click: () => {
          app.quit()
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }

  public hideTray(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  public refreshLocalizedMenus(): void {
    this.updateTrayMenu();
    KeybindManager.getInstance().updateMenu();
  }

  public setHasDebugged(value: boolean): void {
    this.hasDebugged = value
  }

  public getHasDebugged(): boolean {
    return this.hasDebugged
  }

  private windowPreferenceResult(kind: WindowPreferenceKind, code?: WindowPreferenceResult['code']): WindowPreferenceResult {
    const value = kind === 'protection' ? this.isUndetectable : kind === 'passthrough' ? this.overlayMousePassthrough : this.disguiseMode;
    const error = code === 'save_failed' ? 'The window preference could not be saved.' : code === 'apply_failed' ? 'The window preference could not be fully applied. Retry the setting.' : code === 'invalid_value' ? 'Invalid window preference.' : undefined;
    return { success: !code, kind, value, revision: this._windowPreferenceRevision[kind], ...(code ? { code } : {}), ...(error ? { error } : {}) };
  }

  private publishWindowPreference(result: WindowPreferenceResult): WindowPreferenceResult {
    this._windowPreferenceResults[result.kind] = result;
    this._broadcastToAllWindows('window-preferences:result', result);
    const channel = result.kind === 'protection' ? 'undetectable-changed' : result.kind === 'passthrough' ? 'overlay-mouse-passthrough-changed' : 'disguise-changed';
    this._broadcastToAllWindows(channel, result.value);
    return result;
  }

  public getWindowPreferences(): WindowPreferenceResult[] {
    return (['protection', 'passthrough', 'disguise'] as const).map(kind => this._windowPreferenceResults[kind] ?? this.windowPreferenceResult(kind));
  }

  private _protectionFailureCount = 0;
  public reportProtectionFailure(): void {
    this._protectionFailureCount = (this._protectionFailureCount ?? 0) + 1;
    this._protectionApplyFailed = true;
    this.publishWindowPreference(this.windowPreferenceResult('protection', 'apply_failed'));
  }

  public async setUndetectable(state: boolean): Promise<WindowPreferenceResult> {
    if (typeof state !== 'boolean') return this.windowPreferenceResult('protection', 'invalid_value');
    const changed = this.isUndetectable !== state;
    if (changed) {
      try { SettingsManager.getInstance().saveWindowPreference('isUndetectable', state); }
      catch { return this.publishWindowPreference(this.windowPreferenceResult('protection', 'save_failed')); }
    }
    const revision = ++this._windowPreferenceRevision.protection;
    this.isUndetectable = state;
    if (!changed && !this._protectionApplyFailed) return this.publishWindowPreference(this.windowPreferenceResult('protection'));
    this._protectionApplyFailed = true;
    this.publishWindowPreference({ ...this.windowPreferenceResult('protection'), success: false, pending: true });
    let failed = false;
    for (const helper of [this.windowHelper, this.settingsWindowHelper, this.modelSelectorWindowHelper, this.cropperWindowHelper]) {
      try { helper.setContentProtection(state); } catch { failed = true; }
    }
    const failureCount = this._protectionFailureCount;
    if (process.platform === 'win32') {
      try {
        this.windowHelper.syncOverlayInteractionPolicy();
        this.settingsWindowHelper.syncActivationPolicy();
        this.modelSelectorWindowHelper.syncActivationPolicy();
      } catch { failed = true; }
    }
    if (state) {
      for (const timer of this._disguiseTimers) clearTimeout(timer);
      this._disguiseTimers = [];
    }
    this._broadcastToAllWindows('undetectable-changed', state);
    if (process.platform === 'darwin') {
      // Debounce without abandoning the earlier caller's Promise.
      await new Promise<void>(resolve => setTimeout(resolve, 150));
      if (revision !== this._windowPreferenceRevision.protection) return this.windowPreferenceResult('protection', 'superseded');
      const dockTask = this._dockApplyTask.catch(() => {}).then(async () => {
        if (revision !== this._windowPreferenceRevision.protection) return;
        const settings = this.settingsWindowHelper.getSettingsWindow();
        const target = settings && !settings.isDestroyed() && settings.isVisible() ? settings : this.windowHelper.getMainWindow();
        const wasFocused = target && !target.isDestroyed() && target.isFocused();
        if (target === settings) {
          if (this._settingsBlurRestoreTimer) clearTimeout(this._settingsBlurRestoreTimer);
          this.settingsWindowHelper.setIgnoreBlur(true);
        }
        try {
          if (state) {
            app.dock.hide(); this.hideTray();
            if (wasFocused && target && !target.isDestroyed()) target.focus();
          } else {
            this._applyDisguise(this.disguiseMode);
            await app.dock.show();
            if (revision === this._windowPreferenceRevision.protection) this.showTray();
          }
        } catch { failed = true; }
        finally {
          if (target === settings) this._settingsBlurRestoreTimer = setTimeout(() => {
            this._settingsBlurRestoreTimer = null;
            this.settingsWindowHelper.setIgnoreBlur(false);
          }, 500);
        }
      });
      this._dockApplyTask = dockTask;
      await dockTask;
    }
    if (revision !== this._windowPreferenceRevision.protection) return this.windowPreferenceResult('protection', 'superseded');
    failed ||= failureCount !== this._protectionFailureCount;
    this._protectionApplyFailed = failed;
    if (failed && state) {
      for (const win of this.preferenceWindows()) {
        try { if (win && !win.isDestroyed()) win.hide(); } catch { /* The apply failure remains visible in the result. */ }
      }
    }
    return this.publishWindowPreference(this.windowPreferenceResult('protection', failed ? 'apply_failed' : undefined));
  }

  public getUndetectable(): boolean {
    return this.isUndetectable
  }

  // --- Mouse Passthrough (Adapted from public PR #113) ---
  private overlayMousePassthrough: boolean = false;
  private _passthroughApplyFailed = false;

  public setOverlayMousePassthrough(state: boolean): WindowPreferenceResult {
    if (typeof state !== 'boolean') return this.windowPreferenceResult('passthrough', 'invalid_value');
    const decision = decideToggle(this.overlayMousePassthrough, state);

    // RC-2 fix (see setUndetectable): always reconcile the renderer with the
    // authoritative state, even on a no-op, so the UI can never stay desynced.
    if (!decision.changed && !this._passthroughApplyFailed) {
      this._broadcastToAllWindows('overlay-mouse-passthrough-changed', this.overlayMousePassthrough);
      return this.publishWindowPreference(this.windowPreferenceResult('passthrough'));
    }

    console.log(`[Overlay] setOverlayMousePassthrough(${state}) called`);

    const previous = this.overlayMousePassthrough;
    ++this._windowPreferenceRevision.passthrough;
    this.overlayMousePassthrough = state;
    try { this.windowHelper.syncOverlayInteractionPolicy(); }
    catch {
      this.overlayMousePassthrough = previous;
      this._passthroughApplyFailed = false;
      try { this.windowHelper.syncOverlayInteractionPolicy(); } catch {
        this._passthroughApplyFailed = true;
        const result = this.windowPreferenceResult('passthrough', 'apply_failed');
        result.error = 'Mouse passthrough could not be applied or restored. Retry the setting.';
        return this.publishWindowPreference(result);
      }
      return this.publishWindowPreference(this.windowPreferenceResult('passthrough', 'apply_failed'));
    }
    this._passthroughApplyFailed = false;

    // Immediately revalidate global shortcuts after the window interaction-policy
    // changes.  The OS can silently drop Carbon/IOKit hotkey registrations when
    // window focusability or visibility changes; revalidating surgically
    // re-registers any that were lost without clobbering the others.
    KeybindManager.getInstance().revalidateShortcuts();

    return this.publishWindowPreference(this.windowPreferenceResult('passthrough'));
  }

  public toggleOverlayMousePassthrough(): boolean {
    const next = !this.overlayMousePassthrough;
    this.setOverlayMousePassthrough(next);
    return this.overlayMousePassthrough;
  }

  public getOverlayMousePassthrough(): boolean {
    return this.overlayMousePassthrough;
  }

  public getVerboseLogging(): boolean {
    return this._verboseLogging;
  }

  public setVerboseLogging(enabled: boolean): void {
    this._verboseLogging = enabled;
    setVerboseLoggingFlag(enabled);
    SettingsManager.getInstance().set('verboseLogging', enabled);
    console.log(`[AppState] verboseLogging set to ${enabled}`);
    // Notify all renderer windows so they can start/stop forwarding their console output
    this.broadcast('verbose-logging-changed', enabled);
  }

  public setDisguise(mode: 'terminal' | 'settings' | 'activity' | 'none'): WindowPreferenceResult {
    if (!isDisguiseMode(mode)) return this.windowPreferenceResult('disguise', 'invalid_value');
    try { SettingsManager.getInstance().saveWindowPreference('disguiseMode', mode); }
    catch { return this.publishWindowPreference(this.windowPreferenceResult('disguise', 'save_failed')); }
    this.disguiseMode = mode;
    ++this._windowPreferenceRevision.disguise;

    // Apply the disguise regardless of undetectable state
    // (disguise affects Activity Monitor name via process.title,
    //  dock icon only updates when NOT in stealth)
    try { this._applyDisguise(mode); }
    catch { return this.publishWindowPreference(this.windowPreferenceResult('disguise', 'apply_failed')); }
    return this.publishWindowPreference(this.windowPreferenceResult('disguise'));
  }

  public applyInitialDisguise(): void {
    try { this._applyDisguise(this.disguiseMode); }
    catch { this.publishWindowPreference(this.windowPreferenceResult('disguise', 'apply_failed')); }
  }

  public getDisguiseName(): string {
    const windows = process.platform === 'win32';
    return this.disguiseMode === 'terminal' ? (windows ? 'Command Prompt' : 'Terminal') : this.disguiseMode === 'settings' ? (windows ? 'Settings' : 'System Settings') : this.disguiseMode === 'activity' ? (windows ? 'Task Manager' : 'Activity Monitor') : APP_IDENTITY.name;
  }

  public getDisguiseIconPath(): string {
    const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
    if (this.disguiseMode !== 'none') return path.join(base, 'assets/fakeicon', process.platform === 'win32' ? 'win' : 'mac', `${this.disguiseMode}.png`);
    // nativeImage cannot decode ICNS; keep ICNS for bundle metadata, PNG for runtime.
    return path.join(base, process.platform === 'win32' ? 'assets/icons/win/icon.ico' : 'assets/icon.png');
  }

  private _applyDisguise(mode: 'terminal' | 'settings' | 'activity' | 'none'): void {
    for (const timer of this._disguiseTimers) clearTimeout(timer);
    this._disguiseTimers = [];
    const appName = this.getDisguiseName() + (mode === 'none' ? '' : ' ');
    const iconPath = this.getDisguiseIconPath();

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    console.log(`[AppState] Applying disguise: ${mode} (${appName}) on ${process.platform}`);

    // 1. Update process title (affects Activity Monitor / Task Manager)
    process.title = appName;

    // 2. Update app name (affects macOS Menu / Dock)
    // Skip when undetectable — app.setName() causes macOS to re-register
    // the app and re-show the dock icon even after dock.hide()
    if (!this.isUndetectable) {
      app.setName(appName);
    }

    if (isMac) {
      process.env.CFBundleName = appName.trim();
    }

    // 3. Update App User Model ID (Windows Taskbar grouping)
    if (isWin) {
      // Use unique AUMID per disguise to avoid grouping with the real app
      app.setAppUserModelId(mode === 'none' ? APP_IDENTITY.appId : `${APP_IDENTITY.appId}.${mode}`);
    }

    // 4. Update Icons
    let identityFailed = false;
    if (fs.existsSync(iconPath)) {
      try {
        const image = nativeImage.createFromPath(iconPath);
        if (image.isEmpty?.()) throw new Error('Window identity icon is unavailable.');
        if (isMac) {
          // Skip dock icon update when dock is hidden to avoid potential flicker
          if (!this.isUndetectable) app.dock.setIcon(image);
        } else {
          // Windows/Linux: Update all window icons.
          for (const win of this.preferenceWindows()) if (win && !win.isDestroyed()) {
            try { win.setIcon(image); } catch { identityFailed = true; }
          }
        }
      } catch { identityFailed = true; }
    } else {
      console.warn(`[AppState] Disguise icon not found: ${iconPath}`);
      identityFailed = true;
    }

    // 5. Update Window Titles
    for (const win of this.preferenceWindows()) {
      if (win && !win.isDestroyed()) {
        try { win.setTitle(appName.trim()); } catch { identityFailed = true; }
      }
    }
    if (identityFailed) throw new Error('Window identity could not be fully applied.');

    // Periodically re-assert process.title only — it can drift on some systems.
    // NOTE: We intentionally do NOT call app.setName() here — it was already called
    // synchronously above, and repeated calls on macOS cause the system to briefly
    // show a second dock tile while re-registering the app identity.
    const scheduleUpdate = (ms: number) => {
      const ts = setTimeout(() => {
        process.title = appName;
        this._disguiseTimers = this._disguiseTimers.filter(t => t !== ts);
      }, ms);
      this._disguiseTimers.push(ts);
    };

    scheduleUpdate(200);
    scheduleUpdate(1000);
    scheduleUpdate(5000);
  }

  private preferenceWindows(): (BrowserWindow | null)[] {
    return [
      this.windowHelper.getLauncherWindow(),
      this.windowHelper.getOverlayWindow(),
      this.settingsWindowHelper.getSettingsWindow(),
      this.modelSelectorWindowHelper.getWindow(),
      this.cropperWindowHelper.getWindow(),
    ];
  }

  // Helper: broadcast an IPC event to all windows
  private _broadcastToAllWindows(channel: string, ...args: any[]): void {
    const sent = new Set<number>();
    for (const win of this.preferenceWindows()) {
      if (win && !win.isDestroyed() && !sent.has(win.id)) {
        sent.add(win.id);
        try { win.webContents.send(channel, ...args); } catch { /* A tearing-down renderer does not invalidate the saved preference. */ }
      }
    }
  }

  public getDisguise(): string {
    return this.disguiseMode;
  }
}

// Application initialization

async function initializeApp() {
  // 1. Enforce single instance — prevent duplicate dock icons from leftover processes.
  // In development mode with hot-reload this is still safe because electron is restarted
  // by the build step, not re-launched by concurrently while the old process is alive.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    console.log('[Main] Another instance is already running. Exiting this instance.');
    // Use app.exit(0) — app.quit() before whenReady can be deferred or no-op'd
    // (it tries to close all windows first, but none exist yet), leaving the
    // duplicate process alive long enough to register a second tray icon on
    // macOS Tahoe + Spotlight launches. exit() terminates immediately and
    // cannot be intercepted by before-quit handlers.
    app.exit(0);
    return;
  }

  // When a duplicate launch is attempted (e.g. user invokes Spotlight again
  // while Natively is running), focus and recenter the existing window so the
  // launch is visibly handled instead of silently absorbed.
  app.on('second-instance', () => {
    try {
      const appState = AppState.getInstance();
      appState.centerAndShowWindow();
    } catch (err) {
      console.error('[Main] second-instance handler failed:', err);
    }
  });

  // 2. Wait for app to be ready
  await app.whenReady()

  // 2a. PRE-EMPTIVE dock hide: must happen before ANY operation that causes macOS to
  // register a dock entry (app.setName, BrowserWindow creation, etc.).
  // We read isUndetectable directly from settings here — AppState singleton isn't
  // constructed yet, so we cannot call appState.getUndetectable().
  if (process.platform === 'darwin') {
    // SettingsManager is already statically imported — no require() needed.
    const isUndetectableOnStartup = SettingsManager.getInstance().get('isUndetectable') ?? false;
    if (isUndetectableOnStartup) {
      app.dock.hide();
    }
  }

  // 3. Initialize Managers
  // Initialize CredentialsManager and load keys explicitly
  // This fixes the issue where keys (especially in production) aren't loaded in time for the LLM
  const { CredentialsManager } = require('./services/CredentialsManager');
  const credentialLoad = CredentialsManager.getInstance().init();
  if (!credentialLoad.ok) console.warn('[Init] Credentials unavailable:', credentialLoad.message);

  // 4. Initialize State
  const appState = AppState.getInstance()

  // Explicitly load credentials into helpers
  appState.processingHelper.loadStoredCredentials();

  // Initialize IPC handlers before window creation
  initializeIpcHandlers(appState)

  // Apply the full disguise payload (names, dock icon, AUMID) early
  appState.applyInitialDisguise();

  // NOTE: CredentialsManager.init() and loadStoredCredentials() are already called
  // above before this block — do NOT call them again here to avoid double key-load.

  logAppEvent('app-ready');

  // PERF: pre-construct STT provider objects so the meeting-start critical
  // path doesn't pay for class init + listener wiring. Runs after all
  // credentials are loaded (so the provider can read its API key) and is
  // non-blocking — failures are logged and retried at meeting start.
  try {
    appState.prewarmSttProviders();
  } catch (err) {
    console.warn('[Init] STT pre-warm threw (non-fatal):', err);
  }

  appState.createWindow()

  // Apply initial stealth state based on isUndetectable setting.
  // NOTE: app.dock.hide() was already called pre-emptively before createWindow()
  // when isUndetectable=true. Here we only need to initialize the tray for non-stealth mode.
  if (!appState.getUndetectable()) {
    // Normal mode: show tray (dock is already showing — no need to call dock.show() again)
    appState.showTray();
  }
  // Stealth mode: dock is already hidden, tray stays hidden, no action needed here.
  // Register global shortcuts using KeybindManager
  KeybindManager.getInstance().registerGlobalShortcuts()

  const disposeOsEvents = registerOsEventSubscriptions({
    powerMonitor: require('electron').powerMonitor,
    screen,
    restartCapturesAfterResume: () => appState.restartCapturesAfterResume(),
    suspendCaptures: () => appState.suspendAudio(),
    revalidateShortcuts: () => KeybindManager.getInstance().revalidateShortcuts(),
  });
  app.once('will-quit', disposeOsEvents);

  // Pre-create detached overlay companion windows in background for faster first open
  appState.settingsWindowHelper.preloadWindow()
  appState.modelSelectorWindowHelper.preloadWindow()

  // One-time macOS screen recording permission prompt.
  //
  // We must fire this AFTER createWindow() so that:
  //   1. The Natively launcher window is visible and focused when the TCC dialog
  //      appears — macOS anchors the dialog to the frontmost app window on Ventura+.
  //      Without a visible window the dialog can appear behind other apps (Sequoia).
  //   2. In stealth/undetectable mode the dock icon is hidden, but the window is
  //      still visible — the dialog still has a surface to attach to.
  //
  // The 800ms delay lets the launcher's ready-to-show animation complete so the
  // window is fully composited before the system sheet appears above it.
  //
  // TCC caches the decision permanently after the first response — this block
  // runs exactly ONCE on the first launch of each unique packaged binary.
  // On every subsequent launch the status is 'granted' or 'denied', and we skip.
  if (process.platform === 'darwin') {
    setTimeout(async () => {
      try {
        const screenStatus = systemPreferences.getMediaAccessStatus('screen');
        console.log(`[Init] Screen recording permission status at startup: ${screenStatus}`);

        if (isDevTccBypassEnabled()) {
          // B5: Legacy dev bypass — see isDevTccBypassEnabled() docstring.
          // Without the env var, dev users get the same startup TCC flow as
          // production so production bugs are reproducible locally.
          console.log('[Init] Dev TCC bypass enabled — skipping startup screen-recording check');
          return;
        }

        if (screenStatus === 'not-determined') {
          // First launch: trigger the one-time TCC dialog by making a minimal
          // desktopCapturer call. macOS will show the permission sheet anchored
          // to our window. The user's response is stored permanently in the TCC
          // database — we do NOT check status immediately after because the dialog
          // is still open; the status will be read correctly next time `startMeeting`
          // is called (which is the correct gate for system audio access).
          console.log('[Init] Screen recording not-determined — showing one-time TCC dialog...');
          try {
            await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
          } catch (e) {
            // On some Electron builds getSources throws when permission is pending —
            // that's fine; the TCC dialog has still been triggered.
            console.log('[Init] getSources threw (expected during TCC pending state):', (e as Error).message);
          }
          // NOTE: Do NOT read afterStatus here — TCC response is async (dialog still open).
          // startMeeting() reads the status when the user actually tries to use audio.

        } else if (screenStatus === 'denied') {
          const screenCapability = await resolveMacScreenCaptureCapability('startup permission check');
          if (screenCapability.effectiveDenied) {
            // Returning user who previously denied — show the banner immediately at startup
            // so they know system audio won't work before they even start a meeting.
            console.warn('[Init] Screen recording was previously denied — notifying UI banner.');
            appState.sendSystemAudioPermissionDenied(screenCapability.message ?? formatPermissionMessage('screen-recording-denied'));
          }
        } else {
          // 'granted' or 'restricted' — nothing to do for screen recording.
          console.log(`[Init] Screen recording permission already resolved: ${screenStatus}`);
        }

        // UX1: also check Microphone permission at startup. The existing
        // screen-recording check above gave returning users with a denied
        // grant immediate feedback; do the same for the mic so users know
        // before they start a meeting that audio capture is blocked.
        // Symmetric to the screen-recording branch above.
        try {
          const micStatus = systemPreferences.getMediaAccessStatus('microphone');
          console.log(`[Init] Microphone permission status at startup: ${micStatus}`);
          if (micStatus === 'denied') {
            console.warn('[Init] Microphone was previously denied — notifying UI banner.');
            appState.sendAudioCaptureFailed({
              channel: 'mic',
              message: formatPermissionMessage('mic-denied'),
              attempt: 0,
              maxAttempts: 0,
              terminal: true,
              stuck: false,
            });
          } else if (micStatus === 'restricted') {
            console.warn('[Init] Microphone is restricted by device policy at startup.');
            appState.sendAudioCaptureFailed({
              channel: 'mic',
              message: `Microphone is restricted by device policy. Contact your administrator to enable microphone access for ${APP_IDENTITY.name}.`,
              attempt: 0,
              maxAttempts: 0,
              terminal: true,
              stuck: false,
            });
          }
          // 'granted' or 'not-determined' — no banner. 'not-determined' is
          // resolved at first meeting start via ensureMacMicrophoneAccess.
        } catch (micErr) {
          console.warn('[Init] Startup microphone permission check failed:', micErr);
        }
      } catch (e) {
        console.warn('[Init] Startup screen recording permission check failed:', e);
      }
    }, 800);
  }

  // Note: We do NOT force dock show here anymore, respecting stealth mode.

  app.on("activate", () => {
    console.log("App activated")
    if (process.platform === 'darwin') {
      // Do NOT call dock.show() while a meeting is running — the dock icon
      // appearing mid-meeting is a critical stealth failure.
      if (!appState.getUndetectable() && !appState.getIsMeetingActive()) {
        app.dock.show();
      }
    }

    // If no window exists, create it
    if (appState.getMainWindow() === null) {
      appState.createWindow()
    } else {
      // If the window exists but is hidden, clicking the dock icon should restore it
      if (!appState.isVisible()) {
        appState.toggleMainWindow();
      }
    }
  })

  // Quit when all windows are closed, except on macOS
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  // Finish native release and transcript persistence before Electron exits.
  let audioShutdownFinished = false;
  let audioShutdownStarted = false;
  app.on("before-quit", (event) => {
    logAppEvent('app-quitting');
    appState.setQuitting(true);
    disposeOsEvents();
    if (!audioShutdownFinished) {
      event.preventDefault();
      if (!audioShutdownStarted) {
        audioShutdownStarted = true;
        void appState.shutdownAudio().catch(() => console.error('[Main] Audio shutdown failed')).finally(() => {
          audioShutdownFinished = true;
          // Let the cancelled native quit unwind before requesting the final quit.
          setImmediate(() => app.quit());
        });
      }
      return;
    }

    // Stop the default-output watcher so the setInterval doesn't keep calling
    // into the native module while V8 is tearing down. Without this, quitting
    // mid-meeting extends shutdown by 1–2s on slow CoreAudio teardown because
    // the next tick fires after Electron has begun releasing native handles.
    try {
      appState.stopDefaultOutputWatcherForShutdown?.();
    } catch (e) {
      console.error('[main] Failed to stop DefaultOutputWatcher during shutdown:', e);
    }

    // ROUND 2 FIX (#9): synchronously stop the CGEventTap worker thread
    // BEFORE V8 starts tearing down. The tap callback holds an
    // Arc<ThreadsafeFunction> that calls into napi from a non-V8 thread;
    // if V8 is mid-teardown when the callback runs, napi's release path
    // crashes. stop() joins the worker, guaranteeing no in-flight callbacks
    // remain by the time we return.
    //
    // ORDERING NOTE: this MUST happen before any subsequent napi-touching
    // cleanup (cropper.dispose). That can spawn its own native threads or
    // release napi resources, which would race with our worker if it's
    // still alive.
    if (process.platform === 'darwin') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
        StealthKeyboardManager.getInstance().stop();
      } catch (e) {
        console.error('[main] Failed to stop StealthKeyboardManager during shutdown:', e);
      }
    }

    // Dispose CropperWindowHelper to clean up IPC listeners and prevent memory leaks
    // This is critical to prevent resource leaks and ensure proper cleanup
    if (appState?.cropperWindowHelper) {
      appState.cropperWindowHelper.dispose();
    }

    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().scrubMemory();
      appState.processingHelper.getLLMHelper().scrubKeys();
      console.log('[Main] Credentials scrubbed from memory on quit');
    } catch (e) {
      console.error('[Main] Failed to scrub credentials on quit:', e);
    }

    // Clean up screenshot queues to prevent residual PNG files on disk
    try {
      const { ScreenshotHelper } = require('./ScreenshotHelper');
      // Clear screenshot queues - this deletes all queued screenshot files
      const screenshotHelper = new ScreenshotHelper();
      screenshotHelper.clearQueues();
      console.log('[Main] Screenshot queues cleared on quit');
    } catch (e) {
      console.error('[Main] Failed to clear screenshot queues on quit:', e);
    }
  })



  // app.dock?.hide() // REMOVED: User wants Dock icon visible
  app.commandLine.appendSwitch("disable-background-timer-throttling")
}

// Start the application
initializeApp().catch(console.error)
