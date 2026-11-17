import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';

// Interfaces for our data objects
export interface Meeting {
    id: string;
    title: string;
    date: string; // ISO string
    duration: string;
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
        generation?: import('../../src/types/generationMetadata').GenerationMetadata;
    } & Partial<import('../../src/types/generationMetadata').GenerationMetadata>>;
    isProcessed?: boolean;
}

// Thrown by saveMeeting when there is no open database, so a caller can tell it apart
// from a failed write (MeetingPersistence checks `code`).
export class DatabaseUnavailableError extends Error {
    readonly code = 'database-unavailable';
    constructor() {
        super('The meeting database is not available');
        this.name = 'DatabaseUnavailableError';
    }
}

export class DatabaseManager {
    private static instance: DatabaseManager;
    private db: Database.Database | null = null;
    private dbPath: string;

    private constructor() {
        const userDataPath = app.getPath('userData');
        this.dbPath = path.join(userDataPath, 'natively.db');
        this.init();
    }

    public static getInstance(): DatabaseManager {
        if (!DatabaseManager.instance) {
            DatabaseManager.instance = new DatabaseManager();
        }
        return DatabaseManager.instance;
    }

    private init() {
        try {
            console.log(`[DatabaseManager] Initializing database at ${this.dbPath}`);
            // Ensure directory exists (though userData usually does)
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`[DatabaseManager] Created directory: ${dir}`);
            } else {
                console.log(`[DatabaseManager] Directory exists: ${dir}`);
                try {
                    const files = fs.readdirSync(dir);
                    console.log(`[DatabaseManager] Directory contents:`, files);
                    const dbExists = fs.existsSync(this.dbPath);
                    if (dbExists) {
                        const stats = fs.statSync(this.dbPath);
                        console.log(`[DatabaseManager] Found existing DB. Size: ${stats.size} bytes`);
                    } else {
                        console.log(`[DatabaseManager] No existing DB found at ${this.dbPath}. Creating new one.`);
                    }
                } catch (e) {
                    console.error('[DatabaseManager] Error checking directory/file:', e);
                }
            }

            this.db = new Database(this.dbPath);
            this.db.pragma('journal_mode = WAL');

            this.runMigrations();
            this.removeRetiredDemoMeeting();
        } catch (error) {
            console.error('[DatabaseManager] Failed to initialize database:', error);
            throw error;
        }
    }

    // ============================================
    // PRAGMA user_version Migration System
    // ============================================
    // Each version is applied exactly once, in order.
    // New migrations append a new `if (version < N)` block.
    // ============================================

    private runMigrations() {
        if (!this.db) return;

        const version = (this.db.pragma('user_version', { simple: true }) as number) || 0;
        console.log(`[DatabaseManager] Current schema version: ${version}`);

        // Version 0 → 1: Initial schema (all core tables)
        if (version < 1) {
            console.log('[DatabaseManager] Applying migration v0 → v1: Initial schema');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS meetings (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    start_time INTEGER,
                    duration_ms INTEGER,
                    summary_json TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    is_processed INTEGER DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS transcripts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT,
                    speaker TEXT,
                    content TEXT,
                    timestamp_ms INTEGER,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS ai_interactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT,
                    type TEXT,
                    timestamp INTEGER,
                    user_query TEXT,
                    ai_response TEXT,
                    metadata_json TEXT,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS user_profile (
                    id INTEGER PRIMARY KEY,
                    structured_json TEXT NOT NULL,
                    compact_persona TEXT NOT NULL,
                    intro_short TEXT,
                    intro_interview TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS resume_nodes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    category TEXT,
                    title TEXT,
                    organization TEXT,
                    start_date TEXT,
                    end_date TEXT,
                    duration_months INTEGER,
                    text_content TEXT,
                    tags TEXT,
                    embedding BLOB
                );
            `);
            this.db.pragma('user_version = 1');
        }

        // Version 1 → 2: Add columns for existing installs (safe for fresh installs too)
        if (version < 2) {
            console.log('[DatabaseManager] Applying migration v1 → v2: Add meetings columns');
            // For fresh installs these columns already exist from v1, so we guard with try/catch.
            // Unlike the old code, these are versioned and run exactly once.
            const columnsToAdd = [
                "ALTER TABLE meetings ADD COLUMN is_processed INTEGER DEFAULT 1"
            ];
            for (const sql of columnsToAdd) {
                try { this.db.exec(sql); } catch (e) { /* Column already exists from v1 CREATE */ }
            }
            this.db.pragma('user_version = 2');
        }

        // Versions 3 → 5 created and reshaped the sqlite-vec tables and added
        // embedding columns to meetings. The vector store was removed in PLAN.md
        // AG-14: the steps remain so the version sequence is unchanged, but they
        // create nothing, and v17 drops the RAG tables where they exist.
        if (version < 3) this.db.pragma('user_version = 3');
        if (version < 4) this.db.pragma('user_version = 4');
        if (version < 5) this.db.pragma('user_version = 5');

        // Version 5 → 6: Add app_state table for KV storage
        if (version < 6) {
            console.log('[DatabaseManager] Applying migration v5 → v6: Add app_state table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS app_state (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
            `);
            this.db.pragma('user_version = 6');
        }

        // Version 6 → 7: Add indexes on transcripts and ai_interactions meeting_id
        // (Previously missing — causes O(N) full-table scans when fetching meeting details)
        if (version < 7) {
            console.log('[DatabaseManager] Applying migration v6 → v7: Add meeting_id indexes');
            try {
                this.db.exec('CREATE INDEX IF NOT EXISTS idx_transcripts_meeting ON transcripts(meeting_id);');
                this.db.exec('CREATE INDEX IF NOT EXISTS idx_ai_interactions_meeting ON ai_interactions(meeting_id, timestamp);');
                console.log('[DatabaseManager] Meeting ID indexes created successfully');
            } catch (e) {
                console.error('[DatabaseManager] Failed to create indexes (non-fatal):', e);
            }
            this.db.pragma('user_version = 7');
        }

        // Versions 7 → 10 provisioned per-dimension vec0 tables and reshaped
        // embedding_queue (vector store, removed in AG-14). Version steps only.
        if (version < 8) this.db.pragma('user_version = 8');
        if (version < 9) this.db.pragma('user_version = 9');
        if (version < 10) this.db.pragma('user_version = 10');

        // Versions 10 → 13 created and seeded the mode tables (modes,
        // mode_reference_files, mode_note_sections). The mode system was removed
        // in PLAN.md AG-13: the steps remain so the version sequence is unchanged,
        // but they create nothing, and v16 drops the tables where they exist.
        if (version < 11) this.db.pragma('user_version = 11');
        if (version < 12) this.db.pragma('user_version = 12');
        if (version < 13) this.db.pragma('user_version = 13');

        // Version 13 → 14: Add profile_custom_notes table
        if (version < 14) {
            console.log('[DatabaseManager] Applying migration v13 → v14: Add profile_custom_notes table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS profile_custom_notes (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    content TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT OR IGNORE INTO profile_custom_notes (id, content) VALUES (1, '');
            `);
            this.db.pragma('user_version = 14');
        }

        // Version 14 → 15: Add profile_persona table
        if (version < 15) {
            console.log('[DatabaseManager] Applying migration v14 → v15: Add profile_persona table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS profile_persona (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    content TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT OR IGNORE INTO profile_persona (id, content) VALUES (1, '');
            `);
            this.db.pragma('user_version = 15');
        }

        // Version 15 → 16: Drop the retired mode tables (PLAN.md AG-13)
        if (version < 16) {
            console.log('[DatabaseManager] Applying migration v15 → v16: Drop retired mode tables');
            this.db.exec(`
                DROP TABLE IF EXISTS mode_reference_index_state;
                DROP TABLE IF EXISTS mode_note_sections;
                DROP TABLE IF EXISTS mode_reference_files;
                DROP TABLE IF EXISTS modes;
            `);
            this.db.pragma('user_version = 16');
        }

        // Version 16 → 17: Drop the retired RAG tables (PLAN.md AG-14). Plain tables
        // drop normally; sqlite-vec virtual tables can only be dropped with the
        // extension loaded, which this build never does, so a failure is logged and
        // the table is left in place (Margin never opens databases from older builds
        // after AG-20, so this only concerns development databases).
        if (version < 17) {
            console.log('[DatabaseManager] Applying migration v16 → v17: Drop retired RAG tables');
            this.db.exec(`
                DROP TABLE IF EXISTS embedding_queue_old;
                DROP TABLE IF EXISTS embedding_queue;
                DROP TABLE IF EXISTS chunk_summaries;
                DROP TABLE IF EXISTS chunks;
            `);
            const vecTables = this.db.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%vec0%'"
            ).all() as Array<{ name: string }>;
            for (const { name } of vecTables) {
                try {
                    this.db.exec(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}";`);
                } catch (e) {
                    console.warn(`[DatabaseManager] v17: could not drop vector table ${name} (extension not loaded); left in place`);
                }
            }
            this.db.pragma('user_version = 17');
        }

        console.log('[DatabaseManager] Migrations completed.');
    }

    // ============================================
    // Profile Custom Notes
    // ============================================

    public getCustomNotes(): string {
        if (!this.db) return '';
        try {
            const row = this.db.prepare('SELECT content FROM profile_custom_notes WHERE id = 1').get() as { content: string } | undefined;
            return row?.content ?? '';
        } catch (e) {
            console.error('[DatabaseManager] getCustomNotes failed:', e);
            return '';
        }
    }

    public saveCustomNotes(content: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(
                'INSERT INTO profile_custom_notes (id, content, updated_at) VALUES (1, ?, datetime(\'now\')) ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
            ).run(content);
        } catch (e) {
            console.error('[DatabaseManager] saveCustomNotes failed:', e);
        }
    }

    public getPersona(): string {
        if (!this.db) return '';
        try {
            const row = this.db.prepare('SELECT content FROM profile_persona WHERE id = 1').get() as { content: string } | undefined;
            return row?.content ?? '';
        } catch (e) {
            console.error('[DatabaseManager] getPersona failed:', e);
            return '';
        }
    }

    public savePersona(content: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(
                'INSERT INTO profile_persona (id, content, updated_at) VALUES (1, ?, datetime(\'now\')) ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
            ).run(content);
        } catch (e) {
            console.error('[DatabaseManager] savePersona failed:', e);
        }
    }

    public clearProfilePersona(): void {
        if (!this.db) return;
        try {
            this.db.prepare('UPDATE profile_persona SET content = \'\', updated_at = datetime(\'now\') WHERE id = 1').run();
        } catch (e) {
            console.error('[DatabaseManager] clearProfilePersona failed:', e);
        }
    }

    // ============================================
    // System KV Store (app_state)
    // ============================================

    public getAppState(key: string): string | null {
        if (!this.db) return null;
        try {
            const stmt = this.db.prepare('SELECT value FROM app_state WHERE key = ?');
            const row = stmt.get(key) as { value: string } | undefined;
            return row ? row.value : null;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to get app_state for key: ${key}`, error);
            return null;
        }
    }

    public setAppState(key: string, value: string): void {
        if (!this.db) return;
        try {
            const stmt = this.db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)');
            stmt.run(key, value);
        } catch (error) {
            console.error(`[DatabaseManager] Failed to set app_state for key: ${key}`, error);
        }
    }

    public deleteAppState(key: string): void {
        if (!this.db) return;
        try {
            const stmt = this.db.prepare('DELETE FROM app_state WHERE key = ?');
            stmt.run(key);
        } catch (error) {
            console.error(`[DatabaseManager] Failed to delete app_state for key: ${key}`, error);
        }
    }

    public getDb(): Database.Database | null {
        return this.db;
    }

    /** Path to the SQLite database file on disk. Used by worker threads. */
    public getDbPath(): string {
        return this.dbPath;
    }

    public saveMeeting(meeting: Meeting, startTimeMs: number, durationMs: number) {
        if (!this.db) {
            console.error('[DatabaseManager] DB not initialized');
            throw new DatabaseUnavailableError();
        }

        const insertMeeting = this.db.prepare(`
            INSERT OR REPLACE INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, is_processed)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const insertTranscript = this.db.prepare(`
            INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms)
            VALUES (?, ?, ?, ?)
        `);

        const insertInteraction = this.db.prepare(`
            INSERT INTO ai_interactions (meeting_id, type, timestamp, user_query, ai_response, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        // Summaries are retired; the column stays (no schema change) and is written empty.
        const summaryJson = '{}';

        const runTransaction = this.db.transaction(() => {
            // 1. Insert Meeting
            insertMeeting.run(
                meeting.id,
                meeting.title,
                startTimeMs,
                durationMs,
                summaryJson,
                meeting.date, // Using the ISO string as created_at for sorting simply
                meeting.isProcessed ? 1 : 0
            );

            // 2. Insert Transcript
            if (meeting.transcript) {
                for (const segment of meeting.transcript) {
                    insertTranscript.run(
                        meeting.id,
                        segment.speaker,
                        segment.text,
                        segment.timestamp
                    );
                }
            }

            // 3. Insert Interactions
            if (meeting.usage) {
                for (const usage of meeting.usage) {
                    let metadata = null;
                    if (usage.items) {
                        metadata = JSON.stringify(usage.items);
                    } else if (usage.type === 'followup_questions' && usage.answer) {
                        // Sometimes answer is the array for questions, or we store it in metadata
                        // In intelligence manager we pushed: { type: 'followup_questions', answer: fullQuestions }
                        // Let's store that 'answer' (array) in metadata for this type
                        if (Array.isArray(usage.answer)) {
                            metadata = JSON.stringify(usage.answer);
                        }
                    }

                    const generation = usage.requestId ? {
                        requestId: usage.requestId, provider: usage.provider, model: usage.model, status: usage.status, attempts: usage.attempts, partial: usage.partial, timeout: usage.timeout,
                        codeOutputFormat: usage.codeOutputFormat,
                    } : usage.generation;
                    if (generation?.requestId) metadata = JSON.stringify({
                        generation,
                        items: usage.items ?? (Array.isArray(usage.answer) ? usage.answer : undefined),
                    });

                    // Normalization
                    const answerText = Array.isArray(usage.answer) ? null : usage.answer || null;
                    const queryText = usage.question || null;

                    insertInteraction.run(
                        meeting.id,
                        usage.type,
                        usage.timestamp,
                        queryText,
                        answerText,
                        metadata
                    );
                }
            }
        });

        try {
            runTransaction();
            console.log(`[DatabaseManager] Successfully saved meeting ${meeting.id}`);
        } catch (err) {
            console.error(`[DatabaseManager] Failed to save meeting ${meeting.id}`, err);
            throw err;
        }
    }

    public updateMeetingTitle(id: string, title: string): boolean {
        if (!this.db) return false;
        try {
            const stmt = this.db.prepare('UPDATE meetings SET title = ? WHERE id = ?');
            const info = stmt.run(title, id);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to update title for meeting ${id}:`, error);
            return false;
        }
    }

    public getRecentMeetings(limit: number = 50): Meeting[] {
        if (!this.db) return [];

        const stmt = this.db.prepare(`
            SELECT * FROM meetings
            ORDER BY created_at DESC
            LIMIT ?
        `);

        const rows = stmt.all(limit) as any[];

        return rows.map(row => {
            // Format duration string if needed, but we typically store ms
            // Let's recreate the 'duration' string "MM:SS" from duration_ms
            const minutes = Math.floor(row.duration_ms / 60000);
            const seconds = Math.floor((row.duration_ms % 60000) / 1000);
            const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            return {
                id: row.id,
                title: row.title,
                date: row.created_at, // Use the stored ISO string
                duration: durationStr,
                // We don't load full transcript/usage for list view to keep it light
                transcript: [] as any[],
                usage: [] as any[]
            };
        });
    }

    public getMeetingDetails(id: string): Meeting | null {
        if (!this.db) return null;

        const meetingStmt = this.db.prepare('SELECT * FROM meetings WHERE id = ?');
        const meetingRow = meetingStmt.get(id) as any;

        if (!meetingRow) return null;

        // Get Transcript
        const transcriptStmt = this.db.prepare('SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY timestamp_ms ASC');
        const transcriptRows = transcriptStmt.all(id) as any[];

        // Get Usage
        const usageStmt = this.db.prepare('SELECT * FROM ai_interactions WHERE meeting_id = ? ORDER BY timestamp ASC');
        const usageRows = usageStmt.all(id) as any[];

        // Reconstruct
        const minutes = Math.floor(meetingRow.duration_ms / 60000);
        const seconds = Math.floor((meetingRow.duration_ms % 60000) / 1000);
        const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const transcript = transcriptRows.map(row => ({
            speaker: row.speaker,
            text: row.content,
            timestamp: row.timestamp_ms
        }));

        const usage = usageRows.map(row => {
            let items: string[] | undefined;
            let generation: import('../../src/types/generationMetadata').GenerationMetadata | undefined;
            let answer = row.ai_response;

            if (row.metadata_json) {
                try {
                    const parsed = JSON.parse(row.metadata_json);
                    if (Array.isArray(parsed)) {
                        items = parsed;
                        // Special case: for 'followup_questions', earlier we treated 'answer' as the array in memory
                        // UI expects appropriate field. If type is 'followup_questions', usually answer is null and items has the questions.
                    }
                    else if (parsed && typeof parsed === 'object') { items = parsed.items; generation = parsed.generation; }
                } catch (e) { console.warn('[DatabaseManager] Failed to parse metadata_json for interaction:', row?.id, e); }
            }

            return {
                type: row.type,
                timestamp: row.timestamp,
                question: row.user_query,
                answer: answer,
                items: items,
                generation,
            };
        });

        return {
            id: meetingRow.id,
            title: meetingRow.title,
            date: meetingRow.created_at,
            duration: durationStr,
            transcript: transcript,
            usage: usage
        };
    }

    /**
     * Earlier builds seeded a fixed 'demo-meeting' guide describing features that no longer
     * exist. Remove it (and its rows) on every start; a no-op once it is gone.
     */
    public removeRetiredDemoMeeting(): void {
        if (!this.db) return;
        try {
            const id = 'demo-meeting';
            this.db.transaction(() => {
                this.db!.prepare('DELETE FROM ai_interactions WHERE meeting_id = ?').run(id);
                this.db!.prepare('DELETE FROM transcripts WHERE meeting_id = ?').run(id);
                this.db!.prepare('DELETE FROM meetings WHERE id = ?').run(id);
            })();
        } catch (error) {
            console.error('[DatabaseManager] Failed to remove the retired demo meeting:', error);
        }
    }

    public deleteMeeting(id: string): boolean {
        if (!this.db) return false;

        try {
            const stmt = this.db.prepare('DELETE FROM meetings WHERE id = ?');
            const info = stmt.run(id);
            console.log(`[DatabaseManager] Deleted meeting ${id}. Changes: ${info.changes}`);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to delete meeting ${id}:`, error);
            return false;
        }
    }

    public clearAllData(): boolean {
        if (!this.db) return false;

        try {
            // Clear all tables atomically (order matters due to foreign keys,
            // but SQLite handles cascades). Using a transaction ensures we never
            // end up in a half-cleared state if one statement fails.
            this.db.transaction(() => {
                this.db!.exec('DELETE FROM ai_interactions');
                this.db!.exec('DELETE FROM transcripts');
                this.db!.exec('DELETE FROM meetings');
            })();

            console.log('[DatabaseManager] All data cleared from database.');
            return true;
        } catch (error) {
            console.error('[DatabaseManager] Failed to clear all data:', error);
            return false;
        }
    }
}
