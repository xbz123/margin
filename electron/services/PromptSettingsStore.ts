import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ADDITIONAL_INSTRUCTIONS_LIMIT, type PromptSettings, type PromptSkill, type PromptScene } from '../../src/types/promptSettings';

export class PromptSettingsError extends Error {
    constructor(message: string, readonly recovery = false) { super(message); this.name = 'PromptSettingsError'; }
}
const SKILL_BYTES = 32 * 1024;
const STORE_BYTES = 1024 * 1024;
const empty = (): PromptSettings => ({ skills: [], scenes: {
    interview: { skillId: null, additional: '' }, written: { skillId: null, additional: '' },
} });

function text(value: unknown, limit: number): asserts value is string {
    if (typeof value !== 'string' || value.length > limit || Buffer.from(value).toString() !== value
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
        throw new PromptSettingsError('Invalid or oversized prompt text.');
    }
}

export function readPromptFile(file: string, limit = SKILL_BYTES): string {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size > limit) throw new PromptSettingsError('Select a regular UTF-8 SKILL.md file up to 32 KiB.');
        const buffer = Buffer.alloc(limit + 1);
        let used = 0;
        while (used < buffer.length) {
            const count = fs.readSync(fd, buffer, used, buffer.length - used, null);
            if (count === 0) break;
            used += count;
        }
        if (used > limit) throw new PromptSettingsError('Invalid or oversized prompt text.');
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used));
    } finally { fs.closeSync(fd); }
}

// Deliberately a small metadata format, not YAML with executable/tool extensions.
export function parsePromptSkill(markdown: unknown): PromptSkill {
    text(markdown, SKILL_BYTES);
    if (Buffer.byteLength(markdown) > SKILL_BYTES) throw new PromptSettingsError('Invalid or oversized prompt text.');
    const match = markdown.replace(/^\uFEFF/, '').match(/^---\r?\nname: ([a-z0-9][a-z0-9_-]{0,79})\r?\ndescription: ([^\r\n]{1,300})\r?\n---\r?\n([\s\S]+)$/);
    if (!match || !match[3].trim()) throw new PromptSettingsError('Use name and description frontmatter followed by prompt text. Tools, scripts and other metadata are not supported.');
    return { id: match[1], name: match[1], description: match[2], instructions: match[3].trim() };
}

function validate(settings: PromptSettings): void {
    if (!settings || !Array.isArray(settings.skills) || settings.skills.length > 16 || !settings.scenes) throw new PromptSettingsError('Invalid prompt settings.');
    const ids = new Set<string>();
    for (const skill of settings.skills) {
        if (!skill || typeof skill.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(skill.id) || skill.name !== skill.id || ids.has(skill.id)) throw new PromptSettingsError('Invalid prompt skill.');
        text(skill.description, 300);
        text(skill.instructions, SKILL_BYTES);
        if (!skill.description.trim() || !skill.instructions.trim() || Buffer.byteLength(skill.instructions) > SKILL_BYTES) throw new PromptSettingsError('Invalid prompt skill.');
        ids.add(skill.id);
    }
    for (const scene of ['interview', 'written'] as const) {
        const selection = settings.scenes[scene];
        if (!selection || (selection.skillId !== null && !ids.has(selection.skillId))) throw new PromptSettingsError('Choose an installed prompt skill.');
        text(selection.additional, ADDITIONAL_INSTRUCTIONS_LIMIT);
    }
}

export class PromptSettingsStore {
    constructor(private readonly file: string) {}
    read(): PromptSettings {
        try {
            const settings = JSON.parse(readPromptFile(this.file, STORE_BYTES));
            validate(settings);
            return settings;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
            throw new PromptSettingsError('Prompt settings could not be read. Clear them in Settings to recover.', true);
        }
    }
    private save(settings: PromptSettings): PromptSettings {
        validate(settings);
        const encoded = JSON.stringify(settings);
        if (Buffer.byteLength(encoded) > STORE_BYTES) throw new PromptSettingsError('Prompt settings exceed the storage limit.');
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const staging = `${this.file}.${randomUUID()}`;
        try {
            fs.writeFileSync(staging, encoded, { flag: 'wx', mode: 0o600 });
            fs.renameSync(staging, this.file);
        } finally { fs.rmSync(staging, { force: true }); }
        return settings;
    }
    install(skill: PromptSkill): PromptSettings {
        const settings = this.read();
        if (settings.skills.some(item => item.id === skill.id)) throw new PromptSettingsError('A prompt skill with this name is already installed.');
        settings.skills.push(skill);
        return this.save(settings);
    }
    configure(scene: PromptScene, skillId: string | null, additional: string): PromptSettings {
        if (scene !== 'interview' && scene !== 'written') throw new PromptSettingsError('Invalid prompt scene.');
        const settings = this.read();
        settings.scenes[scene] = { skillId, additional };
        return this.save(settings);
    }
    remove(id: string): PromptSettings {
        const settings = this.read();
        settings.skills = settings.skills.filter(skill => skill.id !== id);
        for (const scene of Object.values(settings.scenes)) if (scene.skillId === id) scene.skillId = null;
        return this.save(settings);
    }
    clear(): PromptSettings { return this.save(empty()); }
}
