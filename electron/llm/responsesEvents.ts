import type { GenerateEvent } from './generateContract';

/** Responses events only: neither credentials nor endpoint/request serialization. */
export async function* parseResponsesEvents(events: AsyncIterable<any>, signal?: AbortSignal, response?: (value: unknown) => void): AsyncGenerator<GenerateEvent> {
  let hasVisibleText = false, refused = false;
  for await (const event of events) {
    if (signal?.aborted) { yield { type: 'finish', status: 'cancelled' }; return; }
    refused ||= event.type === 'response.refusal.delta' || event.type === 'response.refusal.done';
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string' && !refused) {
      hasVisibleText ||= Boolean(event.delta.trim()); yield { type: 'delta', text: event.delta };
    }
    if (['response.completed', 'response.incomplete', 'response.failed', 'response.cancelled', 'error'].includes(event.type)) {
      const result = event.response;
      response?.(result);
      refused ||= result?.output?.some((item: any) => item.content?.some((part: any) => part.type === 'refusal')) ?? false;
      const reason = event.type === 'response.incomplete' ? result?.incomplete_details?.reason ?? 'incomplete' : event.type.replace('response.', '');
      const failure = event.type === 'error' ? event.error ?? new Error(event.message ?? 'Responses stream failed') : result?.error;
      yield { type: 'finish', status: refused ? 'refused' : failure || ['response.failed', 'error'].includes(event.type) ? 'failed'
        : event.type === 'response.cancelled' ? 'cancelled' : event.type !== 'response.completed' ? 'incomplete' : hasVisibleText ? 'completed' : 'empty',
        finishReason: reason, ...(result?.usage ? { usage: result.usage } : {}), ...(failure ? { error: failure } : {}) };
      return;
    }
  }
  yield { type: 'finish', status: signal?.aborted ? 'cancelled' : refused ? 'refused' : 'incomplete' };
}
