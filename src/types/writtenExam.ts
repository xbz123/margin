export type CodeOutputFormat = 'plain' | 'markdown';
export interface WrittenExamSettings {
  enabled: boolean;
  intervalSeconds: number;
  hideScreenshots: boolean;
  codeOutputFormat: CodeOutputFormat;
}
export interface WrittenExamStatus extends WrittenExamSettings {
  running: boolean;
  generation: number;
  error: string;
}
export interface WrittenExamCapture { path: string; preview: string; generation: number }
export const DEFAULT_WRITTEN_EXAM: WrittenExamSettings = {
  enabled: false, intervalSeconds: 20, hideScreenshots: true, codeOutputFormat: 'plain',
};
export function validExamSettings(value: unknown): value is WrittenExamSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as WrittenExamSettings;
  return Object.keys(v).every(key => Object.hasOwn(DEFAULT_WRITTEN_EXAM, key))
    && typeof v.enabled === 'boolean' && typeof v.hideScreenshots === 'boolean'
    && Number.isInteger(v.intervalSeconds) && v.intervalSeconds >= 5 && v.intervalSeconds <= 300
    && (v.codeOutputFormat === 'plain' || v.codeOutputFormat === 'markdown');
}
