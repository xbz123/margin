// Maps the start-meeting IPC reply to what the launcher shows next to its Start button.
// The reply is { success: true } or { success: false, error, code? } (electron/ipcHandlers.ts
// 'start-meeting'); the messages below match the errors main throws before a meeting begins
// (CredentialsManager.requireSttConfigured, formatPermissionMessage('mic-denied')).

export type StartFailureKind = 'stt-not-configured' | 'microphone-denied' | 'other';

export interface StartFailure {
    kind: StartFailureKind;
    // English source text; the launcher translates it with t().
    message: string;
    // The main-process reason, shown only for failures without a specific message.
    reason?: string;
}

export const START_FAILURE_STT_NOT_CONFIGURED = 'The meeting could not start because no speech provider is set up. Choose a speech provider and save its key in Speech & Audio settings, then start again.';
// Like main's message, these ask for a restart: macOS applies a microphone grant after the app restarts.
// {name} is the app name, filled in by the launcher.
export const START_FAILURE_MIC_DENIED_MAC = 'The meeting could not start because microphone access is blocked. Allow it in System Settings → Privacy & Security → Microphone, then restart {name}.';
// Main only checks microphone access on macOS today; this is the same guidance should it ever report one elsewhere.
export const START_FAILURE_MIC_DENIED_OTHER = 'The meeting could not start because microphone access is blocked. Allow it in Settings → Privacy → Microphone, then restart {name}.';
export const START_FAILURE_OTHER = 'The meeting could not start.';

// Null means nothing to show here: the meeting started, the unsaved-meeting banner
// already explains the refusal, or the app is quitting.
export function describeStartFailure(result: unknown, options: { isMac: boolean }): StartFailure | null {
    if (!result || typeof result !== 'object') return null;
    const reply = result as { success?: unknown; error?: unknown; code?: unknown };
    if (reply.success === true) return null;
    if (reply.code === 'pending-unsaved-meeting') return null;
    const error = typeof reply.error === 'string' ? reply.error.trim() : '';
    if (error.startsWith('Application is quitting')) return null;
    if (error.startsWith('STT is not configured')) {
        return { kind: 'stt-not-configured', message: START_FAILURE_STT_NOT_CONFIGURED };
    }
    if (error.startsWith('Microphone access denied')) {
        return { kind: 'microphone-denied', message: options.isMac ? START_FAILURE_MIC_DENIED_MAC : START_FAILURE_MIC_DENIED_OTHER };
    }
    return error ? { kind: 'other', message: START_FAILURE_OTHER, reason: error } : { kind: 'other', message: START_FAILURE_OTHER };
}
