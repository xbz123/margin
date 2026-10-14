/**
 * CredentialsManager - Secure storage for API keys
 * Uses Electron's safeStorage API for encryption at rest
 */

import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { CredentialDiscardResult, CredentialLoadStatus, CredentialSaveResult } from '../../src/types/credentialSave';
import { openAiSttEndpoint } from './outbound';
import { validateSttBaseUrl } from '../utils/validateSttBaseUrl';
import { LLM_PRESETS, modelTargetId, parseModelSelection, type LlmProvider, type ProviderConfiguration, type ProviderConfigurationSave, type GatewayConfiguration, type GatewayConfigurationSave, type GatewaySummary, type ModelTarget } from '../../src/types/llmTarget';
import { validateProviderConfiguration, validateGatewayConfiguration, resolveModelTarget, followSelection, GROQ_ANSWERS_RETIRED } from '../llm/llmTarget';
import { DEFAULT_GENERATION_POLICY, validateGenerationPolicy, type GenerationPolicy } from '../../src/types/generationPolicy';
import { isCodexSelection, validateCodexModel, codexImageTarget, DEFAULT_CODEX_SOURCE_CONFIG, type CodexSourceConfig } from '../../src/types/codexSource';
import type { DomesticSttSettings, DoubaoResourceId } from '../../src/types/domesticStt';

const CREDENTIALS_PATH = path.join(app.getPath('userData'), 'credentials.enc');

export interface StoredCredentials {
    geminiApiKey?: string;
    groqApiKey?: string;
    openaiApiKey?: string;
    claudeApiKey?: string;
    deepseekApiKey?: string;
    defaultModel?: string;
    providerConfigurations?: Partial<Record<LlmProvider, ProviderConfiguration>>;
    /** Gateway configuration by stable ID; their keys are kept apart in gatewayKeys. */
    gateways?: Record<string, GatewayConfiguration>;
    gatewayKeys?: Record<string, string>;
    generationPolicy?: GenerationPolicy;
    // STT Provider settings
    sttProvider?: 'none' | 'groq' | 'openai' | 'soniox' | 'aliyun' | 'doubao';
    domesticStt?: Partial<Record<'aliyun' | 'doubao', { key: string; workspaceId: string; appId: string; resourceId?: DoubaoResourceId }>>;
    groqSttApiKey?: string;
    groqSttModel?: string;
    openAiSttApiKey?: string;
    /** Custom OpenAI-compatible STT base URL (e.g. self-hosted Speaches).
     *  Empty / unset → use https://api.openai.com. */
    openAiSttBaseUrl?: string;
    sonioxApiKey?: string;
    sttLanguage?: string;
    aiResponseLanguage?: string;
    // Dynamic Model Discovery – preferred models per provider
    geminiPreferredModel?: string;
    groqPreferredModel?: string;
    openaiPreferredModel?: string;
    claudePreferredModel?: string;
    deepseekPreferredModel?: string;
}

export class CredentialsManager {
    private static instance: CredentialsManager;
    private credentials: StoredCredentials = {};
    // An unread existing ciphertext must never be replaced by a partial new state.
    private loadFailure: Extract<CredentialSaveResult, { ok: false }> | undefined = {
        ok: false, code: 'decrypt_failed', message: 'Credentials have not been loaded. Restart the application before saving.',
    };
    // Set only when an existing file was read and could not be decrypted or parsed.
    private unreadableOnDisk = false;

    private constructor() {
        // Load on construction after app ready
    }

    public static getInstance(): CredentialsManager {
        if (!CredentialsManager.instance) {
            CredentialsManager.instance = new CredentialsManager();
        }
        return CredentialsManager.instance;
    }

    /**
     * Initialize - load credentials from disk
     * Must be called after app.whenReady()
     */
    public init(): CredentialSaveResult {
        return this.loadCredentials();
    }

    // =========================================================================
    // Getters
    // =========================================================================

    public getGeminiApiKey(): string | undefined {
        return this.credentials.geminiApiKey;
    }

    public getGroqApiKey(): string | undefined {
        return this.credentials.groqApiKey;
    }

    public getOpenaiApiKey(): string | undefined {
        return this.credentials.openaiApiKey;
    }

    public getClaudeApiKey(): string | undefined {
        return this.credentials.claudeApiKey;
    }

    public getDeepseekApiKey(): string | undefined {
        return this.credentials.deepseekApiKey;
    }

    public getSttProvider(): NonNullable<StoredCredentials['sttProvider']> {
        // 'local-whisper' was retired with local STT (PLAN.md AG-15).
        // 'google', 'deepgram', 'elevenlabs', 'azure', 'ibmwatson' were retired in AG-41a.
        // Treat retired providers as "none" so audio is never sent to a retired cloud provider.
        const stored = this.credentials.sttProvider;
        if (stored === 'groq' || stored === 'openai' || stored === 'soniox' || stored === 'aliyun' || stored === 'doubao') {
            return stored;
        }
        return 'none';
    }

    public getGroqSttApiKey(): string | undefined {
        return this.credentials.groqSttApiKey;
    }

    public getDomesticStt(provider: 'aliyun' | 'doubao') {
        const stored = this.credentials.domesticStt?.[provider];
        // Doubao configurations saved before the resource choice existed used the hourly resource.
        return stored && provider === 'doubao' ? { ...stored, resourceId: stored.resourceId === undefined ? 'volc.seedasr.sauc.duration' : stored.resourceId } : stored;
    }

    // Aliyun: an empty workspace selects the Beijing general endpoint, otherwise one DNS label of
    // the dedicated Beijing domain. Doubao: one of the two resources the user can buy.
    private invalidDomesticStt(provider: 'aliyun' | 'doubao', config: { workspaceId?: unknown; resourceId?: unknown }): boolean {
        if (provider === 'aliyun') {
            return typeof config.workspaceId !== 'string' || (config.workspaceId !== '' && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(config.workspaceId));
        }
        return config.resourceId !== 'volc.seedasr.sauc.duration' && config.resourceId !== 'volc.seedasr.sauc.concurrent';
    }

    public setDomesticStt(provider: 'aliyun' | 'doubao', input: DomesticSttSettings): CredentialSaveResult {
        if (provider !== 'aliyun' && provider !== 'doubao') throw Error('Invalid STT provider');
        if (!input || [input.key, input.workspaceId, input.appId].some(value => typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value))) {
            throw Error('Invalid STT credentials');
        }
        const key = input.key.trim(), workspaceId = input.workspaceId.trim(), appId = input.appId.trim();
        const resourceId = input.resourceId === undefined ? 'volc.seedasr.sauc.duration' : input.resourceId;
        if (key && this.invalidDomesticStt(provider, { workspaceId, resourceId })) throw Error('Invalid STT configuration');
        if (key && appId && !/^[A-Za-z0-9_-]{1,128}$/.test(appId)) throw Error('Invalid App ID');
        const config = provider === 'doubao' ? { key, workspaceId, appId, resourceId } : { key, workspaceId, appId };
        return this.saveCredentials({ domesticStt: { ...this.credentials.domesticStt,
            [provider]: key ? config : undefined } });
    }

    public requireSttConfigured(): void {
        const provider = this.getSttProvider();
        const key = provider === 'groq' ? this.getGroqSttApiKey() : provider === 'openai' ? this.getOpenAiSttApiKey()
            : provider === 'soniox' ? this.getSonioxApiKey() : provider === 'none' ? undefined : this.getDomesticStt(provider)?.key;
        const domestic = provider === 'aliyun' || provider === 'doubao' ? this.getDomesticStt(provider) : undefined;
        if (!key?.trim() || (domestic && this.invalidDomesticStt(provider as 'aliyun' | 'doubao', domestic))) {
            throw Error('STT is not configured. Select a speech provider and save its credentials before starting a meeting. / 请先选择语音服务商并保存凭据。');
        }
    }

    public getGroqSttModel(): string {
        return this.credentials.groqSttModel || 'whisper-large-v3-turbo';
    }

    public getOpenAiSttApiKey(): string | undefined {
        return this.credentials.openAiSttApiKey;
    }

    public getOpenAiSttBaseUrl(): string | undefined {
        return this.credentials.openAiSttBaseUrl;
    }

    public getSonioxApiKey(): string | undefined {
        return this.credentials.sonioxApiKey;
    }

    public getSttLanguage(): string {
        return this.credentials.sttLanguage || 'english-us';
    }

    public getAiResponseLanguage(): string {
        return this.credentials.aiResponseLanguage || 'auto';
    }
    public getDefaultModel(): string {
        return this.credentials.defaultModel || 'gemini-3.1-flash-lite-preview';
    }

    public getAllCredentials(): StoredCredentials {
        return { ...this.credentials };
    }

    public getProviderConfigurations(): Record<LlmProvider, ProviderConfiguration> {
        return Object.fromEntries(Object.entries(LLM_PRESETS).map(([provider, preset]) => {
            const config = validateProviderConfiguration(this.credentials.providerConfigurations?.[provider as LlmProvider]
                ?? { ...preset, model: this.getPreferredModel(provider as LlmProvider) ?? preset.model });
            if (config.provider !== provider) throw new Error('Provider configuration does not match its credential slot');
            return [provider, config];
        })) as Record<LlmProvider, ProviderConfiguration>;
    }

    public getProviderApiKey(provider: LlmProvider): string | undefined {
        return this.credentials[`${provider}ApiKey` as keyof StoredCredentials] as string | undefined;
    }

    public getGateways(): Record<string, GatewayConfiguration> {
        return Object.fromEntries(Object.entries(this.credentials.gateways ?? {}).map(([id, gateway]) => {
            const config = validateGatewayConfiguration(gateway);
            if (config.id !== id) throw new Error('Gateway configuration does not match its identity');
            return [id, config];
        }));
    }

    public getGatewayApiKey(id: string): string | undefined {
        return Object.hasOwn(this.credentials.gatewayKeys ?? {}, id) ? this.credentials.gatewayKeys![id] : undefined;
    }

    /** Configuration and key presence only; the key never leaves the main process. */
    public getGatewaySummaries(): GatewaySummary[] {
        return Object.values(this.getGateways()).map(gateway => ({ ...gateway, hasKey: !!this.getGatewayApiKey(gateway.id)?.trim() }));
    }

    public resolveSelection(selection: string, configs = this.getProviderConfigurations(), gateways = this.getGateways()): ModelTarget {
        return resolveModelTarget(selection, configs, gateways);
    }

    private backupConfirmationValid(policy: GenerationPolicy, configs = this.getProviderConfigurations(), gateways = this.getGateways()): boolean {
        try {
            const backup = this.resolveSelection(policy.backupModel!, configs, gateways);
            const confirmed = { ...backup, imageSupportConfirmedFor: policy.backupImageSupportConfirmedFor };
            return backup.provider === 'gateway'
                ? !!validateGatewayConfiguration({ ...confirmed, id: backup.gatewayId!, baseUrl: backup.baseUrl! }).imageSupportConfirmedFor
                : !!validateProviderConfiguration(confirmed as ProviderConfiguration).imageSupportConfirmedFor;
        } catch { return false; }
    }

    public getGenerationPolicy(): GenerationPolicy {
        const policy = validateGenerationPolicy(this.credentials.generationPolicy ?? DEFAULT_GENERATION_POLICY);
        if (policy.backupImageSupportConfirmedFor) {
            if (policy.backupModel && isCodexSelection(policy.backupModel)) {
                if (policy.backupModel.startsWith('codex-cli:') && policy.backupImageSupportConfirmedFor !== codexImageTarget(validateCodexModel(policy.backupModel.slice(10)))) delete policy.backupImageSupportConfirmedFor;
                return policy;
            }
            // An unavailable backup (retired Groq, removed gateway) stays visible as saved; it is refused when used.
            if (!policy.backupModel || !this.backupConfirmationValid(policy)) delete policy.backupImageSupportConfirmedFor;
        }
        return policy;
    }

    private generationSelectionId(selection: string, config: CodexSourceConfig, fast = false): string {
        return isCodexSelection(selection) ? `codex-cli:${fast ? config.fastModel : selection.startsWith('codex-cli:') ? validateCodexModel(selection.slice(10)) : config.model}`
            : modelTargetId(this.resolveSelection(selection));
    }

    /** The selection unchanged when it is unavailable, so comparisons never invent a target. */
    private comparableSelection(selection: string, configs: Record<LlmProvider, ProviderConfiguration>, gateways: Record<string, GatewayConfiguration>): string {
        if (isCodexSelection(selection)) return selection;
        try { return modelTargetId(this.resolveSelection(selection, configs, gateways)); } catch { return selection; }
    }

    /**
     * After an explicit save of one target, a primary or backup that named that target's configured
     * model follows it, and one that named its old protocol keeps its model on the new protocol.
     * Other selections are left exactly as they were.
     */
    private followSavedTarget(selection: string | undefined, previous: ModelTarget, next: ModelTarget): string | undefined {
        if (!selection || isCodexSelection(selection)) return selection;
        // A legacy bare ID is compared through its canonical form, and kept as written when untouched.
        const canonical = parseModelSelection(selection) ? selection : this.comparableSelection(selection, this.getProviderConfigurations(), this.getGateways());
        const followed = followSelection(canonical, previous, next);
        return followed === canonical ? selection : followed;
    }

    private assertDistinctSelections(primary: string, backup: string | undefined, configs: Record<LlmProvider, ProviderConfiguration>, gateways: Record<string, GatewayConfiguration>): void {
        if (backup && !isCodexSelection(backup) && !primary.startsWith('codex-cli')
            && this.comparableSelection(primary, configs, gateways) === this.comparableSelection(backup, configs, gateways)) {
            throw new Error('Primary and backup model must differ. Change the backup first.');
        }
    }

    public setGenerationPolicy(value: GenerationPolicy, codexConfig = DEFAULT_CODEX_SOURCE_CONFIG, fast = false): CredentialSaveResult {
        const policy = validateGenerationPolicy(value);
        if (policy.backupModel) {
            if (isCodexSelection(policy.backupModel)) {
                if (policy.backupModel.startsWith('codex-cli:')) validateCodexModel(policy.backupModel.slice(10));
                if (this.generationSelectionId(policy.backupModel, codexConfig) === this.generationSelectionId(this.getDefaultModel(), codexConfig, fast && isCodexSelection(this.getDefaultModel()))) throw new Error('Primary and backup model must differ.');
                return this.saveCredentials({ generationPolicy: policy });
            }
            const backup = this.resolveSelection(policy.backupModel);
            if (!this.getDefaultModel().startsWith('codex-cli') && modelTargetId(backup) === this.comparableSelection(this.getDefaultModel(), this.getProviderConfigurations(), this.getGateways())) throw new Error('Primary and backup model must differ.');
        }
        return this.saveCredentials({ generationPolicy: policy });
    }

    public setProviderConfiguration(value: ProviderConfigurationSave): CredentialSaveResult {
        if (value?.provider === 'groq') throw new Error(GROQ_ANSWERS_RETIRED);
        const config = validateProviderConfiguration(value);
        if (value.apiKey !== undefined && typeof value.apiKey !== 'string') throw new Error('Invalid API key');
        const configs = this.getProviderConfigurations(), gateways = this.getGateways();
        const previous = configs[config.provider];
        const nextConfigurations = { ...configs, [config.provider]: config };
        const followed = this.followSavedTarget(this.getDefaultModel(), previous, config);
        const defaultModel = followed !== this.getDefaultModel() ? followed : this.credentials.defaultModel;
        const generationPolicy = this.getGenerationPolicy();
        generationPolicy.backupModel = this.followSavedTarget(generationPolicy.backupModel, previous, config);
        if (generationPolicy.backupImageSupportConfirmedFor && generationPolicy.backupModel && !isCodexSelection(generationPolicy.backupModel)
            && !this.backupConfirmationValid(generationPolicy, nextConfigurations, gateways)) delete generationPolicy.backupImageSupportConfirmedFor;
        this.assertDistinctSelections(defaultModel ?? this.getDefaultModel(), generationPolicy.backupModel, nextConfigurations, gateways);
        return this.saveCredentials({
            defaultModel,
            providerConfigurations: { ...this.credentials.providerConfigurations, [config.provider]: config },
            ...(this.credentials.generationPolicy ? { generationPolicy } : {}),
            [`${config.provider}PreferredModel`]: config.model,
            ...(value.apiKey === undefined ? {} : { [`${config.provider}ApiKey`]: value.apiKey.trim() || undefined }),
        });
    }

    /** Creates a gateway without an id. A changed address origin needs the key entered again. */
    public setGatewayConfiguration(value: GatewayConfigurationSave): CredentialSaveResult & { gatewayId?: string } {
        if (!value || typeof value !== 'object') throw new Error('Invalid gateway');
        if (value.apiKey !== undefined && typeof value.apiKey !== 'string') throw new Error('Invalid API key');
        const gateways = this.getGateways(), configs = this.getProviderConfigurations();
        if (value.id !== undefined && !Object.hasOwn(gateways, value.id)) return { ok: false, code: 'write_failed', message: 'This gateway no longer exists. Reopen settings.' };
        let id = value.id;
        while (id === undefined || (value.id === undefined && Object.hasOwn(this.credentials.gateways ?? {}, id))) id = `gw-${randomUUID()}`;
        const { apiKey, ...rest } = value;
        const config = validateGatewayConfiguration({ ...rest, id });
        const previous = gateways[id];
        const key = apiKey?.trim();
        if (!previous && !key) return { ok: false, code: 'write_failed', message: 'Enter the gateway API key before saving.' };
        if (previous && new URL(previous.baseUrl).origin !== new URL(config.baseUrl).origin && !key) {
            return { ok: false, code: 'write_failed', message: 'Re-enter the API key after changing the gateway address. The previous configuration was kept.' };
        }
        const nextGateways = { ...gateways, [id]: config };
        let defaultModel = this.credentials.defaultModel;
        const generationPolicy = this.getGenerationPolicy();
        if (previous) {
            const before = { provider: 'gateway' as const, gatewayId: id, ...previous }, after = { provider: 'gateway' as const, gatewayId: id, ...config };
            const followed = this.followSavedTarget(this.getDefaultModel(), before, after);
            if (followed !== this.getDefaultModel()) defaultModel = followed;
            generationPolicy.backupModel = this.followSavedTarget(generationPolicy.backupModel, before, after);
        }
        if (generationPolicy.backupImageSupportConfirmedFor && generationPolicy.backupModel && !isCodexSelection(generationPolicy.backupModel)
            && !this.backupConfirmationValid(generationPolicy, configs, nextGateways)) delete generationPolicy.backupImageSupportConfirmedFor;
        this.assertDistinctSelections(defaultModel ?? this.getDefaultModel(), generationPolicy.backupModel, configs, nextGateways);
        const result = this.saveCredentials({
            gateways: { ...this.credentials.gateways, [id]: config },
            ...(key ? { gatewayKeys: { ...this.credentials.gatewayKeys, [id]: key } } : {}),
            defaultModel,
            ...(this.credentials.generationPolicy ? { generationPolicy } : {}),
        });
        return result.ok ? { ...result, gatewayId: id } : result;
    }

    /** Removes one gateway and its key only. A gateway still selected for answers is kept. */
    public removeGateway(id: string): CredentialSaveResult {
        if (typeof id !== 'string' || !Object.hasOwn(this.credentials.gateways ?? {}, id)) return { ok: false, code: 'write_failed', message: 'This gateway no longer exists. Reopen settings.' };
        const uses = (selection?: string) => { const parsed = selection ? parseModelSelection(selection) : undefined; return parsed?.kind === 'gateway' && parsed.gatewayId === id; };
        if (uses(this.credentials.defaultModel) || uses(this.credentials.generationPolicy?.backupModel)) {
            return { ok: false, code: 'write_failed', message: 'This gateway is selected as the primary or backup answer model. Choose another model first.' };
        }
        const { [id]: _gateway, ...gateways } = this.credentials.gateways!;
        const { [id]: _key, ...gatewayKeys } = this.credentials.gatewayKeys ?? {};
        return this.saveCredentials({ gateways, gatewayKeys });
    }

    // =========================================================================
    // Vision provider availability — used by the vision-first screen pipeline
    // =========================================================================

    /**
     * True if at least one configured provider is vision-capable.
     * Legacy capability query; it does not select or reorder generation targets.
     */
    public anyVisionProviderConfigured(): boolean {
        if (this.credentials.openaiApiKey) return true;          // gpt-4o / gpt-5 vision
        if (this.credentials.claudeApiKey) return true;          // Claude vision
        if (this.credentials.geminiApiKey) return true;          // Gemini vision
        if (this.credentials.groqApiKey) return true;            // Groq llama-4-scout vision
        return false; // An external login file is neither an API credential nor proof of vision support.
    }

    // =========================================================================
    // Setters (auto-save)
    // =========================================================================

    public setGeminiApiKey(key: string): CredentialSaveResult {
        return this.saveCredentials({ geminiApiKey: key });
    }

    public setGroqApiKey(key: string): CredentialSaveResult {
        return this.saveCredentials({ groqApiKey: key });
    }

    public setOpenaiApiKey(key: string): CredentialSaveResult {
        return this.saveCredentials({ openaiApiKey: key });
    }

    public setClaudeApiKey(key: string): CredentialSaveResult {
        return this.saveCredentials({ claudeApiKey: key });
    }

    public setDeepseekApiKey(key: string): CredentialSaveResult {
        const trimmed = key.trim();
        return this.saveCredentials({ deepseekApiKey: trimmed || undefined });
    }

    public setSttProvider(provider: NonNullable<StoredCredentials['sttProvider']>): CredentialSaveResult {
        if (!['none', 'groq', 'openai', 'soniox', 'aliyun', 'doubao'].includes(provider)) throw new Error('Invalid STT provider');
        return this.saveCredentials({ sttProvider: provider });
    }

    public setGroqSttApiKey(key: string): CredentialSaveResult {
        return this.saveCredentials({ groqSttApiKey: key });
    }

    public setOpenAiSttApiKey(key: string): CredentialSaveResult {
        return this.saveCredentials({ openAiSttApiKey: key });
    }

    public setOpenAiSttBaseUrl(url: string): CredentialSaveResult {
        // Store undefined (not empty string) when clearing, so callers can fall back
        // to the default api.openai.com endpoint with a simple truthiness check.
        const trimmed = validateSttBaseUrl(url);
        if (trimmed) openAiSttEndpoint(trimmed);
        return this.saveCredentials({ openAiSttBaseUrl: trimmed || undefined });
    }

    public setGroqSttModel(model: string): CredentialSaveResult {
        return this.saveCredentials({ groqSttModel: model });
    }

    public setSonioxApiKey(key: string): CredentialSaveResult {
        return this.saveCredentials({ sonioxApiKey: key });
    }

    public setSttLanguage(language: string): CredentialSaveResult {
        return this.saveCredentials({ sttLanguage: language });
    }

    public setAiResponseLanguage(language: string): CredentialSaveResult {
        return this.saveCredentials({ aiResponseLanguage: language });
    }
    public setDefaultModel(model: string, codexConfig = DEFAULT_CODEX_SOURCE_CONFIG, fast = false): CredentialSaveResult {
        const backup = this.getGenerationPolicy().backupModel;
        if (backup && this.generationSelectionId(backup, codexConfig) === this.generationSelectionId(model, codexConfig, fast && isCodexSelection(model))) throw new Error('Primary and backup model must differ. Change the backup first.');
        if (isCodexSelection(model) && model.startsWith('codex-cli:')) validateCodexModel(model.slice(10));
        if (!isCodexSelection(model)) this.resolveSelection(model);
        return this.saveCredentials({ defaultModel: model });
    }

    public getPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek'): string | undefined {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        return this.credentials[key] as string | undefined;
    }

    public setPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', modelId: string): CredentialSaveResult {
        return this.setProviderConfiguration({ ...this.getProviderConfigurations()[provider], model: modelId });
    }

    public getLoadStatus(): CredentialLoadStatus {
        if (!this.loadFailure) return { ok: true };
        return { ...this.loadFailure, canDiscard: this.unreadableOnDisk };
    }

    /**
     * Recovery after a decrypt failure, confirmed by the user in settings: the
     * unreadable file is moved aside unchanged (hard link, then unlink of the
     * original name) and an empty store becomes usable. Refused in every other
     * state, so it never removes a file that could still be read.
     */
    public discardUnreadableCredentials(): CredentialDiscardResult {
        if (!this.loadFailure || !this.unreadableOnDisk) {
            return { ok: false, message: 'There are no unreadable credentials to discard.' };
        }
        const backupName = `credentials.enc.unreadable-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        const backupPath = path.join(path.dirname(CREDENTIALS_PATH), backupName);
        try {
            fs.linkSync(CREDENTIALS_PATH, backupPath);
        } catch {
            return { ok: false, message: 'The unreadable credentials could not be backed up, so they were kept.' };
        }
        try {
            fs.unlinkSync(CREDENTIALS_PATH);
        } catch {
            try { fs.unlinkSync(backupPath); } catch { /* the original is still in place */ }
            return { ok: false, message: 'The unreadable credentials could not be set aside, so they were kept.' };
        }
        this.scrubMemory();
        this.unreadableOnDisk = false;
        this.loadFailure = undefined;
        return { ok: true, backupName };
    }

    public clearAll(): void {
        this.scrubMemory();
        if (fs.existsSync(CREDENTIALS_PATH)) {
            fs.unlinkSync(CREDENTIALS_PATH);
        }
        const plaintextPath = CREDENTIALS_PATH + '.json';
        if (fs.existsSync(plaintextPath)) {
            fs.unlinkSync(plaintextPath);
        }
        console.log('[CredentialsManager] All credentials cleared');
    }

    /**
     * Scrub all API keys from memory to minimize exposure window.
     * Called on app quit and credential clear.
     */
    public scrubMemory(): void {
        // Overwrite each string field with empty before discarding
        for (const key of Object.keys(this.credentials) as (keyof StoredCredentials)[]) {
            const val = this.credentials[key];
            if (typeof val === 'string') {
                (this.credentials as any)[key] = '';
            }
        }
        this.credentials = {};
        console.log('[CredentialsManager] Memory scrubbed');
    }

    // =========================================================================
    // Storage (Encrypted)
    // =========================================================================

    private saveCredentials(patch: Partial<StoredCredentials>): CredentialSaveResult {
        if (this.loadFailure) return this.loadFailure;
        let tmpEnc: string | undefined;
        let tempWritten = false;
        try {
            if (!safeStorage.isEncryptionAvailable()) {
                return { ok: false, code: 'encryption_unavailable', message: 'Secure storage is unavailable. Credentials were not saved.' };
            }
            const candidate = { ...this.credentials, ...patch };
            const encrypted = safeStorage.encryptString(JSON.stringify(candidate));
            tmpEnc = `${CREDENTIALS_PATH}.${randomUUID()}.tmp`;
            fs.writeFileSync(tmpEnc, encrypted, { mode: 0o600, flag: 'wx' });
            tempWritten = true;
            fs.renameSync(tmpEnc, CREDENTIALS_PATH);
            this.credentials = candidate;
            return { ok: true };
        } catch (error) {
            // An exclusive-create collision does not give us ownership of that file.
            if (!tempWritten && (error as NodeJS.ErrnoException)?.code === 'EEXIST') tmpEnc = undefined;
            return { ok: false, code: 'write_failed', message: 'Credentials could not be saved. The previous credentials were kept.' };
        } finally {
            if (tmpEnc) {
                try {
                    if (fs.existsSync(tmpEnc)) fs.unlinkSync(tmpEnc);
                } catch {
                    console.warn('[CredentialsManager] Could not remove the temporary encrypted file');
                }
            }
        }
    }

    private loadCredentials(): CredentialSaveResult {
        // Only bytes that were read and then failed to decrypt or parse count as
        // unreadable; a failed read may succeed later and is never discardable.
        let readBytes = false;
        try {
            if (fs.existsSync(CREDENTIALS_PATH)) {
                if (!safeStorage.isEncryptionAvailable()) {
                    this.scrubMemory();
                    this.loadFailure = { ok: false, code: 'encryption_unavailable', message: 'Secure storage is unavailable. Existing credentials were kept on disk; restart after restoring secure storage.' };
                    return this.loadFailure;
                }

                const encrypted = fs.readFileSync(CREDENTIALS_PATH);
                readBytes = true;
                const decrypted = safeStorage.decryptString(encrypted);
                const parsed = JSON.parse(decrypted);
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                    throw new Error('Invalid credentials object');
                }
                this.credentials = parsed;
            } else {
                this.credentials = {};
            }
            this.loadFailure = undefined;
            this.unreadableOnDisk = false;
            // Legacy plaintext is never read or used as a fallback.
            const plaintextPath = CREDENTIALS_PATH + '.json';
            if (fs.existsSync(plaintextPath)) {
                try {
                    fs.unlinkSync(plaintextPath);
                    console.log('[CredentialsManager] Removed plaintext credential file');
                } catch {
                    console.warn('[CredentialsManager] Could not remove plaintext credential file');
                }
            }

            return { ok: true };
        } catch {
            this.scrubMemory();
            this.unreadableOnDisk = readBytes;
            this.loadFailure = { ok: false, code: 'decrypt_failed', message: 'Stored credentials could not be read. The original file was kept and saving is blocked until it can be loaded or discarded.' };
            return this.loadFailure;
        }
    }
}
