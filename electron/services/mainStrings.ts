import { chinese } from '../../src/i18n.zh';
import type { UiLanguage } from '../../src/types/uiLanguage';
import { SettingsManager } from './SettingsManager';

// Built-in tray, menu and dialog labels follow the saved interface language; {name} fills values.
export function mainTextFor(language: UiLanguage, english: string, values: Record<string, string> = {}): string {
    const template = language === 'zh-CN' && Object.hasOwn(chinese, english) ? chinese[english] : english;
    return template.replace(/\{(\w+)\}/g, (match, key: string) => Object.hasOwn(values, key) ? values[key] : match);
}

export function mainText(english: string, values?: Record<string, string>): string {
    let language: UiLanguage = 'en';
    try { language = SettingsManager.getInstance().getUiLanguage(); } catch { /* Settings are unavailable before app ready. */ }
    return mainTextFor(language, english, values);
}
