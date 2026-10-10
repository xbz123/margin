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
    // Screen-understanding routing — VISION-ONLY architecture (legacy OCR removed from runtime).
    //   vision_first   — Default. Send screenshot to the first available vision-capable provider; cascade through fallback chain on failure.
    //   vision_only    — Stricter: require vision-capable provider. No text-only provider fallback. No OCR fallback.
    // (private_vision, local vision only, was removed with Ollama in PLAN.md AG-14; see migrateLegacySettings.)
    screenUnderstandingMode?: 'vision_first' | 'vision_only';
    // When true (default) and the active mode is a technical / coding interview, prefer
    // direct vision LLM over structured-extract-then-answer for lowest latency.
    technicalInterviewVisionFirst?: boolean;
}

export const VALID_SCREEN_UNDERSTANDING_MODES = ['vision_first', 'vision_only'] as const;
export type ScreenUnderstandingMode = typeof VALID_SCREEN_UNDERSTANDING_MODES[number];

// LEGACY values kept ONLY for migration of existing settings.json files written by older builds.
// New code MUST NOT branch on these — they are normalized to a VALID_SCREEN_UNDERSTANDING_MODES value on load.
const LEGACY_SCREEN_MODE_MIGRATION: Record<string, ScreenUnderstandingMode> = {
    auto: 'vision_first',
    balanced: 'vision_first',
    best: 'vision_first',
    fast: 'vision_first',
    ocr_only: 'vision_first',
};

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

    // Resolved screen-understanding mode with default and runtime validation.
    // Use this instead of get('screenUnderstandingMode') from callers so the default applies consistently.
    public getScreenUnderstandingMode(): ScreenUnderstandingMode {
        const stored = this.settings.screenUnderstandingMode;
        if (stored && (VALID_SCREEN_UNDERSTANDING_MODES as readonly string[]).includes(stored)) {
            return stored;
        }
        return 'vision_first';
    }

    public setScreenUnderstandingMode(mode: ScreenUnderstandingMode): void {
        if (!(VALID_SCREEN_UNDERSTANDING_MODES as readonly string[]).includes(mode)) {
            throw new Error(`[SettingsManager] Invalid screenUnderstandingMode: ${mode}`);
        }
        this.settings.screenUnderstandingMode = mode;
        this.saveSettings();
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

    // Normalize legacy screen-understanding mode values written by older builds.
    // Runs once on load; rewrites settings.json if any migration was applied.
    private migrateLegacySettings(): void {
        const raw = this.settings.screenUnderstandingMode as unknown as string | undefined;
        if (!raw) return;
        if ((VALID_SCREEN_UNDERSTANDING_MODES as readonly string[]).includes(raw)) return;
        if (raw === 'private' || raw === 'private_vision') {
            // The user asked never to send screenshots to cloud vision. Local vision
            // providers are gone (AG-14), so keep that promise by denying the
            // screenshots data scope for cloud providers.
            console.warn(`[SettingsManager] Migrating screenUnderstandingMode "${raw}" → "vision_first" with the screenshots scope denied (local vision removed)`);
            this.settings.screenUnderstandingMode = 'vision_first';
            this.settings.providerDataScopes = { ...(this.settings.providerDataScopes || {}), screenshots: false };
            this.saveSettings();
            return;
        }
        const migrated = LEGACY_SCREEN_MODE_MIGRATION[raw];
        if (migrated) {
            console.warn(`[SettingsManager] Migrating legacy screenUnderstandingMode "${raw}" → "${migrated}" (OCR runtime path removed)`);
            this.settings.screenUnderstandingMode = migrated;
            this.saveSettings();
        } else {
            console.warn(`[SettingsManager] Unknown legacy screenUnderstandingMode "${raw}" — defaulting to vision_first`);
            this.settings.screenUnderstandingMode = 'vision_first';
            this.saveSettings();
        }
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
