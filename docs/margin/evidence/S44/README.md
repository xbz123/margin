# S44 answer-model settings

2026-10-14. Worktree change over `2ba5cf92`; implementation by Claude Opus 5.5
medium with auto permissions, independent review and acceptance by the main agent.
This is not installation, stage-6 user acceptance or a release.

## Contract

Primary and backup selectors lead the AI Providers page. Privacy and the three
generation deadlines remain. Each provider card owns its configured model's
reasoning fields; old configurations omit them, and retries use the applicable
target snapshot. Unsupported values are not silently downgraded after rejection.
Custom-endpoint context capacity is an optional note, not a send-time gate.
Local Context and retry input are not refused by a local model-capacity estimate;
byte limits, image validation, revocation and privacy checks remain in effect.

Official metadata is exact-model/exact-endpoint reference information only.
Unlisted models and gateways expose protocol options labelled unverified; a
gateway may reject or ignore them. Defaults and installed models are not migrated.

## Official references inspected for this change

- [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning),
  [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4): Chat Completions
  `reasoning_effort` and Responses `reasoning.effort`.
- [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort),
  [Sonnet 4.6](https://platform.claude.com/docs/en/models/sonnet-4-6/overview):
  Messages `output_config.effort` and the separate `thinking` mode.
- [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking),
  [3.1 Pro](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview),
  [3.1 Flash Lite preview](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview):
  model metadata; the installed GenerateContent SDK's `thinkingConfig.thinkingLevel`
  is checked through its actual synthetic wire request, not inferred from the
  newer Interactions API examples.
- [Groq reasoning](https://console.groq.com/docs/reasoning) and
  [models](https://console.groq.com/docs/models).
- [DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode) and
  [model reference](https://api-docs.deepseek.com/quick_start/pricing).

## Verification state

Main-agent review requested target-note reset and translation/retired-help-text
corrections. Claude completed them, with mounted checks for model/protocol changes
and a custom-to-explicit-official URL transition, plus fixed bilingual errors.
The final code was independently checked using the existing complete gate runner:

- 132 unit files, **1167/1167 pass**, zero failures/skips or isolation violations.
- Answer regression **21/21**, storage **2/2**, startup **1/1**, mounted outbound
  renderer **13/13**; both builds and both typechecks pass.
- Retirement, IPC/preload contracts, isolation selftests and required S42 evidence
  checks pass. `git diff --check` passes.
- The full run in [gates/summary.json](gates/summary.json) is preserved as **15/16**:
  G2 flagged four generic statements. After reviewing their surrounding use and
  registering only the exact lines, [provenance-recheck](provenance-recheck/summary.json)
  passes G2 with zero unreviewed hits and passes whitespace checks. Application
  and test source did not change after the full run, so those passing checks were
  reused rather than rerun. No directory exclusions or source pools were widened.

Local software verification is complete. Commit `b66523c9` is pushed to both
repositories. Ordinary [CI 38611696710](https://github.com/xbz123/margin/actions/runs/38611696710)
completed with 15/16 gates passing. Provenance flagged four occurrences of two
generic line forms in older STT startup and credential tests. These are distinct
from the four locally reviewed S44 lines; the follow-up records their review and
must obtain a new full pass. No CI success is claimed for this run.

The user subsequently approved installation. The local package passed its checks
and guarded asar startup passed 10/10. Natively Local was replaced with that exact
source version; installed asar SHA-256 is
`6c45df614e9fb3df38d5e18fb012ed56684f9d94d4559645df45d32dde3aae48`.
Before/after hashes confirmed existing local settings/credential files, Margin's
credential file and Margin's application asar were unchanged. Only the replaced
old Natively Local application package was removed, with no old-package backup
as previously requested. User data was not deleted. The new launcher rendered.

The user reports completing all requested permissions. Subsequent UI automation
could read the launcher but could not reliably trigger settings/refresh actions,
including a window-location error. A two-second main-thread sample showed the
application event loop, not the prior CoreAudio enumeration stall. This does not
prove a fix or identify a permissions failure. Real-parameter testing remains
incomplete; no real request has been sent.

## User-reported connection failure and follow-up

The displayed error was `Application quit`, not an authentication rejection.
Production-method reproduction shows that a visible overlay can veto window
closure after before-quit has scrubbed the LLM service. The remaining UI then
fails a connection test before sending anything. The installed-process lifecycle
events are consistent with this sequence; the user's successful earlier test is
not contradicted because a fresh, non-quitting process does not enter this state.
The overlay veto is inherited; commit `06006149` added terminal generation
closure, and `5241e414` added the two-pass asynchronous audio shutdown. The recent
settings change did not add the veto or generation-closed guard.

The follow-up preserves the terminal guard and lets a quitting overlay close.
Eight close-state combinations were added to the existing window fixture; before
the fix two visible/quitting cases failed, afterwards all eight and five existing
window cases pass, along with the existing audio shutdown test (14/14 total).
The production-method shutdown reproduction also exits successfully after repair.

Official configurations now use built-in endpoints and an upstream model select,
not an editable Model ID. Discovery remains an explicit user action after saving
the Key; it does not silently select/save a model or call a service on page open.
Gateway mode retains URL/Key and manual model fallback for unsupported list APIs.
Changing origin still requires a newly entered key at the main-process boundary.
Paginated official results are collected, stale UI responses are discarded, and
DeepSeek errors do not become a fabricated preset list. Official lists no longer
use local model-name/version allowlists; Gemini uses its upstream generateContent
capability field. List membership alone does not certify text/protocol support.

Final [followup-gates](followup-gates/summary.json) passes **16/16**: 133 unit files,
1181/1181 tests, answer regression 21/21, storage 2/2, startup 1/1, mounted renderer
13/13. The startup test now makes the actual Electron overlay visible, invokes
the real two-pass app.quit chain and requires exit code 0 without a signal.
Claude Opus 5.5 medium reviewed read-only; two P2 discovery findings were corrected
and a second review returned no blocking findings. No original acceptance record
was rewritten as if it covered this later fix. Public CI and installation of the
follow-up are pending; real-service inference has not been performed by this run.

Real parameter testing is authorized only for existing Margin credential-bound
targets and synthetic text. A read-only credential inspection did not return and
its diagnostic process was stopped. No credential values were printed or copied,
no real API request was made, and no original credential store was modified.
The cause of the inspection timeout is undetermined. Normal protected access is
needed before real tests can proceed; it is not bypassed.

No claims of actual reasoning-strength adherence, measured quality/latency,
all-model compatibility or successful service access are made. Existing transcript
selection/trimming and the baseline output caps are not redesigned by this change.
