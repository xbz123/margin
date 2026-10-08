# Checks for the seventh Astra review (PLAN.md section 9)

Raw outputs of the one-off checks behind the seventh round of review fixes (`9a7dcf1c`).
All were run under the isolation guard. The mutation checks changed only build output
(`dist-electron/electron/LLMHelper.js`, which the unit tests load, and the renderer
bundle `dist/assets/index-DTglraGl.js`), never the source. Each mutated file was copied
first, restored from the copy afterwards, and compared byte for byte with it
(`run-mutation.sh.txt` is the script; `mutate.py.txt` replaces a unique string,
`mutate_near.py.txt` the nearest occurrence before a unique anchor).

| File | What it shows |
| --- | --- |
| `scope.log` | `ScopeLocalFallback.test.mjs` with the tightened static sweep and three new cases that turn a scope off in the middle of a request (meeting summaries, `streamChat`, `chatWithGemini`): 24/24 pass |
| `storage.log` | The storage harness with the extended failed-save case (seven steps): 5/5 pass |
| `storage-attempt1..3.log` | Earlier runs of the extended case while it was being written: attempt 1 used the first `h1` on the page, which is not the meeting title; attempts 2–3 timed out clicking a key point and then the title, which another part of the page covered. The test now targets the editable title and dispatches the clicks to the elements. Test setup problems, not app failures. `storage-attempt4.log` is the first passing run |
| `pre-commit-gates.summary.json` | The type checks, provenance, retired, preload and IPC checks and the full `tests` step run before the commit (740 tests, 735 pass, 0 fail, 5 skipped). A first run of the same checks failed and its output was overwritten by this one: the baseline source test `LlmStreamAbortController.test.mjs` expects `streamChat` to loop over `this._streamChatInner(` directly (the scope wrapping was then moved into `_streamChatInner`, with the old body renamed `_streamChatBody`), and G2 matched two generic lines of the new test (`const elapsed = Date.now() - started;`, `assert.equal(sent.length, 1);`), which were reworded; no allowlist entry was added |
| `m13-request-scopes-not-merged.unit.log` | Mutation: the sends no longer see the request's scopes: the three mid-request cases fail |
| `m14-groq-stream-recheck-removed.unit.log` | Mutation: `streamWithGroq` no longer checks again right before sending: the `streamChat` case fails (the scope is turned off while the rate limiter waits) |
| `m15-summary-flash-continues-after-refusal.unit.log` | Mutation: the Flash attempts of the meeting summary treat a refusal as a provider failure: nothing more is sent (the other checks still refuse), but the chain goes through its retries and back-off waits; the summary case fails on time (about 2 s, limit 0.9 s) |
| `m15-invalid-not-applied.unit.log`, `m15-attempt-before-test-tightened.unit.log` | Two earlier m15 runs. The first is invalid: the script's argument split did not work in zsh and nothing was mutated (24/24 pass). The second applied the mutation, but the case then allowed 5 s and still passed: the summary's first Flash attempt failed with an error, which backs off 1 s either way. The case was changed so that attempt returns an empty answer, and m15 rerun |
| `mutations-before-refactor/` | m13–m15 as first run, before `_streamChatInner` was split (same results) |
| `m16-edit-versions-ignored.storage.log` | Mutation (renderer): every response acts, not only the latest edit's: step 7 fails ("no notice from the outdated response") |
| `m17-any-success-clears-notice.storage.log` | Mutation (renderer): any successful save clears the notice: step 2 fails ("the notice of the title stays") |
| `m18-reload-failure-keeps-edit.storage.log` | Mutation (renderer): when the meeting cannot be read, the edit stays on screen: step 5 times out waiting for the title before the edit |
| `m19-whole-meeting-restored.storage.log` | Mutation (renderer): a failed save restores the whole meeting and rebuilds all list keys (the sixth-round behavior): step 4 fails ("the other row was not remounted") |

m16–m19 ran before the `_streamChatInner` split, which changed only the main-process build;
the renderer bundle they mutated is the one of the committed code.
