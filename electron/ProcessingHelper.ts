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

const isDev = process.env.NODE_ENV === "development"
const isDevTest = process.env.IS_DEV_TEST === "true"
const MOCK_API_WAIT_TIME = Number(process.env.MOCK_API_WAIT_TIME) || 500

export class ProcessingHelper {
  private appState: AppState
  private llmHelper: LLMHelper
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null
  private currentProcessingTask?: ReturnType<LLMHelper['beginGenerationTask']>;
  private currentExtraProcessingTask?: ReturnType<LLMHelper['beginGenerationTask']>;

  constructor(appState: AppState) {
    this.appState = appState

    // Try environment first (for development)
    const apiKey = process.env.GEMINI_API_KEY
    const groqApiKey = process.env.GROQ_API_KEY
    const openaiApiKey = process.env.OPENAI_API_KEY
    const claudeApiKey = process.env.CLAUDE_API_KEY
    const deepseekApiKey = process.env.DEEPSEEK_API_KEY

    // Allow initializing without key (will be loaded in loadStoredCredentials or via Settings)
    if (!apiKey) {
      console.warn("[ProcessingHelper] GEMINI_API_KEY not found in env. Will try CredentialsManager after ready.")
    }

    this.llmHelper = new LLMHelper(apiKey, groqApiKey, openaiApiKey, claudeApiKey, deepseekApiKey)
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

    const configs = credManager.getProviderConfigurations();
    const envKeys: Record<LlmProvider, string | undefined> = {
      gemini: process.env.GEMINI_API_KEY, groq: process.env.GROQ_API_KEY, openai: process.env.OPENAI_API_KEY,
      claude: process.env.CLAUDE_API_KEY, deepseek: process.env.DEEPSEEK_API_KEY,
    };
    const savedConfigs = credManager.getAllCredentials().providerConfigurations;
    for (const config of Object.values(configs)) {
      // An explicitly saved slot never borrows an environment key; official slots only reach official addresses.
      const key = credManager.getProviderApiKey(config.provider) || (savedConfigs?.[config.provider] ? undefined : envKeys[config.provider]);
      this.llmHelper.configureProvider(config, key);
    }
    for (const gateway of Object.values(credManager.getGateways())) this.llmHelper.configureGateway(gateway, credManager.getGatewayApiKey(gateway.id));

    // CRITICAL: Re-initialize IntelligenceManager now that keys are loaded
    // This fixes the issue where buttons don't work in production because of late key loading
    this.appState.getIntelligenceManager().initializeLLMs();

    // Initialize self-improving model version manager (background, non-blocking)
    this.llmHelper.initModelVersionManager().catch(err => {
      console.warn('[ProcessingHelper] ModelVersionManager initialization failed (non-critical):', err.message);
    });

    // NEW: Load Default Model Config
    const defaultModel = credManager.getDefaultModel();
    if (defaultModel) {
      console.log(`[ProcessingHelper] Loading stored Default Model: ${defaultModel}`);
      // A saved choice that can no longer be used stays visible and refuses answers; nothing is substituted.
      try { this.llmHelper.setModel(defaultModel); }
      catch (error) { this.llmHelper.selectUnavailable(defaultModel, error instanceof Error ? error.message : 'The saved answer model is unavailable.'); }
    }
    this.llmHelper.setGenerationPolicy(credManager.getGenerationPolicy());

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

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.appState.getMainWindow()
    if (!mainWindow) return

    const view = this.appState.getView()

    if (view === "queue") {
      const screenshotQueue = this.appState.getScreenshotHelper().getScreenshotQueue()
      if (screenshotQueue.length === 0) {
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }



      const allPaths = this.appState.getScreenshotHelper().getScreenshotQueue();

      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START)
      this.appState.setView("solutions")
      this.cancelOngoingRequests();
      const controller = new AbortController();
      this.currentProcessingAbortController = controller;
      const task = this.llmHelper.beginGenerationTask('written', controller.signal);
      this.currentProcessingTask = task;
      task.rendererOwner = mainWindow.webContents;
      try {
        // Generate the structured 4-phase rolling interview script
        const rollingScript = await this.llmHelper.runGeneration(() => this.llmHelper.generateRollingScript(allPaths), 'written', controller.signal, task);
        if (this.currentProcessingAbortController !== controller || controller.signal.aborted || mainWindow.webContents.isDestroyed?.()) return;
        this.appState.getIntelligenceManager?.().logUsage('chat', 'Screenshot analysis', JSON.stringify(rollingScript), this.llmHelper.getTaskMetadata(task));

        const problemInfo = {
          problem_statement: rollingScript.problem_identifier_script,
          input_format: { description: "Generated from screenshot", parameters: [] as any[] },
          output_format: { description: "Generated from screenshot", type: "string", subtype: "structured" },
          complexity: { time: rollingScript.time_complexity, space: rollingScript.space_complexity },
          test_cases: [] as any[],
          validation_type: "structured",
          difficulty: "custom"
        };
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo);
        this.appState.setProblemInfo(problemInfo);

        // Send the full structured solution so Solutions.tsx renders the 4 phases
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.SOLUTION_SUCCESS, {
          generation: this.llmHelper.getTaskMetadata(task),
          solution: {
            problem_identifier_script: rollingScript.problem_identifier_script,
            brainstorm_script: rollingScript.brainstorm_script,
            code: rollingScript.code,
            dry_run_script: rollingScript.dry_run_script,
            time_complexity: rollingScript.time_complexity,
            space_complexity: rollingScript.space_complexity,
          }
        });
      } catch (error: any) {
        if (this.currentProcessingAbortController !== controller || mainWindow.webContents.isDestroyed?.()) return;
        this.appState.getIntelligenceManager?.().logUsage('chat', 'Screenshot analysis', task.displayedText, this.llmHelper.getTaskMetadata(task));
        console.error("[ProcessingHelper] Rolling script generation failed:", error);
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error.message, this.llmHelper.getTaskMetadata(task))
      } finally {
        if (this.currentProcessingAbortController === controller) { this.currentProcessingAbortController = null; this.currentProcessingTask = undefined; }
      }
      return;

    } else {
      // Debug mode
      const extraScreenshotQueue = this.appState.getScreenshotHelper().getExtraScreenshotQueue()
      if (extraScreenshotQueue.length === 0) {
        // console.log("No extra screenshots to process")
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_START)
      this.cancelOngoingRequests();
      const controller = new AbortController();
      this.currentExtraProcessingAbortController = controller;
      const task = this.llmHelper.beginGenerationTask('written', controller.signal);
      this.currentExtraProcessingTask = task;
      task.rendererOwner = mainWindow.webContents;

      try {
        // Get problem info and current solution
        const problemInfo = this.appState.getProblemInfo()
        if (!problemInfo) {
          throw new Error("No problem info available")
        }

        // The debug workflow shares one deadline, cancellation signal and send budget.
        const debugResult = await this.llmHelper.runGeneration(async () => {
          const currentSolution = await this.llmHelper.generateSolution(problemInfo);
          return this.llmHelper.debugSolutionWithImages(problemInfo, currentSolution.solution.code, extraScreenshotQueue);
        }, 'written', controller.signal, task);
        if (this.currentExtraProcessingAbortController !== controller || controller.signal.aborted || mainWindow.webContents.isDestroyed?.()) return;
        this.appState.getIntelligenceManager?.().logUsage('chat', 'Screenshot debugging', JSON.stringify(debugResult), this.llmHelper.getTaskMetadata(task));

        this.appState.setHasDebugged(true)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_SUCCESS,
          { ...debugResult, generation: this.llmHelper.getTaskMetadata(task) }
        )

      } catch (error: any) {
        if (this.currentExtraProcessingAbortController !== controller || mainWindow.webContents.isDestroyed?.()) return;
        this.appState.getIntelligenceManager?.().logUsage('chat', 'Screenshot debugging', task.displayedText, this.llmHelper.getTaskMetadata(task));
        // console.error("Debug processing error:", error)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_ERROR,
          error.message,
          this.llmHelper.getTaskMetadata(task)
        )
      } finally {
        if (this.currentExtraProcessingAbortController === controller) { this.currentExtraProcessingAbortController = null; this.currentExtraProcessingTask = undefined; }
      }
    }
  }

  public cancelOngoingRequests(): void {
    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      if (this.currentProcessingTask && this.currentProcessingTask.terminalStatus !== 'completed') this.appState.getIntelligenceManager?.().logUsage('chat', 'Screenshot analysis', this.currentProcessingTask.displayedText, this.llmHelper.getTaskMetadata(this.currentProcessingTask));
      this.currentProcessingAbortController = null
      this.currentProcessingTask = undefined;
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      if (this.currentExtraProcessingTask && this.currentExtraProcessingTask.terminalStatus !== 'completed') this.appState.getIntelligenceManager?.().logUsage('chat', 'Screenshot debugging', this.currentExtraProcessingTask.displayedText, this.llmHelper.getTaskMetadata(this.currentExtraProcessingTask));
      this.currentExtraProcessingAbortController = null
      this.currentExtraProcessingTask = undefined;
    }

    this.appState.setHasDebugged(false)
  }



  public getLLMHelper() {
    return this.llmHelper;
  }
}
