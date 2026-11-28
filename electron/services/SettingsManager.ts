import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import type { UiLanguage } from '../../src/types/uiLanguage';
import { DEFAULT_WRITTEN_EXAM, validExamSettings, type WrittenExamSettings } from '../../src/types/writtenExam';

// Kept local so test harnesses that compile this file alone need no extra module.
const isUiLanguage = (value: unknown): value is UiLanguage => value === 'en' || value === 'zh-CN';

// Privacy values used while a present settings.json could not be read: keep nothing and send
// nothing until the user saves a setting again (the next write stores these explicitly).
const failSecurePrivacy = (): Pick<AppSettings, 'meetingRetention' | 'providerDataScopes'> => ({
    meetingRetention: 'never',
    providerDataScopes: { transcript: false, screenshots: false, profile_history: false },
});

const PRIVACY_SCOPE_KEYS = ['transcript', 'screenshots', 'profile_history'] as const;
// Values a user could have saved; older builds also stored '7d'/'30d' (read as 'forever').
const STORED_RETENTION_VALUES: readonly unknown[] = ['forever', 'never', '7d', '30d'];

// Recovery merge: keep every privacy value the user explicitly stored and fill only the missing
// (or malformed) fields with the fail-secure value: retention 'never', each cloud scope off.
// `retentionMissing` is true when no retention choice was stored at all.
const fillPrivacyGaps = (kept: AppSettings): { candidate: AppSettings; complete: boolean; retentionMissing: boolean } => {
    const secure = failSecurePrivacy();
    const retentionMissing = !STORED_RETENTION_VALUES.includes(kept.meetingRetention);
    const storedScopes = kept.providerDataScopes && typeof kept.providerDataScopes === 'object' && !Array.isArray(kept.providerDataScopes)
        ? kept.providerDataScopes : undefined;
    const scopes: Record<string, unknown> = { ...(storedScopes || {}) };
    let scopesComplete = !!storedScopes;
    for (const key of PRIVACY_SCOPE_KEYS) {
        if (typeof scopes[key] !== 'boolean') { scopes[key] = false; scopesComplete = false; }
    }
    return {
        candidate: { ...kept, meetingRetention: retentionMissing ? secure.meetingRetention : kept.meetingRetention,
            providerDataScopes: scopes as AppSettings['providerDataScopes'] },
        complete: !retentionMissing && scopesComplete,
        retentionMissing,
    };
};

export const PRIVACY_SAVE_FAILED = 'The privacy setting could not be saved. The previous setting was kept.';

export interface AppSettings {
    writtenExam?: WrittenExamSettings;
    // Only boot-critical or non-encrypted settings should live here.
    // In the future, other non-secret data like 'language' or 'theme'
    // can be moved here from CredentialsManager to allow early boot access.
    isUndetectable?: boolean;
    disguiseMode?: 'terminal' | 'settings' | 'activity' | 'none';
    verboseLogging?: boolean;
    groqFastTextMode?: boolean;
    knowledgeMode?: boolean;
    // Phase 9 — privacy/retention controls. Foundation only. Encryption is
    // documented in docs/engineering/LOCAL_DB_ENCRYPTION_DESIGN.md.
    // 'forever' (default) or 'never' (do not store transcripts). Older builds also
    // saved '7d'/'30d', which were never enforced; getMeetingRetention() reads them as 'forever'.
    meetingRetention?: 'forever' | 'never';
    providerDataScopes?: {
        transcript?: boolean;
        screenshots?: boolean;
        profile_history?: boolean;
    };
    uiLanguage?: UiLanguage;
}

export class SettingsManager {
    private static instance: SettingsManager;
    private settings: AppSettings = {};
    private settingsPath: string;
    // True after boot found settings.json present but unreadable, until a write succeeds.
    private privacyUnreadable = false;

    private constructor() {
        if (!app.isReady()) {
            throw new Error('[SettingsManager] Cannot initialize before app.whenReady()');
        }
        this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
        this.loadSettings();
    }

    public static getInstance(): SettingsManager {
        if (!SettingsManager.instance) {
            SettingsManager.instance = new SettingsManager();
        }
        return SettingsManager.instance;
    }

    public get<K extends keyof AppSettings>(key: K): AppSettings[K] {
        return this.settings[key];
    }

    public set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
        this.settings[key] = value;
        this.saveSettings();
    }

    // Privacy settings are written before memory changes; a failed write throws and keeps the
    // previous value both in memory and on disk.
    public savePrivacySetting<K extends 'meetingRetention' | 'providerDataScopes'>(key: K, value: AppSettings[K]): void {
        this.writeCandidate({ ...this.settings, [key]: value }, 'privacy', PRIVACY_SAVE_FAILED);
    }

    // A present settings.json could not be read at boot and no setting has been saved since.
    public privacySettingsUnreadable(): boolean {
        return this.privacyUnreadable;
    }

    private writeCandidate(candidate: AppSettings, tag: string, message: string): void {
        const temp = this.settingsPath + `.${tag}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temp, JSON.stringify(candidate, null, 2), { flag: 'wx', mode: 0o600 });
            fs.renameSync(temp, this.settingsPath);
        } catch (error: any) {
            if (error?.code !== 'EEXIST') { try { fs.unlinkSync(temp); } catch {} }
            throw new Error(message);
        }
        this.settings = candidate;
        this.privacyUnreadable = false;
    }

    public saveWindowPreference(key: 'isUndetectable' | 'disguiseMode', value: boolean | AppSettings['disguiseMode']): void {
        if (key === 'isUndetectable' ? typeof value !== 'boolean' : !['none', 'terminal', 'settings', 'activity'].includes(value as string)) throw new Error('Invalid window preference.');
        const candidate = { ...this.settings, [key]: value };
        const temp = this.settingsPath + `.window.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temp, JSON.stringify(candidate, null, 2), { flag: 'wx', mode: 0o600 });
            fs.renameSync(temp, this.settingsPath);
        } catch (error: any) {
            if (error?.code !== 'EEXIST') { try { fs.unlinkSync(temp); } catch {} }
            throw new Error('The window preference could not be saved.');
        }
        this.settings = candidate;
    }

    public getMeetingRetention(): 'forever' | 'never' {
        return this.settings.meetingRetention === 'never' ? 'never' : 'forever';
    }

    public getUiLanguage(): UiLanguage {
        return isUiLanguage(this.settings.uiLanguage) ? this.settings.uiLanguage : 'en';
    }

    public getWrittenExamSettings(): WrittenExamSettings {
        const saved = this.settings.writtenExam;
        const migrated = saved && typeof saved === 'object' ? { autoCaptureEnabled: false, ...saved } : saved;
        return { ...(validExamSettings(migrated) ? migrated : DEFAULT_WRITTEN_EXAM) };
    }

    public saveWrittenExamSettings(value: unknown): WrittenExamSettings {
        if (!validExamSettings(value)) throw new Error('Invalid written exam settings. Use a whole number from 5 to 300 seconds.');
        const writtenExam = { ...value };
        const candidate = { ...this.settings, writtenExam };
        const temp = this.settingsPath + `.exam.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temp, JSON.stringify(candidate, null, 2), { flag: 'wx', mode: 0o600 });
            fs.renameSync(temp, this.settingsPath);
        } catch (error: any) {
            if (error?.code !== 'EEXIST') { try { fs.unlinkSync(temp); } catch {} }
            throw new Error('Written exam settings could not be saved. Previous settings were kept.');
        }
        this.settings = candidate;
        return { ...writtenExam };
    }

    // Unlike set(), a failed write throws and leaves the previous language in memory and on disk.
    public saveUiLanguage(language: UiLanguage): UiLanguage {
        if (!isUiLanguage(language)) throw new Error('Unsupported interface language.');
        const candidate = { ...this.settings, uiLanguage: language };
        const temp = this.settingsPath + `.language.${randomUUID()}.tmp`;
        try { fs.writeFileSync(temp, JSON.stringify(candidate, null, 2), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, this.settingsPath); }
        catch (error: any) { if (error?.code !== 'EEXIST') { try { fs.unlinkSync(temp); } catch {} } throw new Error('The interface language could not be saved.'); }
        this.settings = candidate;
        return language;
    }

    private loadSettings(): void {
        if (!fs.existsSync(this.settingsPath)) {
            // A missing file is a first run and keeps the defaults, unless an older build moved an
            // unreadable settings.json aside and then failed to write the replacement, or the
            // folder cannot be listed to rule that out.
            if (this.inRecoveryState()) {
                console.error('[SettingsManager] settings.json is missing but an unreadable copy may have been kept aside; privacy settings fail secure until saved again');
                this.recoverFailSecure();
            }
            return;
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Settings JSON is not a valid object');
            this.settings = parsed;
        } catch (error) {
            console.error('[SettingsManager] settings.json could not be read; privacy settings fail secure until saved again:', error);
            // Never overwrite the unreadable file when it could not be kept aside.
            if (this.preserveUnreadableFile()) this.recoverFailSecure();
            else { this.settings = failSecurePrivacy(); this.privacyUnreadable = true; }
            return;
        }
        const migrated = this.applyLegacyMigration();
        // An older build treated a missing settings.json (moved aside as unreadable) as a first
        // install and later wrote some preferences to a new one, possibly only part of the privacy
        // settings. With an unreadable copy kept aside (or a folder that cannot be listed), every
        // privacy field the file does not store fails secure; stored fields are kept as they are.
        if (this.inRecoveryState() && !fillPrivacyGaps(this.settings).complete) {
            console.error('[SettingsManager] settings.json is missing privacy settings and an unreadable copy may have been kept aside; missing privacy settings fail secure until saved again');
            this.recoverFailSecure(this.settings);
            return;
        }
        if (migrated) this.saveSettings();
        console.log('[SettingsManager] Settings loaded successfully', { keys: Object.keys(this.settings).length });
    }

    // Store the fail-secure values so a restart without any save stays secure. The replacement is
    // written beside settings.json and renamed over it, so a failed write leaves the unreadable
    // file (or nothing, in the legacy state) in place and the next boot fails secure again.
    // `kept` holds readable settings to carry over; privacy values it stores are kept per field.
    // Meetings stay unsaved (privacyUnreadable) only when no retention choice was stored, so a
    // stored choice behaves the same on this boot and every later one.
    private recoverFailSecure(kept: AppSettings = {}): void {
        const { candidate, retentionMissing } = fillPrivacyGaps(kept);
        try { this.writeCandidate(candidate, 'recovery', 'The fail-secure settings could not be written.'); }
        catch (error) { console.error('[SettingsManager] Failed to write fail-secure settings:', error); }
        this.settings = candidate;
        this.privacyUnreadable = retentionMissing;
    }

    private unreadableBackups(): string[] {
        try { return this.listUnreadableBackups(); }
        catch { return []; }
    }

    private listUnreadableBackups(): string[] {
        const prefix = `${path.basename(this.settingsPath)}.corrupt-`;
        return fs.readdirSync(path.dirname(this.settingsPath)).filter(name => name.startsWith(prefix));
    }

    // An unreadable copy was kept aside, or the folder could not be listed to rule that out.
    private inRecoveryState(): boolean {
        try { return this.listUnreadableBackups().length > 0; }
        catch (error: any) {
            // A folder that does not exist holds no copy; any other failure could hide one.
            if (error?.code === 'ENOENT') return false;
            console.error('[SettingsManager] Could not list the settings folder; treating privacy settings as unrecovered:', error);
            return true;
        }
    }

    // Copy the unreadable file beside settings.json so the next write cannot destroy it. The
    // original stays at settings.json until the fail-secure replacement is fully written.
    private preserveUnreadableFile(): boolean {
        // A boot that failed again on the same file keeps it once: an identical copy is already aside.
        try {
            const current = fs.readFileSync(this.settingsPath);
            const dir = path.dirname(this.settingsPath);
            for (const name of this.unreadableBackups()) {
                try {
                    const file = path.join(dir, name);
                    if (fs.statSync(file).size === current.length && fs.readFileSync(file).equals(current)) return true;
                } catch { /* Unreadable backup: compare the next one. */ }
            }
        } catch { /* Copy below; it reports its own failure. */ }
        const backup = `${this.settingsPath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
        try { fs.copyFileSync(this.settingsPath, backup, fs.constants.COPYFILE_EXCL); return true; } catch (error) {
            console.error('[SettingsManager] Could not copy the unreadable settings file:', error);
            return false;
        }
    }

    // Preserve the legacy ban on screenshot egress before retiring the unused setting. Changes
    // memory only; returns true when the caller must save.
    private applyLegacyMigration(): boolean {
        const legacy = this.settings as AppSettings & { screenUnderstandingMode?: string };
        if (!Object.hasOwn(legacy, 'screenUnderstandingMode')) return false;
        const raw = legacy.screenUnderstandingMode;
        if (raw === 'private' || raw === 'private_vision') {
            // The user asked never to send screenshots to cloud vision. Local vision
            // providers are gone (AG-14), so keep that promise by denying the
            // screenshots data scope for cloud providers.
            this.settings.providerDataScopes = { ...(this.settings.providerDataScopes || {}), screenshots: false };
        }
        delete legacy.screenUnderstandingMode;
        return true;
    }

    private saveSettings(): void {
        try {
            const tmpPath = this.settingsPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(this.settings, null, 2));
            fs.renameSync(tmpPath, this.settingsPath);
            this.privacyUnreadable = false;
        } catch (e) {
            console.error('[SettingsManager] Failed to save settings:', e);
        }
    }
}
