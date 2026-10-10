export interface GenerationPolicy {
    backupModel?: string;
    backupImageSupportConfirmedFor?: string;
    interviewFirstTokenSeconds: number;
    interviewTotalSeconds: number;
    writtenTotalSeconds: number;
}

export const DEFAULT_GENERATION_POLICY: GenerationPolicy = {
    interviewFirstTokenSeconds: 10,
    interviewTotalSeconds: 60,
    writtenTotalSeconds: 180,
};

export function validateGenerationPolicy(value: GenerationPolicy): GenerationPolicy {
    for (const seconds of [value.interviewFirstTokenSeconds, value.interviewTotalSeconds, value.writtenTotalSeconds]) {
        if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(seconds * 1000 + Date.now())) throw new Error('Generation timeouts must be positive finite seconds.');
    }
    if (value.interviewTotalSeconds < value.interviewFirstTokenSeconds) throw new Error('Interview total timeout must not be shorter than the first-token timeout.');
    if (value.backupModel !== undefined && (typeof value.backupModel !== 'string' || !value.backupModel)) throw new Error('Invalid backup model.');
    if (value.backupImageSupportConfirmedFor !== undefined && typeof value.backupImageSupportConfirmedFor !== 'string') throw new Error('Invalid backup image confirmation.');
    return { ...value };
}
