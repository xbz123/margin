import net from 'net';
import type { NetworkProxyMode, NetworkProxyProtocol, NetworkProxySettings } from '../../../src/types/networkProxy';

// Validation and host matching for the network proxy. Pure functions: no I/O, no state.

// Shared with the settings page, which shows this refusal by its exact text.
export { PROXY_PASSWORD_REENTRY } from '../../../src/types/networkProxy';

export const DEFAULT_NETWORK_PROXY: Readonly<NetworkProxySettings> = Object.freeze({
  mode: 'system', protocol: 'http', host: '', port: 0, bypass: Object.freeze([]) as unknown as string[],
});

/** Domestic services that always connect directly, in every mode (the proxy is for foreign traffic only). */
export const BUILT_IN_DIRECT: readonly string[] = Object.freeze(['dashscope.aliyuncs.com', '.aliyuncs.com', 'openspeech.bytedance.com']);

export const MAX_BYPASS_ENTRIES = 64;
const MAX_BYPASS_LENGTH = 255;
const MAX_CREDENTIAL_LENGTH = 255;
const MODES: readonly NetworkProxyMode[] = ['system', 'manual', 'off'];
const PROTOCOLS: readonly NetworkProxyProtocol[] = ['http', 'https', 'socks5'];
const LABEL = /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/;

export class InvalidProxySettings extends Error {
  constructor() { super('Invalid proxy settings'); this.name = 'InvalidProxySettings'; }
}

function invalid(): never { throw new InvalidProxySettings(); }

/** Bare host name (lower case) or IP literal; IPv6 may be bracketed and is returned without brackets. */
export function normalizeProxyHost(value: unknown): string {
  if (typeof value !== 'string') invalid();
  const raw = value;
  if (!raw || raw.length > 255 || /[\s\0]/.test(raw)) invalid();
  const unbracketed = /^\[(.*)\]$/.exec(raw)?.[1];
  if (unbracketed !== undefined) {
    if (net.isIPv6(unbracketed)) return unbracketed.toLowerCase();
    invalid();
  }
  if (net.isIPv6(raw)) return raw.toLowerCase();
  if (net.isIPv4(raw)) return raw;
  const host = raw.toLowerCase().replace(/\.$/, '');
  // Rejects schemes, paths, user info, queries, fragments, ports and any other punctuation.
  if (!host || !host.split('.').every(label => LABEL.test(label))) invalid();
  return host;
}

export function normalizeProxyPort(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) invalid();
  return value;
}

function credential(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > MAX_CREDENTIAL_LENGTH || /[\r\n\0]/.test(value)) invalid();
  if (Buffer.byteLength(value) > MAX_CREDENTIAL_LENGTH) invalid();
  return value;
}

/** One bypass entry: host name, `*.domain` / `.domain` suffix, or IP literal. Returned in canonical form. */
export function normalizeBypassEntry(value: unknown): string {
  if (typeof value !== 'string') invalid();
  const raw = value.trim().toLowerCase();
  if (!raw || raw.length > MAX_BYPASS_LENGTH) invalid();
  const suffix = /^(?:\*\.|\.)(.+)$/.exec(raw);
  if (suffix) {
    const host = normalizeProxyHost(suffix[1]);
    if (net.isIP(host)) invalid();
    return '.' + host;
  }
  return normalizeProxyHost(raw);
}

/** Validates a whole settings object; throws InvalidProxySettings and never returns a partial value. */
export function normalizeNetworkProxySettings(input: unknown): NetworkProxySettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const value = input as Record<string, unknown>;
  const mode = value.mode as NetworkProxyMode;
  const protocol = (value.protocol ?? 'http') as NetworkProxyProtocol;
  if (!MODES.includes(mode) || !PROTOCOLS.includes(protocol)) invalid();
  const rawHost = value.host ?? '';
  const rawPort = value.port ?? 0;
  let host = '', port = 0;
  if (mode === 'manual' || rawHost !== '') host = normalizeProxyHost(rawHost);
  if (mode === 'manual' || rawPort !== 0) port = normalizeProxyPort(rawPort);
  const bypassInput = value.bypass ?? [];
  if (!Array.isArray(bypassInput) || bypassInput.length > MAX_BYPASS_ENTRIES) invalid();
  const bypass = [...new Set(bypassInput.map(normalizeBypassEntry))];
  const username = credential(value.username);
  const password = credential(value.password);
  return { mode, protocol, host, port, ...(username ? { username } : {}), ...(password ? { password } : {}), bypass };
}

/** Host part of a URL without IPv6 brackets or a trailing dot, lower case. */
export function urlHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

const LOOPBACK = new net.BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');
const PRIVATE = new net.BlockList();
for (const [address, prefix] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16]] as const) PRIVATE.addSubnet(address, prefix, 'ipv4');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');
PRIVATE.addSubnet('fe80::', 10, 'ipv6');

function inList(list: net.BlockList, host: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(host)?.[1];
  if (mapped) return list.check(mapped, 'ipv4');
  const family = net.isIP(host);
  return family === 4 ? list.check(host, 'ipv4') : family === 6 ? list.check(host, 'ipv6') : false;
}

/** Loopback names and addresses. */
export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || inList(LOOPBACK, host);
}

/** Private, link-local and unique-local address literals (never names). */
export function isPrivateAddress(host: string): boolean {
  return inList(PRIVATE, host);
}

/** Matches a host against canonical patterns: exact host / IP, or `.domain` (the domain and its subdomains). */
export function matchesHostPatterns(host: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => pattern.startsWith('.')
    ? host === pattern.slice(1) || host.endsWith(pattern)
    : host === pattern);
}

/** Targets that never use a proxy: loopback, private literals, built-in domestic services, user bypass. */
export function alwaysDirect(host: string, bypass: readonly string[]): boolean {
  return isLoopbackHost(host) || isPrivateAddress(host) || matchesHostPatterns(host, BUILT_IN_DIRECT) || matchesHostPatterns(host, bypass);
}
