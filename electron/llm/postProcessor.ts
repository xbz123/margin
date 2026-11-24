// electron/llm/postProcessor.ts
// Hard post-processing clamp to enforce constraints
// Even if Gemini misbehaves, this ensures clean output

/**
 * Filler phrases to strip from end of responses
 */
const FILLER_PHRASES = [
    "I hope this helps",
    "Let me know if you",
    "Feel free to",
    "Does that make sense",
    "Is there anything else",
    "Hope that answers",
    "Let me know if you have",
    "I'd be happy to",
];

/**
 * Prefixes to strip from start of responses
 */
const PREFIXES = [
    "Refined (rephrase):",
    "Refined (expand):",
    "Refined answer:",
    "Refined:",
    "Answer:",
    "Response:",
    "Suggestion:",
    "Here is the answer:",
    "Here is the refined answer:",
];

/**
 * Reduce dash usage that betrays AI authorship. The prompt rules ban em/en
 * dashes in spoken passages but Llama / Gemini / GPT all generate them
 * anyway because their training distribution is saturated with them. This is
 * the deterministic backstop that strips them before the user ever sees them.
 *
 * Rules (in order):
 * - Em dash (—) with surrounding spaces / tabs → ", "
 * - En dash (–) with surrounding spaces / tabs → ", "
 *   (Line breaks around the dash are kept, so a following fence or list
 *   line is never glued onto the prose line.)
 * - Cleanup of the commas that swap leaves: double commas, comma before a
 *   terminator, a comma orphaned at line start.
 *
 * The ASCII hyphen-minus ("-") is never touched: it is the subtraction
 * operator in code and math ("$a - b$"), a list marker and a thematic break
 * ("- - -"), and the code detection here is too shallow to tell those apart.
 *
 * Em / en dashes are kept, best effort, inside fenced code blocks
 * (```...```) and inline code (`...`).
 *
 * Safe to call on already-clean text (idempotent).
 */
export function reduceDashes(text: string): string {
    if (!text || typeof text !== "string") return "";

    // Stash code so we don't touch dashes inside it
    const codeBlocks: string[] = [];
    let result = text.replace(/```[\s\S]*?```/g, (m) => {
        codeBlocks.push(m);
        return `CODE${codeBlocks.length - 1}`;
    });
    const inlineCodes: string[] = [];
    result = result.replace(/`[^`\n]+`/g, (m) => {
        inlineCodes.push(m);
        return `INL${inlineCodes.length - 1}`;
    });

    // Em + en dash → comma. Eat surrounding spaces / tabs, never line breaks.
    result = result.replace(/[ \t]*[—–][ \t]*/g, ", ");

    // Tidy up artifacts
    // Same line only, so line breaks stay as they were.
    result = result.replace(/,[ \t]*,+/g, ",");      // double commas
    result = result.replace(/,[ \t]*([.!?])/g, "$1"); // comma-then-terminator
    result = result.replace(/^,[ \t]*/gm, "");        // line-start orphan comma

    // Restore code. Function replacement, so "$&" / "$$" inside code stay literal.
    inlineCodes.forEach((c, i) => {
        result = result.replace(`INL${i}`, () => c);
    });
    codeBlocks.forEach((c, i) => {
        result = result.replace(`CODE${i}`, () => c);
    });

    return result;
}

/**
 * Prose-only dash swap, as `reduceDashes` does outside code: an em / en
 * dash with the spaces / tabs around it inside this segment (never line
 * breaks) becomes ", ". Whitespace already emitted in an earlier chunk
 * stays. The ASCII hyphen is never touched.
 */
function swapProseDashes(segment: string): string {
    return segment.replace(/[ \t]*[—–][ \t]*/g, ", ");
}

type FenceChar = "`" | "~";
type DashFilterState =
    | { kind: "prose" }
    | { kind: "inline"; ticks: number }
    | {
        kind: "fence";
        char: FenceChar;
        length: number;
        /** Indentation (columns) of the opening fence line. */
        indent: number;
        /** A closing-fence candidate was seen; only whitespace may follow it on its line. */
        pendingClose: boolean;
    };

/**
 * Streaming dash filter: the per-stream counterpart of `reduceDashes`.
 *
 * It rewrites only em dash (—) and en dash (–) in prose, to ", ". The ASCII
 * hyphen-minus is never touched anywhere, so code, math ("$a - b$"), list
 * markers and thematic breaks ("- - -") pass through byte for byte whatever
 * the code tracking below gets wrong.
 *
 * Providers split code anywhere (mid-line, mid-fence-marker), so each chunk
 * is not self-describing. One instance follows the markdown code state
 * across every chunk of ONE stream so that em / en dashes inside code are
 * kept. The tracking is best effort, not a Markdown parser, and it only
 * protects em / en dashes. Rules loosely follow CommonMark, erring toward
 * "code" where they are ambiguous:
 * - Opening fence: a run of 3+ backticks or 3+ tildes with only whitespace
 *   before it on its line (any indentation, so fences nested in lists
 *   count). It opens from prose and also from inside an unclosed inline
 *   span (a fence interrupts the paragraph).
 * - Closing fence: at line start, indented at most 3 columns more than the
 *   opening fence, the same character, a run at least as long as the
 *   opener, and only whitespace after it until the end of the line. After
 *   such a run the filter stays in code ("pending close"): whitespace and
 *   the newline confirm the close, any other character cancels it and the
 *   block continues. Either way those characters are emitted unchanged.
 * - Inline code: a backtick run of any length that is not an opening fence
 *   (mid-line, or 1-2 backticks at line start) opens an inline span, closed
 *   by a run of exactly the same length, or by a blank line (inline code
 *   never spans paragraphs). Mid-line tildes are plain text.
 * - Not supported: fences inside `>` blockquotes. The `>` makes the run
 *   mid-line, so it is read as an inline span; em / en dashes there may be
 *   kept or converted depending on the markers that follow.
 * Marker characters are emitted immediately; a marker split across chunks
 * is resolved when the next chunk shows how long the run is, before any of
 * that chunk's text is rewritten. Nothing is held back, so there is nothing
 * to flush at the end or lose on cancel. Spaces before an em / en dash
 * that were emitted in an earlier chunk stay as they are.
 */
export class StreamDashFilter {
    private state: DashFilterState = { kind: "prose" };
    /** Whitespace only since the last newline (or stream start). */
    private lineStart = true;
    /** Indentation (columns) of the current line so far, while `lineStart`. */
    private indent = 0;
    /** The pending marker run: its character, length so far, and where it began. */
    private run: { char: FenceChar; length: number; atLineStart: boolean; indent: number } | null = null;

    push(chunk: string): string {
        if (!chunk) return chunk;
        let out = "";
        let prose = "";
        const flushProse = () => {
            if (!prose) return;
            out += swapProseDashes(prose);
            prose = "";
        };
        const emit = (ch: string) => { out += ch; };

        for (const ch of chunk) {
            if (this.run) {
                if (ch === this.run.char) { this.run.length++; emit(ch); continue; }
                this.resolveRun();
            }
            const state = this.state;
            if (state.kind === "fence" && state.pendingClose) {
                if (ch === "\n") {
                    this.state = { kind: "prose" };
                    this.lineStart = true;
                    this.indent = 0;
                    emit(ch);
                    continue;
                }
                if (/\s/.test(ch)) { emit(ch); continue; }
                // Text after the fence run: not a close, the block goes on.
                state.pendingClose = false;
            }
            const isMarker = ch === "`" || (ch === "~" && this.lineStart);
            if (isMarker) {
                flushProse();
                this.run = { char: ch as FenceChar, length: 1, atLineStart: this.lineStart, indent: this.indent };
                this.lineStart = false;
                emit(ch);
                continue;
            }
            if (ch === "\n") {
                if (this.lineStart && this.state.kind === "inline") this.state = { kind: "prose" };
                this.lineStart = true;
                this.indent = 0;
            } else if (this.lineStart && (ch === " " || ch === "\t")) {
                this.indent += ch === "\t" ? 4 : 1;
            } else if (!/\s/.test(ch)) {
                this.lineStart = false;
            }
            if (this.state.kind === "prose") prose += ch;
            else emit(ch);
        }
        flushProse();
        return out;
    }

    private resolveRun(): void {
        const run = this.run!;
        this.run = null;
        const state = this.state;
        if (state.kind === "fence") {
            const closes = run.atLineStart && run.char === state.char && run.length >= state.length
                && run.indent <= state.indent + 3;
            if (closes) state.pendingClose = true;
        } else if (run.atLineStart && run.length >= 3) {
            this.state = { kind: "fence", char: run.char, length: run.length, indent: run.indent, pendingClose: false };
        } else if (state.kind === "inline") {
            if (run.char === "`" && run.length === state.ticks) this.state = { kind: "prose" };
        } else if (run.char === "`") {
            this.state = { kind: "inline", ticks: run.length };
        }
    }
}

/**
 * Wraps a token stream with a fresh `StreamDashFilter` (one per stream).
 * Closing the returned generator early closes `source` too.
 */
export async function* filterStreamDashes(source: AsyncIterable<string>): AsyncGenerator<string, void, unknown> {
    const filter = new StreamDashFilter();
    for await (const chunk of source) yield filter.push(chunk);
}

/**
 * Clamp response to strict interview copilot constraints
 * @param text - Raw LLM response
 * @param maxSentences - Maximum sentences allowed (default 3)
 * @param maxWords - Maximum words allowed (default 60)
 * @returns Clean, clamped plain text
 */
export function clampResponse(
    text: string,
    maxSentences: number = 3,
    maxWords: number = 45
): string {
    if (!text || typeof text !== "string") {
        return "";
    }

    let result = text.trim();

    // Step 0: Reduce dashes (em/en dash → comma; ASCII hyphen untouched). Backstop for
    // the prompt-level anti-tell rule that providers don't fully respect.
    result = reduceDashes(result);

    // Step 1: Strip markdown
    result = stripMarkdown(result);

    // Step 2: Strip prefixes (labels)
    result = stripPrefixes(result);

    // Step 3: Remove filler phrases from end
    result = stripFillerPhrases(result);

    // CRITICAL: If code blocks were found (preserved from stripMarkdown), DO NOT CLAMP.
    // Code answers need to be full length.
    const hasCodeBlocks = /```/.test(result);

    if (!hasCodeBlocks) {
        // Step 4: Enforce sentence limit (only for prose)
        result = limitSentences(result, maxSentences);

        // Step 5: Enforce word limit (only for prose)
        result = limitWords(result, maxWords);
    }

    // Step 6: Final cleanup
    result = result.trim();

    return result;
}

/**
 * Strip all markdown formatting
 */
/**
 * Strip all markdown formatting but PRESERVE code blocks
 */
function stripMarkdown(text: string): string {
    const codeBlocks: string[] = [];
    let result = text;

    // Extract code blocks to protect them
    result = result.replace(/```[\s\S]*?```/g, (match) => {
        codeBlocks.push(match);
        return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    // Remove headers (# ## ### etc.)
    result = result.replace(/^#{1,6}\s+/gm, "");

    // Remove bold (**text** or __text__)
    result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
    result = result.replace(/__([^_]+)__/g, "$1");

    // Remove italic (*text* or _text_)
    result = result.replace(/\*([^*]+)\*/g, "$1");
    result = result.replace(/_([^_]+)_/g, "$1");

    // Remove inline code (`text`) - keep content
    result = result.replace(/`([^`]+)`/g, "$1");

    // Remove bullet points (-, *, •)
    result = result.replace(/^[\s]*[-*•]\s+/gm, "");

    // Remove numbered lists
    result = result.replace(/^[\s]*\d+\.\s+/gm, "");

    // Remove blockquotes
    result = result.replace(/^>\s+/gm, "");

    // Remove horizontal rules
    result = result.replace(/^[-*_]{3,}$/gm, "");

    // Remove links [text](url) -> text
    result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

    // Collapse multiple newlines to single space (but preserve structure around blocks later?)
    // We should be careful collapsing newlines around placeholders
    result = result.replace(/\n+/g, " ");

    // Collapse multiple spaces
    result = result.replace(/\s+/g, " ");

    // Restore code blocks
    // Add newlines around them for better formatting
    codeBlocks.forEach((block, index) => {
        result = result.replace(`__CODE_BLOCK_${index}__`, `\n${block}\n`);
    });

    return result.trim();
}

/**
 * Remove trailing filler phrases that add no value
 */
function stripFillerPhrases(text: string): string {
    let result = text;

    for (const phrase of FILLER_PHRASES) {
        const regex = new RegExp(`[.!?]?\\s*${phrase}[^.!?]*[.!?]?\\s*$`, "i");
        result = result.replace(regex, ".");
    }

    // Clean up trailing punctuation issues
    result = result.replace(/\.+$/, ".");
    result = result.replace(/\s+\.$/, ".");

    return result.trim();
}

/**
 * Limit to N sentences
 */
function limitSentences(text: string, maxSentences: number): string {
    // Split on sentence boundaries (., !, ?)
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

    if (sentences.length <= maxSentences) {
        return text;
    }

    // Take first N sentences
    return sentences.slice(0, maxSentences).join(" ").trim();
}

/**
 * Limit to N words
 */
function limitWords(text: string, maxWords: number): string {
    const words = text.split(/\s+/);

    if (words.length <= maxWords) {
        return text;
    }

    // Take first N words
    let result = words.slice(0, maxWords).join(" ");

    // Try to end at a sentence boundary
    const lastPunctuation = result.search(/[.!?][^.!?]*$/);
    if (lastPunctuation > result.length * 0.6) {
        result = result.substring(0, lastPunctuation + 1);
    } else {
        // Add ellipsis if we cut mid-sentence
        result = result.replace(/[,;:]?\s*$/, "...");
    }

    return result.trim();
}

/**
 * Validate response meets constraints
 * Returns true if valid, false if clamping was needed
 */
export function validateResponse(
    text: string,
    maxSentences: number = 3,
    maxWords: number = 60
): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check for markdown
    if (/[#*_`]/.test(text)) {
        issues.push("Contains markdown");
    }

    // Check sentence count
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    if (sentences.length > maxSentences) {
        issues.push(`Too many sentences (${sentences.length}/${maxSentences})`);
    }

    // Check word count
    const words = text.split(/\s+/);
    if (words.length > maxWords) {
        issues.push(`Too many words (${words.length}/${maxWords})`);
    }

    return {
        valid: issues.length === 0,
        issues,
    };
}

/**
 * Strip common prefixes/labels
 */
function stripPrefixes(text: string): string {
    let result = text;
    for (const prefix of PREFIXES) {
        if (result.toLowerCase().startsWith(prefix.toLowerCase())) {
            result = result.substring(prefix.length).trim();
        }
    }
    // Handle "Refined (...):" regex pattern
    result = result.replace(/^Refined \([^)]+\):\s*/i, "");

    return result.trim();
}
