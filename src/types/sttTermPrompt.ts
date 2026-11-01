// Term hints are sent as the Whisper `prompt`, which reads at most 224 tokens. ASCII counts
// one per character and anything else (mostly Chinese) three, which keeps the longest
// accepted hint under that limit in either language.
export const STT_TERM_PROMPT_MAX_WEIGHT = 300;

export function sttTermPromptWeight(text: string): number {
  let weight = 0;
  for (const char of text) weight += char.charCodeAt(0) < 128 ? 1 : 3;
  return weight;
}
