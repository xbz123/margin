import type { ModelTarget } from './llmTarget';
import { OFFICIAL_ENDPOINTS, officialCapability } from './modelCapabilities';

type ImageTarget = Pick<ModelTarget, 'provider' | 'protocol' | 'baseUrl' | 'model' | 'gatewayId' | 'imageSupportConfirmedFor'>;

export const PROVIDER_IMAGE_ENDPOINTS = OFFICIAL_ENDPOINTS;

// A gateway binding names the gateway, so an official-looking gateway URL is still a gateway.
export function imageSupportTarget(config: ImageTarget): string {
  if (config.provider === 'gateway') {
    return JSON.stringify(['gateway', config.gatewayId, config.protocol, new URL(config.baseUrl!.trim()).href.replace(/\/+$/, ''), config.model.trim()]);
  }
  const base = new URL(config.baseUrl?.trim() || PROVIDER_IMAGE_ENDPOINTS[config.provider]).href.replace(/\/+$/, '');
  return JSON.stringify([config.provider, config.protocol, base, config.model.trim()]);
}

/** Documented image input of an exact official target; undefined for gateways and unknown models. */
export function knownModelImageSupport(config: ImageTarget): boolean | undefined {
  return officialCapability(config)?.images;
}

export const IMAGE_UNVERIFIED = 'Image input for this model has not been verified yet, so images are not sent. Select another model; your attachments were kept.';

/**
 * Official targets follow the capability record only: supported is allowed, unsupported or unknown is
 * refused, and no stored confirmation overrides it. A gateway needs its own exact confirmation.
 */
export function assertModelImageSupport(config: ImageTarget): void {
  const known = knownModelImageSupport(config);
  if (known === true) return;
  if (known === false) throw new Error('This model does not support images. Select another model; your attachments were kept.');
  if (config.provider !== 'gateway') throw new Error(IMAGE_UNVERIFIED);
  if (config.imageSupportConfirmedFor !== imageSupportTarget(config)) {
    throw new Error('Image support is unconfirmed for this model and endpoint. Check the provider model documentation and confirm image support in Settings.');
  }
}
