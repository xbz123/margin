# AG-42 local implementation

Scope: HANDOFF 4.4, starting at `4435616a`. Local commit only. No agents,
real credentials, services, devices, Electron gate launches, CI or dependency changes.
Implementation commit: `3ff20cbc`. Verified source fingerprints are in
`checks/source-sha256.json`; the evidence/PLAN/wayfinder follow in a separate local
documentation commit.

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
cancelled metadata is displayed as 已取消. Fixed local error strings replace raw
provider text at both terminal and IPC result boundaries.

## Microphone and lifetime

Manual actions bypass the old automatic-trigger cooldown. The existing main
`finalizeMicSTT` now goes through MeetingSttSession, only finalizes the user channel,
and waits for its final transcript (up to 1500 ms). No new STT or capture is started.
Finalization exceptions fail the answer, cancellation removes listeners immediately.
Silence/no acknowledgement expires the bounded wait and uses available session
context; this is not a guarantee that every provider's remote tail is complete.
The voice-input button also awaits this path before snapshotting its text, and
discards a result superseded while waiting. End-meeting already resets the engine
before audio drain; tests now exercise that cancellation with a real logical task.
Incoming transcripts still update SessionTracker only: no automatic answer/Judge.

## Verification

Final commands and exit codes: [checks/commands.json](checks/commands.json).
Targeted: 108 passed, zero failed/skipped. Full unit suite: 965 tests, 963 passed,
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
input/no-send checks and now expects the fixed manual failure text. The Electron
answer-regression scope-refusal test likewise retains exactly-one-error/no-send
assertions while rejecting raw internal text. Its execution remains with Claude.

Full Electron gates, real renderer/device interaction, real providers and Claude
review are not completed here. G7 reuses the unchanged dependency/lockfile baseline.
No new retirement rule is necessary; completedTickets records AG-42 implementation.
