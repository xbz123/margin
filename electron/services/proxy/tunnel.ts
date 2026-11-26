import net from 'net';
import tls from 'tls';
import type { NetworkProxyProtocol } from '../../../src/types/networkProxy';

// One tunnel implementation for every outbound channel: HTTP CONNECT (optionally over TLS to
// the proxy) and SOCKS5 (RFC 1928 / RFC 1929). The returned socket reaches the target; TLS to
// the target is layered on top by the caller, so the target's certificate is what gets verified.

export interface ProxyEndpoint {
  protocol: NetworkProxyProtocol;
  host: string;
  port: number;
  auth?: { username: string; password: string };
}

export interface TunnelTarget { host: string; port: number }

export type ProxyErrorCode = 'PROXY_UNREACHABLE' | 'PROXY_AUTH_REQUIRED' | 'PROXY_AUTH_FAILED' | 'PROXY_REFUSED' | 'PROXY_PROTOCOL';

const MESSAGES: Record<ProxyErrorCode, string> = {
  PROXY_UNREACHABLE: 'The proxy server could not be reached.',
  PROXY_AUTH_REQUIRED: 'The proxy server requires authentication.',
  PROXY_AUTH_FAILED: 'The proxy server rejected the proxy credentials.',
  PROXY_REFUSED: 'The proxy server refused the connection to the destination.',
  PROXY_PROTOCOL: 'The proxy server returned an invalid response.',
};

/** The fixed message for each code, for callers that turn a ProxyError into UI text by its code. */
export const PROXY_ERROR_MESSAGES: Readonly<Record<ProxyErrorCode, string>> = Object.freeze({ ...MESSAGES });

/** Fixed messages only: never proxy response text, credentials or target paths. */
export class ProxyError extends Error {
  readonly code: ProxyErrorCode;
  constructor(code: ProxyErrorCode) {
    super(MESSAGES[code]);
    this.name = 'ProxyError';
    this.code = code;
  }
}

/** The ProxyError anywhere in an error's cause chain (fetch reports it as "fetch failed", SDKs as connection errors). */
export function proxyErrorIn(error: unknown): ProxyError | undefined {
  const seen = new Set<unknown>();
  for (let cause: any = error; cause && typeof cause === 'object' && !seen.has(cause); cause = cause.cause) {
    seen.add(cause);
    if (cause instanceof ProxyError || cause.name === 'ProxyError') return cause as ProxyError;
  }
  return undefined;
}

export const PROXY_CONNECT_TIMEOUT_MS = 15_000;
const MAX_CONNECT_RESPONSE_BYTES = 16 * 1024;

/** Authority form for CONNECT and Host: IPv6 literals are bracketed. */
export function authority(host: string, port: number): string {
  return `${net.isIPv6(host) ? `[${host}]` : host}:${port}`;
}

function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

/** Buffered reader over a socket in paused mode, so no byte is lost before the tunnel is handed over. */
class HandshakeReader {
  private buffer = Buffer.alloc(0);
  private wake: (() => void) | undefined;
  private ended = false;
  private readonly onReadable = () => {
    let chunk: Buffer | null;
    while ((chunk = this.socket.read()) !== null) this.buffer = Buffer.concat([this.buffer, chunk]);
    this.wake?.();
  };
  private readonly onEnd = () => { this.ended = true; this.wake?.(); };

  constructor(private readonly socket: net.Socket) {
    socket.on('readable', this.onReadable);
    socket.on('end', this.onEnd);
  }

  /** Waits until `size(buffer)` returns a byte count that is available, then consumes it. */
  async take(size: (buffer: Buffer) => number | undefined, limit: number): Promise<Buffer> {
    for (;;) {
      const needed = size(this.buffer);
      if (needed !== undefined && this.buffer.length >= needed) {
        const out = this.buffer.subarray(0, needed);
        this.buffer = this.buffer.subarray(needed);
        return out;
      }
      if (this.buffer.length > limit) throw new ProxyError('PROXY_PROTOCOL');
      if (this.ended || this.socket.destroyed) throw new ProxyError('PROXY_PROTOCOL');
      await new Promise<void>(resolve => { this.wake = resolve; });
      this.wake = undefined;
    }
  }

  exact(count: number): Promise<Buffer> { return this.take(() => count, count); }

  /** Detaches; any unread byte means the proxy spoke out of turn (all our protocols are client-first). */
  detach(): void {
    this.socket.removeListener('readable', this.onReadable);
    this.socket.removeListener('end', this.onEnd);
    if (this.buffer.length) throw new ProxyError('PROXY_PROTOCOL');
  }
}

async function httpConnect(socket: net.Socket, reader: HandshakeReader, target: TunnelTarget, proxy: ProxyEndpoint): Promise<void> {
  const where = authority(target.host, target.port);
  const lines = [`CONNECT ${where} HTTP/1.1`, `Host: ${where}`];
  // Proxy credentials only ever travel in this request to the proxy, never into the tunnel.
  if (proxy.auth) lines.push(`Proxy-Authorization: Basic ${Buffer.from(`${proxy.auth.username}:${proxy.auth.password}`).toString('base64')}`);
  socket.write(lines.join('\r\n') + '\r\n\r\n');
  const head = await reader.take(buffer => {
    const end = buffer.indexOf('\r\n\r\n');
    return end < 0 ? undefined : end + 4;
  }, MAX_CONNECT_RESPONSE_BYTES);
  if (head.length > MAX_CONNECT_RESPONSE_BYTES) throw new ProxyError('PROXY_PROTOCOL');
  const status = /^HTTP\/1\.[01] (\d{3})(?: |\r)/.exec(head.toString('latin1'));
  if (!status) throw new ProxyError('PROXY_PROTOCOL');
  const code = Number(status[1]);
  if (code >= 200 && code < 300) return;
  // Redirects and every other status are failures; nothing is ever followed or retried.
  if (code === 407) throw new ProxyError(proxy.auth ? 'PROXY_AUTH_FAILED' : 'PROXY_AUTH_REQUIRED');
  throw new ProxyError('PROXY_REFUSED');
}

async function socks5Connect(socket: net.Socket, reader: HandshakeReader, target: TunnelTarget, proxy: ProxyEndpoint): Promise<void> {
  socket.write(Buffer.from(proxy.auth ? [5, 2, 0x00, 0x02] : [5, 1, 0x00]));
  const [version, method] = await reader.exact(2);
  if (version !== 5) throw new ProxyError('PROXY_PROTOCOL');
  if (method === 0xff) throw new ProxyError(proxy.auth ? 'PROXY_AUTH_FAILED' : 'PROXY_AUTH_REQUIRED');
  if (method === 0x02) {
    if (!proxy.auth) throw new ProxyError('PROXY_PROTOCOL');
    const user = Buffer.from(proxy.auth.username), pass = Buffer.from(proxy.auth.password);
    if (user.length > 255 || pass.length > 255) throw new ProxyError('PROXY_AUTH_FAILED');
    socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
    const [, status] = await reader.exact(2);
    if (status !== 0) throw new ProxyError('PROXY_AUTH_FAILED');
  } else if (method !== 0x00) {
    throw new ProxyError('PROXY_PROTOCOL');
  }
  // Names are sent as names (ATYP 3) so the proxy resolves them; only literals use address types.
  let address: Buffer;
  if (net.isIPv4(target.host)) address = Buffer.from([1, ...target.host.split('.').map(Number)]);
  else if (net.isIPv6(target.host)) address = Buffer.concat([Buffer.from([4]), ipv6Bytes(target.host)]);
  else {
    const name = Buffer.from(target.host);
    if (!name.length || name.length > 255) throw new ProxyError('PROXY_PROTOCOL');
    address = Buffer.concat([Buffer.from([3, name.length]), name]);
  }
  const port = Buffer.alloc(2); port.writeUInt16BE(target.port);
  socket.write(Buffer.concat([Buffer.from([5, 1, 0]), address, port]));
  const head = await reader.exact(4);
  if (head[0] !== 5) throw new ProxyError('PROXY_PROTOCOL');
  if (head[1] !== 0) throw new ProxyError('PROXY_REFUSED');
  const kind = head[3];
  const length = kind === 1 ? 4 : kind === 4 ? 16 : kind === 3 ? (await reader.exact(1))[0] : -1;
  if (length < 0) throw new ProxyError('PROXY_PROTOCOL');
  await reader.exact(length + 2);
}

function ipv6Bytes(host: string): Buffer {
  const expand = (part: string): number[] => part ? part.split(':').flatMap(group => {
    if (!net.isIPv4(group)) return [parseInt(group, 16)];
    const [a, b, c, d] = group.split('.').map(Number);
    return [(a << 8) | b, (c << 8) | d];
  }) : [];
  const [left, right] = host.split('::');
  const head = expand(left), tail = right === undefined ? [] : expand(right);
  const groups = right === undefined ? head : [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail];
  const out = Buffer.alloc(16);
  groups.forEach((value, index) => out.writeUInt16BE(value & 0xffff, index * 2));
  return out;
}

export interface TunnelOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Extra trust anchors for an HTTPS proxy (tests only); verification is never disabled. */
  ca?: string | Buffer | Array<string | Buffer>;
}

/** Opens a socket to `target` through `proxy`. Rejects with ProxyError (or AbortError) and destroys the socket on failure. */
export function openTunnel(target: TunnelTarget, proxy: ProxyEndpoint, options: TunnelOptions = {}): Promise<net.Socket> {
  const { signal, timeoutMs = PROXY_CONNECT_TIMEOUT_MS } = options;
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<net.Socket>((resolve, reject) => {
    let settled = false;
    let connected = false;
    const socket: net.Socket = proxy.protocol === 'https'
      ? tls.connect({ host: proxy.host, port: proxy.port, ...(net.isIP(proxy.host) ? {} : { servername: proxy.host }), ...(options.ca ? { ca: options.ca } : {}), ALPNProtocols: ['http/1.1'] })
      : net.connect({ host: proxy.host, port: proxy.port });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
      if (error) { socket.destroy(); reject(error); } else resolve(socket);
    };
    const onAbort = () => finish(abortError());
    const onError = (error: Error) => finish(error instanceof ProxyError ? error : new ProxyError(connected ? 'PROXY_PROTOCOL' : 'PROXY_UNREACHABLE'));
    const onClose = () => finish(new ProxyError(connected ? 'PROXY_PROTOCOL' : 'PROXY_UNREACHABLE'));
    const timer = setTimeout(() => finish(new ProxyError('PROXY_UNREACHABLE')), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.on('error', onError);
    socket.on('close', onClose);
    socket.once(proxy.protocol === 'https' ? 'secureConnect' : 'connect', () => {
      connected = true;
      const reader = new HandshakeReader(socket);
      (proxy.protocol === 'socks5' ? socks5Connect : httpConnect)(socket, reader, target, proxy)
        .then(() => { reader.detach(); finish(); })
        .catch(error => finish(error instanceof ProxyError ? error : new ProxyError('PROXY_PROTOCOL')));
    });
  });
}

export interface TargetTlsOptions {
  servername?: string;
  ALPNProtocols?: string[];
  ca?: string | Buffer | Array<string | Buffer>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** TLS to the target over an established tunnel; the target certificate is verified normally. */
export function connectTargetTls(socket: net.Socket, host: string, options: TargetTlsOptions = {}): Promise<tls.TLSSocket> {
  const { signal, timeoutMs = PROXY_CONNECT_TIMEOUT_MS } = options;
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const servername = options.servername || (net.isIP(host) ? undefined : host);
    const secure = tls.connect({
      socket, host, ...(servername ? { servername } : {}),
      ...(options.ALPNProtocols ? { ALPNProtocols: options.ALPNProtocols } : {}),
      ...(options.ca ? { ca: options.ca } : {}),
    });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      secure.removeListener('error', finish);
      if (error) { secure.destroy(); socket.destroy(); reject(error); } else resolve(secure);
    };
    const onAbort = () => finish(abortError());
    const timer = setTimeout(() => finish(new Error('TLS handshake timed out')), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    secure.once('secureConnect', () => finish());
    secure.on('error', finish);
  });
}
