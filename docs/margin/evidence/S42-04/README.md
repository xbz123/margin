# S42-04 prepared retry and visible-answer acceptance

2026-10-13; source baseline `7c9f5b85` plus this ticket. Astra implemented
the initial changes during Claude's quota limit. Claude Opus 5.5 medium / auto
continued after a serial handoff, fixed the superseded-capture race and supplied
the preparation-revocation repair. The main agent reviewed the full diff,
integrated the repair across preparation and speech waits, and ran final gates.

## Accepted behavior

- One current failed input per window, held only in main-process memory. The
  original prepared prompt, text, image bytes and context are reused with a new
  task and current model/configuration. No new capture, transcription collection
  or live context is added. The 64 MiB serialized cap applies before first send.
- Permissions, image support, capacity and source withdrawal are checked again.
  Explicit attachment removal revokes both prepared input and in-progress image
  preparation, including speech waits; automatic queue cleanup does not revoke
  already-owned image bytes. New questions, success, cancel, reset/end and window
  destruction release the old retry state.
- First partial output remains its own row. Retry has a new request ID, the same
  question ID and an explicit prior-attempt link. Existing output filters and
  transports are retained, without new model/configuration hint text.
- The Natively answer consumer acknowledges actual visible DOM text. Hidden
  text, placeholders and main-process delivery alone do not acknowledge it.
  Quick EOF waits for the receipt; late receipts cannot extend the original
  deadline. Existing consumers without the Natively UI retain their lifecycle.
- Manual action timing starts at click/key, Stop or text submit. Global
  capture-and-process starts its same action before screenshot work; stale
  captures cannot cancel newer actions or dispatch obsolete references. Speech
  waits and automatic attempts share the original budget; manual Retry starts
  a fresh budget. Timing metadata distinguishes speech, preparation and answer
  display rather than relabelling completion duration as first-text latency.

## Evidence

- Final complete gates: **16/16**, every exit code 0 (`summary.json`).
- Unit inventory: **127 files, 1106 tests: 1105 pass, 0 fail, 1 existing skip**
  (`tests.files.json`). The skipped activation-policy case belongs to AG-61.
- Isolated Electron answer regression: **20/20** (`regression.log`); storage,
  startup and outbound-renderer gates pass too. The three new mounted cases
  exercise invisible DOM/quick EOF, independent Retry rows, and attachment removal.
- Required-file evidence includes `generateTask.test.mjs`, now **16 files** plus
  outbound-renderer. The existing unconditional regression step runs the mounted
  cases in CI; no separate test framework or relaxed failure allowance was added.
- The parent's independent preparation-revocation counterexample initially
  observed one provider send after removal (expected zero); after the repair it
  passes **1/1**. Durable coverage includes both decode and speech-wait races in
  `SpeechActions.test.mjs` (**67/67**). Its combined targeted check with image-path
  validation and the independent probe passed **80/80**.
- G2: zero unreviewed hits; six exact generic statements were individually
  recorded with reasons. No source pool, exclusion, dependency or skip was added.

## Preserved failures and limits

`attempt-1/` retains the first full run: only one assertion failed because the
new early configuration check changed a provider-specific error message. The
original message was restored, not the assertion weakened; the relevant
multi-protocol suite now passes **39/39**, and all gates were rerun.
`attempt-1/initial-mounted.log` retains the earlier 16/20 renderer run: a new
test left its HTTP 400 script active for later cases. Its own `finally` now
restores that fixture. Both subsequent full runs passed renderer 20/20.
Machine-specific paths in published evidence are normalized.

Public CI and remote delivery are pending at this local acceptance point.
No real STT/LLM service, device capture, shared-screen protection, answer quality
or production latency was tested. No installation, native rebuild or release was
performed locally. Stage-5 product sign-off is still separate.
