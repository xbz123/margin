import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { CODEX_RISK_VERSION, DEFAULT_CODEX_SOURCE_CONFIG, validateCodexSourceConfig, type CodexSourceConfig, type CodexSourceUpdate } from '../../src/types/codexSource';

export interface AppSettings {
    // Only boot-critical or non-encrypted settings should live here.
    // In the future, other non-secret data like 'language' or 'theme'
    // can be moved here from CredentialsManager to allow early boot access.
    isUndetectable?: boolean;
    disguiseMode?: 'terminal' | 'settings' | 'activity' | 'none';
    verboseLogging?: boolean;
    actionButtonMode?: 'recap' | 'brainstorm';
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
    // 'forever' (default), '7d', '30d', or 'never' (do not store transcripts).
    meetingRetention?: 'forever' | '7d' | '30d' | 'never';
    providerDataScopes?: {
        transcript?: boolean;
        screenshots?: boolean;
        profile_history?: boolean;
        post_call_summary?: boolean;
    };
    // When true (default) and the active mode is a technical / coding interview, prefer
    // direct vision LLM over structured-extract-then-answer for lowest latency.
    technicalInterviewVisionFirst?: boolean;
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
        if (key === 'codexCliEnabled') throw new Error('Legacy Codex enable is unsupported; confirm the current login-source risks.');
        this.settings[key] = value;
        this.saveSettings();
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

    public getTechnicalInterviewVisionFirst(): boolean {
        return this.settings.technicalInterviewVisionFirst !== false;
    }

    private loadSettings(): void {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const data = fs.readFileSync(this.settingsPath, 'utf8');
                try {
                    const parsed = JSON.parse(data);
                    // Minimal validation to ensure it's an object before assigning
                    if (typeof parsed === 'object' && parsed !== null) {
                        this.settings = parsed;
                        this.migrateLegacySettings();
                        console.log('[SettingsManager] Settings loaded successfully', { keys: Object.keys(this.settings).length });
                    } else {
                        throw new Error('Settings JSON is not a valid object');
                    }
                } catch (parseError) {
                    console.error('[SettingsManager] Failed to parse settings.json. Continuing with empty settings. Error:', parseError);
                    this.settings = {};
                }
                console.log('[SettingsManager] Settings loaded');
            }
        } catch (e) {
            console.error('[SettingsManager] Failed to read settings file:', e);
            this.settings = {};
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
        } catch (e) {
            console.error('[SettingsManager] Failed to save settings:', e);
        }
    }
}
