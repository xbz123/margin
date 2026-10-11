import { app } from 'electron';
import path from 'node:path';
import { PromptSettingsStore, PromptSettingsError, parsePromptSkill, readPromptFile } from './PromptSettingsStore';

export class SkillsManager {
  private static instance: SkillsManager;

  public static getInstance(): SkillsManager {
    if (!app.isReady()) throw new Error('Skills require a ready application.');
    return SkillsManager.instance ??= new SkillsManager();
  }

  public promptSettings(): PromptSettingsStore {
    return new PromptSettingsStore(path.join(app.getPath('userData'), 'prompt-settings.json'));
  }

  public importPromptSkill(file: string) {
    if (!/\.md$/i.test(file)) throw new PromptSettingsError('Select a regular UTF-8 SKILL.md file up to 32 KiB.');
    return this.promptSettings().install(parsePromptSkill(readPromptFile(file)));
  }
}
