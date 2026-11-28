export const getModelTargetDisplayName = (id: string): string | null => {
    const match = /^llm-(?:target|gateway):([^:]+):[^:]+:(.+)$/.exec(id);
    if (!match) return null;
    try { return `${decodeURIComponent(match[2])} (${match[1]})`; }
    catch { return id; }
};
