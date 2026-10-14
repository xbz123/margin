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

Local software verification is complete. No commit, push, remote CI, package or
installation was performed for S44; real-parameter verification remains incomplete.

Real parameter testing is authorized only for existing Margin credential-bound
targets and synthetic text. A read-only credential inspection did not return and
its diagnostic process was stopped. No credential values were printed or copied,
no real API request was made, and no original credential store was modified.
The cause of the inspection timeout is undetermined. Normal protected access is
needed before real tests can proceed; it is not bypassed.

No claims of actual reasoning-strength adherence, measured quality/latency,
all-model compatibility or successful service access are made. Existing transcript
selection/trimming and the baseline output caps are not redesigned by this change.
