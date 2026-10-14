/**
 * modelFetcher.ts - Dynamic Model Discovery
 * Fetches available models from AI provider APIs
 */

import { outboundAxios as axios } from '../services/outbound';
import { LLM_PRESETS, type ProviderConfiguration } from '../../src/types/llmTarget';
import { effectiveProviderConfiguration } from '../llm/llmTarget';

export interface ProviderModel {
    id: string;
    label: string;
}

type Provider = 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek';

/**
 * Fetch available models from a provider's API.
 * Returns a filtered, sorted array of { id, label } objects.
 */
export async function fetchProviderModels(
    provider: Provider,
    apiKey: string,
    configuration: ProviderConfiguration = LLM_PRESETS[provider],
): Promise<ProviderModel[]> {
    const target = effectiveProviderConfiguration(configuration);
    if (target.custom) {
        const suffix = target.protocol === 'gemini' ? '/v1alpha/models'
            : target.protocol === 'messages' && !/\/v\d+$/.test(target.baseUrl) ? '/v1/models' : '/models';
        const response = await axios.get(target.baseUrl + suffix, {
            headers: target.protocol === 'gemini' ? { 'x-goog-api-key': apiKey }
                : target.protocol === 'messages' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
                    : { Authorization: `Bearer ${apiKey}` },
            timeout: 15000,
        });
        const rows = target.protocol === 'gemini' ? response.data?.models : response.data?.data;
        if (!Array.isArray(rows)) throw new Error('Invalid model list response');
        return rows.filter((row: any) => typeof (row.id ?? row.name) === 'string').map((row: any) => ({
            id: row.id ?? row.name.replace(/^models\//, ''), label: row.display_name ?? row.displayName ?? row.id ?? row.name,
        }));
    }
    switch (provider) {
        case 'openai':
            return fetchOpenAIModels(apiKey);
        case 'groq':
            return fetchGroqModels(apiKey);
        case 'claude':
            return fetchAnthropicModels(apiKey);
        case 'gemini':
            return fetchGeminiModels(apiKey);
        case 'deepseek':
            return fetchDeepSeekModels(apiKey);
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
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

    // Use the upstream capability field, not a model-name/version allowlist.
    const filtered = models.filter(m => typeof m.name === 'string' && m.supportedGenerationMethods?.includes('generateContent'));

    return filtered
        .map((m: any) => {
            const id = (m.name || '').replace(/^models\//, '');
            return { id, label: m.displayName || id };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
}
