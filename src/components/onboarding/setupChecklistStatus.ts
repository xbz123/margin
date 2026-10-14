import type { ElectronAPI } from '../../types/electron';
import { codexSourceAvailable, type CodexSourceConfig } from '../../types/codexSource';

export type SetupState = 'configured' | 'missing' | 'unknown' | 'reported-allowed';
export interface SetupChecklistStatus { answer: SetupState; speech: SetupState; permissions: SetupState }
export type SetupMetadataApi = Pick<ElectronAPI, 'getCurrentLlmConfig' | 'getStoredCredentials' | 'getDomesticStt' | 'getCodexCliConfig' | 'checkPermissions'>;
export const UNCHECKED_SETUP: SetupChecklistStatus = { answer: 'unknown', speech: 'unknown', permissions: 'unknown' };

function object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
async function readLocal(read: () => Promise<unknown>): Promise<Record<string, unknown> | undefined> {
    try { return object(await read()); } catch { return undefined; }
}
const keyState = (value: unknown): SetupState => value === true ? 'configured' : value === false ? 'missing' : 'unknown';

export async function readSetupChecklist(api: SetupMetadataApi | undefined): Promise<SetupChecklistStatus> {
    const result = { ...UNCHECKED_SETUP };
    if (!api) return result;
    const [selection, credentials, permissions] = await Promise.all([
        readLocal(() => api.getCurrentLlmConfig()), readLocal(() => api.getStoredCredentials()), readLocal(() => api.checkPermissions()),
    ]);
    // The legacy credentials read returns no providerConfigurations on failure.
    const configurations = object(credentials?.providerConfigurations);
    const keyFields: Record<string, string> = { gemini: 'hasGeminiKey', groq: 'hasGroqKey', openai: 'hasOpenaiKey', claude: 'hasClaudeKey', deepseek: 'hasDeepseekKey' };
    if (selection && typeof selection.model === 'string' && selection.model.trim()) {
        const provider = selection.provider;
        if (provider === 'codex-cli') {
            const config = await readLocal(() => api.getCodexCliConfig());
            if (config && typeof config.enabled === 'boolean' && typeof config.model === 'string' && config.model.trim()) {
                result.answer = codexSourceAvailable(config as unknown as CodexSourceConfig) ? 'configured' : 'missing';
            }
        } else if (provider === 'gateway') {
            const id = /^llm-gateway:([a-z0-9-]+):/.exec(selection.model)?.[1];
            const gateways = Array.isArray(credentials?.gateways) ? credentials.gateways as Record<string, unknown>[] : undefined;
            const gateway = gateways?.find(item => item?.id === id);
            if (gateways) result.answer = gateway ? keyState(gateway.hasKey) : 'missing';
        } else if (provider === 'unavailable' || provider === 'groq') {
            result.answer = 'missing';
        } else if (typeof provider === 'string' && Object.hasOwn(keyFields, provider) && configurations) {
            const target = object(configurations[provider]);
            if (target?.provider === provider && typeof target.model === 'string' && target.model.trim()
                && ['gemini', 'chat-completions', 'responses', 'messages'].includes(target.protocol as string)) {
                result.answer = keyState(credentials?.[keyFields[provider]]);
            }
        }
    } else if (selection && typeof selection.model === 'string') result.answer = 'missing';
    if (credentials && configurations) {
        const provider = credentials.sttProvider;
        const speechKeys: Record<string, string> = { openai: 'hasSttOpenaiKey', groq: 'hasSttGroqKey', soniox: 'hasSonioxKey' };
        if (provider === 'none') result.speech = 'missing';
        else if (typeof provider === 'string' && Object.hasOwn(speechKeys, provider)) result.speech = keyState(credentials[speechKeys[provider]]);
        else if (provider === 'aliyun' || provider === 'doubao') {
            const config = await readLocal(() => api.getDomesticStt(provider));
            if (config) {
                result.speech = keyState(config.hasKey);
                if (result.speech === 'configured') {
                    const validResource = provider === 'aliyun'
                        ? typeof config.workspaceId === 'string' && (config.workspaceId === '' || /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(config.workspaceId))
                        : config.resourceId === 'volc.seedasr.sauc.duration' || config.resourceId === 'volc.seedasr.sauc.concurrent';
                    if (!validResource) result.speech = 'unknown';
                }
            }
        }
    }
    const statuses = ['granted', 'denied', 'not-determined', 'restricted'];
    if (permissions?.platform === 'darwin' && statuses.includes(permissions.microphone as string) && statuses.includes(permissions.screen as string)) {
        result.permissions = permissions.microphone === 'granted' && permissions.screen === 'granted' ? 'reported-allowed' : 'missing';
    }
    return result;
}
