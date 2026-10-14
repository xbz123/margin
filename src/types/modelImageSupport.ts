import type { ModelTarget } from './llmTarget';

type ImageTarget = Pick<ModelTarget, 'provider' | 'protocol' | 'baseUrl' | 'model' | 'gatewayId' | 'imageSupportConfirmedFor'>;

export const PROVIDER_IMAGE_ENDPOINTS = {
  gemini: 'https://generativelanguage.googleapis.com', groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1', claude: 'https://api.anthropic.com', deepseek: 'https://api.deepseek.com',
};

// A gateway binding names the gateway, so an official-looking gateway URL is still a gateway.
export function imageSupportTarget(config: ImageTarget): string {
  if (config.provider === 'gateway') {
    return JSON.stringify(['gateway', config.gatewayId, config.protocol, new URL(config.baseUrl!.trim()).href.replace(/\/+$/, ''), config.model.trim()]);
  }
  const base = new URL(config.baseUrl?.trim() || PROVIDER_IMAGE_ENDPOINTS[config.provider]).href.replace(/\/+$/, '');
  return JSON.stringify([config.provider, config.protocol, base, config.model.trim()]);
}

// Exact vendor endpoints and model IDs only; a compatible server is not the vendor.
// Sources verified 2026-10-10: vendor model pages (see AG33 evidence). Retired IDs
// describe input capability, not current availability. DeepSeek's legacy ID routes to V4.1.
const KNOWN_IMAGE_MODELS: Record<string, Record<string, boolean>> = {
  gemini: { 'gemini-3.1-flash-lite-preview': true, 'gemini-3.1-pro-preview': true },
  groq: { 'llama-3.3-70b-versatile': false },
  openai: { 'gpt-5.4': true },
  claude: { 'claude-sonnet-4-6': true },
  deepseek: { 'deepseek-v4-flash': true },
};

export function knownModelImageSupport(config: ImageTarget): boolean | undefined {
  if (config.provider === 'gateway') return undefined;
  const base = new URL(config.baseUrl?.trim() || PROVIDER_IMAGE_ENDPOINTS[config.provider]).href.replace(/\/+$/, '');
  const models = KNOWN_IMAGE_MODELS[config.provider];
  return base === PROVIDER_IMAGE_ENDPOINTS[config.provider] && Object.hasOwn(models, config.model.trim()) ? models[config.model.trim()] : undefined;
}

export function assertModelImageSupport(config: ImageTarget): void {
  const known = knownModelImageSupport(config);
  if (known === false) throw new Error('This model does not support images. Select another model; your attachments were kept.');
  if (known === undefined && config.imageSupportConfirmedFor !== imageSupportTarget(config)) {
    throw new Error('Image support is unconfirmed for this model and endpoint. Check the provider model documentation and confirm image support in Settings.');
  }
}
