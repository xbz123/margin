import { LLMHelper } from "../LLMHelper";
import { CODE_HINT_PROMPT, buildCodeHintMessage } from "./prompts";
import { TINY_CODE_HINT_PROMPT } from "./tinyPrompts";

export class CodeHintLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    generateStream(...args: Parameters<CodeHintLLM['generateStreamInner']>): AsyncGenerator<string> {
        const factory = () => this.generateStreamInner(...args);
        return this.llmHelper.runGenerationStream(factory);
    }

    async *generateStreamInner(
        imagePaths?: string[],
        questionContext?: string,
        questionSource?: 'screenshot' | 'transcript' | null,
        transcriptContext?: string
    ): AsyncGenerator<string> {
        const message = buildCodeHintMessage(
            questionContext ?? null,
            questionSource ?? null,
            transcriptContext ?? null
        );

        const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_CODE_HINT_PROMPT : CODE_HINT_PROMPT;
        const fittedMessage = this.llmHelper.fitContextForCurrentModel(message);

        yield* this.llmHelper.streamChat(
            fittedMessage,
            imagePaths,
            undefined,
            promptOverride
        );
    }
}
