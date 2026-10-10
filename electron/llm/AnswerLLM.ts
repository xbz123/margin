import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_ANSWER_PROMPT } from "./prompts";
import { TINY_ANSWER_PROMPT } from "./tinyPrompts";

export class AnswerLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Generate a spoken interview answer
     */
    generate(...args: Parameters<AnswerLLM['generateInner']>): Promise<string> {
        const factory = () => this.generateInner(...args);
        return this.llmHelper.runGeneration(factory);
    }

    async generateInner(question: string, context?: string): Promise<string> {
        const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_ANSWER_PROMPT : UNIVERSAL_ANSWER_PROMPT;
        const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(context) : context;
        const stream = this.llmHelper.streamChat(question, undefined, fittedContext, promptOverride);

        let fullResponse = "";
        for await (const chunk of stream) {
            fullResponse += chunk;
        }
        return fullResponse.trim();
    }
}
