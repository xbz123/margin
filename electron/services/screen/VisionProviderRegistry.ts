// electron/services/screen/VisionProviderRegistry.ts
//
// Builds the ordered VisionProviderConfig[] consumed by VisionProviderFallbackChain.
//
// Each entry knows:
//   - whether the provider is configured (API key, runtime path)
//   - whether the selected model is vision-capable
//   - whether the data scope policy allows screenshots
//   - how to invoke the provider with an optimized image + prompt
//
// The invocation lives in adapter functions that call into LLMHelper. We
// intentionally lazy-import LLMHelper so tests can replace this registry
// without booting the whole LLM stack.

import fs from 'node:fs/promises';
import type {
  VisionProviderConfig,
  VisionInvocationParams,
  VisionMode,
} from './VisionProviderFallbackChain';
import { CredentialsManager } from '../CredentialsManager';

export interface VisionProviderBuildInputs {
  mode: VisionMode;
  scopeAllowsScreenshots: boolean;
}

/**
 * Produce the ordered list of vision providers. Order is:
 *   OpenAI → Gemini Flash → Claude → Gemini Pro → Groq Scout → Codex → Custom
 */
export function buildVisionProviders(inputs: VisionProviderBuildInputs): VisionProviderConfig[] {
  const credentials = CredentialsManager.getInstance();
  const providers: VisionProviderConfig[] = [];

  providers.push(openai(credentials, inputs));
  providers.push(geminiFlash(credentials, inputs));
  providers.push(claude(credentials, inputs));
  providers.push(geminiPro(credentials, inputs));
  providers.push(groqScout(credentials, inputs));
  providers.push(codex(credentials, inputs));
  providers.push(custom(credentials, inputs));

  return providers.filter(p => p !== null) as VisionProviderConfig[];
}

// ─── Provider builders ────────────────────────────────────────────────────

function openai(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getOpenaiApiKey();
  return {
    id: 'openai',
    displayName: 'OpenAI',
    modelId: 'gpt-4o',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'openai',
    invoke: async (p) => callLLMHelperVision('openai', p),
  };
}

function geminiFlash(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getGeminiApiKey();
  return {
    id: 'gemini_flash',
    displayName: 'Gemini Flash',
    modelId: 'gemini-3.1-flash-lite-preview',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'gemini',
    invoke: async (p) => callLLMHelperVision('gemini_flash', p),
  };
}

function claude(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getClaudeApiKey();
  return {
    id: 'claude',
    displayName: 'Claude',
    modelId: 'claude-sonnet-4-6',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'claude',
    invoke: async (p) => callLLMHelperVision('claude', p),
  };
}

function geminiPro(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getGeminiApiKey();
  return {
    id: 'gemini_pro',
    displayName: 'Gemini Pro',
    modelId: 'gemini-3.1-pro-preview',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'gemini',
    invoke: async (p) => callLLMHelperVision('gemini_pro', p),
  };
}

function groqScout(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getGroqApiKey();
  return {
    id: 'groq_scout',
    displayName: 'Groq Llama-4 Scout',
    modelId: 'meta-llama/llama-4-scout-17b-16e-instruct',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'groq',
    invoke: async (p) => callLLMHelperVision('groq_scout', p),
  };
}

function codex(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const cliPath = (creds.getAllCredentials() as any)?.codexCliPath as string | undefined;
  // Codex CLI vision capability is not yet verified across builds — we configure
  // the provider as available but the vision flag is conservative. See ROADMAP.
  return {
    id: 'codex_cli',
    displayName: 'Codex CLI',
    modelId: (creds.getAllCredentials() as any)?.codexCliModel,
    isLocal: true,
    isConfigured: !!cliPath,
    supportsVision: false, // unverified; flip to true when CLI vision is confirmed end-to-end
    scopeAllowsScreenshots: true,
    hint: 'codex',
    invoke: async () => { throw new Error('Codex CLI vision unverified — capability disabled'); },
  };
}

function custom(creds: CredentialsManager, inputs: VisionProviderBuildInputs): VisionProviderConfig {
  // The active custom provider lives on the live LLMHelper instance (set via
  // switchToCustom in main.ts). CredentialsManager stores all configured custom
  // providers; we only show the active one as a vision target so the chain
  // never silently calls a provider the user didn't pick.
  const customProviders = creds.getCustomProviders();
  // Prefer the explicitly-set active provider if any; fall back to the first
  // configured entry so the registry remains useful when LLMHelper hasn't been
  // initialized yet (e.g. during unit tests).
  const fromHelper = readActiveCustomProviderSync();
  const active = fromHelper || customProviders[0];

  const multimodal = (active as any)?.multimodal === true;
  // Treat a provider as local if explicitly flagged OR if its URL targets a
  // loopback host.
  const localOnly = isLocalOnlyCustomProvider(active);

  return {
    id: 'custom',
    displayName: active?.name || 'Custom Provider',
    modelId: (active as any)?.model,
    isLocal: localOnly,
    isConfigured: !!active,
    supportsVision: multimodal,
    scopeAllowsScreenshots: inputs.scopeAllowsScreenshots,
    hint: 'custom',
    invoke: async (p) => callLLMHelperVision('custom', p),
  };
}

function readActiveCustomProviderSync(): any | null {
  try {
    const g = global as any;
    if (typeof g.__nativelyGetLLMHelper === 'function') {
      const helper = g.__nativelyGetLLMHelper();
      if (helper && typeof helper.getActiveCustomProvider === 'function') {
        return helper.getActiveCustomProvider() || null;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function isLocalOnlyCustomProvider(provider: any | undefined | null): boolean {
  if (!provider) return false;
  if (provider.localOnly === true) return true;
  // Inspect the cURL command for a localhost / 127.0.0.1 / 0.0.0.0 / ::1 target.
  const curl: string | undefined = provider.curlCommand;
  if (!curl) return false;
  try {
    const urlMatch = curl.match(/https?:\/\/([^\s'"`]+)/i);
    if (!urlMatch) return false;
    const host = new URL(urlMatch[0]).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host.endsWith('.local');
  } catch {
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Call into LLMHelper to run a vision request against the chosen cloud provider.
 * We funnel everything through LLMHelper.streamChat so the auth, retries, and
 * per-provider payload shape are handled in one place.
 */
async function callLLMHelperVision(providerId: string, params: VisionInvocationParams): Promise<string> {
  const helper = await getActiveLLMHelper();
  if (!helper) throw new Error('LLMHelper not initialized');
  return helper.runVisionRequest(providerId, params.userPrompt, params.systemPrompt, params.optimized.path);
}

/**
 * Retrieve the live LLMHelper instance. main.ts owns the LLMHelper; we expose
 * it via a global accessor function set up there. If the accessor is missing,
 * return null and let the caller fail closed.
 */
async function getActiveLLMHelper(): Promise<any | null> {
  const g = global as any;
  if (typeof g.__nativelyGetLLMHelper === 'function') {
    try {
      return g.__nativelyGetLLMHelper();
    } catch {
      return null;
    }
  }
  return null;
}
