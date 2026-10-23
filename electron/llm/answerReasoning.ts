import { modelTargetId, type ModelTarget, type ProviderConfiguration, type ReasoningSetting } from '../../src/types/llmTarget';
import { choiceForSetting, reasoningChoices, reasoningForChoice, type ReasoningChoice } from '../../src/types/modelCapabilities';
import type { AnswerReasoningState, ReasoningControlState } from '../../src/types/answerReasoning';
import { effectiveProviderConfiguration } from './llmTarget';

/**
 * The saved default reasoning (S48 C3/C4): a shared choice, or, before the user saves one under the new
 * rule, the saved primary model's older per-model setting that no choice expresses exactly. The older
 * setting applies to that one target only and is shown as awaiting confirmation.
 */
export type SavedReasoning = { choice: ReasoningChoice } | { legacy: ReasoningSetting; target: string };

/** An official target with the address requests actually use, so a development endpoint stays unknown. */
export function capabilityTarget(target: ModelTarget): ModelTarget {
  if (target.provider === 'gateway') return target;
  return { ...target, baseUrl: effectiveProviderConfiguration(target as ProviderConfiguration).baseUrl };
}

/** Whether `source` can be applied to `target` as it is. */
export function reasoningApplies(target: ModelTarget, source: SavedReasoning | ReasoningChoice): boolean {
  if (target.provider === 'gateway') return true;
  if (typeof source === 'object' && 'legacy' in source) return modelTargetId(target) === source.target;
  const choice = typeof source === 'string' ? source : source.choice;
  return reasoningChoices(capabilityTarget(target)).includes(choice);
}

/** Fields the next request sends: nothing for the provider default or for a value the target does not take. */
export function effectiveReasoning(target: ModelTarget, source: SavedReasoning | ReasoningChoice): ReasoningSetting | undefined {
  if (target.provider === 'gateway' || !reasoningApplies(target, source)) return undefined;
  if (typeof source === 'object' && 'legacy' in source) return { ...source.legacy };
  return reasoningForChoice(capabilityTarget(target), typeof source === 'string' ? source : source.choice);
}

/** Reads an older per-model setting of the saved primary model without loss, or keeps it pending. */
export function savedFromLegacy(target: ModelTarget | undefined, legacy: ReasoningSetting | undefined): SavedReasoning {
  if (!target || target.provider === 'gateway' || !legacy) return { choice: 'default' };
  const choice = choiceForSetting(capabilityTarget(target), legacy);
  return choice ? { choice } : { legacy, target: modelTargetId(target) };
}

export const describeLegacy = (setting: ReasoningSetting): string =>
  [setting.thinking && `thinking ${setting.thinking}`, setting.effort && `effort ${setting.effort}`].filter(Boolean).join(', ');

export const NOT_AVAILABLE_NOTICE = 'The selected reasoning level is not available for this model, so the provider default is used.';

/** Control state for one selection; `target` undefined means Codex (source) or an unusable selection. */
export function controlState(selection: string, target: ModelTarget | undefined, source: SavedReasoning | ReasoningChoice, unavailable = false): ReasoningControlState {
  if (unavailable) return { target: selection, mode: 'unavailable', options: ['default'], value: 'default' };
  if (!target || target.provider === 'gateway') return { target: selection, mode: 'source', options: ['default'], value: 'default' };
  const options = reasoningChoices(capabilityTarget(target));
  if (typeof source === 'object' && 'legacy' in source) {
    return reasoningApplies(target, source)
      ? { target: selection, mode: 'official', options, value: 'legacy', pendingLegacy: describeLegacy(source.legacy) }
      : { target: selection, mode: 'official', options, value: 'default', notice: NOT_AVAILABLE_NOTICE };
  }
  const choice = typeof source === 'string' ? source : source.choice;
  return options.includes(choice) ? { target: selection, mode: 'official', options, value: choice }
    : { target: selection, mode: 'official', options, value: 'default', notice: NOT_AVAILABLE_NOTICE };
}

/** Saved default (for the saved primary model) and session state, as every window shows them. */
export function answerReasoningState(manager: { getDefaultModel(): string; resolveSelection(selection: string): ModelTarget; getSavedReasoning(): SavedReasoning },
  session: AnswerReasoningState['session'], notice?: string): AnswerReasoningState {
  const selection = manager.getDefaultModel();
  let saved: ReasoningControlState;
  try {
    const target = selection.startsWith('codex-cli') ? undefined : manager.resolveSelection(selection);
    saved = controlState(target ? modelTargetId(target) : selection, target, manager.getSavedReasoning());
  } catch { saved = controlState(selection, undefined, { choice: 'default' }, true); }
  return { saved, session: notice ? { ...session, notice } : session };
}
