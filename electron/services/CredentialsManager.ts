/**
 * CredentialsManager - Secure storage for API keys and service account paths
 * Uses Electron's safeStorage API for encryption at rest
 */

import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { CredentialDiscardResult, CredentialLoadStatus, CredentialSaveResult } from '../../src/types/credentialSave';
import { regionalSttEndpoint, openAiSttEndpoint } from './outbound';
import { GoogleServiceAccount, loadGoogleServiceAccount, validateGoogleServiceAccount } from './googleServiceAccount';

const CREDENTIALS_PATH = path.join(app.getPath('userData'), 'credentials.enc');

export interface StoredCredentials {
    geminiApiKey?: string;
    groqApiKey?: string;
    openaiApiKey?: string;
    claudeApiKey?: string;
    deepseekApiKey?: string;
    googleServiceAccountPath?: string;
    defaultModel?: string;
    // STT Provider settings
    sttProvider?: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox';
    groqSttApiKey?: string;
    groqSttModel?: string;
    openAiSttApiKey?: string;
    /** Custom OpenAI-compatible STT base URL (e.g. self-hosted Speaches).
     *  Empty / unset → use https://api.openai.com. */
    openAiSttBaseUrl?: string;
    deepgramApiKey?: string;
    elevenLabsApiKey?: string;
    azureApiKey?: string;
    azureRegion?: string;
    ibmWatsonApiKey?: string;
    ibmWatsonRegion?: string;
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

    public getGoogleServiceAccountPath(): string | undefined {
        return this.credentials.googleServiceAccountPath;
    }


    public getSttProvider(): 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' {
        // 'local-whisper' was retired with local STT (PLAN.md AG-15). Treat it as "no
        // provider" so audio is never sent to a cloud provider the user did not pick.
        const stored = this.credentials.sttProvider as string | undefined;
        if (stored === 'local-whisper') return 'none';
        return this.credentials.sttProvider || 'none';
    }

    public getDeepgramApiKey(): string | undefined {
        return this.credentials.deepgramApiKey;
    }

    public getGroqSttApiKey(): string | undefined {
        return this.credentials.groqSttApiKey;
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

    public getElevenLabsApiKey(): string | undefined {
        return this.credentials.elevenLabsApiKey;
    }

    public getAzureApiKey(): string | undefined {
        return this.credentials.azureApiKey;
    }

    public getAzureRegion(): string {
        return this.credentials.azureRegion || 'eastus';
    }

    public getIbmWatsonApiKey(): string | undefined {
        return this.credentials.ibmWatsonApiKey;
    }

    public getIbmWatsonRegion(): string {
        return this.credentials.ibmWatsonRegion || 'us-south';
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

    // =========================================================================
    // Vision provider availability — used by the vision-first screen pipeline
    // =========================================================================

    /**
     * True if at least one configured provider is vision-capable.
     * Used by ScreenUnderstandingService to gate vision_only / decide fallback.
     */
    public anyVisionProviderConfigured(): boolean {
        if (this.credentials.openaiApiKey) return true;          // gpt-4o / gpt-5 vision
        if (this.credentials.claudeApiKey) return true;          // Claude vision
        if (this.credentials.geminiApiKey) return true;          // Gemini vision
        if (this.credentials.groqApiKey) return true;            // Groq llama-4-scout vision
        // Codex CLI is counted as configured; its vision capability is verified by ProviderRouter.
        const codexCliPath = (this.credentials as any).codexCliPath as string | undefined;
        return !!(codexCliPath && codexCliPath.trim().length > 0);
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

    public setGoogleServiceAccountPath(filePath: string, account: GoogleServiceAccount = loadGoogleServiceAccount(filePath)): CredentialSaveResult {
        validateGoogleServiceAccount(account);
        return this.saveCredentials({ googleServiceAccountPath: filePath });
    }

    public setSttProvider(provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox'): CredentialSaveResult {
        if (!['none', 'google', 'groq', 'openai', 'deepgram', 'elevenlabs', 'azure', 'ibmwatson', 'soniox'].includes(provider)) throw new Error('Invalid STT provider');
        return this.saveCredentials({ sttProvider: provider });
    }

    public setDeepgramApiKey(key: string): CredentialSaveResult {
        return this.saveCredentials({ deepgramApiKey: key });
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
        const trimmed = url.trim();
        if (trimmed) openAiSttEndpoint(trimmed);
        return this.saveCredentials({ openAiSttBaseUrl: trimmed || undefined });
    }

    public setGroqSttModel(model: string): CredentialSaveResult {
        return this.saveCredentials({ groqSttModel: model });
    }

    public setElevenLabsApiKey(key: string): CredentialSaveResult {
        return this.saveCredentials({ elevenLabsApiKey: key });
    }

    public setAzureApiKey(key: string): CredentialSaveResult {
        return this.saveCredentials({ azureApiKey: key });
    }

    public setAzureRegion(region: string): CredentialSaveResult {
        regionalSttEndpoint('azure', region);
        return this.saveCredentials({ azureRegion: region });
    }

    public setIbmWatsonApiKey(key: string): CredentialSaveResult {
        return this.saveCredentials({ ibmWatsonApiKey: key });
    }

    public setIbmWatsonRegion(region: string): CredentialSaveResult {
        regionalSttEndpoint('ibmwatson', region);
        return this.saveCredentials({ ibmWatsonRegion: region });
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
    public setDefaultModel(model: string): CredentialSaveResult {
        return this.saveCredentials({ defaultModel: model });
    }

    public getPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek'): string | undefined {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        return this.credentials[key] as string | undefined;
    }

    public setPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', modelId: string): CredentialSaveResult {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        return this.saveCredentials({ [key]: modelId });
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
