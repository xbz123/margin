import {
  buildTemporalContext,
  prepareTranscriptForWhatToAnswer,
} from '../llm';
import type { AssistantResponse, ContextItem } from '../llm/TemporalContextBuilder';

export type PreparedContextItem = ContextItem;

export interface PreparedContextSession {
  getContextWithInterim(lastSeconds: number): PreparedContextItem[];
  getAssistantResponseHistory(): AssistantResponse[];
}

/**
 * Build transcript context aligned with What-to-Answer: cleaned turns,
 * interim interviewer speech, and recent assistant responses. The responses are
 * profile_history data; callers pass `includeAssistantResponses: false` when that
 * scope is denied (PLAN.md AG-17 fourth review).
 */
export function buildPreparedTranscriptContext(
  session: PreparedContextSession,
  lastSeconds: number = 180,
  includeAssistantResponses: boolean = true,
): string {
  const contextItems = session.getContextWithInterim(lastSeconds);
  if (contextItems.length === 0) return '';

  const transcriptTurns = contextItems.map((item) => ({
    role: item.role,
    text: item.text,
    timestamp: item.timestamp,
  }));

  const preparedTranscript = prepareTranscriptForWhatToAnswer(transcriptTurns, 12);
  const temporalContext = buildTemporalContext(
    contextItems,
    session.getAssistantResponseHistory(),
    lastSeconds,
  );

  const parts: string[] = [preparedTranscript];
  if (includeAssistantResponses && temporalContext.hasRecentResponses && temporalContext.previousResponses.length > 0) {
    parts.push(
      '[RECENT ASSISTANT RESPONSES]\n' +
        temporalContext.previousResponses.map((r) => `- ${r}`).join('\n'),
    );
  }
  return parts.filter(Boolean).join('\n\n');
}
