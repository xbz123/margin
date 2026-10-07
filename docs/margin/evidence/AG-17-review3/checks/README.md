# Checks for the third Astra review (PLAN.md section 9)

Raw outputs of the one-off checks behind the third round of review fixes (`02d4cb2e`).
All were run under the isolation guard. The mutation checks changed only build output
(`dist-electron/electron/LLMHelper.js` and the renderer bundle in `dist/assets`) or a
copy of a source file in the session's scratch directory, never the source in the
repository. The build output was restored afterwards: `LLMHelper.js` by a fresh build,
the renderer bundle from a copy, and each was compared byte for byte with the copy
taken before the mutation.

| File | What it shows |
| --- | --- |
| `scope.log` | `ScopeLocalFallback.test.mjs` with the new scope tests: 11/11 pass |
| `scope-checks-removed.log` | Mutation: the scope checks of `generateWithClaude` and `generateWithGroqMultimodal` removed from the built `LLMHelper.js`, and Gemini inline images no longer counted as screenshots: the Claude, Groq multimodal, Gemini contents and `chatWithGemini` cases fail (4) |
| `sweep-claude-check-removed.*` | The static sweep of `ScopeLocalFallback.test.mjs`, copied into a separate test (the `.txt` file) and run against a copy of `LLMHelper.ts` without the Claude check: it reports the Claude send as unchecked |
| `regression.log` | The answer regression harness with the new retry case: 6/6 pass |
| `regression-first-attempt.log` | The first run of the new case, before the test dismissed the first-run startup screen: it could not find the launcher's search box (a test setup error, not an app failure) |
| `regression-release-removed.log` | Mutation: the listener release removed from the launcher chat's catch block in the built renderer: the retry case fails waiting for the answer to appear once |
| `ppid-match.*` | A copy of `isolationRecords()` from `run-gates.mjs` (the `.txt` file) run against made-up isolation logs: a load record counts only when its `ppid` is the run-node.mjs process the gate started |
| `g3-new-rules-at-c8365b63.log` | The four new G3 phrases at the reviewed commit `c8365b63`: each had a hit before the fix |
