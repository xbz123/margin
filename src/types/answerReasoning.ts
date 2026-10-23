import type { ReasoningChoice } from './modelCapabilities';

export type { ReasoningChoice } from './modelCapabilities';

/**
 * What one reasoning control shows (S48). The main process computes it for the exact model the
 * control applies to; a write must name that same `target`, so a late write from a window that still
 * shows an older model is refused.
 */
export interface ReasoningControlState {
  /** Canonical selection (or Codex selector) the state applies to. */
  target: string;
  /** official: choices from the capability record; source: a gateway or Codex sets reasoning in its own configuration; unavailable: the model cannot be used. */
  mode: 'official' | 'source' | 'unavailable';
  options: ReasoningChoice[];
  /** 'legacy' while an older per-model setting is still applied and awaits the user's choice. */
  value: ReasoningChoice | 'legacy';
  /** Readable older setting, e.g. "thinking adaptive, effort high". */
  pendingLegacy?: string;
  /** Why the shown value differs from what was chosen before, e.g. a level the new model does not offer. */
  notice?: string;
}

export interface AnswerReasoningState {
  /** The saved default, for the saved primary model. */
  saved: ReasoningControlState;
  /** What the next answer of this session uses; `overridden` is false while it inherits the saved default. */
  session: ReasoningControlState & { overridden: boolean };
}
