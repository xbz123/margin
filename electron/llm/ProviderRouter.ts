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
