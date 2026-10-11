import { useSyncExternalStore } from 'react';
import { chinese } from './i18n.zh';

export type UiLanguage = 'en' | 'zh-CN';

export function translate(language: UiLanguage, english: string): string {
    return language === 'zh-CN' && Object.hasOwn(chinese, english) ? chinese[english] : english;
}

// shortcut: language is per renderer; add persistence and cross-window sync in AG-60.
let uiLanguage: UiLanguage = 'en';
const listeners = new Set<() => void>();

export const getUiLanguage = (): UiLanguage => uiLanguage;

export function setUiLanguage(language: UiLanguage): void {
    if (language !== 'en' && language !== 'zh-CN') throw new Error('Unsupported UI language');
    if (uiLanguage === language) return;
    uiLanguage = language;
    listeners.forEach(notify => notify());
}

function subscribe(notify: () => void): () => void {
    listeners.add(notify);
    return () => { listeners.delete(notify); };
}

export function useI18n() {
    const language = useSyncExternalStore(subscribe, getUiLanguage, getUiLanguage);
    return { language, setLanguage: setUiLanguage, t: (english: string) => translate(language, english) };
}
