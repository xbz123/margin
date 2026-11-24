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
 * It is exactly one `StreamDashFilter` fed the whole text (`push` then
 * `finish`), so offline and streamed answers always agree; see that class for
 * the rules. In short: each run of em / en dashes in prose becomes at most one
 * separator: "，" after CJK text, ", " otherwise, a single space after ASCII
 * , . ; : ! ? (and after "…" that follows non-CJK text), nothing at line start
 * or after CJK / fullwidth clause punctuation. The separator is dropped when
 * the next prose character is itself clause punctuation ("word —." gives
 * "word."). Spaces, tabs, U+3000 and U+00A0 around the run are dropped. The
 * ASCII hyphen-minus is never touched, dashes inside code are kept, and
 * commas already in the text are never removed. While streaming, only
 * trailing whitespace or one pending separator is ever held back; here
 * `finish()` returns it, so nothing is lost.
 */
export function reduceDashes(text: string): string {
    if (!text || typeof text !== "string") return "";
    const filter = new StreamDashFilter();
    return filter.push(text) + filter.finish();
}

const ASCII_CLAUSE_PUNCT = new Set([",", ".", ";", ":", "!", "?"]);
const CJK_CLAUSE_PUNCT = new Set(["，", "。", "；", "：", "！", "？", "、", "…"]);
const LETTER_OR_NUMBER = /^[\p{L}\p{N}]$/u;
const CJK_SCRIPT = /^[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}\p{scx=Bopomofo}]$/u;
const isHighSurrogate = (ch: string) => ch.length === 1 && ch >= "\uD800" && ch <= "\uDBFF";
const isLowSurrogate = (ch: string) => ch.length === 1 && ch >= "\uDC00" && ch <= "\uDFFF";
/** Whitespace that may be held / dropped around a prose dash: space, tab, ideographic space, NBSP. */
const isDashSpace = (ch: string) => ch === " " || ch === "\t" || ch === "\u3000" || ch === "\u00A0";
const isClausePunct = (ch: string) => ASCII_CLAUSE_PUNCT.has(ch) || CJK_CLAUSE_PUNCT.has(ch);

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
/** The last non-whitespace character on the current line: none yet, clause punctuation, or anything else. */
type LeftKind = "none" | "asciiPunct" | "cjkPunct" | "other";

/**
 * Streaming dash filter: the per-stream counterpart of `reduceDashes`.
 *
 * It rewrites only em dash (—) and en dash (–) in prose. The ASCII
 * hyphen-minus is never touched anywhere, so code, math ("$a - b$"), list
 * markers and thematic breaks ("- - -") pass through byte for byte whatever
 * the code tracking below gets wrong.
 *
 * Prose dashes, character by character with state kept across `push()` calls:
 * "Whitespace" below means space, tab, U+3000 (ideographic space) and U+00A0
 * (NBSP); at line start it is indentation and is never held or dropped.
 * - A run of em / en dashes (whitespace between them allowed) gives at most
 *   one separator, chosen when its first dash arrives; the rest of the run and
 *   the whitespace after it are dropped. A newline, a code marker or any
 *   other character ends the run.
 * - Separator: nothing at line start (indentation stays); nothing after CJK /
 *   fullwidth clause punctuation (，。；：！？、, and "…" when the line's most
 *   recent letter / number is CJK); one space after ASCII , . ; : ! ? (and
 *   after "…" otherwise); otherwise "，" when the line's most recent prose
 *   letter or number is CJK (Han, kana, Hangul, Bopomofo; closing quotes do
 *   not hide it), else ", ".
 * - A non-empty separator is held until the first character after the run:
 *   clause punctuation (, . ; : ! ? ，。；：！？、…) drops it ("word —." gives
 *   "word."), anything else (letter, quote, newline, code marker...) emits it
 *   first.
 * - Whitespace before a dash is dropped. So that nothing already emitted
 *   needs retracting, whitespace after a non-space character on a prose line
 *   is held back, across chunks, until the next character: a dash drops it,
 *   anything else emits it unchanged first.
 * Held content is only ever that trailing whitespace or one pending
 * separator, never other text. `finish()` returns it at the end of the
 * stream; a stream cancelled early loses it. `push()` may return "".
 * Output is the same however the text is split into chunks, including a
 * surrogate pair split across two chunks.
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
 * Marker characters and code are emitted immediately; a marker split across
 * chunks is resolved when the next chunk shows how long the run is.
 */
export class StreamDashFilter {
    private state: DashFilterState = { kind: "prose" };
    /** Whitespace only since the last newline (or stream start). */
    private lineStart = true;
    /** Indentation (columns) of the current line so far, while `lineStart`. */
    private indent = 0;
    /** The pending marker run: its character, length so far, and where it began. */
    private run: { char: FenceChar; length: number; atLineStart: boolean; indent: number } | null = null;
    /** Prose whitespace after a non-space character, not yet emitted. */
    private held = "";
    /** The separator chosen for the current dash run, not yet emitted (never set together with `held`). */
    private pendingSep = "";
    /** Inside a prose dash run: further dashes and whitespace (space, tab, U+3000, NBSP) are dropped. */
    private inDashRun = false;
    private left: LeftKind = "none";
    /** Whether the line's most recent prose letter / number is CJK; null when there is none yet. */
    private cjk: boolean | null = null;
    /** The previous character, when it was a lone high surrogate (a pair split across chunks). */
    private prevHigh = "";

    push(chunk: string): string {
        if (!chunk) return "";
        let out = "";
        for (const ch of chunk) {
            const high = this.prevHigh;
            this.prevHigh = isHighSurrogate(ch) ? ch : "";
            const space = ch === " " || ch === "\t";
            const ws = isDashSpace(ch);
            const dash = ch === "—" || ch === "–";
            // Invariant: while held / pendingSep / inDashRun is set, the state is prose,
            // run === null and lineStart === false.
            if (this.inDashRun) {
                if (ws || dash) continue;
                this.inDashRun = false;
                if (this.pendingSep && !isClausePunct(ch)) out += this.pendingSep;
                this.pendingSep = "";
            }
            if (this.held) {
                if (ws) { this.held += ch; continue; }
                if (!dash) { out += this.held; this.held = ""; }
            }
            if (this.run) {
                if (ch === this.run.char) { this.run.length++; out += ch; continue; }
                this.resolveRun();
            }
            const state = this.state;
            if (state.kind === "fence" && state.pendingClose) {
                if (ch === "\n") {
                    this.state = { kind: "prose" };
                    this.newLine();
                    out += ch;
                    continue;
                }
                if (/\s/.test(ch)) { out += ch; continue; }
                // Text after the fence run: not a close, the block goes on.
                state.pendingClose = false;
            }
            const isMarker = ch === "`" || (ch === "~" && this.lineStart);
            if (isMarker) {
                this.run = { char: ch as FenceChar, length: 1, atLineStart: this.lineStart, indent: this.indent };
                this.lineStart = false;
                this.left = "other";
                out += ch;
                continue;
            }
            if (ch === "\n") {
                if (this.lineStart && this.state.kind === "inline") this.state = { kind: "prose" };
                this.newLine();
            } else if (this.lineStart && space) {
                this.indent += ch === "\t" ? 4 : 1;
            } else if (!/\s/.test(ch)) {
                this.lineStart = false;
            }
            if (this.state.kind !== "prose") {
                if (!/\s/.test(ch)) this.left = "other";
                out += ch;
                continue;
            }
            if (dash) {
                this.pendingSep = this.separator();
                this.held = "";
                this.inDashRun = true;
                continue;
            }
            if (ws && !this.lineStart) { this.held += ch; continue; }
            if (!/\s/.test(ch)) this.noteProse(isLowSurrogate(ch) && high ? high + ch : ch);
            out += ch;
        }
        return out;
    }

    /** Ends the stream: returns (and clears) the held trailing whitespace or pending separator. */
    finish(): string {
        const held = this.held + this.pendingSep;
        this.held = "";
        this.pendingSep = "";
        return held;
    }

    private newLine(): void {
        this.lineStart = true;
        this.indent = 0;
        this.left = "none";
        this.cjk = null;
    }

    private noteProse(ch: string): void {
        if (ch === "…") this.left = this.cjk ? "cjkPunct" : "asciiPunct";
        else this.left = ASCII_CLAUSE_PUNCT.has(ch) ? "asciiPunct" : CJK_CLAUSE_PUNCT.has(ch) ? "cjkPunct" : "other";
        if (LETTER_OR_NUMBER.test(ch)) this.cjk = CJK_SCRIPT.test(ch);
    }

    private separator(): string {
        switch (this.left) {
            case "none":
            case "cjkPunct": return "";
            case "asciiPunct": return " ";
            default: return this.cjk ? "，" : ", ";
        }
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
 * Empty outputs (a chunk that was only held whitespace or dropped dashes)
 * are skipped, so consumers never see an empty token. At the normal end the
 * held trailing whitespace or pending separator is yielded; a consumer that
 * stops early loses it.
 * Closing the returned generator early closes `source` too.
 */
export async function* filterStreamDashes(source: AsyncIterable<string>): AsyncGenerator<string, void, unknown> {
    const filter = new StreamDashFilter();
    for await (const chunk of source) {
        const out = filter.push(chunk);
        if (out) yield out;
    }
    const tail = filter.finish();
    if (tail) yield tail;
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

    // Step 0: Reduce dashes (each em/en dash run → "，" / ", " / one space / nothing,
    // dropped before clause punctuation; ASCII hyphen and code untouched). Backstop for
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
