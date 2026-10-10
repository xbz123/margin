# AG33 implementation test migration and evidence

Workspace: `<repo>`
Baseline: `060061497153de763c90e65b3f95c4bec909e76f` (AG32).
This record covers local implementation checks, not CI or real credential/provider/device verification.

## Preserved and migrated checks

- `electron/services/__tests__/ImagePathValidation.test.mjs`: retired six source-string checks. Replacement transpiles the complete real `initializeIpcHandlers` module, registers all handlers, and invokes six actual image entries (`gemini-chat`, `gemini-chat-stream`, `generate-what-to-say`, `generate-code-hint`, `generate-brainstorm`, `analyze-image-file`) against malformed/traversal/missing/sensitive/Windows/symlink-escape inputs (zero generation calls), plus owned-file positive controls. External app/transport dependencies are doubles; validation is the real built validator. Added real registered request-mode handler plus real GenerationTask deadline checks, and engine-only-cancel vs explicit-reset wiring.
- `electron/utils/__tests__/validateImagePath.test.mjs`: retained ten relationships; formerly nonexistent positive macOS paths now use actual temporary directories/files because validation requires realpath and regular files. No unknown file acceptance.
- `generationInterfaces.test.mjs`: synthetic image fixtures now carry exact target-bound confirmations; primary and backup confirmations are independent. Unknown models/custom endpoints are not implicitly enabled. Existing routing/scope/retry/cache/cancellation contracts retained; added short-answer, late-inner events, written second-step failure/timeout, ProcessingHelper controller ownership, no-visible-output outcomes, exact partial/session metadata, actual Manager cancel semantics, decoding rejection, opaque CodeHint delegation, and preflight-rejected-backup metadata.
- `credentialTransactions.test.mjs`: added confirmation restart and target-change invalidation; existing save-failure/transaction tests retained.
- `answer-regression.test.mjs`: request acceptance now means physical loopback request, not eager input removal. Failed/cancelled requests preserve input/attachments and permit immediate explicit same-text retry. Loopback image support is explicitly bound to the synthetic endpoint. Setup error assertion matches the genuine returned error. Added unknown-image retry, owner subscriptions, real Written text and capture-and-process images with 11-second no-visible-body delay, mixed manual/automatic events, real SQLite metadata+legacy-array roundtrip, and late action invoke over a newer manual request.
- `outbound-renderer.test.mjs`: existing esbuild/React/Electron harness reused to mount the real Global/Meeting components in a no-preload window with a synthetic bridge. Tests partial error/actual model/timeout, separate retry rows, closed callbacks forced through released subscriptions, pending invoke rejection, and closing during the 200ms delay (zero invocation). This proves component state, not the full connected bridge; the separate answer harness covers preload/IPC. No new framework or production test hook.

## Red evidence and classification

- Earlier context recorded legitimate short-answer replacement and cancelled held-prefix emissions before repair; do not infer preserved log filenames if absent. `red-green-02.log` specifically shows short answer text already fixed but metadata missing, 2/3 pass. Written ordinary second-step failure was already green and is not a claimed red.
- `critical-03.log`: explicit `unsupported_image` plus HTTP503 wrongly sent primary and backup, 6/7 pass.
- `targeted-02.log`: 117/118 pass; prototype name `toString` incorrectly granted known image capability. Fixed using Object.hasOwn, not by authorizing the fixture.
- `actual-target-red-01.log`: exit 1; one actual physical primary send but metadata reported preflight-refused backup (`gemini-b` vs `gemini-a`). Fixed by updating actualTarget only after claimSend succeeds.
- `gui-01.log`: exit 1, 10/14 pass. Genuine inherited-task premature close caused WhatToSay AbortError and scope feedback failure; genuine duplicate-submit window swallowed same-text retry after capability confirmation. Written-budget spy incorrectly instantiated a second bundled AppState; removed without production global/test IPC.
- `component-01.log`: harness PNG-loader setup error, not product red.
- `component-02.log`: harness wrongly expected Global close to delete its preserved partial; not a product defect. Changed assertion to reject late tokens/errors and prove an intact new record.
- `gui-03.log`: 14/15 pass, exit 1. Direct rejection of a deferred IPC promise inside Playwright evaluate produced context-destroyed. Its real main-errors recorder (pid13814) contained loaded only, no uncaught/unhandled records. Scheduling the rejection on the normal event loop exercises the same renderer fence; no production repair for this harness issue.
- `late-invoke-01.log`: isolated case lacked the earlier case's prior record; not product red. Made prior record self-contained.
- `codehint-red-01.log`: 1/1 green, exit 0. Despite filename it is NOT red evidence. Final opaque confirmed model case exercises the retired name heuristic.
- `image-handler-01.log`: incomplete external double lacked getLastAssistantMessage; later real handler matrix green. Not a security-policy loosening.

## Latest local green evidence

- `targeted-06.log`: exit 0, 130/130; predates final actualTarget assignment repair.
- `targeted-07.log`: final built-source targeted suite, exit 0, 130/130.
- `component-03.log`: exit 0, 1/1 parameterized real Global/Meeting state case. Component sources unchanged afterward.
- `gui-02.log`: exit 0, 14/14. Before final cancel-only and actualTarget repairs.
- `late-invoke-02.log`: exit 0, 1/1; after cancel-only repair, before final actualTarget repair. The full GUI 15-case collection is covered by the later formal gates.
- `build-12.log`: final Electron build, exit 0.
- `type-07.log`: final Electron typecheck, exit 0.
- `renderer-build-05.log`, `renderer-type-06.log`: exit 0; final renderer source.
- `git diff --check`: exit 0 at source freeze.

All commands use X2, all GUI launches are escalated and explicitly allow Electron; esbuild allowed only for builds/component bundling. Logs are append-only distinct files. Some earliest pre-compaction shell calls tailed without preserving command status; those are only log-count evidence, not inferred exit-0 evidence.

## Boundaries and blind spots

No real provider/model/credential/auth/device/native testing, no installed dependencies, no CI, no AG34/AG50/AG52. Metadata uses existing SessionTracker and ai_interactions metadata_json; no incremental recovery schema. Written UI uses the existing chat/screenshot path; legacy ProcessingHelper/debug remains covered at the actual helper interface and is not claimed as a restored Solutions UI. Official model capability table is exact-ID/endpoint and does not assert availability of retired IDs. Complete gate and source provenance results are recorded separately in the ticket evidence.

## First formal gate failure closure (2026-10-10)

The first formal run found 26 unit failures, classified from tests.tap rather than assumed all fixture: 3 stale source-signature checks; 15 Engine stubs missing the task interface; 8 image tests stopped before their intended scope/transport/terminal assertions because synthetic image capability had not been confirmed.

- LlmStreamAbortController: preserves .send channel, main sender ownership and types; now checks the exported cancelActiveChat owner binding plus optional owner parameter.
- TokenBatchFlushNoTrailing: follows the new request-keyed batch map signature; retains pending handle / clearImmediate / reset / re-arm assertions and Node scheduler behavior.
- generateOnce and ScopeLocalFallback WhatToSay: real LLMHelper prototype supplies begin/run/metadata/ALS, not getCurrentGenerationTask always undefined. Keeps terminal object identity, original error delivery and no fabricated answer assertions. Existing fake session only implements the additional audit sink these narrow error-delivery cases need.
- CodeHint/Planner/Sentinel: real LLMHelper logical-task methods run with a prototype-only synthetic target; no constructor credentials. CodeHint now cancels the actual task through reset rather than only mutating generationId. It preserves generator return, one original partial, no stale token/final, and asserts cancelled partial metadata plus no stale history. AG33 explicitly retains cancelled partial records, so the obsolete no-partial-history expectation is replaced rather than discarded. Sentinel stream doubles now mark their natural completed terminal, as real adapters do; original no-sentinel tokens/final/history and speculative privacy assertions remain.
- ScreenContext: existing isolated prompt-routing double implements the current task interface with real GenerationTask and closes it; original imagePaths, screenContext identity and no-screen case assertions remain. Real separately bundled Engine/Helper ALS and cancellation are covered by generationInterfaces.
- Synthetic image tests explicitly bind confirmation to the exact model/protocol/endpoint. Groq's old llama-3.3 text-only positive control becomes an opaque synthetic-image-model; it does not assert vendor image support. Negative capability guards remain covered by AG33 tests. MultiProtocol loopback confirmation is bound to each ephemeral API root. No production capability guard is weakened.
- Storage first failure was owner mismatch: test observer listened for default natively, genuine MeetingChatOverlay request/observer is meeting. The test now observes meeting and also asserts the refusal is visible and zero physical requests. Its early exit previously skipped CHAT_QUESTION four and scope reset, explaining the dependent recovery missing CHAT_ANSWER. No production scope change.

Confirmed product closure:

- DatabaseManager save previously accepted flat generation only, while its loader returns nested generation. Actual recoverUnprocessedMeetings -> details.usage -> processAndSaveMeeting -> saveMeeting lost metadata. save now accepts its own nested loader format while retaining the flat live write format and legacy item array. The existing SQLite case now performs save/load/save/load; storage restart recovery checks the exact metadata both while history is denied and allowed.
- MeetingDetails previously rendered only question/answer with no status. It now renders existing metadata using the same compact actual provider/model/partial/timeout presentation as the chat overlays, including zero-answer outcomes. The real history Usage tab is checked for failed + Incomplete + timeout:total after restart recovery.
- Integration review found mode cleanup blocked by the abort fence. New engine-mode-red-01.log has 2/3 fail: real timeout and setModel cancellation leave what_to_say stuck; old-finally-new-task counterexample was already green. Owner-only outer finally now restores idle even for abort, before generation_terminal deletes its main request-owner map. New tests prove timeout/model-switch -> idle -> next actual assist send, no late old history, and old finally/late old transport cannot reset newer manual mode. No general state-machine refactor.

Logs and classification:

- gates-failed-targeted-01: exit 1, 143/150. Follow-on failures include fixture ALS undefined, natural completed terminal not represented, missing helper constant. It is not evidence of seven new product defects.
- gates-failed-targeted-02: exit 0, 150/150 before owner-mode cleanup.
- engine-mode-red-01: exit 1, 1/3, genuine stuck-mode reproduction before repair.
- gates-failed-targeted-03: exit 0, 224/224 after mode cleanup, before event-order tightening.
- storage-02/db-roundtrip-02: Electron launch SIGABRT in sandbox before isolation guard loads; infrastructure failures, no product assertions ran. Explicit escalated runs retain X2 guard and synthetic/loopback inputs.
- storage-03: exit 1, 4/5; new history UI assertion used lower-case usage but real button is Usage. Corrected the locator, no production repair.
- storage-04: exit 0, 5/5, includes genuine history UI and both recovery metadata paths.
- db-roundtrip-03: exit 0, 1/1, real SQLite second save and legacy preservation.
- build-13/type-08/renderer-type-07/renderer-build-06: exit 0 after database/history UI change.
- build-14/type-09: exit 0 after initial owner-mode cleanup.
- Final frozen-source evidence: gates-failed-targeted-04 exit 0, 224/224; storage-05 exit 0, 5/5; db-roundtrip-04 exit 0, 1/1; build-15 exit 0; type-10 exit 0; git diff --check exit 0. These are after the final idle-before-terminal change. Renderer sources remain those validated by renderer-type-07/renderer-build-06, both exit 0; renderer was not edited afterward. Earlier db-roundtrip-03 and storage-04 are not labeled final-source evidence.

Source and tests were frozen again after these completions. The second complete gates run is recorded in the ticket README. AG34 is not implemented by this ticket.
