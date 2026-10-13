// Settings sections in sidebar order. Tab names sent by other windows keep working through aliases.
export type SettingsTab = 'general' | 'privacy' | 'keybinds' | 'ai-providers' | 'context' | 'audio' | 'help' | 'about';

export const SETTINGS_GROUPS: ReadonlyArray<{ title: string; tabs: readonly SettingsTab[] }> = [
    { title: 'Application', tabs: ['general', 'privacy', 'keybinds'] },
    { title: 'Answers', tabs: ['ai-providers', 'context'] },
    { title: 'Speech', tabs: ['audio'] },
    { title: 'Support', tabs: ['help', 'about'] },
];

const TABS = new Set<string>(SETTINGS_GROUPS.flatMap(group => group.tabs));
const ALIASES: Readonly<Record<string, SettingsTab>> = { skills: 'context', 'local-context': 'context' };

export function resolveSettingsTab(tab: unknown): SettingsTab {
    if (typeof tab !== 'string') return 'general';
    if (TABS.has(tab)) return tab as SettingsTab;
    return Object.hasOwn(ALIASES, tab) ? ALIASES[tab] : 'general';
}
