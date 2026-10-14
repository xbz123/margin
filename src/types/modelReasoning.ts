import type { LlmProtocol, ModelTarget, ProviderConfiguration, ReasoningSetting } from './llmTarget';

type ReasoningTarget = Pick<ModelTarget, 'provider' | 'protocol' | 'baseUrl' | 'model'>;
import { PROVIDER_IMAGE_ENDPOINTS } from './modelImageSupport';

export type ThinkingMode = NonNullable<ReasoningSetting['thinking']>;
export interface ReasoningOptions {
  /** True only for an exact vendor endpoint and model ID listed below. */
  verified: boolean;
  effort: readonly string[];
  thinking: readonly ThinkingMode[];
  /** DeepSeek: effort applies to thinking mode only. */
  effortRequiresThinking?: boolean;
}
interface OfficialModel {
  contextTokens: number;
  outputTokens: number;
  /** Omitted: the vendor documents no reasoning values for this model, so it stays unverified. */
  reasoning?: Omit<ReasoningOptions, 'verified'>;
}

// Exact vendor endpoints and model IDs only; a compatible server is not the vendor.
// Read from public vendor documentation on 2026-10-14 (see the S44 evidence):
// OpenAI developers.openai.com/api/docs/models/gpt-5.4; Anthropic platform.claude.com
// models/sonnet-4-6 and build-with-claude/effort; Google ai.google.dev gemini-api/docs/models
// and docs/thinking; Groq console.groq.com/docs/models and docs/reasoning; DeepSeek
// api-docs.deepseek.com quick_start/pricing and guides/thinking_mode.
const OFFICIAL_MODELS: Record<ProviderConfiguration['provider'], Record<string, OfficialModel>> = {
  gemini: {
    'gemini-3.1-flash-lite-preview': { contextTokens: 1_048_576, outputTokens: 65_536 },
    'gemini-3.1-pro-preview': { contextTokens: 1_048_576, outputTokens: 65_536, reasoning: { effort: ['low', 'medium', 'high'], thinking: [] } },
  },
  groq: {
    'llama-3.3-70b-versatile': { contextTokens: 131_072, outputTokens: 32_768, reasoning: { effort: [], thinking: [] } },
    'openai/gpt-oss-120b': { contextTokens: 131_072, outputTokens: 65_536, reasoning: { effort: ['low', 'medium', 'high'], thinking: [] } },
    'openai/gpt-oss-20b': { contextTokens: 131_072, outputTokens: 65_536, reasoning: { effort: ['low', 'medium', 'high'], thinking: [] } },
  },
  openai: {
    'gpt-5.4': { contextTokens: 1_050_000, outputTokens: 128_000, reasoning: { effort: ['none', 'low', 'medium', 'high', 'xhigh'], thinking: [] } },
  },
  claude: {
    'claude-sonnet-4-6': { contextTokens: 1_000_000, outputTokens: 128_000, reasoning: { effort: ['low', 'medium', 'high', 'max'], thinking: ['adaptive', 'disabled'] } },
  },
  deepseek: {
    // Legacy ID, served by DeepSeek-V4.1-Flash.
    'deepseek-v4-flash': { contextTokens: 1_000_000, outputTokens: 384_000, reasoning: { effort: ['low', 'high', 'max'], thinking: ['enabled', 'disabled'], effortRequiresThinking: true } },
  },
};

// Values the protocol itself defines. A gateway or an unlisted model may reject any of them.
const PROTOCOL_REASONING: Record<LlmProtocol, Omit<ReasoningOptions, 'verified'>> = {
  'chat-completions': { effort: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], thinking: [] },
  responses: { effort: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], thinking: [] },
  messages: { effort: ['low', 'medium', 'high', 'xhigh', 'max'], thinking: ['adaptive', 'disabled'] },
  gemini: { effort: ['minimal', 'low', 'medium', 'high'], thinking: [] },
};

export function isOfficialEndpoint(config: Pick<ModelTarget, 'provider' | 'baseUrl'>): boolean {
  if (config.provider === 'gateway') return false;
  const base = new URL(config.baseUrl?.trim() || PROVIDER_IMAGE_ENDPOINTS[config.provider]).href.replace(/\/+$/, '');
  return base === PROVIDER_IMAGE_ENDPOINTS[config.provider];
}

/** Read-only vendor reference for the exact official target; undefined for gateways and unlisted models. */
export function officialModelCapacity(config: ReasoningTarget): { contextTokens: number; outputTokens: number } | undefined {
  const entry = config.provider !== 'gateway' && isOfficialEndpoint(config) ? OFFICIAL_MODELS[config.provider]?.[config.model.trim()] : undefined;
  return entry && { contextTokens: entry.contextTokens, outputTokens: entry.outputTokens };
}

export function reasoningOptions(config: ReasoningTarget): ReasoningOptions {
  const entry = config.provider !== 'gateway' && isOfficialEndpoint(config) ? OFFICIAL_MODELS[config.provider]?.[config.model.trim()] : undefined;
  return entry?.reasoning ? { verified: true, ...entry.reasoning } : { verified: false, ...PROTOCOL_REASONING[config.protocol] };
}

/** Rejects, never strips, a value the target cannot take. An empty setting means the provider default. */
export function validateReasoning(config: ReasoningTarget, value: unknown): ReasoningSetting | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid reasoning setting');
  const { effort, thinking, ...rest } = value as ReasoningSetting;
  if (Object.keys(rest).length) throw new Error('Invalid reasoning setting');
  const options = reasoningOptions(config);
  if (effort !== undefined && !options.effort.includes(effort)) throw new Error('This reasoning effort is not available for this model and protocol.');
  if (thinking !== undefined && !options.thinking.includes(thinking)) throw new Error('This thinking mode is not available for this model and protocol.');
  if (options.effortRequiresThinking && thinking === 'disabled' && effort !== undefined) throw new Error('Reasoning effort applies only with thinking enabled for this model.');
  return effort === undefined && thinking === undefined ? undefined : { ...(thinking ? { thinking } : {}), ...(effort ? { effort } : {}) };
}
