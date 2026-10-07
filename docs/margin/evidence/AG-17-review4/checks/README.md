# Checks for the fourth Astra review (PLAN.md section 9)

Raw outputs of the one-off checks behind the fourth round of review fixes (`4523c762`,
`4bd2eb00`). All were run under the isolation guard. The mutation checks changed only
build output (`dist-electron/electron/*.js`, which the unit tests load, `main.js`,
which the app runs, and the renderer bundle in `dist/assets`), never the source. Each
mutated file was copied first, restored from the copy afterwards, and compared byte
for byte with it (`mutate.py.txt` is the replacement helper).

| File | What it shows |
| --- | --- |
| `scope-and-prepared-context.log` | `ScopeLocalFallback.test.mjs` and `IntelligenceEnginePreparedContext.test.mjs` with the new cases: 21/21 pass |
| `storage-meeting-chat.log` | The storage harness with the new meeting chat case: 3/3 pass |
| `storage-meeting-chat-attempt1..4.log` | Earlier runs of the new case while the test was being written. Attempts 1–2: the meeting ended in under one second and was dropped (MeetingPersistence's minimum). Attempts 3–4: the chat request never reached the mock. A later diagnostic run (its log was overwritten by the passing run and is not kept) recorded the stream error "No AI provider configured": the launcher reload restores the default Gemini model, and only the mock Groq key is set. The test now selects the Groq model after the reload. Test setup problems, not app failures |
| `m1-declared-refusal-removed.*` | Mutation: `streamChat` no longer refuses a denied declared scope (in `LLMHelper.js` and `main.js`): the unit case fails, and the storage case fails at the IPC request that declares `post_call_summary` ("expected a scope refusal, got null") |
| `m2-wta-history-filter-removed.unit.log` | Mutation: WhatToAnswer ignores the `profile_history` denial: its case fails |
| `m3-prepared-history-flag-ignored.unit.log` | Mutation: the prepared transcript context ignores `includeAssistantResponses`: its case fails |
| `m4-meeting-summary-always-included.storage.log` | Mutation: the meeting chat always includes the summary: with the scope denied it declares `post_call_summary`, the main process refuses ("Provider chat blocked by data scope policy: post_call_summary"), and the case fails waiting for the request |
| `m5-flash-branch-check-removed.unit.log` | Mutation: the scope check of the second Gemini branch of `generateContentStructured` removed: the branch case fails (the static sweep alone would not catch this) |
| `ppid-worker-match.*` | A copy of `isolationRecords()` from `run-gates.mjs` (the `.mjs.txt` file) run against made-up logs and against the real log of one guarded test run (`.real.jsonl`): a load record counts only when it comes from the process that ran the file, whose parent is the `node --test` runner started by run-node.mjs |
| `gates-first-run-failed/` | The first gate run, on `4523c762`: the `tests` step failed in `suggestionPromptAssembly.test.mjs`, whose WhatToAnswer stub lacked the new `deniedDataScopes()` method. Fixed in `4bd2eb00`; the evidence in the parent directory is the rerun |
