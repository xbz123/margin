# AG-41b local implementation evidence

Starting point: `1ca4be0b`, branch `codex/margin-agpl-migration`, 2026-10-11.
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
| `node scripts/margin/isolation/run-node.mjs --test --test-timeout=60000` with all six package.json test directory globs | 1 | checks/unit-tests-final.log: 950 total, 948 pass, 1 fail (known sandbox iconutil), 1 existing skip |
| Same runner, credentialTransactions / settingsFoundation / DomesticSttSettings | 0 | checks/settings.log |
| Same runner, OpenAIRealtimeGAProtocol / DomesticStreamingLifecycle / MeetingStartAudioGate / MicRecoveryEmitsTerminalIpc (early targeted run) | 0 | checks/targeted.log: 42 pass, no skips |
| `node scripts/margin/retired-check.mjs --all` | 0 | checks/retired.log |
| `node scripts/margin/provenance-check.mjs --max-hits 0` | 0 | checks/provenance.log |
| `git diff --check` | 0 | checked before staging and commit |

Earlier full-run failures are preserved in unit-tests.log and unit-tests-r2.log.
They were fixture dependency/ACK/registration inventory drift and the new setter
missing from the atomic transaction test table; no assertions were weakened to
resolve them. The iconutil failure remains explicit and is for Claude to verify
outside the sandbox. No additional test skip was added (four removed).

## Boundaries

No HANDOFF section 6 stop condition was encountered. Original checkout was checked
read-only: clean and still on its specified branch. No full Electron gates, real
settings interaction, microphone/device or paid-service checks, push or CI was run.
Stage 4 acceptance is not claimed. AG-42, AG-50 and AG-60 are untouched.
