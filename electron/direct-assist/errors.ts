export const MANUAL_ANSWER_FAILED = 'Answer failed. Check the model configuration and try again.';
export const MANUAL_ANSWER_UNCONFIGURED = 'Configure an answer model and its credentials first.';
export const MANUAL_ANSWER_CANCELLED = 'Cancelled';

export class ManualAnswerConfigurationError extends Error {
  constructor() { super(MANUAL_ANSWER_UNCONFIGURED); this.name = 'ManualAnswerConfigurationError'; }
}

export class InvalidImagePathError extends Error {
  constructor() { super('Invalid image path'); this.name = 'InvalidImagePathError'; }
}

// Only locally assigned error types select UI text; provider messages are never inspected.
export function manualAnswerError(error: unknown): string {
  // Separate Electron bundles have separate class identities, so use the local error names.
  switch ((error as Error)?.name) {
    case 'ManualAnswerConfigurationError': return MANUAL_ANSWER_UNCONFIGURED;
    case 'ProviderScopeError': return 'Data scope denied. Check Data Scopes in Settings.';
    case 'InvalidImagePathError': return 'Invalid image path';
    default: return MANUAL_ANSWER_FAILED;
  }
}
