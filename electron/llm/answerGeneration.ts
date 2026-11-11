import type { LLMHelper } from '../LLMHelper';
import type { TranscriptView } from '../SessionTracker';
import { ManualAnswerConfigurationError } from '../direct-assist/errors';
import { codexSourceAvailable } from '../../src/types/codexSource';

export function isPendingAnswerSentinel(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, '');
  return ['nothing actionable right now', 'nothing to capture right now'].some(sentinel => sentinel.startsWith(normalized));
}

/**
 * What to Answer's explicit question: the interviewer's last few turns in the context the answer
 * reads (an unfinished turn included), oldest first, keeping the newest text within the cap.
 */
export function latestInterviewerQuestion(items: readonly { role: string; text: string }[], turns = 4, maxChars = 8192): string | undefined {
  let text = items.filter(item => item.role === 'interviewer' && item.text.trim())
    .slice(-turns).map(item => item.text.trim()).join('\n').slice(-maxChars);
  // The cut may land inside a surrogate pair; drop the orphaned low half it leaves.
  if (/^[\uDC00-\uDFFF]/.test(text)) text = text.slice(1);
  text = text.trim();
  return text || undefined;
}

/**
 * Prepare the existing WhatToAnswer -> streamChat -> GenerateRequest path, not another transport.
 * `freeze` waits for the action's speech and returns the view the answer reads.
 */
export async function prepareManualAnswer(helper: LLMHelper, freeze?: (signal: AbortSignal) => Promise<TranscriptView | void>): Promise<TranscriptView | void> {
  const task = helper.getCurrentGenerationTask();
  if (!task) throw new ManualAnswerConfigurationError();
  const selected = task.primary;
  if (!selected.target.model.trim() || (selected.kind === 'api' ? !selected.client
    : !codexSourceAvailable(selected.codex))) throw new ManualAnswerConfigurationError();
  task.check();
  const view = await freeze?.(task.signal);
  // Cancellation while freezing must not fall through into a fresh generation.
  task.check();
  return view;
}
