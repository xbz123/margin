import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { chinese } from './i18n.zh';
import type { UiLanguage, UiLanguageResult } from './types/uiLanguage';

export type { UiLanguage } from './types/uiLanguage';

type Values = Record<string, string | number>;

// English source text is the key and the fallback; {name} placeholders are filled after lookup.
export function translate(language: UiLanguage, english: string, values?: Values): string {
    const template = language === 'zh-CN' && Object.hasOwn(chinese, english) ? chinese[english] : english;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (match, key: string) => Object.hasOwn(values, key) ? String(values[key]) : match);
}

const isLanguage = (value: unknown): value is UiLanguage => value === 'en' || value === 'zh-CN';
const CACHE_KEY = 'margin_ui_language';
const SAVE_FAILED = 'The interface language could not be saved.';

let uiLanguage: UiLanguage = 'en';
// Counts languages applied from main, so late get/save replies cannot undo a newer change.
let appliedFromMain = 0;
const listeners = new Set<() => void>();

export const getUiLanguage = (): UiLanguage => uiLanguage;

// Applies a language to this renderer only; persistence goes through requestUiLanguage.
export function setUiLanguage(language: UiLanguage): void {
    if (!isLanguage(language)) throw new Error('Unsupported UI language');
    if (typeof document !== 'undefined') document.documentElement.lang = language;
    if (uiLanguage === language) return;
    uiLanguage = language;
    listeners.forEach(notify => notify());
}

function applyFromMain(language: UiLanguage): void {
    appliedFromMain++;
    try { localStorage.setItem(CACHE_KEY, language); } catch { /* The cache only avoids a first-paint flash. */ }
    setUiLanguage(language);
}

// Called once per window: the saved language from main wins, cross-window changes follow.
export function startUiLanguageSync(): () => void {
    const api = typeof window === 'undefined' ? undefined : window.electronAPI;
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (isLanguage(cached)) setUiLanguage(cached);
    } catch { /* No cache. */ }
    if (!api?.getUiLanguage) return () => {};
    let active = true;
    const unsubscribe = api.onUiLanguageChanged?.(language => {
        if (active && isLanguage(language)) applyFromMain(language);
    });
    const before = appliedFromMain;
    api.getUiLanguage().then(language => {
        if (active && before === appliedFromMain && isLanguage(language)) applyFromMain(language);
    }).catch(() => { /* Keep the current language. */ });
    return () => { active = false; unsubscribe?.(); };
}

// Saves the language for every window; a failed save leaves the current language unchanged.
export async function requestUiLanguage(language: UiLanguage): Promise<UiLanguageResult> {
    if (!isLanguage(language)) return { ok: false, message: 'Unsupported interface language.' };
    const api = typeof window === 'undefined' ? undefined : window.electronAPI;
    if (!api?.setUiLanguage) return { ok: false, message: SAVE_FAILED };
    try {
        const before = appliedFromMain;
        const result = await api.setUiLanguage(language);
        if (result?.ok && isLanguage(result.language)) {
            if (before === appliedFromMain) applyFromMain(result.language);
            return result;
        }
        return { ok: false, message: result && !result.ok && typeof result.message === 'string' ? result.message : SAVE_FAILED };
    } catch {
        return { ok: false, message: SAVE_FAILED };
    }
}

function subscribe(notify: () => void): () => void {
    listeners.add(notify);
    return () => { listeners.delete(notify); };
}

export function useI18n() {
    const language = useSyncExternalStore(subscribe, getUiLanguage, getUiLanguage);
    // Stable per language, so effects that list t do not rerun or refetch on unrelated renders.
    const t = useCallback((english: string, values?: Values) => translate(language, english, values), [language]);
    return useMemo(() => ({ language, setLanguage: setUiLanguage, t }), [language, t]);
}
