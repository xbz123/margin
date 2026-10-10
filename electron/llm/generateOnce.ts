import type { GoogleGenAI } from '@google/genai';
import type OpenAI from 'openai';
import type Anthropic from '@anthropic-ai/sdk';
import type Groq from 'groq-sdk';
import { rethrowProviderScopeError } from './ProviderRouter';
import type { GenerateEvent, GenerateRequest } from './generateContract';

export interface GenerateAccess {
  client: GoogleGenAI | OpenAI | Anthropic | Groq;
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
async function* generateGemini(request: GenerateRequest, access: GenerateAccess): AsyncGenerator<GenerateEvent> {
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
      ? await (access.client as GoogleGenAI).models.generateContentStream(args)
      : await (access.client as GoogleGenAI).models.generateContent(args);
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

function turns(request: GenerateRequest): Array<{ role: 'user' | 'assistant'; parts: any[] }> {
  const contents = typeof request.contents === 'string' ? [{ text: request.contents }] : request.contents;
  if (contents.some(part => 'role' in part)) return contents.map((turn: any) => ({ role: turn.role === 'model' ? 'assistant' : 'user', parts: turn.parts }));
  return [{ role: 'user', parts: [...contents] }];
}

/** One physical send, with protocol completion rather than EOF as the success signal. */
export async function* generateOnce(request: GenerateRequest, access: GenerateAccess): AsyncGenerator<GenerateEvent> {
  if (request.protocol === 'gemini') { yield* generateGemini(request, access); return; }
  const controller = new AbortController();
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
  let iterator: AsyncIterator<any> | Iterator<any> | undefined;
  let text = '', reason: string | undefined, usage: unknown, refused = false, terminal = false;
  let failure: unknown;
  const options = request.providerOptions ?? {};
  const rows = turns(request);
  try {
    if (signal.aborted) { yield { type: 'finish', status: 'cancelled' }; return; }
    let args: any;
    if (request.protocol === 'chat-completions') {
      args = { model: request.model, messages: [
        ...(request.systemInstruction ? [{ role: 'system', content: request.systemInstruction }] : []),
        ...rows.map(row => ({ role: row.role, content: row.parts.map(part => 'text' in part
          ? { type: 'text', text: part.text }
          : { type: 'image_url', image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } }) })),
      ], stream: request.stream, [options.outputTokenField ?? 'max_completion_tokens']: request.maxOutputTokens,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(options.prompt_cache_key ? { prompt_cache_key: options.prompt_cache_key } : {}),
        ...(options.top_p === undefined ? {} : { top_p: options.top_p }),
        ...(options.stop === undefined ? {} : { stop: options.stop }) };
    } else if (request.protocol === 'responses') {
      args = { model: request.model, store: false, stream: request.stream, max_output_tokens: request.maxOutputTokens,
        ...(request.systemInstruction ? { instructions: request.systemInstruction } : {}),
        input: rows.map(row => ({ role: row.role, content: row.parts.map(part => 'text' in part
          ? { type: 'input_text', text: part.text }
          : { type: 'input_image', image_url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`, detail: 'auto' }) })),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(options.prompt_cache_key ? { prompt_cache_key: options.prompt_cache_key } : {}) };
    } else {
      args = { model: request.model, max_tokens: request.maxOutputTokens, stream: true,
        ...(options.systemBlocks ? { system: options.systemBlocks } : request.systemInstruction ? { system: request.systemInstruction } : {}),
        messages: rows.map(row => ({ role: row.role, content: row.parts.map(part => 'text' in part
          ? { type: 'text', text: part.text }
          : { type: 'image', source: { type: 'base64', media_type: part.inlineData.mimeType, data: part.inlineData.data } }) })),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }) };
    }
    access.beforeSend();
    if (signal.aborted) { yield { type: 'finish', status: 'cancelled' }; return; }
    const client: any = access.client;
    const response = request.protocol === 'chat-completions' ? await client.chat.completions.create(args, { signal, maxRetries: 0 })
      : request.protocol === 'responses' ? await client.responses.create(args, { signal, maxRetries: 0 })
      : await client.messages.create(args, { signal, maxRetries: 0 });
    if (signal.aborted) { yield { type: 'finish', status: 'cancelled' }; return; }
    if (request.stream || request.protocol === 'messages') iterator = response[Symbol.asyncIterator]?.() ?? response[Symbol.iterator]();
    else access.response?.(response);
    for (;;) {
      const step = iterator ? await iterator.next() : { done: false, value: response };
      if (signal.aborted) { yield { type: 'finish', status: 'cancelled' }; return; }
      if (step.done) break;
      const chunk = step.value;
      let delta = '';
      if (request.protocol === 'chat-completions') {
        const choice = chunk.choices?.[0];
        reason = choice?.finish_reason ?? reason;
        terminal ||= Boolean(choice?.finish_reason);
        usage = chunk.usage ?? usage;
        refused ||= Boolean((request.stream ? choice?.delta : choice?.message)?.refusal) || reason === 'content_filter';
        delta = (request.stream ? choice?.delta : choice?.message)?.content ?? '';
      } else if (request.protocol === 'responses') {
        if (!iterator) {
          terminal = ['completed', 'failed', 'incomplete', 'cancelled'].includes(chunk.status);
          reason = chunk.status;
          refused = chunk.output?.some((item: any) => item.content?.some((part: any) => part.type === 'refusal')) ?? false;
          delta = chunk.output?.flatMap((item: any) => item.content ?? []).filter((part: any) => part.type === 'output_text').map((part: any) => part.text).join('') ?? '';
          failure = chunk.error;
          usage = chunk.usage;
          if (chunk.status === 'incomplete') reason = chunk.incomplete_details?.reason ?? 'incomplete';
        } else {
          if (chunk.type === 'response.output_text.delta') delta = chunk.delta;
          refused ||= chunk.type === 'response.refusal.delta' || chunk.type === 'response.refusal.done';
          if (['response.completed', 'response.incomplete', 'response.failed'].includes(chunk.type)) {
            terminal = true;
            reason = chunk.type.slice('response.'.length);
            usage = chunk.response?.usage;
            failure = chunk.response?.error;
            refused ||= chunk.response?.output?.some((item: any) => item.content?.some((part: any) => part.type === 'refusal')) ?? false;
            if (reason === 'incomplete') reason = chunk.response?.incomplete_details?.reason ?? 'incomplete';
            access.response?.(chunk.response);
          }
          if (chunk.type === 'error') { terminal = true; failure = new Error(chunk.message ?? 'Responses stream failed'); reason = 'failed'; }
        }
      } else {
        if (chunk.type === 'message_start') usage = chunk.message?.usage;
        if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') delta = chunk.delta.text;
        if (chunk.type === 'message_delta') { reason = chunk.delta?.stop_reason ?? reason; usage = { ...(usage as any), ...chunk.usage }; }
        if (chunk.type === 'message_stop') terminal = true;
        refused ||= reason === 'refusal';
        if (chunk.type === 'error') { terminal = true; failure = new Error(chunk.error?.message ?? 'Messages stream failed'); reason = 'failed'; }
      }
      if (delta && !refused) { text += delta; yield { type: 'delta', text: delta }; }
      if (!iterator) break;
    }
    if (request.protocol === 'messages') access.response?.({ content: [{ type: 'text', text }], stop_reason: reason, usage });
    const completed = terminal && ['stop', 'completed', 'end_turn', 'stop_sequence'].includes(reason ?? '');
    yield { type: 'finish', status: refused ? 'refused' : failure || reason === 'failed' ? 'failed'
      : reason === 'cancelled' ? 'cancelled' : !completed ? 'incomplete' : !text.trim() ? 'empty' : 'completed',
      ...(reason ? { finishReason: reason } : {}), ...(usage ? { usage } : {}), ...(failure ? { error: failure } : {}) };
  } catch (error) {
    rethrowProviderScopeError(error);
    yield { type: 'finish', status: signal.aborted ? 'cancelled' : 'failed', error };
  } finally {
    controller.abort();
    if (iterator?.return) void Promise.resolve(iterator.return()).catch(() => {});
  }
}
