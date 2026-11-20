export interface TranscriptEntryLike {
  speaker: string;
  text: string;
  timestamp: number;
}

export interface TranscriptRow {
  speakerKey: 'Me' | 'Them';
  time: string;
  text: string;
}

export function formatTranscriptTime(ms: number): string;

export function isSpokenEntry(entry: Partial<TranscriptEntryLike> | null | undefined): boolean;

export function speakerLabelKey(speaker: string | undefined): 'Me' | 'Them';

export function visibleTranscriptRows(
  transcript: readonly TranscriptEntryLike[] | null | undefined,
  formatTime: (ms: number) => string,
): TranscriptRow[];

export function formatTranscriptCopy(rows: readonly TranscriptRow[], translate: (key: string) => string): string;
