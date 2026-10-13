# S42-02 answer guidance acceptance

2026-10-13; source baseline `a790e320` plus this ticket. Claude Opus 5.5 medium
implemented the U8 wording and its consumer tests; the main agent reviewed the
actual assembled full/tiny prompts, behavioral shape and spoken Stop path.

Written answers lead with the conclusion and solution steps, with complete code
for coding problems. Interview answers open with speakable content before detail.
Ambiguous live interview answers give the best one or two directions instead of
a mandatory missing-information opener. Missing personal technology history can
yield one to three clearly labelled recommendations, never invented experience.
Unreadable image content is not fabricated. Active Clarify remains a question.

Shared pure text lives in `src/types/answerGuidance.ts`. The spoken Stop consumer
uses it in its own context prompt without changing the existing empty-system IPC
option, cancellation, audio-finalization or generation-budget behavior. A main-agent
scope correction makes the non-clarification default explicitly live-interview-only;
the corresponding assertion failed first, then the three affected test files passed
12/12. Current fingerprints record the authorized new text, not unchanged AG-51
content. See `review-red.log`.

Final local gates: **16/16**, 989 tests (988 pass, 0 fail, 1 existing skip).
Guarded answer regression, storage, startup and renderer checks passed, as did the
required-evidence checker. G2 has zero unreviewed hits with no new exceptions,
dependencies, endpoints or skips. Exact commands and outcomes: `summary.json`.
Generated logs normalize machine-specific repository/account/temp/Node paths.

Not verified: real model answer quality, hallucination rate or latency. Mock requests
prove rule assembly and preserved security/data-scope handling, not model compliance.
Stop still uses its old timing path; the shared lifecycle and interview budget are
owned by S42-03/04, not silently changed in this prompt ticket. Public CI is pending
dispatch on this ticket's commit.
