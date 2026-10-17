// MeetingPersistence.ts
// Handles meeting stop and save.
// Extracted from IntelligenceManager to decouple DB operations from LLM orchestration.
// Since PLAN S33/S34 a meeting is saved as its local transcript and usage only: no
// generated title or summary, so nothing is left to process or recover later.
// A failed database write keeps that one meeting in memory until a retry saves it or the
// user discards it (PLAN §8, failed meeting save). It is not kept across restarts.

import { SessionTracker } from './SessionTracker';
import { DatabaseManager, Meeting } from './db/DatabaseManager';
import type {
    MeetingSaveFailureReason, MeetingSaveSkipReason, StopMeetingResult, UnsavedMeeting, UnsavedMeetingCommandResult,
} from '../src/types/meetingSave';
const crypto = require('crypto');

interface PendingSave {
    meeting: Meeting;
    startTime: number;
    durationMs: number;
    reason: MeetingSaveFailureReason;
}

export class MeetingPersistence {
    private session: SessionTracker;
    private pending: PendingSave | null = null;
    private commandRunning = false;

    constructor(session: SessionTracker) {
        this.session = session;
    }

    /**
     * Stops the meeting, saves its transcript and usage, and resets the session.
     */
    public async stopMeeting(): Promise<StopMeetingResult> {
        console.log('[MeetingPersistence] Stopping meeting and saving it...');

        // 0. Force-save any pending interim transcript
        this.session.flushInterimTranscript();

        // 1. Snapshot valid data BEFORE resetting
        const durationMs = Date.now() - this.session.getSessionStartTime();
        if (durationMs < 1000) {
            console.log("Meeting too short, ignoring.");
            this.session.reset();
            return { status: 'skipped', reason: 'too-short' };
        }

        // Phase 9 — privacy gate: 'never' retention or per-meeting do-not-persist
        // skips persistence entirely: NO transcript / NO DB row.
        let skip: MeetingSaveSkipReason | null = null;
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            const retention = SettingsManager.getInstance().get('meetingRetention');
            if (retention === 'never') skip = 'privacy-setting';
            // Per-meeting toggle is read from SessionTracker meeting metadata
            // (e.g. set via the renderer "Do not persist this meeting" toggle).
            const meta = this.session.getMeetingMetadata?.();
            if (meta && (meta as any).doNotPersist === true) skip = 'privacy-setting';
        } catch (err) {
            console.error('[MeetingPersistence] Failed to read retention settings, defaulting to discard for safety:', err);
            skip = 'privacy-settings-unreadable'; // Fail-secure fallback
        }
        if (skip) {
            console.log(`[MeetingPersistence] Not keeping this meeting (${skip}) — no DB row.`);
            this.session.reset();
            return { status: 'skipped', reason: skip };
        }

        const startTime = this.session.getSessionStartTime();
        const transcript = [...this.session.getFullTranscript()];
        const usage = [...this.session.getFullUsage()];
        // BUG-04 fix: read metadata BEFORE reset() clears it, so a meeting started with
        // a title keeps it.
        const metadata = this.session.getMeetingMetadata() as { title?: string } | null;

        // 2. Reset state immediately so a new meeting can start or the UI is clean
        this.session.reset();

        const minutes = Math.floor(durationMs / 60000);
        const seconds = ((durationMs % 60000) / 1000).toFixed(0);
        const meeting: Meeting = {
            id: crypto.randomUUID(),
            title: metadata?.title || 'Untitled Session',
            date: new Date().toISOString(),
            duration: `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`,
            summary: '',
            detailedSummary: { actionItems: [], keyPoints: [] },
            transcript,
            usage,
            isProcessed: true
        };

        const failure = this.write(meeting, startTime, durationMs);
        if (failure) {
            // Start is refused while a meeting is pending, so this only guards against
            // replacing data the user has not resolved yet.
            if (this.pending) {
                console.error(`[MeetingPersistence] Meeting ${meeting.id} was not saved (${failure}) and another unsaved meeting is pending; it is not kept.`);
            } else {
                this.pending = { meeting, startTime, durationMs, reason: failure };
                this.broadcast('unsaved-meeting-changed', this.getUnsavedMeeting());
            }
            return { status: 'failed', id: meeting.id, reason: failure };
        }
        // Saved once committed; notifying windows is best effort.
        this.broadcast('meetings-updated');
        return { status: 'saved', id: meeting.id };
    }

    public getUnsavedMeeting(): UnsavedMeeting | null {
        const pending = this.pending;
        if (!pending) return null;
        return {
            id: pending.meeting.id,
            startedAt: pending.startTime,
            durationMs: pending.durationMs,
            transcriptCount: pending.meeting.transcript?.length ?? 0,
            reason: pending.reason,
        };
    }

    /** Writes the pending meeting again, with the same id and data. */
    public retryUnsavedMeeting(id: unknown): UnsavedMeetingCommandResult {
        if (this.commandRunning) return { ok: false, code: 'busy' };
        const pending = this.pending;
        if (!pending || pending.meeting.id !== id) return { ok: false, code: 'not-found' };
        this.commandRunning = true;
        try {
            const failure = this.write(pending.meeting, pending.startTime, pending.durationMs);
            if (failure) {
                pending.reason = failure;
                this.broadcast('unsaved-meeting-changed', this.getUnsavedMeeting());
                return { ok: false, code: 'save-failed', reason: failure };
            }
            this.pending = null;
        } finally {
            this.commandRunning = false;
        }
        console.log(`[MeetingPersistence] Unsaved meeting ${id} saved on retry.`);
        this.broadcast('unsaved-meeting-changed', null);
        this.broadcast('meetings-updated');
        return { ok: true };
    }

    /** Drops the pending meeting without writing it; the user has confirmed the loss. */
    public discardUnsavedMeeting(id: unknown): UnsavedMeetingCommandResult {
        if (this.commandRunning) return { ok: false, code: 'busy' };
        if (!this.pending || this.pending.meeting.id !== id) return { ok: false, code: 'not-found' };
        this.pending = null;
        console.log(`[MeetingPersistence] Unsaved meeting ${id} discarded by the user.`);
        this.broadcast('unsaved-meeting-changed', null);
        return { ok: true };
    }

    // Returns null once the meeting is committed, otherwise why the write failed.
    private write(meeting: Meeting, startTime: number, durationMs: number): MeetingSaveFailureReason | null {
        let database: DatabaseManager;
        try {
            database = DatabaseManager.getInstance();
        } catch (error) {
            console.error('[MeetingPersistence] Meeting database could not be opened:', error);
            return 'database-unavailable';
        }
        try {
            database.saveMeeting(meeting, startTime, durationMs);
            return null;
        } catch (error: any) {
            console.error('[MeetingPersistence] Failed to save meeting:', error);
            return error?.code === 'database-unavailable' ? 'database-unavailable' : 'write-error';
        }
    }

    private broadcast(channel: string, ...args: unknown[]): void {
        let windows: any[];
        try {
            windows = require('electron').BrowserWindow.getAllWindows();
        } catch (error) {
            console.warn(`[MeetingPersistence] Could not notify windows (${channel}):`, error);
            return;
        }
        for (const win of windows) {
            try {
                win.webContents.send(channel, ...args);
            } catch (error) {
                console.warn(`[MeetingPersistence] Could not notify a window (${channel}):`, error);
            }
        }
    }
}
