# AG-41b local implementation evidence

Starting point: `1ca4be0b`, branch `codex/margin-agpl-migration`, 2026-10-11.
Initial implementation: `759a6484`. The retained final full-test log is the
2026-10-11 Claude-review repair run on top of that commit, not the initial run.
Implementation and local checks only. Claude owns full gates, independent review
and pushing. No agent delegation, CI, installation, real credentials, live STT,
microphone, screen recording or formal application identity was used.

## Implementation

- Exactly five selectable cloud providers: existing OpenAI (Realtime + compatible
  REST), Soniox, Groq segmented REST, plus Aliyun Bailian and Doubao.
- New domestic task transport owns bounded buffering, finite reconnects, stale
  socket suppression, final acknowledgement deadlines and cancellation. Aliyun
  waits for `task-started`; Doubao sends binary audio after its full request.
  Final transcript delivery precedes drain completion; VAD does not finish a task.
  Failed/expired drains reject so MeetingSttSession reports the failed channel;
  the manual finalize caller consumes rejection without leaking an unhandled promise.
- **Buffer choice: reject.** A single input larger than 160 KiB, projected converted
  audio over the remaining budget, or an actual PCM queue overflow is refused with
  a fixed error. This guarantees a strict queue limit and avoids silently cutting
  speech or retaining an oversized backing buffer. Conversion maintains PCM frame
  continuity. The limit concerns the application PCM queue, not total process or
  WebSocket-library memory.
- Credential save/delete uses the existing encrypted atomic store; tests use
  synthetic storage. New IPC returns only key presence and non-secret IDs.
  Aliyun requires a Beijing workspace ID. Doubao uses API key when App ID is blank,
  or explicit App ID + Access Key for legacy authentication; resource defaults to
  `volc.seedasr.sauc.duration`. The settings card uses AG-60a `useI18n`/SettingsKit.
- `startMeeting` checks the selected provider before permission requests, audio
  capture or meeting-state mutation. No alternate start path is added.
- Four OpenAI deferred tests restored; readiness follows `session.updated`.
  Tests dispose keepalive timers. The current source already lacked the prohibited
  teardown helper/F-201 code, so no old code was imported to remove it again.
- Mic recovery now asserts counts 1 → 2 → 3 → 4 before terminal exhaustion.

## Official protocol checks (2026-10-11)

- [OpenAI Realtime client events](https://developers.openai.com/api/reference/resources/realtime/client-events)
  and [transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription):
  `session.update`, transcription session type, nested audio input with PCM at
  24000 Hz; `session.updated` acknowledges applied configuration. Existing
  `gpt-4o-transcribe` is still listed. No model migration was made.
- [Aliyun realtime speech guide](https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide):
  fetched official HTML confirms the Beijing workspace WebSocket, Qwen Audio 3.1
  streaming model and run-task / task-started / binary PCM / finish-task lifecycle.
- [Doubao large-model streaming ASR](https://docs.volcengine.com/docs/DoubaoVoice/LargemodelstreamingautomaticspeechrecognitionAPI?lang=zh):
  official indexed document extracts confirm bigmodel_async, new/legacy auth,
  resource IDs, gzip, positive sequence and negative final sequence. Audio uses raw
  serialization, unlike JSON configuration. Direct page retrieval returned only
  a JavaScript shell and the in-app browser was unavailable; verification used
  the indexed official protocol tables, not a third-party implementation.

The old tests supply lifecycle scenarios, not permission to copy implementations.
All old flagged class ranges and every new G2 match are itemized in PROVENANCE.
No real-service compatibility or recognition-quality claim is made.

## Checks

All commands ran from this worktree. `TMPDIR` was set to its `.agy-tmp/`;
npm's cache was also placed there and its update notifier disabled. Temporary
files are removed before commit. Node tests all use the isolation runner.

| Command | Exit | Evidence |
| --- | --- | --- |
| `npm run build:electron` (after clearing generated dist/dist-electron) | 0 | checks/build-electron.log |
| `npx --no-install vite build` | 0 | checks/vite-build.log |
| `npx --no-install tsc -p electron/tsconfig.json --noEmit` | 0 | checks/tsc-electron.log |
| `npx --no-install tsc --noEmit -p tsconfig.json` | 0 | checks/tsc-renderer.log |
| `node scripts/margin/isolation/run-node.mjs --test --test-timeout=60000` with all six package.json test directory globs | 1 | checks/unit-tests-final.log: 955 total, 953 pass, 1 fail (known sandbox iconutil), 1 existing skip |
| Same runner, DomesticStreamingLifecycle / DomesticSttSettings / settingsFoundation (review repairs) | 0 | checks/review-targeted.log: 20 pass, no skips |
| Same runner, credentialTransactions / settingsFoundation / DomesticSttSettings (historical initial implementation) | 0 | checks/settings.log, retained from 759a6484 |
| Same runner, OpenAIRealtimeGAProtocol / DomesticStreamingLifecycle / MeetingStartAudioGate / MicRecoveryEmitsTerminalIpc (historical initial implementation) | 0 | checks/targeted.log, retained from 759a6484: 42 pass, no skips |
| `node scripts/margin/retired-check.mjs --all` | 0 | checks/retired.log |
| `node scripts/margin/provenance-check.mjs --max-hits 0` | 0 | checks/provenance.log |
| `git diff --check` | 0 | checked before staging and commit |

At the user's request, intermediate full-run logs unit-tests.log and
unit-tests-r2.log are deleted (recoverable from 759a6484). Only the final repair
full run is retained. The iconutil failure remains explicit and is for Claude to
verify outside the sandbox. No additional test skip was added (four removed in
the initial implementation).

## Claude review repairs after 759a6484

1. Continuous rejected PCM reports one overflow error, rearmed by accepted PCM,
   connection readiness or queue reset on stop. The 160 KiB rejection limit and
   discarded audio policy are unchanged. Tests cover both providers, 20 repeated
   rejects, recovery, another overflow and rearming on accepted audio.
2. Runtime connection-test rejections are caught inside the connection phase.
   Only configuration/construction failures return the configuration message.
   Locally assigned error codes select fixed authentication, timeout, empty-audio
   or connection-failure text; arbitrary error bodies and unknown codes are not
   echoed. The settings card displays the translated fixed IPC result.
3. Doubao 45000001 is configuration/protocol failure, 45000002 is empty audio.
   Neither is classified as authentication. The former stops the provider and
   main reports a failed configuration rather than claiming it is reconnecting.
   The latter closes only this task, rejects its drain and waits for new audio;
   it neither permanently disables the instance nor runs an empty retry loop.
   Authentication is classified only on HTTP upgrade 401/403 in this adapter.
4. Save/delete reuse the existing STT save-button classes; test uses the existing
   STT test-button classes. Background, padding, rounded borders and disabled
   styling are asserted in the rendered HTML. No component or settings reorganization.
5. Evidence cleanup above; README, PLAN, provenance and retained file inventory
   are synchronized. The initial red loop had 19 tests, 5 failures matching the
   review; the final targeted loop has 20 passing tests including main's terminal
   configuration status. No debug instrumentation or new dependencies were added.

The sole new G2 match, `const expected = {`, is a generic test object declaration
registered individually with its reason; no code was cosmetically changed to evade G2.

## Boundaries

No HANDOFF section 6 stop condition was encountered. Original checkout was checked
read-only: clean and still on its specified branch. No full Electron gates, real
settings interaction, microphone/device or paid-service checks, push or CI was run.
Stage 4 acceptance is not claimed. AG-42, AG-50 and AG-60 are untouched.
