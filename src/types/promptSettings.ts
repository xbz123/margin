export type PromptScene = 'interview' | 'written';
export interface PromptSkill { id: string; name: string; description: string; instructions: string }
export interface PromptSettings {
    skills: PromptSkill[];
    scenes: Record<PromptScene, { skillId: string | null; additional: string }>;
}
export type PromptSettingsResult = { ok: true; settings: PromptSettings } | { ok: false; error: string; recovery?: boolean };
export const ADDITIONAL_INSTRUCTIONS_LIMIT = 4000;
