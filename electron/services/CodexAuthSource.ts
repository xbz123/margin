import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CODEX_ENDPOINT, assertCodexConsent, validateCodexModel, validateCodexSourceConfig, type CodexSourceConfig, type CodexSourceStatus } from '../../src/types/codexSource';
import { outboundFetch, createOutboundFetch } from './outbound';
import { parseResponsesEvents } from '../llm/responsesEvents';
import type { GenerateEvent } from '../llm/generateContract';
export { DEFAULT_CODEX_SOURCE_CONFIG, validateCodexSourceConfig } from '../../src/types/codexSource';

export const MAX_CODEX_AUTH_BYTES = 64 * 1024;
const MAX_SSE_FRAME_CHARS = 1024 * 1024;
type Auth = { token: string; account: string; expiresAt: number };
export class CodexSourceError extends Error {
  constructor(readonly kind: 'file-unavailable' | 'invalid' | 'expired' | 'transport', readonly status?: number, readonly code?: string, readonly headers?: Headers) {
    super(kind === 'file-unavailable' ? 'No readable Codex auth file. Keyring and ephemeral storage are unsupported; do not downgrade storage.'
      : kind === 'expired' ? 'Codex login has expired. Sign in again externally; Margin never refreshes or writes credentials.'
      : kind === 'invalid' ? 'Codex auth file format, account or expiry is unsupported.' : `Codex source request failed${status ? ` (HTTP ${status})` : ''}. No real-service verification is claimed.`);
    this.name = 'CodexSourceError';
  }
}
const SAFE_ERROR_CODES = new Set(['model_not_found', 'model_decommissioned', 'model_not_available', 'unsupported_image', 'image_not_supported', 'invalid_image', 'invalid_image_format', 'invalid_image_url', 'insufficient_quota', 'invalid_api_key']);
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);
async function safeHttpFailure(response: Response, signal: AbortSignal): Promise<CodexSourceError> {
  const reader = response.body?.getReader(); let text = '', size = 0, code: string | undefined;
  const abort = () => { void reader?.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try {
    const decoder = new TextDecoder();
    while (reader) {
      signal.throwIfAborted(); const step = await reader.read(); signal.throwIfAborted();
      if (step.done) break;
      size += step.value.byteLength; if (size > 16_384) break;
      text += decoder.decode(step.value, { stream: true });
    }
    if (size <= 16_384) { try { const parsed = JSON.parse(text), candidate = parsed.error?.code ?? parsed.code; if (SAFE_ERROR_CODES.has(candidate)) code = candidate; } catch {} }
  } catch { signal.throwIfAborted(); }
  finally { signal.removeEventListener('abort', abort); await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
  const raw = response.headers.get('retry-after');
  const retryAfter = raw && raw.length <= 64 && (/^\d+(?:\.\d+)?$/.test(raw) || Number.isFinite(Date.parse(raw))) ? raw : undefined;
  return new CodexSourceError('transport', response.status, code, retryAfter ? new Headers({ 'retry-after': retryAfter }) : undefined);
}

export async function readCodexAuthFile(filename: string, signal?: AbortSignal): Promise<string> {
  let file: fs.promises.FileHandle | undefined;
  try {
    signal?.throwIfAborted();
    const before = await fs.promises.lstat(filename); signal?.throwIfAborted();
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_CODEX_AUTH_BYTES) throw new CodexSourceError('invalid');
    file = await fs.promises.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    signal?.throwIfAborted();
    const stat = await file.stat(); signal?.throwIfAborted();
    if (!stat.isFile() || stat.size > MAX_CODEX_AUTH_BYTES || stat.dev !== before.dev || stat.ino !== before.ino) throw new CodexSourceError('invalid');
    const bytes = Buffer.alloc(MAX_CODEX_AUTH_BYTES + 1);
    let length = 0;
    for (;;) {
      signal?.throwIfAborted();
      const result = await file.read(bytes, length, bytes.length - length, null);
      signal?.throwIfAborted();
      length += result.bytesRead;
      if (length > MAX_CODEX_AUTH_BYTES) throw new CodexSourceError('invalid');
      if (!result.bytesRead) break;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } catch (error) { signal?.throwIfAborted(); throw error instanceof CodexSourceError ? error : new CodexSourceError('file-unavailable'); }
  finally { await file?.close().catch(() => {}); }
}

export function parseCodexAuth(text: string, now = Date.now()): Auth {
  try {
    if (Buffer.byteLength(text) > MAX_CODEX_AUTH_BYTES) throw new Error();
    const data = JSON.parse(text), tokens = data.tokens;
    if (!data || Array.isArray(data) || data.auth_mode !== undefined && data.auth_mode !== 'chatgpt' || data.OPENAI_API_KEY || !tokens || Array.isArray(tokens)) throw new Error();
    const token = tokens.access_token, account = tokens.account_id;
    if (typeof token !== 'string' || token.length > MAX_CODEX_AUTH_BYTES || !/^[A-Za-z0-9._~-]+$/.test(token)
        || typeof account !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(account)) throw new Error();
    // Decoding supplies only local expiry/consistency checks, not signature verification.
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!Number.isFinite(claims.exp) || claims.exp <= 0) throw new Error();
    const claimAccount = claims['https://api.openai.com/auth']?.chatgpt_account_id;
    if (claimAccount !== undefined && claimAccount !== account) throw new Error();
    const expiresAt = claims.exp * 1000;
    if (!Number.isFinite(expiresAt)) throw new Error();
    if (expiresAt <= now) throw new CodexSourceError('expired');
    return { token, account, expiresAt };
  } catch (error) { throw error instanceof CodexSourceError ? error : new CodexSourceError('invalid'); }
}

export interface CodexSourceRequest { model: string; contents: any[]; systemInstruction?: string; signal: AbortSignal }
export function codexRequestBody(config: CodexSourceConfig, request: CodexSourceRequest): object {
  validateCodexSourceConfig(config);
  validateCodexModel(request.model);
  const rows = request.contents.some(part => part.parts) ? request.contents : [{ role: 'user', parts: request.contents }];
  const input = rows.map(part => ({ role: part.role === 'model' ? 'assistant' : part.role === 'assistant' ? 'assistant' : 'user',
    content: (part.parts ?? [part]).map((item: any) => typeof item.text === 'string' ? { type: 'input_text', text: item.text }
      : item.inlineData ? { type: 'input_image', image_url: `data:${item.inlineData.mimeType};base64,${item.inlineData.data}`, detail: 'auto' }
        : (() => { throw new Error('Invalid Codex input'); })()) }));
  return { model: request.model, stream: true, store: false, instructions: request.systemInstruction ?? '', input,
    ...(config.modelReasoningEffort ? { reasoning: { effort: config.modelReasoningEffort } } : {}),
    ...(config.serviceTier !== 'default' ? { service_tier: config.serviceTier } : {}) };
}

async function* sseEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<any> {
  const reader = body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const step = await reader.read(); signal.throwIfAborted();
      buffer += step.done ? decoder.decode() : decoder.decode(step.value, { stream: true });
      // Normalize CRLF only after a complete line (including a split CR/LF).
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        if (frame.length > MAX_SSE_FRAME_CHARS) throw new CodexSourceError('transport');
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data || data === '[DONE]') continue;
        let event: any; try { event = JSON.parse(data); } catch { throw new CodexSourceError('transport'); }
        // Remote error bodies/usage details never enter errors or logs.
        if (event.type === 'error') yield { type: 'error', error: new CodexSourceError('transport', undefined, SAFE_ERROR_CODES.has(event.code ?? event.error?.code) ? event.code ?? event.error.code : undefined) };
        else if (['response.completed', 'response.incomplete', 'response.failed', 'response.cancelled'].includes(event.type)) {
          const usage = event.response?.usage;
          yield { type: event.type, response: { output: event.response?.output?.map((item: any) => ({ content: item.content?.filter((part: any) => part.type === 'refusal').map(() => ({ type: 'refusal' })) })),
            ...(event.type === 'response.failed' ? { error: new CodexSourceError('transport', undefined, SAFE_ERROR_CODES.has(event.response?.error?.code) ? event.response.error.code : undefined) } : {}),
            ...(usage ? { usage: Object.fromEntries(['input_tokens', 'output_tokens', 'total_tokens'].filter(key => Number.isFinite(usage[key])).map(key => [key, usage[key]])) } : {}) } };
        } else if (['response.output_text.delta', 'response.refusal.delta', 'response.refusal.done'].includes(event.type)) yield { type: event.type, delta: event.delta };
      }
      if (buffer.length > MAX_SSE_FRAME_CHARS) throw new CodexSourceError('transport');
      if (step.done) return;
    }
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Dependency injection is main/test-only; neither the IPC config nor renderer can choose transport/path. */
export class CodexAuthSource {
  constructor(private readonly read = (signal?: AbortSignal) => readCodexAuthFile(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json'), signal),
    private readonly transport: typeof fetch = outboundFetch) {}

  async status(config: CodexSourceConfig, signal?: AbortSignal): Promise<CodexSourceStatus> {
    if (!config.enabled) return { success: false, status: 'disabled', message: 'Codex login source is disabled.' };
    try { assertCodexConsent(config); }
    catch { return { success: false, status: 'confirmation-required', message: 'Confirm current risks before reading the auth file.' }; }
    try { signal?.throwIfAborted(); parseCodexAuth(await this.read(signal)); signal?.throwIfAborted(); return { success: true, status: 'locally-valid', message: 'Local file checks passed. Account entitlement, models and service connectivity are unverified.' }; }
    catch (error) { signal?.throwIfAborted(); const safe = error instanceof CodexSourceError ? error : new CodexSourceError('file-unavailable'); return { success: false, status: safe.kind === 'transport' ? 'invalid' : safe.kind, message: safe.message }; }
  }

  session(check: () => void) {
    let auth: Auth | undefined, recovered = false, pinnedAccount: string | undefined, signal: AbortSignal | undefined;
    const load = async () => { check(); const value = parseCodexAuth(await this.read(signal)); check(); return value; };
    const generate = async function* (this: CodexAuthSource, config: CodexSourceConfig, request: CodexSourceRequest, beforeSend: () => void): AsyncGenerator<GenerateEvent> {
      check(); assertCodexConsent(config); request.signal.throwIfAborted();
      signal = request.signal;
      auth ??= await load(); pinnedAccount ??= auth.account;
      if (auth.account !== pinnedAccount || auth.expiresAt <= Date.now()) throw new CodexSourceError('expired');
      const body = JSON.stringify(codexRequestBody(config, request));
      check(); request.signal.throwIfAborted(); beforeSend();
      let response: Response | undefined;
      const send = createOutboundFetch(this.transport);
      try { response = await send(CODEX_ENDPOINT, { method: 'POST', redirect: 'error', signal: request.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${auth.token}`, 'ChatGPT-Account-Id': auth.account }, body }); }
      catch (error: any) { request.signal.throwIfAborted(); const code = NETWORK_CODES.has(error?.code) ? error.code : NETWORK_CODES.has(error?.cause?.code) ? error.cause.code : undefined; throw new CodexSourceError('transport', undefined, code); }
      try {
        check(); request.signal.throwIfAborted();
        if (!response.ok) throw await safeHttpFailure(response, request.signal);
        if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new CodexSourceError('transport');
        try { yield* parseResponsesEvents(sseEvents(response.body, request.signal), request.signal); }
        catch (error: any) { request.signal.throwIfAborted(); if (error instanceof CodexSourceError) throw error;
          const code = NETWORK_CODES.has(error?.code) ? error.code : NETWORK_CODES.has(error?.cause?.code) ? error.cause.code : undefined;
          throw new CodexSourceError('transport', undefined, code);
        }
      } finally { await response.body?.cancel().catch(() => {}); }
    }.bind(this);
    return { generate, recover: async (error: unknown) => {
      if (!(error instanceof CodexSourceError) || error.status !== 401 || recovered || !auth) return false;
      recovered = true; const previous = auth; auth = undefined;
      try { const next = await load(); if (next.account !== pinnedAccount || next.token === previous.token) return false; auth = next; return true; }
      catch (failure) { if (failure instanceof CodexSourceError) return false; throw failure; }
    }, dispose: () => { auth = undefined; pinnedAccount = undefined; signal = undefined; } };
  }
}
