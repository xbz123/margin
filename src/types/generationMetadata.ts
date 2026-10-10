export interface GenerationMetadata {
  requestId: string;
  provider: string;
  model: string;
  status?: 'completed' | 'refused' | 'incomplete' | 'empty' | 'cancelled' | 'failed';
  attempts: number;
  partial: boolean;
  timeout?: 'first-token' | 'total';
}
