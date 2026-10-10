import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_FOLLOWUP_PROMPT } from "./prompts";
import { TINY_FOLLOWUP_PROMPT } from "./tinyPrompts";

export class FollowUpLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    private resolvePrompt(): string {
        return this.llmHelper.getPromptTier() === 'tiny' ? TINY_FOLLOWUP_PROMPT : UNIVERSAL_FOLLOWUP_PROMPT;
    }

    generate(...args: Parameters<FollowUpLLM['generateInner']>): Promise<string> {
        const factory = () => this.generateInner(...args);
        return this.llmHelper.runGeneration(factory);
    }

    async generateInner(previousAnswer: string, refinementRequest: string, context?: string): Promise<string> {
        const message = `PREVIOUS ANSWER:\n${previousAnswer}\n\nREQUEST: ${refinementRequest}`;
        const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(context) : context;
        const stream = this.llmHelper.streamChat(message, undefined, fittedContext, this.resolvePrompt());
        let full = "";
        for await (const chunk of stream) full += chunk;
        return full;
    }

    generateStream(...args: Parameters<FollowUpLLM['generateStreamInner']>): AsyncGenerator<string> {
        const factory = () => this.generateStreamInner(...args);
        return this.llmHelper.runGenerationStream(factory);
    }

    async *generateStreamInner(previousAnswer: string, refinementRequest: string, context?: string): AsyncGenerator<string> {
        const message = `PREVIOUS ANSWER:\n${previousAnswer}\n\nREQUEST: ${refinementRequest}`;
        const fittedContext = context ? this.llmHelper.fitContextForCurrentModel(context) : context;
        yield* this.llmHelper.streamChat(message, undefined, fittedContext, this.resolvePrompt());
    }
}
