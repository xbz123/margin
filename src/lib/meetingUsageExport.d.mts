export interface UsageExportBlock {
  kind: 'chat' | 'assist' | 'followup' | 'followup_questions';
  label?: string;
  question?: string;
  /** A 'followup' refinement the user typed, shown as typed after the label. */
  request?: string;
  answer?: string;
  bullets?: string[];
}

export function followUpLabel(question: unknown): { label: string; request?: string };

export function followUpQuestionList(entry: { items?: unknown; answer?: unknown } | null | undefined): string[];

export function usageExportBlocks(usage: ReadonlyArray<{
  type: string;
  question?: string;
  answer?: unknown;
  items?: unknown;
}> | null | undefined): UsageExportBlock[];
