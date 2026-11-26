import axios from 'axios';
import { axiosAgentsFor, fetchDispatcherFor, proxyDecisionSync, proxyErrorIn, resolveProxyFor, type ProxyDecision } from './proxy';

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
    const href = validateHttpEndpoint(input instanceof Request ? input.url : String(input));
    const receiver = this ?? globalThis;
    // The proxy decision comes after the endpoint check; a direct decision passes no dispatcher.
    // A proxy failure surfaces as the fixed ProxyError, not undici's generic "fetch failed".
    const send = (decision: ProxyDecision) => decision === 'direct'
      ? transport.call(receiver, input, { ...init, redirect: 'error' })
      : transport.call(receiver, input, { ...init, redirect: 'error', dispatcher: fetchDispatcherFor(decision) } as RequestInit)
        .catch((error: unknown) => { throw proxyErrorIn(error) ?? error; });
    const known = proxyDecisionSync(href);
    return known ? send(known) : resolveProxyFor(href).then(send);
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
  const href = validateHttpEndpoint(config.baseURL ? new URL(config.url!, config.baseURL) : config.url!);
  config.maxRedirects = 0;
  // axios never reads proxy environment variables itself; the shared resolver decides per target.
  config.proxy = false;
  const agents = axiosAgentsFor(href);
  if (agents) Object.assign(config, agents);
  return config;
}, error => { throw error; }, { synchronous: true });


export function openAiSttEndpoint(base = 'https://api.openai.com'): string {
  const url = new URL(validateHttpEndpoint(base));
  if (url.search) throw new Error('Invalid STT base URL');
  const prefix = url.pathname.replace(/\/+$/, '');
  url.pathname = prefix + (/\/v\d+$/.test(prefix) ? '/audio/transcriptions' : '/v1/audio/transcriptions');
  return url.href;
}
