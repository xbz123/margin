import http from 'http';
import https from 'https';
import net from 'net';
import type { Agent as UndiciAgent } from 'undici';
import type { NetworkProxySettings } from '../../../src/types/networkProxy';
import { DEFAULT_NETWORK_PROXY, alwaysDirect, normalizeNetworkProxySettings, normalizeProxyHost, normalizeProxyPort, urlHost } from './settings';
import { authority, connectTargetTls, openTunnel, ProxyError, type ProxyEndpoint } from './tunnel';

export { ProxyError, openTunnel } from './tunnel';
export type { ProxyEndpoint } from './tunnel';

// Network proxy runtime: one resolver and one tunnel shared by fetch (undici dispatcher), axios
// (http/https agents) and ws (agent). Decisions are made after the outbound endpoint checks.

export type ProxyDecision = 'direct' | ProxyEndpoint;
/** Returns a Chromium/PAC style result such as "PROXY host:port; DIRECT". */
export type SystemProxyResolver = (url: string) => Promise<string>;
type Ca = string | Buffer | Array<string | Buffer>;

interface ProxyState {
  settings: NetworkProxySettings;
  systemResolver?: SystemProxyResolver;
  cache: Map<string, { expires: number; decision?: ProxyDecision; pending?: Promise<ProxyDecision> }>;
  dispatchers: Map<string, UndiciAgent>;
  agents?: { http: http.Agent; https: https.Agent };
  testCa?: Ca;
}

// esbuild bundles each entry point separately; one process-wide state keeps every copy consistent.
const STATE = Symbol.for('margin.networkProxy.state');
function state(): ProxyState {
  const holder = globalThis as unknown as Record<symbol, ProxyState | undefined>;
  return holder[STATE] ??= { settings: { ...DEFAULT_NETWORK_PROXY, bypass: [] }, cache: new Map(), dispatchers: new Map() };
}

const SYSTEM_CACHE_MS = 30_000;
const MAX_CACHE_ENTRIES = 512;
const MAX_DISPATCHERS = 16;

function warn(message: string): void {
  // Fixed text only: proxy addresses, credentials and URLs are never logged.
  console.warn(`[NetworkProxy] ${message}`);
}

function resetConnections(current: ProxyState): void {
  current.cache.clear();
  // Graceful close: requests already in flight finish on their existing connections.
  for (const dispatcher of current.dispatchers.values()) dispatcher.close().catch((): void => undefined);
  current.dispatchers.clear();
  current.agents = undefined;
}

/** Applies validated settings to new connections. Throws on invalid input and then changes nothing. */
export function configureNetworkProxy(settings: NetworkProxySettings | undefined): void {
  const next = settings ? normalizeNetworkProxySettings(settings) : { ...DEFAULT_NETWORK_PROXY, bypass: [] };
  const current = state();
  current.settings = next;
  resetConnections(current);
}

export function currentNetworkProxyMode(): NetworkProxySettings['mode'] {
  return state().settings.mode;
}

/** Production: session.defaultSession.resolveProxy after app ready. Before that (and in tests) it is injected or absent. */
export function setSystemProxyResolver(resolver: SystemProxyResolver | undefined): void {
  const current = state();
  current.systemResolver = resolver;
  current.cache.clear();
}

/** Test-only trust anchors for self-signed local targets; certificate verification itself is never disabled. */
export function setProxyTestTrustAnchors(ca: Ca | undefined): void {
  state().testCa = ca;
}

function defaultPort(protocol: string): number {
  return protocol === 'https:' || protocol === 'wss:' ? 443 : 80;
}

function isSecure(url: URL): boolean {
  return url.protocol === 'https:' || url.protocol === 'wss:';
}

function manualEndpoint(settings: NetworkProxySettings): ProxyEndpoint {
  return {
    protocol: settings.protocol, host: settings.host, port: settings.port,
    ...(settings.username ? { auth: { username: settings.username, password: settings.password ?? '' } } : {}),
  };
}

function envValue(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

const NO_PROXY_CIDR = (entry: string): net.BlockList | undefined => {
  const match = /^([^/]+)\/(\d{1,3})$/.exec(entry);
  if (!match) return undefined;
  const family = net.isIP(match[1]);
  const prefix = Number(match[2]);
  if (!family || prefix > (family === 4 ? 32 : 128)) return undefined;
  const list = new net.BlockList();
  list.addSubnet(match[1], prefix, family === 4 ? 'ipv4' : 'ipv6');
  return list;
};

/** NO_PROXY semantics: `*`, host or domain (with subdomains), `.domain`, optional `:port`, IP and CIDR. */
export function noProxyMatches(host: string, port: number, value: string): boolean {
  return value.split(/[\s,]+/).filter(Boolean).some(raw => {
    let entry = raw.toLowerCase();
    if (entry === '*') return true;
    const cidr = NO_PROXY_CIDR(entry);
    if (cidr) {
      const family = net.isIP(host);
      return family ? cidr.check(host, family === 4 ? 'ipv4' : 'ipv6') : false;
    }
    let entryPort: number | undefined;
    const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(entry);
    if (bracketed) { entry = bracketed[1]; entryPort = bracketed[2] ? Number(bracketed[2]) : undefined; }
    else if (!net.isIPv6(entry)) {
      const withPort = /^(.*):(\d+)$/.exec(entry);
      if (withPort) { entry = withPort[1]; entryPort = Number(withPort[2]); }
    }
    if (entryPort !== undefined && entryPort !== port) return false;
    entry = entry.replace(/^\*?\./, '');
    if (!entry) return false;
    return host === entry || (!net.isIP(host) && host.endsWith('.' + entry));
  });
}

const ENV_SCHEMES: Record<string, ProxyEndpoint['protocol'] | 'socks4'> = {
  'http:': 'http', 'https:': 'https', 'socks5:': 'socks5', 'socks5h:': 'socks5', 'socks:': 'socks5', 'socks4:': 'socks4', 'socks4a:': 'socks4',
};

/** Parses an environment proxy URL; undefined when unusable. */
export function parseProxyUrl(value: string): ProxyEndpoint | undefined {
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`); } catch { return undefined; }
  const protocol = ENV_SCHEMES[url.protocol];
  if (!protocol || protocol === 'socks4') return undefined;
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) return undefined;
  try {
    const host = normalizeProxyHost(url.hostname.replace(/^\[|\]$/g, ''));
    const port = url.port ? normalizeProxyPort(Number(url.port)) : protocol === 'socks5' ? 1080 : protocol === 'https' ? 443 : 80;
    let auth: ProxyEndpoint['auth'];
    if (url.username) {
      const username = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
      if (/[\r\n\0]/.test(username + password)) return undefined;
      auth = { username, password };
    }
    return { protocol, host, port, ...(auth ? { auth } : {}) };
  } catch { return undefined; }
}

/** Environment proxy for this URL: undefined when no variable applies to its scheme. */
function envDecision(url: URL, host: string): ProxyDecision | undefined {
  const value = isSecure(url)
    ? envValue(['https_proxy', 'HTTPS_PROXY']) ?? envValue(['all_proxy', 'ALL_PROXY'])
    : envValue(['http_proxy', 'HTTP_PROXY']) ?? envValue(['all_proxy', 'ALL_PROXY']);
  if (!value) return undefined;
  const noProxy = envValue(['no_proxy', 'NO_PROXY']);
  if (noProxy && noProxyMatches(host, Number(url.port) || defaultPort(url.protocol), noProxy)) return 'direct';
  const endpoint = parseProxyUrl(value);
  if (!endpoint) { warn('Unsupported proxy environment variable; connecting directly.'); return 'direct'; }
  return endpoint;
}

/** First entry of a PAC/Chromium result. SOCKS4 and unknown entries connect directly (logged without values). */
export function parsePacResult(result: string): ProxyDecision {
  const first = String(result ?? '').split(';')[0].trim();
  if (!first || /^DIRECT$/i.test(first)) return 'direct';
  const match = /^(PROXY|HTTPS|SOCKS5|SOCKS)\s+(\S+)$/i.exec(first);
  if (!match) { warn('Unsupported system proxy entry; connecting directly.'); return 'direct'; }
  const kind = match[1].toUpperCase();
  const protocol: ProxyEndpoint['protocol'] = kind === 'PROXY' ? 'http' : kind === 'HTTPS' ? 'https' : 'socks5';
  try {
    const parsed = new URL(`http://${match[2]}`);
    if (!parsed.port || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw Error();
    return { protocol, host: normalizeProxyHost(parsed.hostname.replace(/^\[|\]$/g, '')), port: normalizeProxyPort(Number(parsed.port)) };
  } catch {
    warn('Invalid system proxy entry; connecting directly.');
    return 'direct';
  }
}

function systemKey(url: URL, host: string): string {
  const scheme = isSecure(url) ? 'https' : 'http';
  return `${scheme}://${authority(host, Number(url.port) || defaultPort(url.protocol))}/`;
}

/** The decision when it is known without asynchronous work (cached or not needing the system resolver). */
export function proxyDecisionSync(input: string | URL): ProxyDecision | undefined {
  const url = new URL(String(input));
  const host = urlHost(url);
  const current = state();
  const { settings } = current;
  if (alwaysDirect(host, settings.bypass) || settings.mode === 'off') return 'direct';
  if (settings.mode === 'manual') return manualEndpoint(settings);
  const env = envDecision(url, host);
  if (env) return env;
  if (!current.systemResolver) return 'direct';
  const cached = current.cache.get(systemKey(url, host));
  return cached && cached.expires > Date.now() ? cached.decision : undefined;
}

/** Resolves direct or the proxy endpoint for a URL, in the documented order. */
export function resolveProxyFor(input: string | URL): Promise<ProxyDecision> {
  let known: ProxyDecision | undefined;
  try { known = proxyDecisionSync(input); } catch (error) { return Promise.reject(error); }
  if (known) return Promise.resolve(known);
  const url = new URL(String(input));
  const current = state();
  const key = systemKey(url, urlHost(url));
  const cached = current.cache.get(key);
  if (cached?.pending && cached.expires > Date.now()) return cached.pending;
  const resolver = current.systemResolver!;
  const entry: { expires: number; decision?: ProxyDecision; pending?: Promise<ProxyDecision> } = { expires: Date.now() + SYSTEM_CACHE_MS };
  entry.pending = Promise.resolve().then(() => resolver(key)).then(parsePacResult, () => {
    warn('System proxy lookup failed; connecting directly.');
    return 'direct' as const;
  }).then(decision => {
    entry.decision = decision;
    return decision;
  });
  if (current.cache.size >= MAX_CACHE_ENTRIES) current.cache.clear();
  current.cache.set(key, entry);
  return entry.pending;
}

/** True when the URL is known to connect directly without asking the system resolver. */
export function connectsDirectly(input: string | URL): boolean {
  return proxyDecisionSync(input) === 'direct';
}

interface ConnectTarget {
  host: string;
  port: number;
  secure: boolean;
  servername?: string;
  ALPNProtocols?: string[];
  ca?: Ca;
  signal?: AbortSignal;
}

/** Tunnel to the target, then TLS to the target itself for https/wss. */
export async function connectThroughProxy(proxy: ProxyEndpoint, target: ConnectTarget): Promise<net.Socket> {
  const testCa = state().testCa;
  const tunnel = await openTunnel({ host: target.host, port: target.port }, proxy, { signal: target.signal, ...(testCa ? { ca: testCa } : {}) });
  if (!target.secure) return tunnel;
  const ca = target.ca ?? testCa;
  return connectTargetTls(tunnel, target.host, {
    ...(target.servername ? { servername: target.servername } : {}),
    ...(target.ALPNProtocols ? { ALPNProtocols: target.ALPNProtocols } : {}),
    ...(ca ? { ca } : {}),
    signal: target.signal,
  });
}

function bareHost(value: unknown): string {
  return String(value ?? '').replace(/^\[|\]$/g, '');
}

/** undici dispatcher for fetch through one proxy endpoint, cached until the settings change. */
export function fetchDispatcherFor(proxy: ProxyEndpoint): UndiciAgent {
  const current = state();
  const key = JSON.stringify([proxy.protocol, proxy.host, proxy.port, proxy.auth?.username ?? null, proxy.auth?.password ?? null]);
  let dispatcher = current.dispatchers.get(key);
  if (!dispatcher) {
    // Loaded on first proxied fetch only: direct-only processes never evaluate undici.
    const { Agent: UndiciAgent } = require('undici') as typeof import('undici');
    dispatcher = new UndiciAgent({
      connect: (options, callback) => {
        const secure = options.protocol === 'https:';
        const host = bareHost(options.hostname);
        connectThroughProxy(proxy, {
          host, port: Number(options.port) || (secure ? 443 : 80), secure,
          ...(options.servername ? { servername: options.servername } : {}),
          ALPNProtocols: ['http/1.1'],
        }).then(socket => callback(null, socket), error => callback(error, null));
      },
    });
    if (current.dispatchers.size >= MAX_DISPATCHERS) {
      const [oldestKey, oldest] = current.dispatchers.entries().next().value!;
      current.dispatchers.delete(oldestKey);
      oldest.close().catch((): void => undefined);
    }
    current.dispatchers.set(key, dispatcher);
  }
  return dispatcher;
}

type Callback = (error: Error | null, socket?: net.Socket) => void;

function route(options: any, secure: boolean, direct: () => net.Socket, callback: Callback): void {
  const host = bareHost(options.host ?? options.hostname ?? 'localhost');
  const port = Number(options.port) || (secure ? 443 : 80);
  let called = false;
  const done: Callback = (error, socket) => { if (!called) { called = true; callback(error, socket); } };
  resolveProxyFor(`${secure ? 'https' : 'http'}://${authority(host, port)}/`)
    .then(decision => decision === 'direct' ? direct() : connectThroughProxy(decision, {
      host, port, secure,
      ...(options.servername ? { servername: options.servername } : {}),
      ...(Array.isArray(options.ALPNProtocols) ? { ALPNProtocols: options.ALPNProtocols } : {}),
      ...(options.ca ? { ca: options.ca } : {}),
    }))
    .then(socket => done(null, socket), error => done(error));
}

/** http.Agent whose connections follow the proxy decision for their target (axios http, ws). */
class RoutingHttpAgent extends http.Agent {
  createConnection(options: any, callback?: Callback): any {
    route(options, false, () => super.createConnection(options) as net.Socket, callback!);
    return undefined;
  }
}

/** https.Agent whose connections follow the proxy decision for their target (axios https, wss). */
class RoutingHttpsAgent extends https.Agent {
  createConnection(options: any, callback?: Callback): any {
    route(options, true, () => super.createConnection(options) as net.Socket, callback!);
    return undefined;
  }
}

function routingAgents(): { http: http.Agent; https: https.Agent } {
  const current = state();
  // keepAlive off: no pooled socket outlives a settings change.
  return current.agents ??= { http: new RoutingHttpAgent({ keepAlive: false }), https: new RoutingHttpsAgent({ keepAlive: false }) };
}

/** Agents for axios, or undefined when the target is known to connect directly. */
export function axiosAgentsFor(input: string | URL): { httpAgent: http.Agent; httpsAgent: https.Agent } | undefined {
  if (connectsDirectly(input)) return undefined;
  const agents = routingAgents();
  return { httpAgent: agents.http, httpsAgent: agents.https };
}

/** Agent for a ws/wss URL, or undefined when the target is known to connect directly. */
export function webSocketAgentFor(input: string | URL): http.Agent | undefined {
  if (connectsDirectly(input)) return undefined;
  const agents = routingAgents();
  return /^wss:/i.test(String(input)) ? agents.https : agents.http;
}

export function isProxyError(error: unknown): error is ProxyError {
  return error instanceof Error && error.name === 'ProxyError';
}
