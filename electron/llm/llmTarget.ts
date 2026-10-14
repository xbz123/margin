import { LLM_PRESETS, LLM_PROTOCOLS, GATEWAY_ID_PATTERN, gatewayTarget, modelTargetId, parseModelSelection, type LlmProvider, type ProviderConfiguration, type ModelTarget, type GatewayConfiguration } from '../../src/types/llmTarget';
import { validateHttpEndpoint } from '../services/outbound';
import { devOpenAIBaseUrl } from '../margin/devOverrides';
import { imageSupportTarget } from '../../src/types/modelImageSupport';
import { validateReasoning } from '../../src/types/modelReasoning';

export const PROVIDER_BASE_URLS: Record<LlmProvider, string> = {
  gemini: 'https://generativelanguage.googleapis.com', groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1', claude: 'https://api.anthropic.com', deepseek: 'https://api.deepseek.com',
};

export const GROQ_ANSWERS_RETIRED = 'Groq is not available for answers. Select another answer model in Settings.';
export const OFFICIAL_ADDRESS_ONLY = 'Official providers use their built-in address. Add a gateway for a custom address.';
export const GATEWAY_MISSING = 'The selected gateway no longer exists. Select another answer model in Settings.';

const ENVIRONMENT_BASE_URLS: Partial<Record<LlmProvider, string>> = {
  openai: 'OPENAI_BASE_URL', groq: 'GROQ_BASE_URL', claude: 'ANTHROPIC_BASE_URL', gemini: 'GOOGLE_GEMINI_BASE_URL',
};

function normalizedBase(value: string, protocol: ProviderConfiguration['protocol']): string {
  const parsed = new URL(validateHttpEndpoint(value.trim()));
  if (parsed.search) throw new Error('Base URL must not contain query parameters');
  if (protocol === 'gemini' && /\/v\d+(?:alpha|beta)?$/.test(parsed.pathname.replace(/\/+$/, ''))) throw new Error('Gemini base URL must not include an API version; requests use v1alpha.');
  return parsed.href.replace(/\/+$/, '');
}

function validModel(model: unknown): string {
  if (typeof model !== 'string' || !model.trim() || model.length > 512 || /[\x00-\x1f\x7f]/.test(model)) throw new Error('Invalid model ID');
  return model.trim();
}

function validContextWindow(value: unknown): number | undefined {
  if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) <= 0)) throw new Error('Context window must be a positive whole number of tokens.');
  return value as number | undefined;
}

export function validateProviderConfiguration(value: ProviderConfiguration): ProviderConfiguration {
  if (!value || !Object.hasOwn(LLM_PRESETS, value.provider)) throw new Error('Unknown LLM provider');
  const expected = LLM_PRESETS[value.provider].protocol;
  if (value.protocol !== expected && !(value.provider === 'openai' && value.protocol === 'responses')) throw new Error('Unsupported provider protocol');
  const config = { provider: value.provider, protocol: value.protocol, model: validModel(value.model) };
  // Writing the official address itself is accepted and stored as "no address".
  if (value.baseUrl && normalizedBase(value.baseUrl, value.protocol) !== PROVIDER_BASE_URLS[value.provider]) throw new Error(OFFICIAL_ADDRESS_ONLY);
  if (value.imageSupportConfirmedFor !== undefined && typeof value.imageSupportConfirmedFor !== 'string') throw new Error('Invalid image support confirmation');
  const reasoning = validateReasoning(config, value.reasoning);
  if (value.contextWindowTokens !== undefined) throw new Error('A context window can only be noted for a gateway.');
  return { ...config, ...(value.imageSupportConfirmedFor === imageSupportTarget(config) ? { imageSupportConfirmedFor: value.imageSupportConfirmedFor } : {}),
    ...(reasoning ? { reasoning } : {}) };
}

export function validateGatewayConfiguration(value: GatewayConfiguration): GatewayConfiguration {
  if (!value || typeof value.id !== 'string' || !GATEWAY_ID_PATTERN.test(value.id)) throw new Error('Invalid gateway');
  if (!LLM_PROTOCOLS.includes(value.protocol)) throw new Error('Unsupported gateway protocol');
  if (typeof value.baseUrl !== 'string' || !value.baseUrl.trim()) throw new Error('Enter the gateway URL.');
  const config = { id: value.id, protocol: value.protocol, baseUrl: normalizedBase(value.baseUrl, value.protocol), model: validModel(value.model) };
  if (value.imageSupportConfirmedFor !== undefined && typeof value.imageSupportConfirmedFor !== 'string') throw new Error('Invalid image support confirmation');
  const target = gatewayTarget(config);
  const reasoning = validateReasoning(target, value.reasoning);
  const contextWindow = validContextWindow(value.contextWindowTokens);
  return { ...config, ...(value.imageSupportConfirmedFor === imageSupportTarget(target) ? { imageSupportConfirmedFor: value.imageSupportConfirmedFor } : {}),
    ...(reasoning ? { reasoning } : {}), ...(contextWindow !== undefined ? { contextWindowTokens: contextWindow } : {}) };
}

/**
 * Name of a production environment variable that would have redirected this official provider.
 * It is never applied: the provider is blocked until it is removed, so neither a saved key nor an
 * environment key reaches an address the user did not choose. The development loopback override wins.
 */
export function blockedEnvironmentOverride(provider: LlmProvider): string | undefined {
  if (provider === 'openai' && devOpenAIBaseUrl()) return undefined;
  const variable = ENVIRONMENT_BASE_URLS[provider];
  const value = variable ? process.env[variable]?.trim() : undefined;
  if (!variable || !value) return undefined;
  let base = value;
  try { base = new URL(value).href.replace(/\/+$/, ''); } catch { return variable; }
  // The legacy Groq variable named an SDK host root.
  const official = provider === 'groq' ? [PROVIDER_BASE_URLS.groq, 'https://api.groq.com'] : [PROVIDER_BASE_URLS[provider]];
  return official.includes(base) ? undefined : variable;
}

export function effectiveProviderConfiguration(config: ProviderConfiguration): ProviderConfiguration & { baseUrl: string; custom: boolean } {
  const validated = validateProviderConfiguration(config);
  // Only the documented development loopback hook may move an official provider (tests).
  const dev = config.provider === 'openai' ? devOpenAIBaseUrl() : undefined;
  const baseUrl = dev ? normalizedBase(dev, validated.protocol) : PROVIDER_BASE_URLS[config.provider];
  return { ...validated, baseUrl, custom: baseUrl !== PROVIDER_BASE_URLS[config.provider] };
}

/** Another model of the same provider never inherits the configured model's settings. */
function forModel(config: ProviderConfiguration, model: string): ProviderConfiguration {
  if (model === config.model) return config;
  const { reasoning: _reasoning, contextWindowTokens: _window, imageSupportConfirmedFor: _image, ...rest } = config;
  return { ...rest, model };
}

export function resolveModelTarget(id: string, configs: Record<LlmProvider, ProviderConfiguration>, gateways: Record<string, GatewayConfiguration> = {}): ModelTarget {
  if (id.startsWith('llm-target:') || id.startsWith('llm-gateway:')) {
    const parsed = parseModelSelection(id);
    if (!parsed) throw new Error('Invalid model target');
    if (parsed.kind === 'gateway') {
      const gateway = Object.hasOwn(gateways, parsed.gatewayId) ? gateways[parsed.gatewayId] : undefined;
      if (!gateway) throw new Error(GATEWAY_MISSING);
      if (parsed.protocol !== gateway.protocol) throw new Error('Gateway protocol changed. Select the model again.');
      return gatewayTarget(validateGatewayConfiguration(gateway), parsed.model);
    }
    if (parsed.provider === 'groq') throw new Error(GROQ_ANSWERS_RETIRED);
    const config = configs[parsed.provider];
    if (parsed.protocol !== config.protocol) throw new Error('Model target protocol changed. Select the model again.');
    return validateProviderConfiguration(forModel(config, parsed.model));
  }
  const aliases: Record<string, string> = { gemini: LLM_PRESETS.gemini.model, 'gemini-pro': 'gemini-3.1-pro-preview', claude: LLM_PRESETS.claude.model, llama: LLM_PRESETS.groq.model, deepseek: LLM_PRESETS.deepseek.model };
  const model = aliases[id] ?? id;
  const configured = Object.values(configs).filter(c => c.model === model);
  const known: Record<string, LlmProvider> = { 'gemini-3.1-pro-preview': 'gemini', 'deepseek-v4-pro': 'deepseek' };
  for (const preset of Object.values(LLM_PRESETS)) known[preset.model] = preset.provider;
  if (configured.length > 1) throw new Error('Model ID is ambiguous. Select its provider explicitly.');
  const config = configured[0] ?? (known[model] ? configs[known[model]] : undefined);
  if (!config) throw new Error('Unknown model ID. Configure and select its provider first.');
  if (config.provider === 'groq') throw new Error(GROQ_ANSWERS_RETIRED);
  return forModel(config, model);
}

/**
 * Where a canonical selection points after one target was explicitly saved: a selection of that
 * target's configured model follows it; one of another model on its old protocol keeps the model
 * on the new protocol. Everything else is returned unchanged.
 */
export function followSelection(selection: string, previous: ModelTarget, next: ModelTarget): string {
  const parsed = parseModelSelection(selection);
  const same = parsed && (previous.provider === 'gateway' ? parsed.kind === 'gateway' && parsed.gatewayId === previous.gatewayId
    : parsed.kind === 'official' && parsed.provider === previous.provider);
  if (!parsed || !same || parsed.protocol !== previous.protocol) return selection;
  if (parsed.model === previous.model) return modelTargetId(next);
  return previous.protocol !== next.protocol ? modelTargetId({ ...next, model: parsed.model }) : selection;
}
