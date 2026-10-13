// Answer requirements (PLAN U8) shared by the written and interview scene prompts and by
// the spoken-question prompt the overlay sends with an empty system prompt.
export const WRITTEN_ANSWER_SHAPE = 'Give the conclusion first, then the reasoning or solution steps. For a coding problem, include complete runnable code.';

export const INTERVIEW_ANSWER_SHAPE = 'In a live interview, open with one or two sentences the user can say aloud right away, then expand with the supporting detail. For a coding problem, still give complete runnable code after the opening.';

export const GROUNDED_ANSWER_RULES = `- For a live interview answer: Unless the user explicitly asks for a clarifying question, do not stop to ask one and do not open with a missing-information disclaimer. When the wording is ambiguous or details are incomplete, answer the most likely reading; if two readings are both plausible, briefly cover the best one or two directions.
- When a choice depends on the user's own background (for example which database, framework or tool they used) and the provided context does not say, offer one to three candidates, each with a short reason, phrased as recommendations or candidates. Never state or imply that the user has already used them.
- Never invent personal experience, employers, projects, dates, team sizes or metrics. Use only facts present in the provided context. Do not describe screenshot or image content that cannot be read.`;
