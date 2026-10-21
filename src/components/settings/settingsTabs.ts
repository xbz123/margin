// Settings sections in sidebar order. Tab names sent by other windows keep working through aliases.
export const SETTINGS_TABS = [
    'general', 'ai-providers', 'audio', 'context', 'meeting-records', 'privacy', 'keybinds', 'help', 'about',
] as const;

export type SettingsTab = typeof SETTINGS_TABS[number];

const TABS = new Set<string>(SETTINGS_TABS);
const ALIASES: Readonly<Record<string, SettingsTab>> = { skills: 'context', 'local-context': 'context', 'window-privacy': 'privacy' };

export function resolveSettingsTab(tab: unknown): SettingsTab {
    if (typeof tab !== 'string') return 'general';
    if (TABS.has(tab)) return tab as SettingsTab;
    return Object.hasOwn(ALIASES, tab) ? ALIASES[tab] : 'general';
}
