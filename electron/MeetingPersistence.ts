// MeetingPersistence.ts
// Handles meeting stop and save.
// Extracted from IntelligenceManager to decouple DB operations from LLM orchestration.
// Since PLAN S33/S34 a meeting is saved as its local transcript and usage only: no
// generated title or summary, so nothing is left to process or recover later.

import { SessionTracker } from './SessionTracker';
import { DatabaseManager, Meeting } from './db/DatabaseManager';
const crypto = require('crypto');

export class MeetingPersistence {
    private session: SessionTracker;

    constructor(session: SessionTracker) {
        this.session = session;
    }

    /**
     * Stops the meeting, saves its transcript and usage, and resets the session.
     */
    public async stopMeeting(): Promise<string | null> {
        console.log('[MeetingPersistence] Stopping meeting and saving it...');

        // 0. Force-save any pending interim transcript
        this.session.flushInterimTranscript();

        // 1. Snapshot valid data BEFORE resetting
        const durationMs = Date.now() - this.session.getSessionStartTime();
        if (durationMs < 1000) {
            console.log("Meeting too short, ignoring.");
            this.session.reset();
            return null;
        }

        // Phase 9 — privacy gate: 'never' retention or per-meeting do-not-persist
        // skips persistence entirely: NO transcript / NO DB row.
        let doNotPersist = false;
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            const retention = SettingsManager.getInstance().get('meetingRetention');
            if (retention === 'never') doNotPersist = true;
            // Per-meeting toggle is read from SessionTracker meeting metadata
            // (e.g. set via the renderer "Do not persist this meeting" toggle).
            const meta = this.session.getMeetingMetadata?.();
            if (meta && (meta as any).doNotPersist === true) doNotPersist = true;
        } catch (err) {
            console.error('[MeetingPersistence] Failed to read retention settings, defaulting to discard for safety:', err);
            doNotPersist = true; // Fail-secure fallback
        }
        if (doNotPersist) {
            console.log('[MeetingPersistence] doNotPersist set — skipping save (no DB row).');
            this.session.reset();
            return null;
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

        try {
            DatabaseManager.getInstance().saveMeeting(meeting, startTime, durationMs);
            // Notify Frontend to refresh list
            const wins = require('electron').BrowserWindow.getAllWindows();
            wins.forEach((w: any) => w.webContents.send('meetings-updated'));
        } catch (error) {
            console.error('[MeetingPersistence] Failed to save meeting:', error);
            return null;
        }
        return meeting.id;
    }
}
