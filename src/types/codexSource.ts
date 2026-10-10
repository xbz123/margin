export const CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
export const CODEX_RISK_VERSION = 1;
export const CODEX_SERVICE_TIERS = ['default', 'fast', 'flex'] as const;
export const CODEX_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
export interface CodexSourceConfig {
  enabled: boolean;
  model: string;
  fastModel: string;
  serviceTier: typeof CODEX_SERVICE_TIERS[number];
  modelReasoningEffort?: typeof CODEX_REASONING_EFFORTS[number];
  riskConfirmedVersion?: number;
  imageSupportConfirmedFor?: string;
  fastImageSupportConfirmedFor?: string;
}
export type CodexSourceUpdate = Partial<Omit<CodexSourceConfig, 'riskConfirmedVersion'>> & { acceptRisk?: boolean };
export type CodexSourceStatus = { success: boolean; status: 'disabled' | 'confirmation-required' | 'file-unavailable' | 'invalid' | 'expired' | 'locally-valid'; message: string };
export const DEFAULT_CODEX_SOURCE_CONFIG: CodexSourceConfig = {
  enabled: false, model: 'gpt-5.4', fastModel: 'gpt-5.3-codex-spark', serviceTier: 'default',
};
export function codexImageTarget(model: string): string { return JSON.stringify(['codex', 'responses', CODEX_ENDPOINT, model]); }
export function isCodexSelection(id: string): boolean { return id === 'codex-cli' || id.startsWith('codex-cli:'); }
export function validateCodexModel(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error('Invalid Codex model');
  return value;
}
export function validateCodexSourceConfig(value: Partial<CodexSourceConfig>): CodexSourceConfig {
  const config = { ...DEFAULT_CODEX_SOURCE_CONFIG, ...value };
  if (typeof config.enabled !== 'boolean') throw new Error('Invalid Codex enabled flag');
  validateCodexModel(config.model); validateCodexModel(config.fastModel);
  if (!CODEX_SERVICE_TIERS.includes(config.serviceTier)) throw new Error('Invalid Codex service tier');
  if (config.modelReasoningEffort !== undefined && !CODEX_REASONING_EFFORTS.includes(config.modelReasoningEffort)) throw new Error('Invalid Codex reasoning effort');
  return { enabled: config.enabled, model: config.model, fastModel: config.fastModel, serviceTier: config.serviceTier,
    ...(config.modelReasoningEffort ? { modelReasoningEffort: config.modelReasoningEffort } : {}),
    ...(config.riskConfirmedVersion === CODEX_RISK_VERSION ? { riskConfirmedVersion: CODEX_RISK_VERSION } : {}),
    ...(config.imageSupportConfirmedFor === codexImageTarget(config.model) ? { imageSupportConfirmedFor: config.imageSupportConfirmedFor } : {}),
    ...(config.fastImageSupportConfirmedFor === codexImageTarget(config.fastModel) ? { fastImageSupportConfirmedFor: config.fastImageSupportConfirmedFor } : {}) };
}
export function codexSourceAvailable(config: CodexSourceConfig): boolean { return config.enabled && config.riskConfirmedVersion === CODEX_RISK_VERSION; }
export function assertCodexConsent(config: CodexSourceConfig): void {
  if (!config.enabled) throw new Error('Codex login source is disabled.');
  if (config.riskConfirmedVersion !== CODEX_RISK_VERSION) throw new Error('Confirm the current Codex login-source risks in Settings.');
}
