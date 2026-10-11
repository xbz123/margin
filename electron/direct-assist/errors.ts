export const MANUAL_ANSWER_FAILED = '回答失败，请检查模型配置后重试。';
export const MANUAL_ANSWER_UNCONFIGURED = '请先配置回答模型及其凭据。';

export class ManualAnswerConfigurationError extends Error {
  constructor() { super(MANUAL_ANSWER_UNCONFIGURED); this.name = 'ManualAnswerConfigurationError'; }
}

// Only locally assigned error types select UI text; provider messages are never inspected.
export function manualAnswerError(error: unknown): string {
  return (error as Error)?.name === 'ManualAnswerConfigurationError' ? MANUAL_ANSWER_UNCONFIGURED : MANUAL_ANSWER_FAILED;
}
