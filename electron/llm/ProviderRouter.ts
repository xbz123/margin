export type LLMProviderId = 'groq' | 'codex' | 'gemini_flash' | 'gemini_pro' | 'openai' | 'claude' | 'deepseek';
export type ProviderCapability = 'chat' | 'stream_chat' | 'structured' | 'vision';
export type ProviderAttemptStatus = 'available' | 'unavailable';
export type ProviderUnavailableReason = 'missing_api_key' | 'missing_config' | 'unsupported_capability' | 'disabled';
export type ProviderDataScope = 'transcript' | 'screenshots' | 'profile_history';
export type ProviderDataScopePolicy = Partial<Record<ProviderDataScope, boolean>>;

export class ProviderScopeError extends Error {
    constructor(
        public readonly provider: string,
        public readonly deniedScopes: ProviderDataScope[]
    ) {
        super(`Data scope denied: ${deniedScopes.join(', ')}. Check Data Scopes in Settings.`);
        this.name = 'ProviderScopeError';
    }
}

// Promise.any wraps refusals; keep the original refusal instead of treating it as
// provider downtime. Ordinary errors and cancellation keep their existing behavior.
export function rethrowProviderScopeError(error: unknown): void {
    // Electron entry points are bundled separately, so class identity can differ.
    if (error instanceof Error && error.name === 'ProviderScopeError') throw error;
    if (error instanceof AggregateError) {
        for (const cause of error.errors) rethrowProviderScopeError(cause);
    }
}

export function getDeniedDataScopes(scopes: ProviderDataScope[] = [], policy?: ProviderDataScopePolicy): ProviderDataScope[] {
    return scopes.filter(scope => policy?.[scope] === false);
}

export function assertProviderDataScopes(provider: string, scopes: ProviderDataScope[] = [], policy?: ProviderDataScopePolicy): void {
    const denied = getDeniedDataScopes(scopes, policy);
    if (denied.length > 0) {
        throw new ProviderScopeError(provider, denied);
    }
}

export interface ProviderAvailabilityState {
    hasGroq?: boolean;
    groqDisabled?: boolean;
    hasCodex?: boolean;
    hasGemini?: boolean;
    hasOpenAI?: boolean;
    hasClaude?: boolean;
    hasDeepseek?: boolean;
}

export interface ProviderModelState {
    groq?: string;
    codex?: string;
    geminiFlash?: string;
    geminiPro?: string;
    openai?: string;
    claude?: string;
    deepseek?: string;
}

export interface ProviderRouteOptions {
    capability: ProviderCapability;
    multimodal?: boolean;
    availability: ProviderAvailabilityState;
    models?: ProviderModelState;
    dataScopes?: ProviderDataScope[];
    scopePolicy?: ProviderDataScopePolicy;
}

export interface ProviderAttempt {
    provider: LLMProviderId;
    name: string;
    status: ProviderAttemptStatus;
    unavailableReason?: ProviderUnavailableReason;
    capability: ProviderCapability;
    model?: string;
}

interface ProviderSpec {
    provider: LLMProviderId;
    name: string;
    model?: string;
    available?: boolean;
    unavailableReason?: ProviderUnavailableReason;
    supports: ProviderCapability[];
}

function statusFor(spec: ProviderSpec, capability: ProviderCapability, deniedScopes: ProviderDataScope[] = []): Pick<ProviderAttempt, 'status' | 'unavailableReason'> {
    if (!spec.supports.includes(capability)) {
        return { status: 'unavailable', unavailableReason: 'unsupported_capability' };
    }
    if (deniedScopes.length > 0) {
        return { status: 'unavailable', unavailableReason: 'disabled' };
    }
    if (spec.available) return { status: 'available' };
    return { status: 'unavailable', unavailableReason: spec.unavailableReason ?? 'missing_api_key' };
}

export function routeLLMProviders(options: ProviderRouteOptions): ProviderAttempt[] {
    const availability = { ...options.availability };
    const models = { ...options.models };
    const capability = options.capability;

    const groq: ProviderSpec = {
        provider: 'groq',
        name: `Groq (${models.groq ?? 'default'})`,
        model: models.groq,
        available: Boolean(availability.hasGroq) && !availability.groqDisabled,
        unavailableReason: availability.groqDisabled ? 'disabled' : 'missing_api_key',
        supports: ['chat', 'stream_chat', 'structured', 'vision'],
    };
    const codex: ProviderSpec = {
        provider: 'codex',
        name: `Codex login source (${models.codex ?? 'default'})`,
        model: models.codex,
        available: Boolean(availability.hasCodex),
        unavailableReason: 'missing_config',
        supports: ['chat', 'stream_chat', 'structured', 'vision'],
    };
    const geminiFlash: ProviderSpec = {
        provider: 'gemini_flash',
        name: `Gemini Flash (${models.geminiFlash ?? 'default'})`,
        model: models.geminiFlash,
        available: Boolean(availability.hasGemini),
        unavailableReason: 'missing_api_key',
        supports: ['chat', 'stream_chat', 'vision'],
    };
    const geminiPro: ProviderSpec = {
        provider: 'gemini_pro',
        name: `Gemini Pro (${models.geminiPro ?? 'default'})`,
        model: models.geminiPro,
        available: Boolean(availability.hasGemini),
        unavailableReason: 'missing_api_key',
        supports: ['chat', 'stream_chat', 'structured', 'vision'],
    };
    const openai: ProviderSpec = {
        provider: 'openai',
        name: `OpenAI (${models.openai ?? 'default'})`,
        model: models.openai,
        available: Boolean(availability.hasOpenAI),
        unavailableReason: 'missing_api_key',
        supports: ['chat', 'stream_chat', 'structured', 'vision'],
    };
    const claude: ProviderSpec = {
        provider: 'claude',
        name: `Claude (${models.claude ?? 'default'})`,
        model: models.claude,
        available: Boolean(availability.hasClaude),
        unavailableReason: 'missing_api_key',
        supports: ['chat', 'stream_chat', 'structured', 'vision'],
    };
    // DeepSeek (OpenAI-compatible) is intentionally text-only — no vision support
    // declared, so it is excluded from multimodal/screenshot fallback chains.
    const deepseek: ProviderSpec = {
        provider: 'deepseek',
        name: `DeepSeek (${models.deepseek ?? 'default'})`,
        model: models.deepseek,
        available: Boolean(availability.hasDeepseek),
        unavailableReason: 'missing_api_key',
        supports: ['chat', 'stream_chat', 'structured'],
    };
    // DeepSeek is placed after Claude in the text-only chain and is omitted from
    // the multimodal chain since no DeepSeek vision model is supported.
    const orderedSpecs: ProviderSpec[] = options.multimodal
        ? [codex, openai, geminiFlash, claude, geminiPro, groq]
        : [groq, codex, geminiFlash, geminiPro, openai, claude, deepseek];

    const deniedScopes = getDeniedDataScopes(options.dataScopes, options.scopePolicy);

    return orderedSpecs.map(spec => ({
        provider: spec.provider,
        name: spec.name,
        capability,
        model: spec.model,
        ...statusFor(spec, capability, deniedScopes),
    }));
}

export function routeWithScopeFallback(options: ProviderRouteOptions): ProviderAttempt[] {
    return routeLLMProviders(options);
}
