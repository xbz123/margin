import axios from 'axios';

// Explicit user endpoints (including env and HTTP-compatible STT servers) remain
// supported. Reject URL syntax that can conceal a different authority.
export function validateHttpEndpoint(value: string | URL): string {
  const raw = String(value);
  if (/[\s\\]/.test(raw)) throw new Error('Invalid outbound endpoint');
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) {
    throw new Error('Invalid outbound endpoint');
  }
  return url.href;
}

const guardedFetch = Symbol.for('margin.outbound.fetch');

export function createOutboundFetch(transport: typeof fetch): typeof fetch {
  if ((transport as any)[guardedFetch]) return transport;
  const wrapped: typeof fetch = function (input, init) {
    validateHttpEndpoint(input instanceof Request ? input.url : String(input));
    return transport.call(this ?? globalThis, input, { ...init, redirect: 'error' });
  };
  Object.defineProperty(wrapped, guardedFetch, { value: true });
  return wrapped;
}

export function installOutboundFetchPolicy(): void {
  globalThis.fetch = createOutboundFetch(globalThis.fetch);
}

// Standalone helpers/tests do not have to evaluate the production bootstrap.
export const outboundFetch: typeof fetch = (input, init) => createOutboundFetch(globalThis.fetch)(input, init);

export const outboundAxios = axios.create({ maxRedirects: 0 });
outboundAxios.interceptors.request.use(config => {
  validateHttpEndpoint(config.baseURL ? new URL(config.url!, config.baseURL) : config.url!);
  config.maxRedirects = 0;
  return config;
}, error => { throw error; }, { synchronous: true });

export function regionalSttEndpoint(provider: 'azure' | 'ibmwatson', region: string, language = 'en-US'): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(region)) throw new Error('Invalid STT region');
  const hostname = provider === 'azure'
    ? `${region}.stt.speech.microsoft.com`
    : `api.${region}.speech-to-text.watson.cloud.ibm.com`;
  const url = new URL(`https://${hostname}`);
  if (url.hostname !== hostname) throw new Error('Invalid STT region');
  url.pathname = provider === 'azure' ? '/speech/recognition/conversation/cognitiveservices/v1' : '/v1/recognize';
  url.searchParams.set('language', language);
  return url.href;
}

export function openAiSttEndpoint(base = 'https://api.openai.com'): string {
  const url = new URL(validateHttpEndpoint(base));
  if (url.search) throw new Error('Invalid STT base URL');
  const prefix = url.pathname.replace(/\/+$/, '');
  url.pathname = prefix + (/\/v\d+$/.test(prefix) ? '/audio/transcriptions' : '/v1/audio/transcriptions');
  return url.href;
}

export function googleSpeechUniverseDomain(value = 'googleapis.com'): string {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i.test(value)) throw new Error('Invalid Google universe domain');
  return value;
}
