import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { CODEX_RISK_VERSION, DEFAULT_CODEX_SOURCE_CONFIG, validateCodexSourceConfig, type CodexSourceConfig, type CodexSourceUpdate } from '../../src/types/codexSource';
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
    codexCliEnabled?: boolean;
    codexCliPath?: string;
    codexCliModel?: string;
    codexCliFastModel?: string;
    codexCliTimeoutMs?: number;
    codexCliSandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    codexCliServiceTier?: 'default' | 'fast' | 'flex';
    codexCliModelReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
    codexSource?: CodexSourceConfig;
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
        if (key === 'codexCliEnabled') throw new Error('Legacy Codex enable is unsupported; confirm the current login-source risks.');
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

    public getCodexSourceConfig(): CodexSourceConfig {
        try {
            if (this.settings.codexSource) return validateCodexSourceConfig(this.settings.codexSource);
            return validateCodexSourceConfig({ ...DEFAULT_CODEX_SOURCE_CONFIG,
                model: this.settings.codexCliModel || DEFAULT_CODEX_SOURCE_CONFIG.model,
                fastModel: this.settings.codexCliFastModel || DEFAULT_CODEX_SOURCE_CONFIG.fastModel,
                serviceTier: this.settings.codexCliServiceTier || 'default',
                modelReasoningEffort: this.settings.codexCliModelReasoningEffort });
        } catch { return { ...DEFAULT_CODEX_SOURCE_CONFIG }; }
    }

    public withdrawCodexSourceConsent(): void {
        this.settings.codexSource = { ...this.getCodexSourceConfig(), enabled: false, riskConfirmedVersion: undefined };
    }

    public saveCodexSourceConfig(update: CodexSourceUpdate, validate?: (config: CodexSourceConfig) => void): CodexSourceConfig {
        if (!update || typeof update !== 'object' || Array.isArray(update)) throw new Error('Invalid Codex configuration');
        const allowed = new Set(['enabled', 'model', 'fastModel', 'serviceTier', 'modelReasoningEffort', 'acceptRisk', 'imageSupportConfirmedFor', 'fastImageSupportConfirmedFor']);
        if (Object.keys(update).some(key => !allowed.has(key)) || update.acceptRisk !== undefined && typeof update.acceptRisk !== 'boolean') throw new Error('Invalid Codex configuration');
        const previous = this.getCodexSourceConfig();
        const config = validateCodexSourceConfig({ ...previous, ...update,
            riskConfirmedVersion: update.enabled === false ? undefined : update.acceptRisk === true ? CODEX_RISK_VERSION : previous.riskConfirmedVersion });
        if (config.enabled && config.riskConfirmedVersion !== CODEX_RISK_VERSION) throw new Error('Explicit current risk confirmation is required.');
        validate?.(config);
        const candidate = { ...this.settings, codexSource: config };
        // Never retain an executable/sandbox or legacy enable after a successful migration.
        for (const key of Object.keys(candidate)) if (key.startsWith('codexCli')) delete (candidate as any)[key];
        const temp = this.settingsPath + `.codex.${randomUUID()}.tmp`;
        try { fs.writeFileSync(temp, JSON.stringify(candidate, null, 2), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, this.settingsPath); }
        catch (error: any) { if (error?.code !== 'EEXIST') { try { fs.unlinkSync(temp); } catch {} } throw new Error('Unable to save Codex configuration.'); }
        this.settings = candidate;
        return { ...config };
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
        // A missing file is a first run and keeps the defaults.
        if (!fs.existsSync(this.settingsPath)) return;
        try {
            const parsed = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Settings JSON is not a valid object');
            this.settings = parsed;
        } catch (error) {
            console.error('[SettingsManager] settings.json could not be read; privacy settings fail secure until saved again:', error);
            const preserved = this.preserveUnreadableFile();
            this.settings = failSecurePrivacy();
            // Store the fail-secure values so a restart without any save stays secure. Never
            // overwrite the unreadable file when it could not be kept aside.
            if (preserved) this.saveSettings();
            this.privacyUnreadable = true;
            return;
        }
        this.migrateLegacySettings();
        console.log('[SettingsManager] Settings loaded successfully', { keys: Object.keys(this.settings).length });
    }

    // Keep the unreadable file beside settings.json so the next write cannot destroy it.
    private preserveUnreadableFile(): boolean {
        const backup = `${this.settingsPath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
        try { fs.renameSync(this.settingsPath, backup); return true; } catch (error) {
            console.error('[SettingsManager] Could not move the unreadable settings file aside:', error);
        }
        try { fs.copyFileSync(this.settingsPath, backup, fs.constants.COPYFILE_EXCL); return true; } catch (error) {
            console.error('[SettingsManager] Could not copy the unreadable settings file:', error);
            return false;
        }
    }

    // Preserve the legacy ban on screenshot egress before retiring the unused setting.
    private migrateLegacySettings(): void {
        const legacy = this.settings as AppSettings & { screenUnderstandingMode?: string };
        if (!Object.hasOwn(legacy, 'screenUnderstandingMode')) return;
        const raw = legacy.screenUnderstandingMode;
        if (raw === 'private' || raw === 'private_vision') {
            // The user asked never to send screenshots to cloud vision. Local vision
            // providers are gone (AG-14), so keep that promise by denying the
            // screenshots data scope for cloud providers.
            this.settings.providerDataScopes = { ...(this.settings.providerDataScopes || {}), screenshots: false };
        }
        delete legacy.screenUnderstandingMode;
        this.saveSettings();
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
