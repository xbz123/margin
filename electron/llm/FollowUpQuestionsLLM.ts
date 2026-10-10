import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT } from "./prompts";
import { TINY_FOLLOW_UP_QUESTIONS_PROMPT } from "./tinyPrompts";

export class FollowUpQuestionsLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    private resolvePrompt(): string {
        return this.llmHelper.getPromptTier() === 'tiny' ? TINY_FOLLOW_UP_QUESTIONS_PROMPT : UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT;
    }

    generate(...args: Parameters<FollowUpQuestionsLLM['generateInner']>): Promise<string> {
        const factory = () => this.generateInner(...args);
        return this.llmHelper.runGeneration(factory);
    }

    async generateInner(context: string): Promise<string> {
        const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
        const stream = this.llmHelper.streamChat(fittedContext, undefined, undefined, this.resolvePrompt());
        let full = "";
        for await (const chunk of stream) full += chunk;
        return full;
    }

    generateStream(...args: Parameters<FollowUpQuestionsLLM['generateStreamInner']>): AsyncGenerator<string> {
        const factory = () => this.generateStreamInner(...args);
        return this.llmHelper.runGenerationStream(factory);
    }

    async *generateStreamInner(context: string): AsyncGenerator<string> {
        const fittedContext = this.llmHelper.fitContextForCurrentModel(context);
        yield* this.llmHelper.streamChat(fittedContext, undefined, undefined, this.resolvePrompt());
    }
}
