export interface LocalContextEntry {
    id: string;
    name: string;
    content: string;
}

export type LocalContextResult = { ok: true; entries: LocalContextEntry[] } | { ok: false; error: string };
