import type { LlmProtocol, LlmProvider, ModelTarget, ReasoningSetting } from './llmTarget';

/**
 * Official model capabilities (S48): one record per exact model ID, read by the image guard, the
 * reasoning control and the capacity reference. Matching needs the official endpoint, a listed
 * protocol and the exact ID; nothing is inferred from a name or prefix. A model that is not listed,
 * or a gateway or development endpoint with the same ID, is unknown. A record is not a promise
 * that the account can call the model. Sources were read on the date in VERIFIED_ON.
 */

export const OFFICIAL_ENDPOINTS: Record<LlmProvider, string> = {
  gemini: 'https://generativelanguage.googleapis.com', groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1', claude: 'https://api.anthropic.com', deepseek: 'https://api.deepseek.com',
};

export type ReasoningLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** 'default' sends no reasoning field; 'off' is offered only where the vendor documents turning reasoning off. */
export type ReasoningChoice = 'default' | 'off' | ReasoningLevel;
export const REASONING_CHOICES: readonly ReasoningChoice[] = ['default', 'off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export interface ModelCapability {
  provider: LlmProvider;
  protocols: readonly LlmProtocol[];
  /** true / false as documented; undefined when the vendor page does not say. */
  images: boolean | undefined;
  reasoning?: {
    /** Native effort values, sent as written. */
    levels: readonly ReasoningLevel[];
    /** Thinking mode sent together with an explicit level, where the vendor requires one. */
    withThinking?: 'adaptive' | 'enabled';
    /** The documented way to turn reasoning off; omitted where it cannot be turned off. */
    off?: ReasoningSetting;
    /** The model may reason with no reasoning field (connection tests leave it room). */
    reasonsByDefault: boolean;
  };
  capacity?: { contextTokens: number; outputTokens: number };
  /** Shown to the user; the model stays selectable and is never replaced automatically. */
  retired?: string;
  /** Documented capabilities can be retained even when this app cannot execute the model's answer mode. */
  answerUnavailable?: string;
  sources: readonly string[];
}

export const VERIFIED_ON = '2026-10-23';
const OPENAI = ['chat-completions', 'responses'] as const;
const OPENAI_CAPACITY = { contextTokens: 1_050_000, outputTokens: 128_000 };
const CLAUDE_CAPACITY = { contextTokens: 1_000_000, outputTokens: 128_000 };
const CLAUDE_SOURCES = ['https://platform.claude.com/docs/en/models/overview', 'https://platform.claude.com/docs/en/build-with-claude/effort',
  'https://platform.claude.com/docs/en/build-with-claude/thinking'];
const GEMINI_THINKING = 'https://ai.google.dev/gemini-api/docs/generate-content/thinking';
const DEEPSEEK_SOURCES = ['https://api-docs.deepseek.com/quick_start/pricing/', 'https://api-docs.deepseek.com/guides/thinking_mode/'];
const DEEPSEEK_REASONING = { levels: ['low', 'high', 'max'], withThinking: 'enabled', off: { thinking: 'disabled' }, reasonsByDefault: true } as const;

const MODELS: Record<string, ModelCapability> = {
  'gemini/gemini-4-argon': { provider: 'gemini', protocols: ['gemini'], images: true,
    reasoning: { levels: ['low', 'medium', 'high'], reasonsByDefault: true }, capacity: { contextTokens: 1_048_576, outputTokens: 65_536 },
    sources: ['https://ai.google.dev/gemini-api/docs/models/gemini-4-argon', GEMINI_THINKING] },
  'gemini/gemini-3.8-flash': { provider: 'gemini', protocols: ['gemini'], images: true,
    reasoning: { levels: ['low', 'medium', 'high'], reasonsByDefault: true }, capacity: { contextTokens: 1_048_576, outputTokens: 65_536 },
    sources: ['https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash', GEMINI_THINKING, 'https://ai.google.dev/gemini-api/docs/deprecations'] },
  'gemini/gemini-3.6-flash': { provider: 'gemini', protocols: ['gemini'], images: true,
    reasoning: { levels: ['minimal', 'low', 'medium', 'high'], reasonsByDefault: true }, capacity: { contextTokens: 1_048_576, outputTokens: 65_536 },
    sources: ['https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash', GEMINI_THINKING, 'https://ai.google.dev/gemini-api/docs/deprecations'] },
  'gemini/gemini-3.5-flash-lite': { provider: 'gemini', protocols: ['gemini'], images: true,
    reasoning: { levels: ['minimal', 'low', 'medium', 'high'], reasonsByDefault: true }, capacity: { contextTokens: 1_048_576, outputTokens: 65_536 },
    sources: ['https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite', GEMINI_THINKING] },
  'gemini/gemini-3.1-flash-lite': { provider: 'gemini', protocols: ['gemini'], images: true,
    // minimal is the lowest level, not "off"; Gemini 3 Flash-Lite cannot turn thinking fully off.
    reasoning: { levels: ['minimal', 'low', 'medium', 'high'], reasonsByDefault: true }, capacity: { contextTokens: 1_048_576, outputTokens: 65_536 },
    sources: ['https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite', GEMINI_THINKING, 'https://ai.google.dev/gemini-api/docs/gemini-3'] },
  'gemini/gemini-3.1-flash-lite-preview': { provider: 'gemini', protocols: ['gemini'], images: true, capacity: { contextTokens: 1_048_576, outputTokens: 65_536 },
    retired: 'Google shut down Gemini 3.1 Flash-Lite Preview on 2026-05-25. Choose gemini-3.1-flash-lite instead.',
    sources: ['https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview'] },
  'gemini/gemini-3.1-pro-preview': { provider: 'gemini', protocols: ['gemini'], images: true,
    reasoning: { levels: ['low', 'medium', 'high'], reasonsByDefault: true }, capacity: { contextTokens: 1_048_576, outputTokens: 65_536 },
    sources: ['https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview', 'https://ai.google.dev/gemini-api/docs/gemini-3'] },
  'openai/gpt-5.4': { provider: 'openai', protocols: OPENAI, images: true, reasoning: { levels: ['none', 'low', 'medium', 'high', 'xhigh'], reasonsByDefault: false },
    capacity: OPENAI_CAPACITY, sources: ['https://developers.openai.com/api/docs/models/gpt-5.4'] },
  'openai/gpt-6-astra': { provider: 'openai', protocols: OPENAI, images: true, reasoning: { levels: ['low', 'medium', 'high', 'xhigh', 'max'], reasonsByDefault: true },
    capacity: OPENAI_CAPACITY, sources: ['https://developers.openai.com/api/docs/models/gpt-6-astra'] },
  'openai/gpt-6.1-sol': { provider: 'openai', protocols: OPENAI, images: true, reasoning: { levels: ['low', 'medium', 'high', 'xhigh', 'max'], reasonsByDefault: true },
    capacity: OPENAI_CAPACITY, sources: ['https://developers.openai.com/api/docs/models/gpt-6.1-sol'] },
  'openai/gpt-6-luna': { provider: 'openai', protocols: OPENAI, images: true, reasoning: { levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], reasonsByDefault: true },
    capacity: OPENAI_CAPACITY, sources: ['https://developers.openai.com/api/docs/models/gpt-6-luna'] },
  'openai/gpt-6-sol': { provider: 'openai', protocols: OPENAI, images: true, reasoning: { levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], reasonsByDefault: true },
    capacity: OPENAI_CAPACITY, sources: ['https://developers.openai.com/api/docs/models/gpt-6-sol'] },
  'openai/gpt-5.6-sol': { provider: 'openai', protocols: OPENAI, images: true, reasoning: { levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], reasonsByDefault: true },
    capacity: OPENAI_CAPACITY, sources: ['https://developers.openai.com/api/docs/models/gpt-5.6-sol'] },
  'openai/gpt-5.6-terra': { provider: 'openai', protocols: OPENAI, images: true, reasoning: { levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], reasonsByDefault: true },
    capacity: OPENAI_CAPACITY, sources: ['https://developers.openai.com/api/docs/models/gpt-5.6-terra'] },
  'openai/gpt-5.6-luna': { provider: 'openai', protocols: OPENAI, images: true, reasoning: { levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], reasonsByDefault: true },
    capacity: OPENAI_CAPACITY, sources: ['https://developers.openai.com/api/docs/models/gpt-5.6-luna'] },
  // Restricted-access specialist: the model page verifies images but does not enumerate effort values.
  'openai/gpt-5.6-cyber': { provider: 'openai', protocols: ['responses'], images: true,
    reasoning: { levels: [], reasonsByDefault: true }, capacity: { contextTokens: 400_000, outputTokens: 128_000 },
    sources: ['https://developers.openai.com/api/docs/models/gpt-5.6-cyber'] },
  'openai/gpt-5.4-cyber': { provider: 'openai', protocols: ['responses'], images: undefined,
    retired: 'OpenAI shut down gpt-5.4-cyber on 2026-10-01.', sources: ['https://developers.openai.com/api/docs/deprecations'] },
  'openai/gpt-5.5': { provider: 'openai', protocols: OPENAI, images: true, reasoning: { levels: ['none', 'low', 'medium', 'high', 'xhigh'], reasonsByDefault: true },
    capacity: OPENAI_CAPACITY, sources: ['https://developers.openai.com/api/docs/models/gpt-5.5'] },
  'openai/gpt-5.5-pro': { provider: 'openai', protocols: ['responses'], images: true, reasoning: { levels: ['medium', 'high', 'xhigh'], reasonsByDefault: true },
    answerUnavailable: 'This model requires non-streaming responses, which this app does not support yet. Select another answer model.',
    capacity: OPENAI_CAPACITY, sources: ['https://developers.openai.com/api/docs/models/gpt-5.5-pro'] },
  'openai/gpt-5.4-pro': { provider: 'openai', protocols: ['responses'], images: true, reasoning: { levels: ['medium', 'high', 'xhigh'], reasonsByDefault: true },
    capacity: OPENAI_CAPACITY, sources: ['https://developers.openai.com/api/docs/models/gpt-5.4-pro'] },
  'openai/gpt-5.4-mini': { provider: 'openai', protocols: OPENAI, images: true, reasoning: { levels: ['none', 'low', 'medium', 'high', 'xhigh'], reasonsByDefault: false },
    capacity: { contextTokens: 400_000, outputTokens: 128_000 }, sources: ['https://developers.openai.com/api/docs/models/gpt-5.4-mini'] },
  // Deprecated does not mean shut down: nano remains available until 2027-04-01.
  'openai/gpt-5.4-nano': { provider: 'openai', protocols: OPENAI, images: true, reasoning: { levels: ['none', 'low', 'medium', 'high', 'xhigh'], reasonsByDefault: false },
    capacity: { contextTokens: 400_000, outputTokens: 128_000 }, sources: ['https://developers.openai.com/api/docs/models/gpt-5.4-nano', 'https://developers.openai.com/api/docs/deprecations'] },
  // Opus 5.5, Sonnet 5.5 and Fable 5.1 think adaptively with no thinking field and reject "disabled".
  'claude/claude-opus-5-5': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: ['low', 'medium', 'high', 'xhigh', 'max'], reasonsByDefault: true }, capacity: CLAUDE_CAPACITY, sources: CLAUDE_SOURCES },
  'claude/claude-sonnet-5-5': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: ['low', 'medium', 'high', 'xhigh', 'max'], reasonsByDefault: true }, capacity: CLAUDE_CAPACITY, sources: CLAUDE_SOURCES },
  'claude/claude-fable-5-1': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: ['low', 'medium', 'high', 'xhigh', 'max'], reasonsByDefault: true }, capacity: CLAUDE_CAPACITY, sources: CLAUDE_SOURCES },
  // Haiku 5.5 accepts "disabled" at high effort or below; the off choice sends no effort (default medium).
  'claude/claude-haiku-5-5': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: ['low', 'medium', 'high', 'xhigh', 'max'], off: { thinking: 'disabled' }, reasonsByDefault: true }, capacity: CLAUDE_CAPACITY, sources: CLAUDE_SOURCES },
  // Sonnet 4.6 does not think without a thinking field; an explicit level is sent with adaptive thinking.
  'claude/claude-sonnet-4-6': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: ['low', 'medium', 'high', 'max'], withThinking: 'adaptive', off: { thinking: 'disabled' }, reasonsByDefault: false }, capacity: CLAUDE_CAPACITY,
    sources: ['https://platform.claude.com/docs/en/models/sonnet-4-6/overview', ...CLAUDE_SOURCES] },
  'claude/claude-opus-5': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: ['low', 'medium', 'high', 'xhigh', 'max'], off: { thinking: 'disabled' }, reasonsByDefault: true }, capacity: CLAUDE_CAPACITY,
    sources: ['https://platform.claude.com/docs/en/models/opus-5/overview', ...CLAUDE_SOURCES] },
  'claude/claude-sonnet-5': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: ['low', 'medium', 'high', 'xhigh', 'max'], off: { thinking: 'disabled' }, reasonsByDefault: true }, capacity: CLAUDE_CAPACITY,
    sources: ['https://platform.claude.com/docs/en/models/sonnet-5/overview', ...CLAUDE_SOURCES] },
  'claude/claude-opus-4-8': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: ['low', 'medium', 'high', 'xhigh', 'max'], withThinking: 'adaptive', off: { thinking: 'disabled' }, reasonsByDefault: false }, capacity: CLAUDE_CAPACITY,
    sources: ['https://platform.claude.com/docs/en/models/opus-4-8/overview', ...CLAUDE_SOURCES] },
  'claude/claude-opus-4-7': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: ['low', 'medium', 'high', 'xhigh', 'max'], withThinking: 'adaptive', off: { thinking: 'disabled' }, reasonsByDefault: false }, capacity: CLAUDE_CAPACITY,
    sources: ['https://platform.claude.com/docs/en/models/opus-4-7/overview', ...CLAUDE_SOURCES] },
  'claude/claude-opus-4-6': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: ['low', 'medium', 'high', 'max'], withThinking: 'adaptive', off: { thinking: 'disabled' }, reasonsByDefault: false }, capacity: CLAUDE_CAPACITY,
    sources: ['https://platform.claude.com/docs/en/models/opus-4-6/overview', ...CLAUDE_SOURCES] },
  // 4.5 effort controls output, not an invented thinking budget. Sonnet/Haiku 4.5 have no effort parameter.
  'claude/claude-opus-4-5': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: ['low', 'medium', 'high'], off: { thinking: 'disabled' }, reasonsByDefault: false }, capacity: { contextTokens: 200_000, outputTokens: 64_000 },
    sources: ['https://platform.claude.com/docs/en/models/opus-4-5/overview', ...CLAUDE_SOURCES] },
  'claude/claude-sonnet-4-5': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: [], off: { thinking: 'disabled' }, reasonsByDefault: false }, capacity: { contextTokens: 200_000, outputTokens: 64_000 },
    sources: ['https://platform.claude.com/docs/en/models/sonnet-4-5/overview', ...CLAUDE_SOURCES] },
  'claude/claude-haiku-4-5': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: [], off: { thinking: 'disabled' }, reasonsByDefault: false }, capacity: { contextTokens: 200_000, outputTokens: 64_000 },
    sources: ['https://platform.claude.com/docs/en/models/haiku-4-5/overview', ...CLAUDE_SOURCES] },
  'claude/claude-fable-5': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: ['low', 'medium', 'high', 'xhigh', 'max'], reasonsByDefault: true }, capacity: CLAUDE_CAPACITY,
    sources: ['https://platform.claude.com/docs/en/models/fable-5/overview', ...CLAUDE_SOURCES] },
  'claude/claude-mythos-5': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: ['low', 'medium', 'high', 'xhigh', 'max'], reasonsByDefault: true }, capacity: CLAUDE_CAPACITY,
    sources: ['https://platform.claude.com/docs/en/models/mythos-5/overview', ...CLAUDE_SOURCES] },
  'claude/claude-mythos-5-1': { provider: 'claude', protocols: ['messages'], images: true,
    reasoning: { levels: ['low', 'medium', 'high', 'xhigh', 'max'], reasonsByDefault: true }, capacity: CLAUDE_CAPACITY,
    sources: ['https://platform.claude.com/docs/en/models/mythos-5-1/overview', ...CLAUDE_SOURCES] },
  'deepseek/deepseek-flash': { provider: 'deepseek', protocols: ['chat-completions'], images: true, reasoning: DEEPSEEK_REASONING,
    capacity: { contextTokens: 1_000_000, outputTokens: 384_000 }, sources: DEEPSEEK_SOURCES },
  // Documented legacy name, still accepted and served by DeepSeek-V4.1-Flash (the deepseek-flash model).
  'deepseek/deepseek-v4-flash': { provider: 'deepseek', protocols: ['chat-completions'], images: true, reasoning: DEEPSEEK_REASONING,
    capacity: { contextTokens: 1_000_000, outputTokens: 384_000 }, sources: DEEPSEEK_SOURCES },
  'deepseek/deepseek-v4-pro': { provider: 'deepseek', protocols: ['chat-completions'], images: false, reasoning: DEEPSEEK_REASONING,
    capacity: { contextTokens: 1_000_000, outputTokens: 384_000 }, sources: DEEPSEEK_SOURCES },
  // Groq answers are retired; these 2026-10-14 records remain for the speech provider's reference only.
  'groq/llama-3.3-70b-versatile': { provider: 'groq', protocols: ['chat-completions'], images: false, capacity: { contextTokens: 131_072, outputTokens: 32_768 },
    sources: ['https://console.groq.com/docs/models'] },
};

// Only aliases/snapshots explicitly documented by the linked model pages; never infer a dated suffix.
const MODEL_ALIASES: Record<string, string> = {
  'gemini/gemini-3.7-flash': 'gemini/gemini-3.8-flash',
  'gemini/gemini-3.5-flash': 'gemini/gemini-3.6-flash',
  'gemini/gemini-3.1-pro-preview-customtools': 'gemini/gemini-3.1-pro-preview',
  'openai/gpt-5.4-2026-03-05': 'openai/gpt-5.4',
  'openai/gpt-5.4-pro-2026-03-05': 'openai/gpt-5.4-pro',
  'openai/gpt-5.4-mini-2026-03-17': 'openai/gpt-5.4-mini',
  'openai/gpt-5.4-nano-2026-03-17': 'openai/gpt-5.4-nano',
  'openai/gpt-5.5-2026-04-23': 'openai/gpt-5.5',
  'openai/gpt-5.5-pro-2026-04-23': 'openai/gpt-5.5-pro',
  'claude/claude-opus-4-5-20251101': 'claude/claude-opus-4-5',
  'claude/claude-sonnet-4-5-20250929': 'claude/claude-sonnet-4-5',
  'claude/claude-haiku-4-5-20251001': 'claude/claude-haiku-4-5',
  'deepseek/deepseek-v4-flash-vision-exp': 'deepseek/deepseek-flash',
};

type CapabilityTarget = Pick<ModelTarget, 'provider' | 'protocol' | 'baseUrl' | 'model'>;

export function isOfficialEndpoint(config: Pick<ModelTarget, 'provider' | 'baseUrl'>): boolean {
  if (config.provider === 'gateway') return false;
  try { return new URL(config.baseUrl?.trim() || OFFICIAL_ENDPOINTS[config.provider]).href.replace(/\/+$/, '') === OFFICIAL_ENDPOINTS[config.provider]; }
  catch { return false; }
}

/** The record for this exact official target, or undefined (unknown). */
export function officialCapability(config: CapabilityTarget): ModelCapability | undefined {
  if (config.provider === 'gateway' || !isOfficialEndpoint(config)) return undefined;
  const requested = `${config.provider}/${config.model.trim()}`;
  const key = Object.hasOwn(MODEL_ALIASES, requested) ? MODEL_ALIASES[requested] : requested;
  const entry = Object.hasOwn(MODELS, key) ? MODELS[key] : undefined;
  return entry && entry.protocols.includes(config.protocol) ? entry : undefined;
}

/** Newly offered official candidates must be reviewed answer models for this protocol, not retired IDs. */
export function isOfficialAnswerCandidate(config: CapabilityTarget): boolean {
  const capability = officialCapability(config);
  return config.provider !== 'groq' && !!capability && !capability.retired && !capability.answerUnavailable;
}

/** Choices the reasoning control offers for this target; unknown targets offer the provider default only. */
export function reasoningChoices(config: CapabilityTarget): ReasoningChoice[] {
  const reasoning = officialCapability(config)?.reasoning;
  return reasoning ? ['default', ...(reasoning.off ? ['off' as const] : []), ...reasoning.levels] : ['default'];
}

/** The complete reasoning fields a choice sends to this target; throws when the target does not offer it. */
export function reasoningForChoice(config: CapabilityTarget, choice: ReasoningChoice): ReasoningSetting | undefined {
  if (!reasoningChoices(config).includes(choice)) throw new Error('This reasoning level is not available for the selected model.');
  const reasoning = officialCapability(config)?.reasoning;
  if (choice === 'default' || !reasoning) return undefined;
  if (choice === 'off') return { ...reasoning.off! };
  return { ...(reasoning.withThinking ? { thinking: reasoning.withThinking } : {}), effort: choice };
}

/** The choice that sends exactly these fields, if any (used to read an older per-model setting without loss). */
export function choiceForSetting(config: CapabilityTarget, setting: ReasoningSetting | undefined): ReasoningChoice | undefined {
  const wanted = JSON.stringify({ thinking: setting?.thinking, effort: setting?.effort });
  return reasoningChoices(config).find(choice => { const fields = reasoningForChoice(config, choice); return JSON.stringify({ thinking: fields?.thinking, effort: fields?.effort }) === wanted; });
}

export const isReasoningChoice = (value: unknown): value is ReasoningChoice => typeof value === 'string' && (REASONING_CHOICES as readonly string[]).includes(value);
