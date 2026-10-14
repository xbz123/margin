export type LlmProvider = 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek';
export type LlmProtocol = 'gemini' | 'chat-completions' | 'responses' | 'messages';
/** Official providers offered for answers. Groq keys stay stored for speech, but Groq answers are retired. */
export const ANSWER_PROVIDERS = ['gemini', 'openai', 'claude', 'deepseek'] as const satisfies readonly LlmProvider[];
export type AnswerProvider = typeof ANSWER_PROVIDERS[number];
export const LLM_PROTOCOLS: readonly LlmProtocol[] = ['chat-completions', 'responses', 'messages', 'gemini'];
/** Sent as the selected protocol's own reasoning fields; absent fields keep the provider default. */
export interface ReasoningSetting {
  effort?: string;
  thinking?: 'adaptive' | 'enabled' | 'disabled';
}
/** An official provider always uses its built-in address; custom addresses are gateways. */
export interface ProviderConfiguration {
  provider: LlmProvider;
  protocol: LlmProtocol;
  /** Never set for a saved official provider; only the development loopback override may change it. */
  baseUrl?: string;
  model: string;
  imageSupportConfirmedFor?: string;
  /** Applies to this configured model only, not to other models of the same provider. */
  reasoning?: ReasoningSetting;
  /** Gateways only. Informational; requests are never refused or trimmed by it. */
  contextWindowTokens?: number;
}
/** A compatible gateway with its own identity and key; it never borrows an official provider slot. */
export interface GatewayConfiguration {
  id: string;
  protocol: LlmProtocol;
  baseUrl: string;
  model: string;
  imageSupportConfirmedFor?: string;
  reasoning?: ReasoningSetting;
  contextWindowTokens?: number;
}
/** Gateway targets carry provider 'gateway'; the wire adapter follows the protocol only. */
export interface ModelTarget extends Omit<ProviderConfiguration, 'provider'> {
  provider: LlmProvider | 'gateway';
  gatewayId?: string;
}
export interface ProviderConfigurationSave extends ProviderConfiguration { apiKey?: string }
/** Without an id a new gateway is created. */
export interface GatewayConfigurationSave extends Omit<GatewayConfiguration, 'id'> { id?: string; apiKey?: string }
/** What the renderer may see of a gateway: configuration and whether a key is stored, never the key. */
export interface GatewaySummary extends GatewayConfiguration { hasKey: boolean }

export const LLM_PRESETS: Record<LlmProvider, ProviderConfiguration> = {
  gemini: { provider: 'gemini', protocol: 'gemini', model: 'gemini-3.1-flash-lite-preview' },
  groq: { provider: 'groq', protocol: 'chat-completions', model: 'llama-3.3-70b-versatile' },
  openai: { provider: 'openai', protocol: 'chat-completions', model: 'gpt-5.4' },
  claude: { provider: 'claude', protocol: 'messages', model: 'claude-sonnet-4-6' },
  deepseek: { provider: 'deepseek', protocol: 'chat-completions', model: 'deepseek-v4-flash' },
};

export const GATEWAY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

// The selector identity includes the credential slot or gateway; the wire model stays untouched.
export const modelTargetId = (target: Pick<ModelTarget, 'provider' | 'protocol' | 'model' | 'gatewayId'>): string =>
  target.provider === 'gateway' || target.gatewayId !== undefined
    ? `llm-gateway:${target.gatewayId}:${target.protocol}:${encodeURIComponent(target.model)}`
    : `llm-target:${target.provider}:${target.protocol}:${encodeURIComponent(target.model)}`;

export const gatewayTarget = (gateway: GatewayConfiguration, model = gateway.model): ModelTarget => {
  const { id, ...rest } = gateway;
  if (model === gateway.model) return { ...rest, provider: 'gateway', gatewayId: id };
  return { provider: 'gateway', gatewayId: id, protocol: gateway.protocol, baseUrl: gateway.baseUrl, model };
};

export type ParsedSelection =
  | { kind: 'official'; provider: LlmProvider; protocol: LlmProtocol; model: string }
  | { kind: 'gateway'; gatewayId: string; protocol: LlmProtocol; model: string };

/** Parses a canonical selector; undefined for Codex, bare legacy IDs and malformed input. */
export function parseModelSelection(id: string): ParsedSelection | undefined {
  const official = /^llm-target:(gemini|groq|openai|claude|deepseek):(gemini|chat-completions|responses|messages):(.+)$/.exec(id);
  const gateway = /^llm-gateway:([a-z0-9][a-z0-9-]{0,63}):(gemini|chat-completions|responses|messages):(.+)$/.exec(id);
  try {
    if (official) return { kind: 'official', provider: official[1] as LlmProvider, protocol: official[2] as LlmProtocol, model: decodeURIComponent(official[3]) };
    if (gateway) return { kind: 'gateway', gatewayId: gateway[1], protocol: gateway[2] as LlmProtocol, model: decodeURIComponent(gateway[3]) };
  } catch { return undefined; }
  return undefined;
}
