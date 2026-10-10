import type { GoogleGenAI } from '@google/genai';
import { rethrowProviderScopeError } from './ProviderRouter';
import type { GenerateEvent, GenerateRequest } from './generateContract';

export interface GenerateAccess {
  client: GoogleGenAI;
  /** Reads current policy, including the logical request's declared scopes. */
  beforeSend: () => void;
  /** Keeps the unused legacy SDK proxy compatible without polluting event data. */
  response?: (response: unknown) => void;
}

function responseText(response: any): string {
  const parts = response.candidates?.[0]?.content?.parts;
  if (parts) return (Array.isArray(parts) ? parts : [parts])
    .filter((part: any) => part?.thought !== true && typeof part?.text === 'string')
    .map((part: any) => part.text).join('');
  if (typeof response.candidates?.[0]?.content === 'string') return response.candidates[0].content;
  return typeof response.text === 'function' ? response.text() : typeof response.text === 'string' ? response.text : '';
}

/** Gemini serialization and finish interpretation for exactly one SDK call. */
export async function* generateOnce(request: GenerateRequest, access: GenerateAccess): AsyncGenerator<GenerateEvent> {
  let reason: string | undefined;
  let usage: unknown;
  let text = '';
  let refused = false;
  let iterator: AsyncIterator<any> | Iterator<any> | undefined;
  const controller = new AbortController();
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
  try {
    if (request.signal?.aborted) { yield { type: 'finish', status: 'cancelled' }; return; }
    const args = {
      model: request.model,
      contents: request.contents as any,
      config: {
        ...request.providerOptions,
        maxOutputTokens: request.maxOutputTokens,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.cacheReference ? { cachedContent: request.cacheReference }
          : request.systemInstruction ? { systemInstruction: { parts: [{ text: request.systemInstruction }] } } : {}),
        abortSignal: signal,
        httpOptions: { retryOptions: { attempts: 1 } },
      },
    };
    access.beforeSend();
    if (signal.aborted) { yield { type: 'finish', status: 'cancelled' }; return; }
    const response: any = request.stream
      ? await access.client.models.generateContentStream(args)
      : await access.client.models.generateContent(args);
    if (request.signal?.aborted) { yield { type: 'finish', status: 'cancelled' }; return; }
    if (request.stream) {
      const stream = response.stream ?? response;
      iterator = stream[Symbol.asyncIterator]?.() ?? stream[Symbol.iterator]();
    }
    else access.response?.(response);
    for (;;) {
      const step = iterator ? await iterator.next() : { done: false, value: response };
      if (request.signal?.aborted) { yield { type: 'finish', status: 'cancelled' }; return; }
      if (step.done) break;
      const chunk = step.value;
      reason = chunk.candidates?.[0]?.finishReason ?? reason;
      usage = chunk.usageMetadata ?? usage;
      refused ||= Boolean(chunk.promptFeedback?.blockReason) || ['SAFETY', 'PROHIBITED_CONTENT', 'RECITATION', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY'].includes(reason ?? '');
      const delta = refused ? '' : responseText(chunk);
      if (delta) { text += delta; yield { type: 'delta', text: delta }; }
      if (!iterator) break;
    }
    yield { type: 'finish', status: refused ? 'refused' : reason && reason !== 'STOP' ? 'incomplete'
      : !text.trim() ? 'empty' : reason === 'STOP' ? 'completed' : 'incomplete',
      ...(reason ? { finishReason: reason } : {}), ...(usage ? { usage } : {}) };
  } catch (error) {
    rethrowProviderScopeError(error);
    yield { type: 'finish', status: request.signal?.aborted ? 'cancelled' : 'failed', error };
  } finally {
    controller.abort();
    // Do not wait indefinitely for an SDK iterator that is still reading the network.
    if (iterator?.return) void Promise.resolve(iterator.return()).catch(() => {});
  }
}
