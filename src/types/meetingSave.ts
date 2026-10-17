// Result of stopping a meeting, and the one meeting kept in memory after its database
// write failed (PLAN §8, failed meeting save). Shared by main, preload and renderer.

export type MeetingSaveFailureReason = 'database-unavailable' | 'write-error';

// 'privacy-setting': the user chose not to keep meetings (retention 'never' or this
// meeting's do-not-persist). 'privacy-settings-unreadable': those settings could not be
// read, so nothing is kept (fail closed); this is not a user choice.
export type MeetingSaveSkipReason = 'too-short' | 'privacy-setting' | 'privacy-settings-unreadable';

export type StopMeetingResult =
    | { status: 'saved'; id: string }
    | { status: 'skipped'; reason: MeetingSaveSkipReason }
    | { status: 'failed'; id: string; reason: MeetingSaveFailureReason };

// Metadata only: the transcript and usage never leave the main process.
export interface UnsavedMeeting {
    id: string;
    startedAt: number;
    durationMs: number;
    transcriptCount: number;
    reason: MeetingSaveFailureReason;
}

export type UnsavedMeetingCommandResult =
    | { ok: true }
    | { ok: false; code: 'not-found' | 'busy' }
    | { ok: false; code: 'save-failed'; reason: MeetingSaveFailureReason };

// `code` of a start-meeting reply refused because an unsaved meeting is pending.
export type PendingUnsavedMeetingCode = 'pending-unsaved-meeting';
