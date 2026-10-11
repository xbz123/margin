import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LocalContextEntry } from '../../src/types/localContext';

export class LocalContextError extends Error {
    constructor(message: string) { super(message); this.name = 'LocalContextError'; }
}

const FILE_LIMIT = 32 * 1024;
const TOTAL_LIMIT = 64 * 1024;
const STORE_LIMIT = 512 * 1024;

function readLimited(file: string, limit: number): Buffer {
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile()) throw new LocalContextError('Select a regular text file, not a directory or link.');
        if (stat.size > limit) throw new LocalContextError('Local Context file exceeds its size limit (32 KiB per imported file).');
        const data = Buffer.alloc(limit + 1);
        let length = 0;
        for (;;) {
            const count = fs.readSync(descriptor, data, length, data.length - length, null);
            length += count;
            if (length > limit) throw new LocalContextError('Local Context file exceeds its size limit (32 KiB per imported file).');
            if (count === 0) return data.subarray(0, length);
        }
    } finally { fs.closeSync(descriptor); }
}

function validateEntries(value: unknown): asserts value is LocalContextEntry[] {
    if (!Array.isArray(value) || value.length > 8) throw new LocalContextError('Local Context accepts at most 8 files.');
    let bytes = 0;
    const ids = new Set<string>();
    for (const entry of value) {
        if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)
            || typeof entry.name !== 'string' || entry.name.length > 255 || !/\.(md|markdown|txt)$/i.test(entry.name)
            || typeof entry.content !== 'string') throw new LocalContextError('Local Context storage is invalid.');
        ids.add(entry.id);
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(entry.content) || Buffer.from(entry.content).toString() !== entry.content) {
            throw new LocalContextError('Local Context requires valid UTF-8 text, not binary content.');
        }
        const size = Buffer.byteLength(entry.content);
        if (size > FILE_LIMIT) throw new LocalContextError('Local Context file exceeds its size limit (32 KiB per imported file).');
        bytes += size;
    }
    if (bytes > TOTAL_LIMIT) throw new LocalContextError('Local Context exceeds 64 KiB in total. Remove or shorten a file.');
}

// Store imported text snapshots, never paths that could later point at different data.
export class LocalContextStore {
    constructor(private readonly file: string) {}

    list(): LocalContextEntry[] {
        try {
            const entries: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readLimited(this.file, STORE_LIMIT)));
            validateEntries(entries);
            return entries;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw new LocalContextError('Local Context could not be read. Check its local storage.');
        }
    }

    private save(entries: LocalContextEntry[]): LocalContextEntry[] {
        validateEntries(entries);
        const encoded = JSON.stringify(entries);
        if (Buffer.byteLength(encoded) > STORE_LIMIT) throw new LocalContextError('Local Context storage is too large.');
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const staging = `${this.file}.${randomUUID()}`;
        try {
            fs.writeFileSync(staging, encoded, { flag: 'wx', mode: 0o600 });
            fs.renameSync(staging, this.file);
        } finally { fs.rmSync(staging, { force: true }); }
        return entries;
    }

    addFiles(files: string[]): LocalContextEntry[] {
        const entries = this.list();
        if (entries.length + files.length > 8) throw new LocalContextError('Local Context accepts at most 8 files.');
        for (const file of files) {
            if (!/\.(md|markdown|txt)$/i.test(file)) throw new LocalContextError('Only .md, .markdown and .txt files are supported. PDF and DOCX are not supported.');
            let content: string;
            try { content = new TextDecoder('utf-8', { fatal: true }).decode(readLimited(file, FILE_LIMIT)); }
            catch (error) {
                if (error instanceof LocalContextError) throw error;
                throw new LocalContextError('Local Context requires a readable regular UTF-8 text file without symbolic links.');
            }
            entries.push({ id: randomUUID(), name: path.basename(file), content });
        }
        return this.save(entries);
    }

    remove(id: string): LocalContextEntry[] {
        if (typeof id !== 'string') throw new LocalContextError('Invalid Local Context entry.');
        return this.save(this.list().filter(entry => entry.id !== id));
    }
}
