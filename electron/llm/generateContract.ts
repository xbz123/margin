import { rethrowProviderScopeError, type ProviderDataScope } from './ProviderRouter';
import type { GenerateContentConfig } from '@google/genai';
import type { LlmProtocol } from '../../src/types/llmTarget';

export type GeneratePart = { text: string } | { inlineData: { mimeType: string; data: string } };
export type GenerateContents = string | readonly (GeneratePart | { role: 'user' | 'model'; parts: readonly GeneratePart[] })[];

/** One physical send. Routing, retries and deadlines belong to the caller. */
export interface GenerateRequest {
  protocol: LlmProtocol;
  purpose: 'answer' | 'structured' | 'summary' | 'compression' | 'compatibility';
  model: string;
  contents: GenerateContents;
  systemInstruction?: string;
  cacheReference?: string;
  maxOutputTokens: number;
  temperature?: number;
  dataScopes: readonly ProviderDataScope[];
  signal?: AbortSignal;
  stream: boolean;
  /** Main-process compatibility calls may retain already configured SDK options. */
  providerOptions?: Pick<GenerateContentConfig, 'systemInstruction' | 'cachedContent' | 'topP' | 'topK'
    | 'responseMimeType' | 'responseSchema' | 'responseJsonSchema' | 'safetySettings' | 'thinkingConfig'> & {
      outputTokenField?: 'max_tokens' | 'max_completion_tokens'; prompt_cache_key?: string;
      top_p?: number; stop?: string | string[] | null;
      systemBlocks?: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
    };
}

export type GenerateStatus = 'completed' | 'refused' | 'incomplete' | 'empty' | 'cancelled' | 'failed';
export type GenerateEvent =
  | { type: 'delta'; text: string }
  | { type: 'finish'; status: GenerateStatus; finishReason?: string; usage?: unknown; error?: unknown };

/** Internal only: never serialize the underlying provider error into renderer events. */
export class GenerationResultError extends Error {
  constructor(public readonly status: Exclude<GenerateStatus, 'completed' | 'cancelled'>, public readonly partial: boolean) {
    super(`Generation ${status}${partial ? ' after partial output' : ''}`);
    this.name = 'GenerationResultError';
  }
}

export function rethrowTerminalGenerationError(error: unknown): void {
  rethrowProviderScopeError(error);
  const terminal = error as GenerationResultError | undefined;
  if ((error as any)?.generationTaskTerminal || error instanceof GenerationResultError || terminal?.name === 'GenerationResultError'
    || terminal?.name === 'GenerationTimeoutError' || terminal?.name === 'AbortError') throw error;
}
