# F1 closure review — Claude Opus 5.5 medium

2026-10-13. Read-only review on baseline 7915b627 plus the F1 diff.

**PASS: F1 is closed.** I found no blocking issues. This was a read-only review of the uncommitted diff on HEAD `7915b627`. I didn't build or run any tests, and I didn't re-check the 92/92 targeted pass, the 1/1 UI probe, or the 16 gates that are still running.

**The fix (`electron/llm/preparedInput.ts:116-117`)**
- `clear` now deletes the window's entry first and only then aborts that entry's task. Because the entry is already gone when the abort runs, the old task can't affect whatever replaces it. Its later `close()` → `finish()` call also does nothing, because `finish` checks `requestId` (`:62`).
- Starting a new speech action now cancels a Retry that is still waiting. Both `beginSpeech` (`ipcHandlers.ts:90`) and `dictation:begin` (`:385`) call `clearPreparedInput`. So that Retry gets aborted at the limiter and can't send the screenshot after it has been removed. That was the gap in F1.

**Other callers and the task lifecycle: no regressions found**
- **Normal completion:** `close()` → `onClose` → `finish` → `clear` now also aborts the task that is already closing. Since `finished` is already true, `terminalStatus` doesn't change. Abort is idempotent, so a timeout reason that was already set survives, and the `timeout` field in `getTaskMetadata` (`LLMHelper.ts:140`) stays correct. The only change is the abort reason on a completed task, and nothing reads that except the timeout check.
- **A failed task that keeps its input** isn't cleared, so the Retry button and failure record (D9 behaviour) still work.
- **`revoke` and the window-closed handler** abort before calling `clear`, so the second abort does nothing.
- **Callers that cancel the window's current task** (typed chat at `:491`, `gemini-chat-stream-stop` at `:680`, `cancel-intelligence-generation`, the generic generate-* handlers through `begin`): the renderer already treats each new action as replacing the old one (`cancelChatStream`, epoch bump, `cancelIntelligenceGeneration` before a manual submit). Aborting the replaced task matches what the UI already expects, and the old task's late results are ignored by the epoch and `requestId` checks (`NativelyInterface.tsx:1872, 2450`).
- **Callers that cancel every window** (`end-meeting`, `reset-intelligence`) already cancel in-flight work through `cancelOngoingRequests` and `speechActions.cancel()`, so nothing new is lost there.
- **The 32-window eviction** in `begin` can now abort another window's task. That's a theoretical edge, not part of normal use.

**Tests**
- **Unit tests (`SpeechActions.test.mjs`):** the dictation and clarify cases both hold the Retry at the limiter, start the next action, remove the image, and then release. They check that the Retry ends `cancelled`, that no new send happened, and that the next action still works.
- **UI test (`answer-regression.test.mjs`):** it clicks the real Retry, Answer and Remove all buttons, with HTTP 503 and `Retry-After: 4` from the mock. It checks for zero later requests containing `data:image/` and that Stop is still visible. Per the acceptance README, this same scenario failed before the fix.

**Non-blocking notes (no action needed for F1)**
1. The `finally` block in the UI test uses `setScript({ errorStatus: 0 })`, which keeps `chunks: ['Old screenshot answer.']` and `delayMs: 5` for later tests. Only a test that relies on the default script would be affected.
2. There's no dedicated test for a typed chat replacing a pending Retry. It goes through the same `clear` path and is covered by the same mechanism.

I didn't reopen or comment on F2/F3, or on editing Local Context/Skills during a session. I made no edits, builds, test runs or git writes.
