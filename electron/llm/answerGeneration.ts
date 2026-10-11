import type { LLMHelper } from '../LLMHelper';
import { ManualAnswerConfigurationError } from '../direct-assist/errors';
import { codexSourceAvailable } from '../../src/types/codexSource';

/** Prepare the existing WhatToAnswer -> streamChat -> GenerateRequest path, not another transport. */
export async function prepareManualAnswer(helper: LLMHelper, finalize?: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const task = helper.getCurrentGenerationTask();
  if (!task) throw new ManualAnswerConfigurationError();
  const selected = task.primary;
  if (!selected.target.model.trim() || (selected.kind === 'api' ? !selected.client
    : !codexSourceAvailable(selected.codex))) throw new ManualAnswerConfigurationError();
  task.check();
  await finalize?.(task.signal);
  // Cancellation during finalization must not fall through into a fresh generation.
  task.check();
}
