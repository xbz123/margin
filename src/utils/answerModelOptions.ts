import { ANSWER_PROVIDERS, LLM_PRESETS, gatewayTarget, modelTargetId, parseModelSelection, type AnswerProvider, type GatewaySummary, type LlmProtocol, type LlmProvider, type ProviderConfiguration } from '../types/llmTarget';

export const PROVIDER_NAMES: Record<LlmProvider, string> = { gemini: 'Gemini', groq: 'Groq', openai: 'OpenAI', claude: 'Claude', deepseek: 'DeepSeek' };
export const PROTOCOL_NAMES: Record<LlmProtocol, string> = { 'chat-completions': 'OpenAI Chat Completions', responses: 'OpenAI Responses', messages: 'Anthropic Messages', gemini: 'Gemini' };
const KEY_FIELDS: Record<AnswerProvider, string> = { gemini: 'hasGeminiKey', openai: 'hasOpenaiKey', claude: 'hasClaudeKey', deepseek: 'hasDeepseekKey' };

export interface AnswerModelOption { id: string; name: string; source: AnswerProvider | 'gateway' }

/** Host and protocol, so several gateways stay distinguishable without a rename feature. */
export function gatewayLabel(gateway: Pick<GatewaySummary, 'baseUrl' | 'protocol'>): string {
    let host = gateway.baseUrl;
    try { host = new URL(gateway.baseUrl).host; } catch { /* shown as saved */ }
    return `${host} · ${PROTOCOL_NAMES[gateway.protocol]}`;
}

export interface AnswerSources {
    providerConfigurations?: Partial<Record<LlmProvider, ProviderConfiguration>>;
    gateways?: GatewaySummary[];
    providerAddressOverrides?: Partial<Record<LlmProvider, string>>;
    [key: string]: unknown;
}

/** Usable answer targets only: official providers with a saved key, and gateways with their own key. Groq is not offered. */
export function answerModelOptions(sources: AnswerSources | undefined): AnswerModelOption[] {
    const options: AnswerModelOption[] = [];
    for (const provider of ANSWER_PROVIDERS) {
        if (sources?.[KEY_FIELDS[provider]] !== true || sources.providerAddressOverrides?.[provider]) continue;
        const target = sources.providerConfigurations?.[provider] ?? LLM_PRESETS[provider];
        options.push({ id: modelTargetId(target), name: `${target.model} (${PROVIDER_NAMES[provider]})`, source: provider });
    }
    for (const gateway of sources?.gateways ?? []) {
        if (gateway.hasKey) options.push({ id: modelTargetId(gatewayTarget(gateway)), name: `${gateway.model} (${gatewayLabel(gateway)})`, source: 'gateway' });
    }
    return options;
}

/** A readable name for any saved selection, including ones that are no longer offered. */
export function answerModelLabel(id: string, gateways: GatewaySummary[] = []): string {
    const parsed = parseModelSelection(id);
    if (!parsed) return id;
    if (parsed.kind === 'official') return `${parsed.model} (${PROVIDER_NAMES[parsed.provider]})`;
    const gateway = gateways.find(item => item.id === parsed.gatewayId);
    return `${parsed.model} (${gateway ? gatewayLabel(gateway) : 'gateway'})`;
}
