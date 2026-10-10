import { LLMHelper } from "../LLMHelper";
import { BRAINSTORM_MODE_PROMPT } from "./prompts";
import { TINY_BRAINSTORM_PROMPT } from "./tinyPrompts";

export class BrainstormLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate a "thinking out loud" spoken script (streamed)
     * Context is passed directly as the user message so the LLM sees the problem.
     */
    generateStream(...args: Parameters<BrainstormLLM['generateStreamInner']>): AsyncGenerator<string> {
        const factory = () => this.generateStreamInner(...args);
        return this.llmHelper.runGenerationStream(factory);
    }

    async *generateStreamInner(context: string, imagePaths?: string[]): AsyncGenerator<string> {
        if (!context.trim() && !imagePaths?.length) return;
        const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_BRAINSTORM_PROMPT : BRAINSTORM_MODE_PROMPT;
        const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(context) : context;
        yield* this.llmHelper.streamChat(fittedContext, imagePaths, undefined, promptOverride);
    }
}
