
export type LanguageOption = {
    label: string;
    code: string; // Internal key (e.g. 'chinese')
    bcp47: string; // Standard BCP-47 tag (e.g. 'zh-CN')
    iso639: string; // For OpenAI, Groq (e.g. 'zh')
    group: string; // For UI grouping
    alternates?: string[];
};

/** The languages auto mode listens for: Chinese and English. */
export const AUTO_DETECT_ALTERNATES = ['zh-CN', 'en-US'];
/** ISO-639-1 hints sent to providers that accept a hint list (Soniox) in auto mode. */
export const AUTO_DETECT_HINTS = ['zh', 'en'];

export const ENGLISH_RECOGNITION_LANGUAGE = 'english-us';
export const DEFAULT_RECOGNITION_LANGUAGE = ENGLISH_RECOGNITION_LANGUAGE;

export const RECOGNITION_LANGUAGES: Record<string, LanguageOption> = {
    'auto': { label: 'Auto (Chinese & English)', code: 'auto', bcp47: 'auto', iso639: 'auto', group: 'Auto', alternates: AUTO_DETECT_ALTERNATES },
    // Keeps the old 'english-us' key so existing saved settings stay valid.
    'english-us': { label: 'English', code: 'english-us', bcp47: 'en-US', iso639: 'en', group: 'English' },
    'chinese': { label: 'Chinese', code: 'chinese', bcp47: 'zh-CN', iso639: 'zh', group: 'Chinese' },
};

export const AI_RESPONSE_LANGUAGES = [
    { label: 'Auto (Chinese & English)', code: 'auto' },
    { label: 'English', code: 'English' },
    { label: 'Chinese', code: 'Chinese' },
];

export function isRecognitionLanguage(value: unknown): value is string {
    return typeof value === 'string' && Object.hasOwn(RECOGNITION_LANGUAGES, value);
}

export function isAnswerLanguage(value: unknown): value is string {
    return typeof value === 'string' && AI_RESPONSE_LANGUAGES.some(option => option.code === value);
}

/**
 * Maps a saved recognition language to a supported key. Older builds offered five English
 * variants and eleven other languages: any English variant reads as English, anything else
 * unknown reads as auto. Nothing is written back; the saved value is only interpreted.
 */
export function normalizeRecognitionLanguage(value: unknown): string {
    if (value === undefined || value === null || value === '') return DEFAULT_RECOGNITION_LANGUAGE;
    if (isRecognitionLanguage(value)) return value;
    if (typeof value === 'string' && value.toLowerCase().startsWith('english')) return ENGLISH_RECOGNITION_LANGUAGE;
    return 'auto';
}

/** Maps a saved answer language to auto, English or Chinese; anything else reads as auto. */
export function normalizeAnswerLanguage(value: unknown): string {
    return isAnswerLanguage(value) ? value : 'auto';
}

/** Language hints for a recognition key: Chinese and English in auto mode, otherwise the one language. */
export function recognitionLanguageHints(key: string): string[] {
    const normalized = normalizeRecognitionLanguage(key);
    if (normalized === 'auto') return [...AUTO_DETECT_HINTS];
    return [RECOGNITION_LANGUAGES[normalized].iso639];
}

/** The single `language` parameter for Whisper-style APIs; undefined in auto mode so the service detects it. */
export function transcriptionLanguage(key: string | undefined): string | undefined {
    if (!key) return undefined;
    const normalized = normalizeRecognitionLanguage(key);
    return normalized === 'auto' ? undefined : RECOGNITION_LANGUAGES[normalized].iso639;
}
