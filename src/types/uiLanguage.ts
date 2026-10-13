// Application interface language; separate from the AI response and recognition languages.
export type UiLanguage = 'en' | 'zh-CN';

export const isUiLanguage = (value: unknown): value is UiLanguage => value === 'en' || value === 'zh-CN';

export type UiLanguageResult = { ok: true; language: UiLanguage } | { ok: false; message: string };
