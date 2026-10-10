// electron/llm/AssistLLM.ts
// MODE: Assist - Passive observation (low priority)
// Provides brief observational insights, NEVER suggests what to say
// Uses LLMHelper for centralized routing and universal prompts

import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_ASSIST_PROMPT } from "./prompts";
import { TINY_ASSIST_PROMPT } from "./tinyPrompts";

export class AssistLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate passive observational insight
     * @param context - Current conversation context
     * @returns Insight (no post-clamp; prompt enforces brevity)
     */
    generate(...args: Parameters<AssistLLM['generateInner']>): Promise<string> {
        const factory = () => this.generateInner(...args);
        return this.llmHelper.runGeneration(factory);
    }

    async generateInner(context: string): Promise<string> {
        if (!context.trim()) {
            return "";
        }

        // Centralized LLM logic
        // providing a specific instruction as message, using UNIVERSAL_ASSIST_PROMPT as system prompt
        const instruction = "Briefly summarize what is happening right now in 1-2 sentences. Do not give advice, just observation.";

        const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_ASSIST_PROMPT : UNIVERSAL_ASSIST_PROMPT;
        const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
        return await this.llmHelper.chat(
            instruction,
            undefined,
            fittedContext,
            promptOverride,
            true
        );
    }
}
