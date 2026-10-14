import { LLM_PRESETS, type LlmProvider, type ProviderConfiguration, type ModelTarget } from '../../src/types/llmTarget';
import { validateHttpEndpoint } from '../services/outbound';
import { devOpenAIBaseUrl } from '../margin/devOverrides';
import { imageSupportTarget } from '../../src/types/modelImageSupport';
import { isOfficialEndpoint, validateReasoning } from '../../src/types/modelReasoning';

export const PROVIDER_BASE_URLS: Record<LlmProvider, string> = {
  gemini: 'https://generativelanguage.googleapis.com', groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1', claude: 'https://api.anthropic.com', deepseek: 'https://api.deepseek.com',
};

export function validateProviderConfiguration(value: ProviderConfiguration): ProviderConfiguration {
  if (!value || !Object.hasOwn(LLM_PRESETS, value.provider)) throw new Error('Unknown LLM provider');
  const expected = LLM_PRESETS[value.provider].protocol;
  if (value.protocol !== expected && !(value.provider === 'openai' && value.protocol === 'responses')) throw new Error('Unsupported provider protocol');
  if (typeof value.model !== 'string' || !value.model.trim() || value.model.length > 512 || /[\x00-\x1f\x7f]/.test(value.model)) throw new Error('Invalid model ID');
  let baseUrl: string | undefined;
  if (value.baseUrl) {
    const parsed = new URL(validateHttpEndpoint(value.baseUrl.trim()));
    if (parsed.search) throw new Error('Base URL must not contain query parameters');
    baseUrl = parsed.href.replace(/\/+$/, '');
    if (value.protocol === 'gemini' && /\/v\d+(?:alpha|beta)?$/.test(parsed.pathname.replace(/\/+$/, ''))) throw new Error('Gemini base URL must not include an API version; requests use v1alpha.');
  }
  const config = { provider: value.provider, protocol: value.protocol, model: value.model.trim(), ...(baseUrl ? { baseUrl } : {}) };
  if (value.imageSupportConfirmedFor !== undefined && typeof value.imageSupportConfirmedFor !== 'string') throw new Error('Invalid image support confirmation');
  const reasoning = validateReasoning(config, value.reasoning);
  const contextWindow = value.contextWindowTokens;
  if (contextWindow !== undefined && (!Number.isSafeInteger(contextWindow) || contextWindow <= 0)) throw new Error('Context window must be a positive whole number of tokens.');
  if (contextWindow !== undefined && isOfficialEndpoint(config)) throw new Error('A context window can only be noted for a custom endpoint.');
  return { ...config, ...(value.imageSupportConfirmedFor === imageSupportTarget(config) ? { imageSupportConfirmedFor: value.imageSupportConfirmedFor } : {}),
    ...(reasoning ? { reasoning } : {}), ...(contextWindow !== undefined ? { contextWindowTokens: contextWindow } : {}) };
}

/** Another model of the same provider never inherits the configured model's settings. */
function forModel(config: ProviderConfiguration, model: string): ProviderConfiguration {
  if (model === config.model) return config;
  const { reasoning: _reasoning, contextWindowTokens: _window, ...rest } = config;
  return { ...rest, model };
}

export function effectiveProviderConfiguration(config: ProviderConfiguration): ProviderConfiguration & { baseUrl: string; custom: boolean } {
  const validated = validateProviderConfiguration(config);
  const env = config.provider === 'openai' ? devOpenAIBaseUrl() ?? process.env.OPENAI_BASE_URL
    : config.provider === 'groq' ? process.env.GROQ_BASE_URL : config.provider === 'claude' ? process.env.ANTHROPIC_BASE_URL
      : config.provider === 'gemini' ? process.env.GOOGLE_GEMINI_BASE_URL : undefined;
  let baseUrl = validated.baseUrl ?? env ?? PROVIDER_BASE_URLS[config.provider];
  // Legacy GROQ_BASE_URL is an SDK host root; saved UI bases are already API roots.
  if (config.provider === 'groq' && !validated.baseUrl && env) baseUrl = env.replace(/\/+$/, '') + '/openai/v1';
  baseUrl = validateProviderConfiguration({ ...validated, baseUrl }).baseUrl!;
  return { ...validated, baseUrl, custom: baseUrl !== PROVIDER_BASE_URLS[config.provider] };
}

export function resolveModelTarget(id: string, configs: Record<LlmProvider, ProviderConfiguration>): ModelTarget {
  if (id.startsWith('llm-target:')) {
    const match = /^llm-target:(gemini|groq|openai|claude|deepseek):(gemini|chat-completions|responses|messages):(.+)$/.exec(id);
    if (!match) throw new Error('Invalid model target');
    const config = configs[match[1] as LlmProvider];
    if (match[2] !== config.protocol) throw new Error('Model target protocol changed. Select the model again.');
    return validateProviderConfiguration(forModel(config, decodeURIComponent(match[3])));
  }
  const aliases: Record<string, string> = { gemini: LLM_PRESETS.gemini.model, 'gemini-pro': 'gemini-3.1-pro-preview', claude: LLM_PRESETS.claude.model, llama: LLM_PRESETS.groq.model, deepseek: LLM_PRESETS.deepseek.model };
  const model = aliases[id] ?? id;
  const configured = Object.values(configs).filter(c => c.model === model);
  const known: Record<string, LlmProvider> = { 'gemini-3.1-pro-preview': 'gemini', 'deepseek-v4-pro': 'deepseek' };
  for (const preset of Object.values(LLM_PRESETS)) known[preset.model] = preset.provider;
  if (configured.length > 1) throw new Error('Model ID is ambiguous. Select its provider explicitly.');
  const config = configured[0] ?? (known[model] ? configs[known[model]] : undefined);
  if (!config) throw new Error('Unknown model ID. Configure and select its provider first.');
  return forModel(config, model);
}
