# AG-42 local implementation

Scope: HANDOFF 4.4, starting at `4435616a`. Local commit only. No agents,
real credentials, services, devices, Electron gate launches, CI or dependency changes.
Initial implementation: `3ff20cbc`, evidence: `3bfcbe47`. The current evidence is
the final local run after Claude's three review repairs, not the initial run.
Verified source fingerprints are in `checks/source-sha256.json`.

## Review repairs

1. Known local error types retain fixed English messages: Data scope denied,
   Invalid image path, missing configuration, and Cancelled. Only provider/unknown
   errors use the generic model-failure message. Classification never examines
   provider message text. Tests inject private canaries and provider messages
   containing the known-error phrases to verify they stay generic. The image test
   now keeps assertions outside the invocation catch, closing an accidental
   assertion-swallowing hole. Electron regression again requires exactly one
   Data-scope-denied message and zero requests.
2. Main returns English strings; the renderer uses useI18n/t and i18n.zh.ts for
   Chinese. Tests execute the actual answer-row component and manual callback in
   both languages. The obsolete finalize-failure UI message is removed because
   that failure no longer prevents generation.
3. MeetingSttSession catches non-user-cancellation finalize failures after cleanup,
   logs only a fixed warning and continues with available context. Provider
   AbortError is not mistaken for user cancellation; the actual signal remains
   authoritative. The recording callback likewise continues after finalize IPC
   rejection but rejects an obsolete epoch before sending. Real main/session/engine
   tests verify continued generation after mic rejection and no request on cancel.

The initial targeted repro failed on these behaviors before implementation; only
the final passing run is retained, as requested. No old code or new dependencies
were introduced. G2's two new generic warning-count assertions are documented in
PROVENANCE and registered exactly, without changing scan scope.

## Entry and adaptation contract

The existing overlay What-to-Say button and `whatToAnswer` shortcut call
`generateWhatToSay` -> `generate-what-to-say` -> `IntelligenceManager.runWhatShouldISay`
-> `IntelligenceEngine` -> `WhatToAnswerLLM` -> `LLMHelper.streamChat` ->
`selectedGeneration` / `generateTask` / `generateOnce`. This is the existing stage-3
transport, not a parallel DirectAssistService.

`answerGeneration.prepareManualAnswer` checks the selected logical-task snapshot
(model and configured API client, or enabled/consented Codex source), waits for the
optional mic-finalization callback and rechecks cancellation before context is read.
No credential files are inspected by this adapter. Existing stage-3 code still owns
target selection, retry/backup budget, deadlines, credentials and scope enforcement.

Request mapping (established before choosing old-code reuse): the snapshot supplies
`GenerateRequest.protocol` and `model`; the existing prompt assembler supplies
`contents` as user data and the existing prompt as `systemInstruction`; the helper
supplies `purpose: answer`, `stream: true`, `maxOutputTokens`, transport `signal`
and `dataScopes` (transcript, plus existing image/history scopes when present).
Each physical send rechecks scope policy. No `GenerateTurn`, old `AnswerGenerationInput`,
requestBuilder, old types, new IPC method or new model transport was added.

Event mapping: stage-3 delta -> existing suggested-answer token -> ordered main
token batch; completion -> suggested answer and generation terminal. All carry
the logical task's UUID. The engine aborts the previous task, main fences by owner
and UUID, and preload uses `directAssistAnswerState` to reject mismatched/sealed
answer data. Main drops unsent batches for cancelled tasks. Partial text remains;
cancelled metadata is displayed as Cancelled / 已取消 through the shared hook. Fixed local error strings replace raw
provider text at both terminal and IPC result boundaries.

## Microphone and lifetime

Manual actions bypass the old automatic-trigger cooldown. The existing main
`finalizeMicSTT` now goes through MeetingSttSession, only finalizes the user channel,
and waits for its final transcript (up to 1500 ms). No new STT or capture is started.
Non-cancellation finalization exceptions log a fixed warning and do not fail the
answer. Cancellation removes listeners immediately and prevents generation.
Silence/no acknowledgement expires the bounded wait and uses available session
context; this is not a guarantee that every provider's remote tail is complete.
The voice-input button also awaits this path before snapshotting its text, and
discards a result superseded while waiting. End-meeting already resets the engine
before audio drain; tests now exercise that cancellation with a real logical task.
Incoming transcripts still update SessionTracker only: no automatic answer/Judge.

## Verification

Final commands and exit codes: [checks/commands.json](checks/commands.json).
Targeted: 117 passed, zero failed/skipped. Full unit suite: 970 tests, 968 passed,
one failed (`icons.test.mjs`, sandbox iconutil Invalid Iconset, the authorized
known exception), one existing skip. Full suite exits 1, not a claimed all-green
run. Builds, both type checks, preload contract, retirement scan, provenance scan,
diff-check and four Electron-test syntax checks exit 0.
Logs replace only the checkout prefix with `<worktree>`; all other test output is
retained. Only the final run of each check is kept. Temporary sandboxes were under
the checkout's `.agy-tmp/` and are removed before delivery.

Behavior coverage: configured/unconfigured manual action; tail-before-context;
ordered deltas equal final text; rapid replacement during finalization; session
reset during finalization; end-meeting aborts streaming transport; late data and
old terminals cannot replace a newer answer; fixed failures including task-creation
failure; real preload subscriber delivery; mic-only bounded finalization/cleanup.
No tests were removed or newly skipped. ImagePathValidation retains all malicious
input/no-send checks and requires Invalid image path. The Electron
answer-regression scope-refusal test requires exactly one Data scope denied and
no send, without exposing provider text. Its execution remains with Claude.

Full Electron gates, real renderer/device interaction and real providers are not
completed here; Claude's re-review of these repairs is pending. G7 reuses the unchanged dependency/lockfile baseline.
No new retirement rule is necessary; completedTickets records AG-42 implementation.
