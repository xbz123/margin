import type { LlmProtocol, ModelTarget, ReasoningSetting } from './llmTarget';
import { officialCapability } from './modelCapabilities';

export { isOfficialEndpoint } from './modelCapabilities';

type ReasoningTarget = Pick<ModelTarget, 'provider' | 'protocol' | 'baseUrl' | 'model'>;

export type ThinkingMode = NonNullable<ReasoningSetting['thinking']>;
export interface ReasoningOptions {
  /** True only for an exact official model record (modelCapabilities). */
  verified: boolean;
  effort: readonly string[];
  thinking: readonly ThinkingMode[];
  /** DeepSeek: effort applies to thinking mode only. */
  effortRequiresThinking?: boolean;
}

// Values the protocol itself defines; gateways choose from these. A gateway may reject any of them.
const PROTOCOL_REASONING: Record<LlmProtocol, Omit<ReasoningOptions, 'verified'>> = {
  'chat-completions': { effort: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], thinking: [] },
  responses: { effort: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], thinking: [] },
  messages: { effort: ['low', 'medium', 'high', 'xhigh', 'max'], thinking: ['adaptive', 'disabled'] },
  gemini: { effort: ['minimal', 'low', 'medium', 'high'], thinking: [] },
};

/** Read-only vendor reference for the exact official target; undefined for gateways and unlisted models. */
export function officialModelCapacity(config: ReasoningTarget): { contextTokens: number; outputTokens: number } | undefined {
  const capacity = officialCapability(config)?.capacity;
  return capacity && { ...capacity };
}

/** Field values a gateway's own reasoning setting may use; official models use the reasoning control instead. */
export function reasoningOptions(config: ReasoningTarget): ReasoningOptions {
  const reasoning = officialCapability(config)?.reasoning;
  if (!reasoning) return { verified: false, ...PROTOCOL_REASONING[config.protocol] };
  const thinking = Array.from(new Set([reasoning.withThinking, reasoning.off?.thinking].filter((mode): mode is ThinkingMode => !!mode)));
  return { verified: true, effort: reasoning.levels, thinking, ...(reasoning.withThinking === 'enabled' ? { effortRequiresThinking: true } : {}) };
}

/** Shape only: an object with optional string effort/thinking and nothing else. */
export function reasoningShape(value: unknown): ReasoningSetting | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid reasoning setting');
  const { effort, thinking, ...rest } = value as ReasoningSetting;
  if (Object.keys(rest).length || (effort !== undefined && typeof effort !== 'string') || (thinking !== undefined && typeof thinking !== 'string')) throw new Error('Invalid reasoning setting');
  return effort === undefined && thinking === undefined ? undefined : { ...(thinking ? { thinking } : {}), ...(effort ? { effort } : {}) };
}

/** Rejects, never strips, a value the target cannot take. An empty setting means the provider default. */
export function validateReasoning(config: ReasoningTarget, value: unknown): ReasoningSetting | undefined {
  const setting = reasoningShape(value);
  if (!setting) return undefined;
  const { effort, thinking } = setting;
  const options = reasoningOptions(config);
  if (effort !== undefined && !options.effort.includes(effort)) throw new Error('This reasoning effort is not available for this model and protocol.');
  if (thinking !== undefined && !options.thinking.includes(thinking)) throw new Error('This thinking mode is not available for this model and protocol.');
  if (options.effortRequiresThinking && thinking === 'disabled' && effort !== undefined) throw new Error('Reasoning effort applies only with thinking enabled for this model.');
  return setting;
}
