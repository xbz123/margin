export interface GenerationMetadata {
  codeOutputFormat?: 'plain' | 'markdown';
  requestId: string;
  questionId?: string;
  retryOf?: string;
  retryable?: boolean;
  entryPoint?: string;
  timing?: { speechMs: number; preparationMs?: number; modelToVisibleMs?: number; firstVisibleMs?: number };
  provider: string;
  model: string;
  status?: 'completed' | 'refused' | 'incomplete' | 'empty' | 'cancelled' | 'failed';
  attempts: number;
  partial: boolean;
  timeout?: 'first-token' | 'total';
}
