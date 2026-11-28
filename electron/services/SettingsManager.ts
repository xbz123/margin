import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import type { UiLanguage } from '../../src/types/uiLanguage';
import { DEFAULT_WRITTEN_EXAM, validExamSettings, type WrittenExamSettings } from '../../src/types/writtenExam';

// Kept local so test harnesses that compile this file alone need no extra module.
const isUiLanguage = (value: unknown): value is UiLanguage => value === 'en' || value === 'zh-CN';

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
        // A missing file is a first run; an unreadable one also starts with the defaults.
        if (!fs.existsSync(this.settingsPath)) return;
        try {
            const parsed = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Settings JSON is not a valid object');
            this.settings = parsed;
        } catch (error) {
            console.error('[SettingsManager] settings.json could not be read; starting with the default settings:', error);
            return;
        }
        if (this.applyLegacyMigration()) this.saveSettings();
        console.log('[SettingsManager] Settings loaded successfully', { keys: Object.keys(this.settings).length });
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
        } catch (e) {
            console.error('[SettingsManager] Failed to save settings:', e);
        }
    }
}
