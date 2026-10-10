import { LLMHelper } from "../LLMHelper";
import { CLARIFY_MODE_PROMPT } from "./prompts";
import { TINY_CLARIFY_PROMPT } from "./tinyPrompts";

export class ClarifyLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate a clarification question
     */
    generate(...args: Parameters<ClarifyLLM['generateInner']>): Promise<string> {
        const factory = () => this.generateInner(...args);
        return this.llmHelper.runGeneration(factory);
    }

    async generateInner(context: string): Promise<string> {
        if (!context.trim()) return "";
        const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_CLARIFY_PROMPT : CLARIFY_MODE_PROMPT;
        const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
        const stream = this.llmHelper.streamChat(fittedContext, undefined, undefined, promptOverride);
        let fullResponse = "";
        for await (const chunk of stream) fullResponse += chunk;
        return fullResponse.trim();
    }

    /**
     * Generate a clarification question (Streamed)
     */
    generateStream(...args: Parameters<ClarifyLLM['generateStreamInner']>): AsyncGenerator<string> {
        const factory = () => this.generateStreamInner(...args);
        return this.llmHelper.runGenerationStream(factory);
    }

    async *generateStreamInner(context: string): AsyncGenerator<string> {
        if (!context.trim()) return;
        const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_CLARIFY_PROMPT : CLARIFY_MODE_PROMPT;
        const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
        yield* this.llmHelper.streamChat(fittedContext, undefined, undefined, promptOverride);
    }
}
