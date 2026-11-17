// ProcessingHelper.ts

import { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import { CredentialsManager } from "./services/CredentialsManager"
import { app } from "electron"
import { LLM_PRESETS, type LlmProvider } from '../src/types/llmTarget';
// import dotenv from "dotenv" // Removed static import

if (!app.isPackaged) {
  require("dotenv").config()
}

export class ProcessingHelper {
  private appState: AppState
  private llmHelper: LLMHelper

  constructor(appState: AppState) {
    this.appState = appState
    // API keys come only from the app's saved credentials (loadStoredCredentials or Settings), never the environment.
    this.llmHelper = new LLMHelper()
  }

  /** Applies one official provider's stored configuration with its saved key only; official slots only reach official addresses. */
  public applyStoredProvider(provider: LlmProvider): void {
    const credManager = CredentialsManager.getInstance();
    this.llmHelper.configureProvider(credManager.getProviderConfigurations()[provider], credManager.getProviderApiKey(provider));
    // A pending older setting is derived from the saved configuration (S48 C4); re-read it as a cold start would.
    this.llmHelper.setSavedReasoning(credManager.getSavedReasoning());
  }

  /** Applies one stored gateway with its own key. */
  public applyStoredGateway(id: string): void {
    const credManager = CredentialsManager.getInstance();
    this.llmHelper.configureGateway(credManager.getGateways()[id], credManager.getGatewayApiKey(id));
  }

  /** Rebuilds the answer engine and tells windows the current model selection. */
  public refreshAnswerRuntime(): void {
    const intelligence = this.appState.getIntelligenceManager();
    intelligence.resetEngine();
    intelligence.initializeLLMs();
    this.appState.sendModelChanged(this.llmHelper.getCurrentModelSelection());
  }

  /**
   * Load stored credentials from CredentialsManager
   * Should be called after app.whenReady() when CredentialsManager is initialized
   */
  public loadStoredCredentials(): void {
    const credManager = CredentialsManager.getInstance();

    if (!credManager.getLoadStatus().ok) {
      for (const config of Object.values(LLM_PRESETS)) this.llmHelper.configureProvider(config);
      this.appState.getIntelligenceManager().initializeLLMs();
      return;
    }

    // Startup and every successful save apply stored answer targets through the same operations.
    for (const config of Object.values(credManager.getProviderConfigurations())) this.applyStoredProvider(config.provider);
    for (const id of Object.keys(credManager.getGateways())) this.applyStoredGateway(id);

    // CRITICAL: Re-initialize IntelligenceManager now that keys are loaded
    // This fixes the issue where buttons don't work in production because of late key loading
    this.appState.getIntelligenceManager().initializeLLMs();

    // NEW: Load Default Model Config
    const defaultModel = credManager.getDefaultModel();
    if (defaultModel) {
      console.log(`[ProcessingHelper] Loading stored Default Model: ${defaultModel}`);
      // A saved choice that can no longer be used stays visible and refuses answers; nothing is substituted.
      try { this.llmHelper.setModel(defaultModel); }
      catch (error) { this.llmHelper.selectUnavailable(defaultModel, error instanceof Error ? error.message : 'The saved answer model is unavailable.'); }
    }
    this.llmHelper.setGenerationPolicy(credManager.getGenerationPolicy());
    this.llmHelper.setSavedReasoning(credManager.getSavedReasoning());

    // Load Languages
    const sttLanguage = credManager.getSttLanguage();
    const aiResponseLanguage = credManager.getAiResponseLanguage();

    if (sttLanguage) {
      this.llmHelper.setSttLanguage(sttLanguage);
    }

    if (aiResponseLanguage) {
      this.llmHelper.setAiResponseLanguage(aiResponseLanguage);
    }
  }

  public getLLMHelper() {
    return this.llmHelper;
  }
}
