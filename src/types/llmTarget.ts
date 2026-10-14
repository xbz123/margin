export type LlmProvider = 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek';
export type LlmProtocol = 'gemini' | 'chat-completions' | 'responses' | 'messages';
/** Sent as the selected protocol's own reasoning fields; absent fields keep the provider default. */
export interface ReasoningSetting {
  effort?: string;
  thinking?: 'adaptive' | 'enabled' | 'disabled';
}
export interface ProviderConfiguration {
  provider: LlmProvider;
  protocol: LlmProtocol;
  baseUrl?: string;
  model: string;
  imageSupportConfirmedFor?: string;
  /** Applies to this configured model only, not to other models of the same provider. */
  reasoning?: ReasoningSetting;
  /** Custom endpoints only. Informational; requests are never refused or trimmed by it. */
  contextWindowTokens?: number;
}
export interface ModelTarget extends ProviderConfiguration {}
export interface ProviderConfigurationSave extends ProviderConfiguration { apiKey?: string }

export const LLM_PRESETS: Record<LlmProvider, ProviderConfiguration> = {
  gemini: { provider: 'gemini', protocol: 'gemini', model: 'gemini-3.1-flash-lite-preview' },
  groq: { provider: 'groq', protocol: 'chat-completions', model: 'llama-3.3-70b-versatile' },
  openai: { provider: 'openai', protocol: 'chat-completions', model: 'gpt-5.4' },
  claude: { provider: 'claude', protocol: 'messages', model: 'claude-sonnet-4-6' },
  deepseek: { provider: 'deepseek', protocol: 'chat-completions', model: 'deepseek-v4-flash' },
};

// The selector identity includes the credential slot; the wire model stays untouched.
export const modelTargetId = (target: Pick<ModelTarget, 'provider' | 'protocol' | 'model'>): string =>
  `llm-target:${target.provider}:${target.protocol}:${encodeURIComponent(target.model)}`;
