/**
 * modelFetcher.ts - Dynamic Model Discovery
 * Fetches available models from AI provider APIs
 */

import { outboundAxios as axios } from '../services/outbound';
import { LLM_PRESETS, type GatewayConfiguration, type LlmProtocol, type ProviderConfiguration } from '../../src/types/llmTarget';
import { effectiveProviderConfiguration, validateGatewayConfiguration } from '../llm/llmTarget';
import { isOfficialAnswerCandidate } from '../../src/types/modelCapabilities';

export interface ProviderModel {
    id: string;
    label: string;
}

type Provider = 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek';

/** Lists models at a compatible address with the request shape its protocol defines. */
async function fetchCompatibleModels(protocol: LlmProtocol, baseUrl: string, apiKey: string): Promise<ProviderModel[]> {
    const suffix = protocol === 'gemini' ? '/v1alpha/models'
        : protocol === 'messages' && !/\/v\d+$/.test(baseUrl) ? '/v1/models' : '/models';
    const response = await axios.get(baseUrl + suffix, {
        headers: protocol === 'gemini' ? { 'x-goog-api-key': apiKey }
            : protocol === 'messages' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
                : { Authorization: `Bearer ${apiKey}` },
        timeout: 15000,
    });
    const rows = protocol === 'gemini' ? response.data?.models : response.data?.data;
    if (!Array.isArray(rows)) throw new Error('Invalid model list response');
    return rows.filter((row: any) => typeof (row.id ?? row.name) === 'string').map((row: any) => ({
        id: row.id ?? row.name.replace(/^models\//, ''), label: row.display_name ?? row.displayName ?? row.id ?? row.name,
    }));
}

/** A gateway is listed through its own address and protocol only, never an official endpoint. */
export async function fetchGatewayModels(gateway: GatewayConfiguration, apiKey: string): Promise<ProviderModel[]> {
    const target = validateGatewayConfiguration(gateway);
    return fetchCompatibleModels(target.protocol, target.baseUrl, apiKey);
}

/**
 * Fetch available models from an official provider's API.
 * Returns a filtered, sorted array of { id, label } objects.
 */
export async function fetchProviderModels(
    provider: Provider,
    apiKey: string,
    configuration: ProviderConfiguration = LLM_PRESETS[provider],
): Promise<ProviderModel[]> {
    const target = effectiveProviderConfiguration(configuration);
    // Only the development loopback override can make an official provider custom.
    if (target.custom) return fetchCompatibleModels(target.protocol, target.baseUrl, apiKey);
    let models: ProviderModel[];
    switch (provider) {
        case 'openai':
            models = await fetchOpenAIModels(apiKey); break;
        case 'groq':
            return fetchGroqModels(apiKey);
        case 'claude':
            models = await fetchAnthropicModels(apiKey); break;
        case 'gemini':
            models = await fetchGeminiModels(apiKey); break;
        case 'deepseek':
            models = await fetchDeepSeekModels(apiKey); break;
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
    // Intersect the account's list with reviewed answer capabilities; never invent account access.
    return models.filter(model => isOfficialAnswerCandidate({ ...target, model: model.id }));
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

async function fetchOpenAIModels(apiKey: string): Promise<ProviderModel[]> {
    const response = await axios.get('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15000,
    });

    const models: any[] = response.data?.data;
    if (!Array.isArray(models)) throw new Error('Invalid model list response');
    return models.filter(m => typeof m.id === 'string')
        .map((m: any) => ({ id: m.id, label: m.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

// ─── Groq ────────────────────────────────────────────────────────────────────

async function fetchGroqModels(apiKey: string): Promise<ProviderModel[]> {
    const response = await axios.get('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15000,
    });

    const models: any[] = response.data?.data;
    if (!Array.isArray(models)) throw new Error('Invalid model list response');
    return models.filter(m => typeof m.id === 'string')
        .map((m: any) => ({ id: m.id, label: m.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

// ─── Anthropic ───────────────────────────────────────────────────────────────

async function fetchAnthropicModels(apiKey: string): Promise<ProviderModel[]> {
    const models: any[] = [];
    let after: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const response = await axios.get('https://api.anthropic.com/v1/models', {
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        timeout: 15000,
        params: { limit: 100, ...(after ? { after_id: after } : {}) },
      });
      if (!Array.isArray(response.data?.data)) throw new Error('Invalid model list response');
      models.push(...response.data.data);
      if (!response.data.has_more) break;
      after = response.data.last_id;
      if (typeof after !== 'string' || !after || seen.has(after) || page === 19) throw new Error('Incomplete model list response');
      seen.add(after);
    }

    return models.filter(m => typeof m.id === 'string')
        .map((m: any) => ({ id: m.id, label: m.display_name || m.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

// ─── DeepSeek ────────────────────────────────────────────────────────────────

async function fetchDeepSeekModels(apiKey: string): Promise<ProviderModel[]> {
        const response = await axios.get('https://api.deepseek.com/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: 15000,
        });

        const models: any[] = response.data?.data;
        if (!Array.isArray(models)) throw new Error('Invalid model list response');

        return models.filter(m => typeof m.id === 'string')
            .map((m: any) => ({ id: m.id, label: m.id }))
            .sort((a, b) => a.label.localeCompare(b.label));
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

async function fetchGeminiModels(apiKey: string): Promise<ProviderModel[]> {
    const models: any[] = [];
    let token: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const response = await axios.get(
        'https://generativelanguage.googleapis.com/v1beta/models',
        {
            headers: { 'x-goog-api-key': apiKey },
            params: { pageSize: 100, ...(token ? { pageToken: token } : {}) },
            timeout: 15000,
        }
      );
      if (!Array.isArray(response.data?.models)) throw new Error('Invalid model list response');
      models.push(...response.data.models);
      token = response.data.nextPageToken;
      if (!token) break;
      if (typeof token !== 'string' || seen.has(token) || page === 19) throw new Error('Incomplete model list response');
      seen.add(token);
    }

    // First require the upstream operation; the shared official answer catalogue is applied above.
    const filtered = models.filter(m => typeof m.name === 'string' && m.supportedGenerationMethods?.includes('generateContent'));

    return filtered
        .map((m: any) => {
            const id = (m.name || '').replace(/^models\//, '');
            return { id, label: m.displayName || id };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
}
