# Code provenance

This file records where every non-baseline piece of code, test, script or asset on this branch came from. Anything not listed here and not changed in a commit on this branch is unmodified baseline code from `a786910e` (see [BASELINE.md](BASELINE.md)).

## Source rules

| Source | May be used | Record |
| --- | --- | --- |
| Baseline `a786910e` and its ancestors | Yes, under AGPLv3 | Nothing extra; git history shows it |
| Other upstream AGPL commits published before 2026-06-01 IST | Only after checking the exact commit, file contents and license, and finding evidence of publication | Commit, path, blob, evidence |
| Upstream commits published on or after 2026-06-01 IST (including the 1–24 June AGPL-labelled window) | No. Not copied or cherry-picked, and not used as a template | — |
| Earlier Margin branch (`codex/ai-assistant-refactor`, personal import `fcfbb02a` onward) | Only lines and files written for Margin that contain no post-June upstream code, prompts, comments, tests or assets | Margin commit, path, check performed |
| New code written on this branch | Yes | Written against the behavior described in [ADAPTATION.md](ADAPTATION.md); the commit message says so |

Notes:

- Renaming, reformatting, moving or lightly rewriting code does not resolve a provenance problem.
- The person writing this branch has read later upstream code while auditing. New implementations are therefore described as "written for this branch from the behavior requirements". They are not claimed to be a verified clean-room rewrite.
- Third-party packages, fonts and icons keep their own licenses. They are not relabelled AGPL.
- Commit dates and authors are recorded as evidence, but do not by themselves prove a license right.

## Ledger

### AG-62 local acceptance identity (2026-10-14)

Written on this branch from the user's approved local installation requirements.
`scripts/margin/app-identity.cjs` adds the fixed Natively Local identity while
retaining temp defaults and the Margin release restriction. `scripts/build-local.cjs`
and `package.config.cjs` allow only that identity to use the local packaging
exception without native rebuilds. The existing isolation environment, storage
guard, identity tests and asar smoke now cover its independent data directory.
No code or assets were copied from the installed application; its bundle metadata
was inspected only to identify the authorized replacement target. No dependencies,
native sources, signing identity or release distribution settings were changed.

Installed acceptance then exposed an existing runtime ICNS decoding failure in
`AppState.getDisguiseIconPath`. The repair selects the already-generated PNG for
macOS runtime use while preserving ICNS bundle metadata and Windows ICO behavior.
The existing icon-consumer test now models ICNS decode failure; source startup and
CI packaged-launch checks assert all window preferences actually applied. This
repair was written from the reproduced installed behavior, not copied code.

### AG-62 local setup guidance and current documentation (2026-10-13)

Written against the accepted `ffc08ab1` branch and the AG-62 behavior contract.
New `src/components/onboarding/SetupChecklist.tsx` and `setupChecklistStatus.ts`
reuse existing settings UI, metadata getters and the current Codex consent check;
they do not call connection tests, auth-file inspection or capture. The public
domestic STT validation follows this branch's accepted credential rules.
App/Launcher wire existing settings and permission-review callbacks. The existing
permission card drops closed/replaced reads and is dismissed when a meeting starts.

`SetupChecklistStatus.test.mjs` and the existing mounted-renderer harness use
synthetic metadata and recorded effects. No framework, dependency, IPC layer,
native source or asset was added. The main agent corrected fixture asset loaders
and actual accessible button names without weakening product assertions.
README/PRIVACY are rewritten from current source and OUTBOUND, not old upstream
prose; they remove retired summary/Google STT and opaque CLI-generation claims.
No earlier Margin or later upstream code, prompt, dictionary or test was imported.
Formal identity restrictions, packaging and release configuration are unchanged.
G2 initially flagged ten exact ordinary control-flow, React state/effect and
array-declaration lines. Each surrounding use was reviewed and its reason recorded
in `provenance-config.json`; no code was rewritten to evade matching and no source
pool or excluded path changed.

### AG-61 window preferences and shortcut failure handling (2026-10-13)

Written on this branch from PLAN U11 and the AG-61 execution contract against
accepted source `968ea59d`. No earlier Margin or later upstream implementation,
tests, prompts or assets were imported. Existing helpers, AppState, settings,
preload and renderer consumers are extended in place; no Controller/Bridge,
dependency or native module is added. Existing platform icons are reused, not
redesigned. This is not a clean-room claim.

New source is limited to `src/types/windowPreferences.ts` and the shared
`src/hooks/useWindowPreferences.ts`; new behavior tests are
`WindowPreferences.test.mjs`, `WindowPreferencePersistence.test.mjs` and
`WindowProtectionLifecycle.test.mjs`. The old skipped activation-policy source
assertion is replaced by execution of the actual initializer under mocks for
the retained Dock policy. The existing renderer harness exercises real consumers.
Main-agent review adds failure regressions for a stranded blur guard and
premature clearing of menu/update failures during shortcut health checks.

Initial G2 results contained nine occurrences of six ordinary exact statements:
three existing-helper invocations, a conditional, an existing return member,
a two-iteration test loop, an assertion and two preload aliases. Each surrounding
use was reviewed; exact lines and reasons are in `provenance-config.json`.
No approved/restricted source pool or excluded path is changed. Verification and
remaining real-machine limitations belong to the AG-61 evidence record.
The parent recovery regression adds one further exact generic statement,
`fail = false;`, to end an injected failure. Existing identity/icon fixtures now
execute the new production identity lookup methods alongside `_applyDisguise`;
their original identity, path-isolation and icon-path assertions are retained.

### AG-60 interface language and settings organization (2026-10-13)

- Written on this branch against AG-60 and the accepted migration source at
  `88b79c523ad21a5c8bd7c565d2917ae4f28d2d35`. No old Margin or later upstream
  source, translation dictionary, tests or assets were imported. This is not a
  clean-room claim.
- New modules: `src/types/uiLanguage.ts` (language/result contract),
  `electron/services/mainStrings.ts` (existing dictionary lookup for menus/dialogs),
  `src/components/settings/settingsTabs.ts` (groups/legacy aliases), and
  `electron/services/__tests__/UiLanguageSettings.test.mjs` (synthetic settings/IPC tests).
  Persistence, IPC/preload, renderer startup and existing i18n are extended in place.
- Existing retained UI components use explicit translation calls; response/STT
  language settings, prompts, user/model text and provider identifiers are unchanged.
  Help/About prose is corrected only where it describes retired features or makes
  unsupported sharing claims. Existing settings and action behavior are retained.
- Exact-line review is retained in
  `evidence/AG-60/provenance-line-review.json`: 168 occurrences, 148 distinct newly
  registered lines. The majority are standard `t()` wrappers on existing accepted
  labels/JSX, with the prior file, line and original text recorded. Remaining entries
  are individually identified accessibility labels, ordinary bilingual words,
  React setters, a timer-variable rename and standard synthetic-test operations.
  No restricted pool, approved-source pool, path exclusion or scanner rule changed;
  matched code was not rewritten merely to evade the scan.
- Tests extend existing settings, IPC and isolated Electron harnesses. Existing
  fixture changes supply the new presentation dependencies without weakening
  assertions. No framework, dependency, asset or native module was added.

### Stage 5 F1 screenshot retry withdrawal repair (2026-10-13)

The main agent wrote this minimal repair from the confirmed normal-use F1
reproduction on this branch. Releasing a prepared-input entry now aborts its
owned active task after removing the entry, preventing an untracked retry and
reentrant cleanup of a successor. No request path, task registry, dependency or
Local Context/Skill editing behavior was added or changed.
The existing SpeechActions fixture covers dictation and speech successors;
the existing mounted answer regression clicks Retry, Answer and Remove all.
Its loopback mock gains an optional Retry-After header, reset between cases.
The diagnostic harness under stage5-acceptance also reuses this branch's existing
fixtures; it is not production code or an additional test framework.
No old imported branch or later upstream code was read or copied, and the
source scan reports zero new unreviewed matches without added exceptions.

### S42-04 prepared retry and visible-answer timing (2026-10-13)

Written for this branch from PLAN U6/U7 and D9, initially by Astra during
Claude's quota limit, then continued by Claude Opus 5.5 medium in auto mode.
No later upstream or old imported branch implementation, prompt or test was used.
The existing generation task and transport own the bounded in-memory input;
retry creates a new task and target while preserving original prepared content.
The existing renderer and event consumers acknowledge visible answer text.
Tests reuse the existing synthetic IPC, fake clock and isolated Electron harnesses.
No framework, dependency, file lease or persistent snapshot storage was added.

Independent review found attachment revocation during asynchronous preparation
could miss the not-yet-captured input. Its zero-send counterexample and correction
are part of this ticket's acceptance, alongside the superseded screenshot-action
regression. An initial mounted run exposed a test-owned HTTP 400 script left
active for later cases; cleanup restores that fixture without weakening assertions.
Acceptance evidence is recorded separately; these changes do not establish real
service compatibility, device behavior or observed production latency.

The initial G2 scan found six exact generic statements: three ordinary guards or
callback cleanup expressions and three TypeScript fields. Each was inspected in
its newly written surrounding implementation and recorded with an exact-line
reason in `provenance-config.json`; source pools and exclusions were not expanded.

### S42-03 manual speech snapshots (2026-10-13)

Written on this branch from PLAN U2–U6/U10 and D8=A by Claude Opus 5.5 medium,
with independent review and corrections by the main agent; Astra added the final
29 behavior regressions after Claude's session quota was exhausted. No earlier Margin or
later upstream implementation, prompt, test or fixture was imported. Protocol
field and lifecycle references are linked in PLAN's S42-03 interface record;
they are not evidence of real account, device or service compatibility.

The existing session ledger, provider adapters and generation lifecycle carry
bounded per-action speech snapshots, provider epochs and fragment identities.
`restBatches.ts` owns copied REST input and records its application ingress time,
not a claimed hardware capture timestamp. `speechActions.ts` binds the action,
dictation mark, task and base context to the invoking window. Synthetic tests use
the existing fake sockets, clocks, preload/IPC and renderer harnesses; no new
framework or dependency was introduced. Late results remain available to the
live session, not to an already-frozen question.

Initial local unit results did not establish acceptance: independent probes
exposed timing, cancellation, buffering, cutoff and history-scope defects.
Corrections and their evidence are tracked in PLAN S43 and `evidence/S42-03`.
Final local gates pass 16/16; public CI 38382098418 passes on `7c9f5b85`.
No source-pool expansion or
scanner exclusion is authorized by this entry. The initial source scan reported
29 matches comprising 26 exact generic statements: timestamp/interface fields,
Map/timer/UUID operations, local boolean guards, snapshot construction and
synthetic assertions. Their surrounding new implementations were inspected;
each exact line has a reason in `provenance-config.json`. No broader block,
path, source pool or binary asset is approved by those registrations.

### S42-02 answer guidance (2026-10-13)

Written from PLAN U8 on this branch by Claude Opus 5.5 medium, then independently
reviewed by the main agent. `src/types/answerGuidance.ts` contains shared text for
the written/interview prompts and the existing spoken Stop consumer, which sends
its own context with an explicitly empty system prompt. No old branch or later
upstream prompts, code or fixtures were imported; no dependencies or endpoints added.
The used full/tiny core and behavioral answer-shape text no longer mandate a
missing-context opener or an ungrounded past story. Unused old prompt variants
were not rewritten. Active Clarify retains its question-oriented instructions.

The main agent scoped the default non-clarification rule explicitly to live
interview answers, rather than changing written-practice behavior without a
decision. A scene-level assertion failed before that scope correction and then
passed. Current fingerprints record the authorized wording, not unchanged AG-51
bytes. Mock request and actual Stop-handler checks preserve one guidance block,
empty-system semantics, cancellation and data-scope rejection. No STT lifecycle,
generation-budget or retry implementation changes belong to this ticket.

### S42-01 domestic speech configuration (2026-10-13)

Claude Opus 5.5 medium implemented U9 from this branch's contracts in auto mode;
no earlier Margin/upstream implementation or assets were imported. Aliyun endpoint
selection, credential validation and the Doubao resource field follow the confirmed
requirements. The existing provider factory is shared by connection testing and
meeting capture. The types, bridge, settings and Chinese text carry the same field.
Protocol tests extend the current fake-socket fixture; the mounted settings test
uses the current renderer harness, real bridge/handler methods and synthetic storage.

The main agent found that `null` was treated as an omitted legacy resource in the
saved-config reader and the Doubao adapter. Two added negative controls failed
before an undefined-only default fixed both paths. Missing legacy fields still
select the existing hourly default; explicit invalid values do not choose billing
resources. The renderer test also restores the CredentialsManager module cache
after its temporary fixture. No lifecycle/finalize or prompt changes in this ticket.
The full inventory gate exposed the missing fixed DashScope origin and changed
workspace expression; OUTBOUND and its exact inventory assertion now track U9,
without adding any wildcard authority or removing outbound checks.

G2: three exact generic lines are recorded with reasons: awaiting a local promise,
asserting a refused save and cleaning the test-owned mkdtemp directory. No renaming
to hide hits, exclusions, dependencies, skipped tests or upstream source imports.

### S42-05 ticket CI evidence (2026-10-13)

Written on this branch from PLAN S42-05/S43 and the existing gate runner's output
shape. Claude supplied a read-only patch; the main agent reviewed and integrated
it, adding rejection of surrounding whitespace in explicit reference paths.
No old Margin or later upstream code, prompts, fixtures or assets were imported.
`gate-evidence.mjs` reuses the existing numeric AG reference-selection behavior
and adds bounded S42 references and required-check evidence validation.
`gateEvidence.test.mjs` uses synthetic evidence in the existing test discovery
directory. The workflow consumes the same completed gate output rather than
rerunning the tests. No dependencies or skipped tests added. G2 initially matched
two generic idioms at three sites: `return problems;` and `const cases = {`.
Their surrounding implementations are newly written evidence checks and synthetic
tests; the exact lines are registered with reasons, following the existing G2
rule, without renaming code to evade the scan or broadening excluded paths.
The existing AG-51 repair was inspected for removed callers, preserved prompt
assembly and data-scope checks before the first S43 publication; its historical
logs are not replaced. Current gate and CI outcomes are recorded separately.

### AG-51 prompt layers and prompt-only Skills (2026-10-11)

Review repair after `45a4e9ce` / `ccee35dd`: written from Claude's findings and
the current call graph, without reading or importing further old/upstream code.
This supersedes the initial library-retention and optional-Skill decisions below.
Searches across electron/src/tests and the tracked file list confirmed that the
folder library had no generation consumer: getSkill/buildPromptBlock had no
callers, listSkills only served its settings page, and the optional activeSkill
chain was never populated. Issue303SkillInvocation is not present on this branch;
the S35 candidate was never imported. Its old existence is not a live consumer.

Delete the old folder-library implementation and builtin text from SkillsManager,
its UI file, IPC/preload/types, and the unused optional-Skill chain. Keep only the
AG-51 import/store facade and mount PromptSettings directly. There is no startup
seeding, directory enumeration, migration, or deletion of existing user Skills.
The request has one shared append site; a protocol assertion requires exactly one
user_guidance block with a selected Skill and additional instructions.

NativelyInterface's spoken-question stream call passes skipSystemPrompt=true,
so the option is retained and honored. Explicit empty overrides survive both
default-mode and HARD_SYSTEM_PROMPT fallback, and omit the language suffix too.
The mock protocol checks both streaming IPC and non-streaming IPC (chatWithGemini),
and confirms their data-scope denial still sends nothing. No prompt wording changes.

G6: SkillsIpcWiring's five library-only tests are removed with their feature;
its general invoke/handler invariant is preserved as IpcInvokeCoverage.test.mjs,
without a stale-channel allowlist. The exact six-case mapping is in AG-51 README.
The mounted renderer language test now exercises the surviving card and retains
draft-state and IPC-count assertions. No new skips. One new exact generic G2 line
is registered: `const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');`
(ordinary Node source read in the relocated general invariant). No scan-evasion
changes or source-pool/exclusion expansion. Thirteen AG-51 retirement rules cover
the obsolete channels, methods, directory accessors/builtin directory identifiers,
optional-Skill parameter and deleted UI/test paths.

Written on this branch from HANDOFF 4.6 and PLAN S29. No dependencies, assets,
post-June upstream implementation or old implementation fragments are imported.
Not a clean-room claim. Old Margin was inspected only with `git show b8ade3f7:<path>`.

The starting `SkillsManager.ts` is byte-identical to baseline `a786910e` (empty
baseline diff at `dd6ef564`); it therefore falls under this ledger's baseline
rule, not an unrecorded old-Margin import. Its library/parser/builtin text remains
unchanged. New methods delegate prompt installation to an independent local
snapshot store. `activeSkill` and the replacement behavior also exist in baseline
WhatToAnswerLLM; the option remains compatible but now appends supplemental guidance
instead of removing DEFAULT_ANSWER_PROMPT_SUFFIX. The live selected Skill is
resolved from local settings at the shared stream consumer, not renderer text.

| Old candidate | Disposition |
| --- | --- |
| `electron/services/skills/PromptSkillImporter.ts` | Behavior reference only; all 191 lines excluded. Native selection + validation + local installation are implemented against this branch, without the upload outcome/type system, folder attachments or Local Context dependency. Hit 19 `super(message);`, 49 `let fd: number \| undefined;`, 82 `let text: string;`, and 185 `return outcome;` are all excluded with the old file, not cosmetically edited. |
| `SkillValidator.ts`, `SkillUploader.ts`, old `LocalContextStore.ts` | Not read or imported for AG-51. New PromptSettingsStore owns its schema, limits, bounded descriptor reads and atomic snapshot replacement. AG-50 storage is not shared. |
| `electron/services/__tests__/PromptSkillConsumerChain.test.mjs` | Behavior reference only. All old lines excluded, including hits 28, 32, 62, 80 and snapshot 1–6, 26–27, 66–67. The new test drives current IPC, IntelligenceManager/Engine, AG-42 preparation, WhatToAnswer and stage-3 mock Chat Completions. No old DirectAssistService/generateAnswer contract is reconstructed. |
| Old `PromptSkillImporter.test.mjs` | Not imported: hits 30, 39, 52, 67, 115, 137 and snapshot 2–3, 5 remain excluded. New behavior tests exercise this branch's store and native-dialog selection. |
| Old `SkillsSettings.tsx` | No old body used. Its hits 261/291, all 10 near-snapshot and 105 snapshot lines listed in S35 remain excluded, together with adjacent short lines. Existing branch SkillsSettings stays a library view; a new SettingsKit/useI18n card handles installed copies and scene preferences. |
| Other S35 AG-51 tests (`CodeHintV3Adoption`, `ProactiveV3PromptSubstitution`, `ResponseLanguageUnified`, `modePrompts`, `Issue303SkillInvocation`, old `SkillsIpcWiring`) | Not imported, including every S35 hit/near-snapshot/snapshot range. No retired modes or automatic answers return. Existing branch tests remain; ImagePathValidation's stub gains current scene prompt resolution and prompt tier only. |

Default strings are split at their existing boundaries, not rewritten. Tests bind
the joined written and interview strings to SHA-256 values from `dd6ef564` (see
AG-51 README). The base retains the already-settled identity/security variant of
each prompt; forcing a single identical identity paragraph would change S29 text.
Tiny-tier interview text and the default suffix remain unchanged.

Five new G2 occurrences (four distinct generic statements) are registered exactly
in provenance-config.json, with no source-pool or exclusion changes:

| New location | Exact line | Judgment |
| --- | --- | --- |
| PromptSettingsStore.read | `return settings;` | Return newly validated snapshot; ordinary control flow |
| PromptSettingsStore.save | `return settings;` | Return committed snapshot; ordinary control flow |
| PromptSkillConsumerChain storage recovery test | `store.clear();` | Invoke this branch's recovery method |
| PromptSkillConsumerChain protocol test | `const { LLMHelper } = require('../../../dist-electron/electron/LLMHelper.js');` | Import the current compiled consumer for behavioral testing |
| PromptSettingsUi preload test | `calls.length = 0;` | Reset the mock call log after existing preload initialization |

Existing approved generic idioms are reused unchanged. No scanner-evasion edits,
deleted tests or new skips. The existing Electron renderer gate gets a synthetic
settings API and request-level scene assertions; only syntax is checked here.
Full Electron gates and Claude review are pending, not claimed by local results.

### AG-50 full-text Local Context (2026-10-11)

Review repair (2026-10-11): written from Claude's unreadable-storage finding.
`clear()` invokes the existing atomic `save([])` without parsing the previous
file; the new guarded IPC/preload entry retains sender validation and generation
invalidation. The card offers recovery only after the fixed local read failure,
with a separate confirmation/cancel step. No old/upstream code or new dependency
was read or introduced. Existing fail-closed generation behavior is unchanged.
Behavior tests cover malformed JSON/schema/oversize/unreadable file mode, real
generation failure and recovery, IPC/preload, confirmation cancellation, failed
clear retention and both UI languages. No tests were removed or skipped.

Three additional exact generic G2 lines in LocalContextSettings are retained and
registered with individual reasons: `const [confirmClear, setConfirmClear] = useState(false);`
(React confirmation state), `if (result.ok) {` (result success branch), and
`setConfirmClear(false);` (reset confirmation after success). No evasion edits or
source-pool changes. The initial seven occurrences below are unchanged.

Written for this branch from HANDOFF 4.5, the final S40 user decision and the
stage-3 GenerateRequest contract. Not a clean-room claim. No old implementation
fragments, later upstream implementation, assets or dependencies were imported.
Only `git show b8ade3f7:<path>` was used for old-code inspection. The S35 ledger
was read before implementation; its candidates are not treated as approvals.

| Old content | Use and disposition |
| --- | --- |
| `electron/services/LocalContextStore.ts` | Behavior reference only for UTF-8/text extensions and 8 / 32 KiB / 64 KiB bounds. The upstream-derived implementation is not introduced. New store persists validated text snapshots rather than a list of source paths; generation never reopens the original documents. It has no enable switch, prewarm observer or old state schema. Bounded descriptor reads and atomic replacement use Node primitives. |
| `electron/llm/promptAssembly.ts` | Behavior reference for reference-first placement and lower-trust material. Rewritten against string / parts / role-based `contents`; no GenerateTurn or old builder. Hit line 12 is excluded with the entire old interface. No stable prefix/prewarm code, Skills or request-reference feature is imported. |
| `electron/llm/promptBudget.ts` | Behavior reference only for rejecting rather than trimming and conservative UTF-8/framing estimation. Rewritten in `localContextRequest.ts`, using this branch's `getModelCapabilities(model)` and `maxOutputTokens`, not old `request.target`, `request.turns` or modelTargetCapabilities. No old exact-count or backend-unbounded special case is imported. |
| `electron/ipc/configContextHandlers.ts` | Only inspected the Local Context behavior. New three-channel handler is self-written; no fragments are introduced. All 47 hit lines 58, 61, 152, 153, 154, 155, 159, 162, 163, 164, 167, 171, 173, 174, 175, 177, 178, 179, 181, 182, 185, 189, 192, 193, 195, 196, 198, 202, 205, 206, 207, 209, 210, 211, 213, 215, 219, 220, 221, 224, 225, 226, 227, 228, 229, 230, 232 are excluded, as are all 81 S35 snapshot lines and their adjacent short lines. No old configuration, debug or prewarm dependencies return. |
| Old `ProviderRouter.ts` and `answerGeneration.ts` | Read only to establish the old `reference_files` policy and distinguish manual persona context. No code imported. S40 supersedes that policy; existing three data scopes are untouched. |
| `src/components/settings/LocalContextSettings.tsx` | No old body imported or used as a template. New card uses the current SettingsKit/useI18n. S35 hits 7, 12, near-snapshot 71, and snapshot lines 8–9, 11, 13–16, 20–21, 23, 25–27 all remain excluded. No old enable/prewarm controls are introduced. |
| Old `PromptBudget2026_09_27` / `ManualContextFallback2026_06_16` tests | Not imported. Their snapshot ranges stay excluded. New tests execute this branch's store, request assembly, actual WhatToAnswer/LLMHelper, IPC/preload and UI handlers with synthetic data. No existing test is deleted or skipped. |
| `tests/fixtures/documents/` | Entirely excluded, including synthetic PDF/DOCX and README. Unsupported extensions are rejected before file access; no parser or dependency changes. |

G2 found seven occurrences of six generic lines. They remain unchanged and are
registered individually by exact line in `provenance-config.json`, with reasons:

| New location | Exact line | Judgment |
| --- | --- | --- |
| LocalContextStore.list | `return entries;` | Return the newly validated local array; generic control flow |
| LocalContextStore.save | `return entries;` | Return the saved local array; generic control flow |
| localContextRequest import | `import { getModelCapabilities } from './modelCapabilities';` | Import this branch's existing model-capacity API, not an upstream implementation |
| LocalContext test | `assert.equal(sent.length, 2);` | Standard count assertion for the two production entry points |
| LocalContextSettings | `const [error, setError] = useState('');` | Standard React error state |
| LocalContextBridge test | `const api = {` | Ordinary synthetic bridge-object declaration |
| LocalContextBridge test | `assert.equal(changes, 2);` | Count only successful add/remove invalidations, excluding cancelled or rejected imports |

No source-pool/exclusion expansion or scan-evasion edits were made. G2's final
result and test evidence are under `evidence/AG-50/checks/`. The two existing IPC
unit harnesses gained only a no-op registration stub for the unrelated new module;
their image-validation and logging-privacy assertions remain intact. AG-50 adds
four exact prewarm retirement rules; `reference_files` remains retired.

### Stage 4 exit CI repair (2026-10-11)

Written from the CI 38159055916 failures and this branch's cancellation contract.
The regression compares LATE marker multiplicity against the UI at cancel return;
all injected stale-event and HTTP-abort assertions remain. No upstream code was
imported. The two generic AG-40 test statements are individually recorded in
provenance-config.json with their paths and reasons; neither statement was edited.
The offline notice check reuses this branch's verifyBundle and source-bundle npm
preconditions. Three removed-package bindings and unreferenced notices were removed
after checking the current lock and regenerated inventory (PLAN section 9).

### AG-42 manual answer (2026-10-11)

Review repair after `3ff20cbc` / `3bfcbe47`: written from Claude's three findings,
using this branch's ProviderScopeError, shared image validator, i18n hook and STT
session. No additional old Margin/upstream files were read or imported. Local
scope, invalid-image, configuration and cancelled outcomes use distinct fixed
English strings; provider/unknown errors remain generic. No provider message
content is used to classify a failure. Error names retain the branch's existing
cross-bundle convention. Chinese UI text lives in i18n.zh.ts and is displayed
through useI18n. Non-cancellation mic-finalize failures only emit a fixed warning
and use available context; the renderer also keeps retained speech after IPC
finalize rejection and fences a cancelled/superseded wait.

The image-path test now separates invocation rejection from result assertions,
so an AssertionError cannot satisfy its own Invalid-image-path exception check.
The Electron regression again requires exactly one Data-scope-denied message and
zero sends. Added tests exercise the production recording callback and answer row,
both UI languages, fixed warnings, best-effort generation and cancellation.
No tests were deleted or skipped. Two exact generic G2 matches are registered:
`assert.equal(warnings.length, 0);` (MeetingSttSession test, cancelled wait emits no
warning) and `assert.equal(warnings.length, 1);` (manualAnswerRenderer test, one
fixed warning on finalize rejection). No source pool/exclusion changes or scan
evasion edits were made. The statements below remain the initial implementation's
dispositions, not new approvals of old code.

Written for this branch from HANDOFF 4.4 and the existing stage-3 contract. This is
not a clean-room claim. No later upstream implementation, dependency or asset is
imported. The request/event mapping and existing caller chain are documented in
`evidence/AG-42/README.md`. The minimal preparation adapter uses the existing
WhatToAnswerLLM/LLMHelper transport; no old generation types are reconstructed.

Only `git show b8ade3f7:<path>` was used to inspect the old service and identity
module. Both are behavior references only; **zero old code lines are imported**.
Their flagged lines (and adjacent short lines) are rejected with their entire
implementations rather than edited until the scan passes:

| Old file | Disposition and basis |
| --- | --- |
| `electron/direct-assist/DirectAssistService.ts` | Not introduced. All hit lines 12, 39, 89, 108 and snapshot lines 1, 9–10, 32, 36 are excluded. The old service requires an incompatible request/transport and out-of-scope Local Context/Skills. Existing logical-task ownership makes a second service unnecessary |
| `src/lib/directAssistAnswerState.ts` | Rewritten for current UUID and sealed-stream state. Old hit line 33 (`errorCode?: string;`) is not imported; neither are the old session/generation-id format, automatic-answer classification, error taxonomy or labels. Current GenerationMetadata remains authoritative |
| `electron/direct-assist/errors.ts` | Self-written fixed messages and a local configuration-error category; no old body or its 66 snapshot lines introduced |
| `electron/ipc/answerHandlers.ts`, `answerActionHandlers.ts`, `directAssistValidation.ts`, `legacyChatHandlers.ts`, `electron/preload/answerBridge.ts` | Not introduced or used as templates. All S35-listed hits (202, 2, 150, 0, 0 respectively), near-snapshot and snapshot ranges stay excluded. Modify this branch's existing ipcHandlers/preload in place; image validation and other existing entries remain |
| Old `requestBuilder.ts`, `types.ts`, `answerGeneration.ts`, `GenerateTurn`, `AnswerGenerationInput` | Not introduced. New answerGeneration.ts is a preparation adapter, not a reconstruction of the old generator |
| Old IntelligenceEngine/NativelyInterface/overlayActionDedup and all 11 AG-42 test candidates | No old fragments introduced. Current branch code and existing synthetic harnesses are extended; new tests implement the ticket's behavior requirements |

G2 found four newly written generic statements; each is registered exactly in
`provenance-config.json`, without expanding source pools or exclusions:

| Location | Exact line | Reason |
| --- | --- | --- |
| MeetingSttSession.finalizeUser | `await new Promise<void>((resolve, reject) => {` | Standard typed Promise construction for the bounded final-event wait |
| Same method | `if (error) reject(error); else resolve();` | Standard settlement after timer/listener cleanup |
| MeetingSttSession and Mg21StopConsumer behavior tests | `await pending;` | Await the synthetic final-event operation in both session and main integration tests |
| ManualAnswerBridge behavior test | `assert.equal(received.length, 0);` | Zero-delivery assertion after session reset |

No tests removed or new skips. Existing malicious-image cases retain their
no-send assertions with fixed manual error text. Electron regression's single
error/no-send check is updated for that same contract, not removed. Full gates
and real-service/device behavior are not claimed by local checks.

### AG-41b five cloud STT providers (2026-10-11)

Full-gate follow-up after `520dc16e`: the three existing domestic STT bridge
signatures are declared directly in both ElectronAPI interfaces, retaining the
existing checker rather than relaxing it; the now-unused aggregate interface is
removed. The existing isolated storage harness adds an unconfigured-start
assertion followed by synthetic OpenAI STT credentials and its own loopback REST
endpoint via IPC. Its request assertions are strengthened, not removed. These
changes use only this branch's code and the reported gate behavior; no old Margin
or upstream source is imported. G2 reports no additional exact matches.

Review repairs after `759a6484` are written against Claude's five reported issues,
without reading or importing additional old Margin or upstream source. Overflow
notifications are latched until accepted PCM, connection readiness or stop; the
strict rejection policy is unchanged. Failure events carry locally assigned codes
and the IPC maps only recognized codes to fixed UI strings. Doubao 45000001 is a
permanent configuration failure, 45000002 ends an empty task without disabling
the provider; only handshake 401/403 is classified as authentication in this
adapter. Three button styles come from this branch's existing STT controls in
SettingsOverlay, not a new component or an old upstream settings implementation.

One additional G2 match is individually registered: `const expected = {` in
`electron/services/__tests__/DomesticSttSettings.test.mjs`, an ordinary object
declaration for fixed result expectations. The tests and expectation table were
written here; this does not approve an upstream algorithm. Existing scan scope
and all previous dispositions below are unchanged. Intermediate full-run logs
`unit-tests.log` and `unit-tests-r2.log` were removed at the user's request; they
remain recoverable from `759a6484`. The final log is replaced by the repair run.

Written for this branch from HANDOFF 4.3 and the official protocol descriptions
linked in `evidence/AG-41b/README.md`. No dependency was added or upgraded.
This is not a verified clean-room claim. No post-June upstream implementation
was imported or used as a template.

Old Margin was read only with `git show b8ade3f7:<path>`:
`electron/audio/AliyunStreamingSTT.ts`, `electron/audio/DoubaoStreamingSTT.ts`,
and the behavior scenarios in `DomesticStreamingLifecycle.test.mjs`,
`DoubaoProtocol.test.mjs`, `MeetingStartAudioGate2026_09_27.test.mjs` under
`electron/audio/__tests__/`. These are behavior references only, not imported files.

Both old provider classes are rejected as reusable implementations. Their many
overlapping connection/active/reconnect/finish flags, close overloads, retry and
buffer routines carry the same template-shaped lifecycle, with snapshot-attributed
state and queue logic. Attribution to a Margin commit does not establish an
independent origin. The new implementation separates one socket-owning task
transport from two protocol adapters. All old class bodies, including short lines,
are replaced rather than cosmetically edited. PCM conversion is newly written and
tested for split-frame/chunk continuity. Overflow is rejected with a fixed error,
not silently retained or truncated.

| Old class / S35 ranges | Disposition of every listed line |
| --- | --- |
| Aliyun hits: 20, 129, 131, 150, 212, 254, 269, 285, 351, 399, 439, 440, 451, 488 | All 14 rejected with the old implementation; no allowLine grants for these old lines |
| Aliyun snapshot: 10–11, 13, 133–135, 141–142, 147–148, 173, 201–203, 206, 209–210, 410–413, 419, 426–427, 462 | All 25 rejected; notably the non-strict queue at 410–413 is not reused |
| Doubao hits: 30, 67, 99, 178, 200, 249, 264, 309, 320, 417, 484, 516, 517, 529, 573, 588, 597, 601 | All 18 rejected with the old implementation; no allowLine grants for these old lines |
| Doubao snapshot: 12–13, 16, 192, 197–198, 225, 253–254, 258, 261–262, 468, 474–477, 496, 503–504 | All 20 rejected; notably the non-strict queue at 474–477 is not reused |

The old `SpeechProviderSettings`, `SpeechTranscriptionSettings`, `sttHandlers`,
`requestSafety`, constants, Soniox and REST implementations are not imported.
The new domestic settings card uses this branch's AG-60a hooks/components;
the surrounding existing settings layout is retained. `validateSttBaseUrl` is
new, reusing the approved branch's HTTP authority validator. The current branch's
OpenAI implementation already has no `wsSafeTeardown` or F-201 block; neither is
introduced. Its readiness moves to the official `session.updated` ACK. Two skipped
source assertions become actual emitted-configuration checks; the other two are
enabled with the corrected ACK contract. No tests are deleted or newly skipped.

New G2 exact matches are individually registered in `provenance-config.json`.
There were 14 occurrences / 11 distinct lines, all ordinary language/API idioms:

| File | Exact matched line | Reason |
| --- | --- | --- |
| DomesticStreamingSTT.ts | `private ready = false;` | Boolean initialization |
| DomesticStreamingSTT.ts | `private channels = 1;` | PCM channel count initialization |
| DomesticStreamingSTT.ts | `this.flush();` (3 occurrences) | Calls to this branch's newly written queue, on finalize/write/readiness |
| DomesticStreamingSTT.ts | `return promise;` | Local drain promise return |
| DomesticStreamingSTT.ts | `response.resume();` | Node HTTP response disposal |
| SpeechProviderSettings.tsx | `if (!current) return;` | Unmounted-effect guard |
| SpeechProviderSettings.tsx | `finally { setBusy(false); }` (2 occurrences) | Clear action state after success or failure |
| DomesticStreamingLifecycle.test.mjs | `assert.equal(errors.length, 1);` | Count assertion for rejected oversize input |
| DomesticStreamingLifecycle.test.mjs | `stt.notifySpeechEnded();` | Existing VAD interface call |
| OpenAIRealtimeGAProtocol.test.mjs | `stt._handleWsMessage({ type: 'session.updated' });` | Official protocol event fed into the parser |
| i18n.zh.ts | `'Save': '保存',` | Ordinary single-word UI translation |

No scan pool, exclusion or generic-idiom rule is changed. Other fixture updates
only load the new dependency, recognize the new registrar, include the new setter
in atomic-persistence coverage, and send the corrected OpenAI ACK. Outbound
inventory includes the new shared WebSocket site and the validated Aliyun dynamic
DNS label. The original assertions remain. Final scan evidence is in
`evidence/AG-41b/checks/provenance.log`.

### AG-41a retire five cloud STT providers (AGY, merged by Claude, 2026-10-11, PLAN S35 item 1, S38, S39)

- Removal only. Google Cloud Speech, Deepgram, ElevenLabs, Azure Speech and IBM
  Watson are deleted from this branch: implementations (`GoogleSTT.ts`,
  `DeepgramStreamingSTT.ts`, `ElevenLabsStreamingSTT.ts`, `googleServiceAccount.ts`,
  the Azure/IBM `RestSTT` configs and binary upload path, `regionalSttEndpoint`),
  IPC, preload, credential fields, settings and help UI, constants and onboarding text.
- Dependencies removed: `@google-cloud/speech`, `@deepgram/sdk`, `@elevenlabs/client`,
  `@elevenlabs/elevenlabs-js`, `@grpc/grpc-js`, `@grpc/proto-loader` (no other code
  users). The lock file was synchronized with `--package-lock-only`.
- A stored `sttProvider` naming a retired provider resolves to `none`. Old stored
  keys are neither read nor deleted.
- No old Margin or upstream code is imported. The only new code is the type-narrowed
  `getSttProvider()` and its behavior test. Retired rules are owned by `AG-41a`.
- Tests that only exercised retired providers are deleted with the feature; the
  others drop only the retired cases. Details are in `evidence/AG-41a/README.md`.

### AG-40 dual audio and meeting lifecycle (2026-10-11)

Written for this branch from HANDOFF §4.2, the race/stop behavior requirements,
and Claude's follow-up source dispositions. This is not a verified clean-room claim.
No post-June upstream implementation or old Margin runtime module is imported.

- `AudioDevices.ts` is independently redesigned against this branch's synchronous
  `native-module/index.d.ts` exports. One internal enumeration loop validates rows,
  excludes the capture backend's own `NativelySystemAudioTap` aggregate (name from
  the current branch's `native-module/src/speaker/core_audio.rs`), and deduplicates IDs.
  It does not blanket-ban legitimate user virtual cables. Input/output selection
  in the new pipeline uses exact IDs and defaults when absent; no fuzzy-name/status
  resolution API is reused. Native files and binaries are unchanged.
- `MeetingAudioPipeline.ts` replaces the entire AGY implementation: owned capture
  slots, epoch/revision invalidation, tracked in-flight work, native-release barriers,
  bounded recovery and serialized STT replacement. HFP auto-switching is not included.
  Existing branch capture wrappers and permission checks are used, not a duplicate
  permission module.
- `MeetingSttSession.ts`, `meetingLifecycleQueue.ts`,
  `TranscriptDisplayThrottle.ts` and `osEventSubscriptions.ts` are rewritten:
  per-provider listener bindings, a single drain deadline, adjacent-intent queuing,
  independently coalesced speaker display, and disposable OS subscriptions.
  The annotated declarations and artificial `extends Object` wrappers in
  the draft are not retained as a way to suppress matches.
- `main.ts` connects these modules, retains the branch's calibrated health monitors,
  permission resolver and provider factory, and removes duplicate capture/recovery
  implementations. It uses the existing processing/engine cancellation and meeting
  persistence services. `IntelligenceManager.handleTranscript` now sends incoming
  speech to the session tracker, bypassing speculative/follow-up **answer** triggers
  (S33). This does not redesign the existing SessionTracker context/compaction policy.
- No new dependency, native implementation, cloud STT protocol or settings UI is added.

Old Margin read-only references were limited to `git show b8ade3f7:<path>`:
`MeetingSttSession.ts` (behavior/reference only, rewritten),
`MeetingAudioPipelineRaces.test.mjs`, `MeetingSttSession.test.mjs`,
`TranscriptDisplayThrottle.test.mjs`, and `Mg21StopConsumer2026_09_27.test.mjs`.
For the retained/adapted tests, the full functions and short lines were reviewed
alongside the S35 per-file ranges:

| Old test | Reuse / disposition |
| --- | --- |
| `MeetingAudioPipelineRaces.test.mjs` | S35 candidate/short ranges across 1–449 supply the mock harness and scenarios. Old hit lines 11, 66, 220, 241 are deferred/timer/await idioms registered below. Old hit 8 is a generic deferred function declaration; the helper is now exported for actual shared-test consumers, so its unused draft allowLine is removed. Snapshot lines 2 and 4 are ordinary assert/fs imports already found in approved baseline code. The HFP case is replaced by a no-auto-switch / stale-PCM case per Claude. The superseding-enumeration case now explicitly enters the first lookup; assertions are retained. The fixture is split into `meetingAudioFixture.mjs`, targeting ES2022 to preserve Set iteration just like the production build. |
| `MeetingSttSession.test.mjs` | S35 candidate/short ranges across 1–213 describe identity, revision, late-event and drain behavior. Snapshot lines 4–5 are ordinary Node module-loader setup; the current fixture transpiles the actual source with synthetic providers. OpenAI/Aliyun/Doubao adapter integration is not imported: AG-41 owns it. The unconnected credential-helper draft test is replaced by the real session's declined-factory boundary, not claimed as AG-41 preflight coverage. |
| `TranscriptDisplayThrottle.test.mjs` | S35 candidate/short ranges across 4–64 supply speaker-coalescing/final/clear scenarios. Old hit 17 is `return timer;`, a generic fake timer return. Snapshot imports 1–3 are common approved Node test/assert/fs imports. |
| `Mg21StopConsumer2026_09_27.test.mjs` | Behavior reference only. The draft's fake stop implementation is replaced by actual AppState methods plus real queue/session/pipeline modules with mock native captures. No prewarm, automatic-answer or Judge steps are imported. |

The required restricted draft dispositions are completed:

| Rejected draft content | Disposition |
| --- | --- |
| `audioDeviceSelection.mjs` and `.d.mts`, including `filterSelectableDevices` / `resolveRequestedInputDevice` and their status objects | Deleted; independent ID selection and synchronous enumeration above. Their three import/filter-call allowLines and the `resolution.status === 'missing'` allowLine are removed. |
| `if (nativeRate > 0 && nativeRate <= 24000) {` and surrounding HFP fallback | Entire behavior and allowLine removed, not reformatted. |
| Draft capture-identity guard allowLines | Removed as unused after the pipeline rewrite; ownership validation remains in the new design. |
| Draft `screenCapturePermissions.ts` | Deleted; main passes the existing approved branch resolver. |
| Draft standalone fake stop test | Replaced by production-consumer behavior tests. |

All remaining exact G2 matches are ordinary declarations, control flow, API calls or
test infrastructure, not approvals for upstream algorithms. Each exact line is
registered individually in `provenance-config.json`; repeated occurrences are
listed together below. Scan pools, approved sources and exclusions are unchanged.

| Exact line | Current occurrences | Reason |
| --- | --- | --- |
| `timedOut: boolean;` | `electron/audio/MeetingSttSession.ts:5` | Generic boolean field in the drain result contract, retained plainly rather than hidden by an inline declaration. |
| `await Promise.all([first, second]);` | `electron/audio/__tests__/MeetingAudioPipelineRaces.test.mjs:51` | Generic test synchronization awaiting two synthetic begin operations. |
| `gate.resolve();` | `electron/audio/__tests__/MeetingLifecycleQueue.test.mjs:16` | Resolves a synthetic deferred promise in the lifecycle queue ordering test. |
| `segmentId?: string;` | `electron/audio/MeetingSttSession.ts:13` | Optional transcript identifier field; public stub contract, not a normalization algorithm. |
| `speakerId?: string;` | `electron/audio/MeetingSttSession.ts:14`<br>`electron/audio/MeetingSttSession.ts:25` | Optional speaker metadata field in input/output types; both occurrences are generic declarations. |
| `segmentId: string;` | `electron/audio/MeetingSttSession.ts:20` | Required transcript identifier field in the session output type. |
| `dispose(): void;` | `electron/audio/MeetingSttSession.ts:47` | Generic cleanup method signature for a listener binding. |
| `private draining = false;` | `electron/audio/MeetingSttSession.ts:55` | Boolean lifecycle flag initialized to false in the newly written binding-based session. |
| `this.draining = true;` | `electron/audio/MeetingSttSession.ts:133` | Assignment entering the final-only drain phase; no provider algorithm is imported. |
| `this.session = null;` | `electron/audio/MeetingSttSession.ts:146` | Clears the local active-session identifier on cancellation. |
| `if (timedOut) {` | `electron/audio/MeetingSttSession.ts:176` | Generic timeout-result branch in the newly written single-deadline drain. |
| `clearTimeout(deadline);` | `electron/audio/MeetingSttSession.ts:184` | Standard timer cleanup in finally. |
| `private epoch = 0;` | `electron/audio/MeetingAudioPipeline.ts:26` | Numeric cancellation generation initialized to zero. |
| `private revision = 0;` | `electron/audio/MeetingAudioPipeline.ts:27` | Numeric latest-device-request revision initialized to zero. |
| `if (!capture) return;` | `electron/audio/MeetingAudioPipeline.ts:190` | Generic null capture guard before channel startup. |
| `export type MeetingLifecycleState = 'idle' \| 'starting' \| 'active' \| 'stopping' \| 'failed';` | `electron/audio/meetingLifecycleQueue.ts:1` | Public lifecycle state vocabulary; queue implementation is newly written as adjacent-intent joining. |
| `export class MeetingLifecycleQueue {` | `electron/audio/meetingLifecycleQueue.ts:4` | Generic exported class declaration; no old queue implementation is retained. |
| `private state: MeetingLifecycleState = 'idle';` | `electron/audio/meetingLifecycleQueue.ts:8` | Typed initialization of the lifecycle state to idle. |
| `await tick();` | `electron/services/__tests__/Mg21StopConsumer2026_09_27.test.mjs:24`<br>`electron/services/__tests__/Mg21StopConsumer2026_09_27.test.mjs:28`<br>`electron/services/__tests__/Mg21StopConsumer2026_09_27.test.mjs:75` | Generic test event-loop synchronization; each use awaits a synthetic capture/drain boundary. |
| `assert.equal(endpoints, 1);` | `electron/audio/__tests__/MicRecoveryUsesCanonicalWiring.test.mjs:26` | Generic count assertion for one synthetic speech-end notification. |
| `const provider = CredentialsManager.getInstance().getSttProvider();` | `electron/main.ts:1368` | Call to this branch's existing settings getter, returning only the selected provider name. |
| `assert.equal(done, true);` | `electron/services/__tests__/AudioTestSystemAudioLevelMeter.test.mjs:193` | Generic boolean completion assertion for a mock native-release promise. |
| `if (payload.final) {` | `electron/audio/TranscriptDisplayThrottle.ts:16` | Generic discriminant check in the newly written transcript display coalescer. |
| `processingHelper: {` | `electron/audio/__tests__/mainMeetingFixture.mjs:71` | Opening property of the synthetic AppState service stub. |
| `return { promise, resolve };` | `electron/audio/__tests__/meetingAudioFixture.mjs:9` | generic return statement of deferred promise and its resolve callback. |
| `return timer;` | `electron/audio/__tests__/TranscriptDisplayThrottle.test.mjs:22`<br>`electron/audio/__tests__/meetingAudioFixture.mjs:63` | generic return statement in mock setTimeout test helper. |
| `await Promise.all([a, b]);` | `electron/audio/__tests__/MeetingAudioPipelineRaces.test.mjs:162` | generic Promise.all concurrency synchronization in race test. |
| `await stopping;` | `electron/main.ts:1439`<br>`electron/audio/__tests__/MeetingAudioPipelineRaces.test.mjs:183`<br>`electron/services/__tests__/Mg21StopConsumer2026_09_27.test.mjs:35` | generic await of an in-flight stopping promise in test harness. |

The scan history is in `evidence/AG-40/checks/provenance-*.log`; the final whole-branch
G2 check is `checks/provenance.log`. Six AG-40 retired rules guard the rejected
module paths/APIs and HFP draft flag. `completedTickets` activates these rules,
not Claude's full-gates/review acceptance. See `evidence/AG-40/README.md` for
the test replacement map, raw results, sandbox icon exception and unverified items.

### AG-60a translation and shared settings foundation

Written on this branch from PLAN S35/S36 and the AG-60a behavior requirements.
The three older candidates (`b8ade3f7:src/i18n.tsx`, `src/i18n.zh.ts` and
`src/components/settings/SettingsKit.tsx`) are **not imported**, in whole or in
fragments. Their S35 range records and restrictions were read; no old commit or
line range is approved here. Earlier Margin is only a behavior reference through
the handoff, not an implementation template or a verified clean-room claim.

`SettingsHeading` and `SettingsCard` extract the markup/styles of this branch's
existing `SkillsSettings.tsx`, also checked directly against baseline `a786910e`.
The four Chinese labels are newly written translations of that consumer's English
labels; the remaining old dictionary is not brought in. Language state uses the
installed React `useSyncExternalStore` API, per renderer; persistent preference,
cross-window synchronization and the language selector remain AG-60 work.

Tests use installed React server rendering, TypeScript and the existing guarded
Electron renderer harness. They exercise lookup/fallback, language changes and
shared markup, plus the mounted Skills consumer and its synthetic IPC controls.
No dependency, native code, fixture, skip or existing test is removed or added
outside this scope.

The first scanner report (`evidence/AG-60a/checks/provenance-first.log`) has six
exact matches. Each is recorded individually in `provenance-config.json`: two
generic translation-call expressions; two baseline HTML/style lines with only
generic translation/title interpolation; a typed callback Set; and an opening
synthetic `window.electronAPI` assignment. The full baseline Skills file was
checked before classifying the HTML lines. No later-upstream algorithm, prompt,
test or asset is imported; source pools and scan exclusions are unchanged.

### AG-52 meeting record trim (Claude, 2026-10-11, PLAN S33 item 3 and S34)

- Removal only, plus a smaller rewrite of what stays: `MeetingPersistence.stopMeeting`
  now saves one finished meeting (transcript and usage) directly, keeping the existing
  one-second minimum and the retention/do-not-persist gate. No new upstream or
  earlier-Margin code is imported.
- Removed: post-call summary and title generation (`LLMHelper.generateMeetingSummary`,
  `PostCallWorkflow`, the Groq title and summary prompts), startup recovery
  (`recoverUnprocessedMeetings`, `getUnprocessedMeetings`), meeting chat
  (`MeetingChatOverlay`, `meetingChatContext`, the `meetingId` chat option), summary
  editing (`update-meeting-summary`), the `post_call_summary` data scope and its
  settings toggle, and the summary tab and "Processing..." list state in the UI.
- Tests: `MeetingPersistence.test.mjs` replaces `MeetingPersistenceRace.test.mjs` with a
  behavior test of the direct save; `tests/margin/meeting-storage.test.mjs` is rewritten
  for meetings saved without any request, and its history-list click reports the
  covering element when a click is intercepted.

### S34 nativeImage in place of sharp (Claude, 2026-10-11)

- `electron/services/screen/imageCodec.ts`: written for this branch from the X6
  pilot (`evidence/nativeimage-pilot/`); it uses only Electron's `nativeImage`.
  `LLMHelper.processImage` and `ScreenshotHelper.stitchImages` call it. No earlier
  Margin or restricted upstream implementation is imported; the one G2 hit of the
  first draft (a generic `getSize()` line) was rewritten, not allowlisted.
- Removed: `ImageOptimizer`, `ImageHashService` (no caller), their test and
  benchmark, `scripts/ensure-sharp-mac-deps.js`, `scripts/margin/libvips/` and
  `scripts/margin/license-inputs/libvips/`. sharp is now a dev dependency (icon
  generation and tests only) and is not packaged. `licenses/manifest.json` was
  regenerated offline; it drops sharp's packages and the libvips notices, and the
  119 texts no entry references any more are deleted.

### Stage 3 W2 review repairs

R3-1, R3-2 and R3-5 are implemented from the review findings and the user's
bounded repair decisions on this branch. They reuse the existing effective
provider resolver, credential transaction, image-path validator and legacy
privacy conversion. No earlier Margin or restricted upstream implementation is
imported. No new dependency, native input, prompt or workflow is in scope.
The named red/green checks and retired-test behavior map are recorded in
`evidence/AG-3x-review/`. Frozen-source local gates pass 16/16, with zero G2 hits
and no new allowlist entry, source pool or path exclusion. Six test instances
on removed wrappers become three equivalent safety checks on a retained entry;
their assertions are not retired with the wrappers. Windows compilation and
Claude closure are recorded separately from local verification.

### AG-70 Windows compile workflow

`.github/workflows/windows-compile.yml` is new code written for this branch
(PLAN S30). Its step layout follows this branch's own `margin-gates.yml`. The
older Margin line's `.github/workflows/release.yml` and the `windows-support`
branch's Windows job were read only to see which Windows build steps had
worked before; no line is copied from them, and neither is added to the
approved source pool. The workflow invokes only scripts already on this
branch (`scripts/build-electron.js`, `scripts/build-native.js`) and the
baseline's Windows platform branch of the native module. It changes no
source, test, dependency or prompt. S31 added the push trigger, the documentation-only
path filter and the public-repository guard; those lines were also written for
this branch.

### AG-34 read-only Codex login source

The behavior requirements are PLAN S27–S28 and sections 3.2–3.3 of
`b8ade3f7:docs/fresh-release-implementation-plan.md`. The older Margin
`electron/services/CodexCliService.ts` and `CodexCliAuth.ts` at that revision
were inspected for the fixed destination, file-auth shape and request fields.
The older personal additions are associated with `fcfbb02a` and `0469fbe7`;
this inspection does not approve importing those files or their dependencies.
No older implementation is copied or added to the approved source pool.
The new source builds on this branch's generation scheduler, Responses event
parser and settings infrastructure. Retained reasoning/service-tier options
use a separate source-specific serializer, not the API-key request serializer.

The official login documentation at `https://learn.chatgpt.com/docs/auth`
describes file and credential-store choices, not a supported third-party
contract for the backend endpoint or a complete versioned auth-file schema.
The distinct OAuth token-sharing flow documented at
`https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference`
does not establish that CLI login tokens can be sent to the public API.
Neither document is used to claim official support for this source. Synthetic
tests cannot establish real-account compatibility or service authorization.
The frozen-source full local gates pass 16/16; G2 has zero hits without any new
allowlist entry, source pool or path exclusion. The existing Responses event
logic is extracted from this branch; endpoint/auth/body construction stays
independent. All 35 retired CLI tests have named behavior mappings in
`evidence/AG-34/targeted/ag34-test-migration-map.md`, with explicit intentional
changes rather than a claim of one-for-one semantic equivalence. No dependency,
native input or prompt text changes in this ticket.

### AG-33 answer lifecycle and image admission

The requirements are PLAN S27–S28 and sections 3.1–3.2 of
`b8ade3f7:docs/fresh-release-implementation-plan.md`. This is a behavior reference,
not permission to import the older implementation. Changes build on this
branch's AG-30–32 generation task, existing IPC/preload event paths, credential
transactions and renderer buffers. No older implementation file is copied or
added to the approved pool. Exact new source matches and behavior evidence are
recorded after implementation freezes. Prompt text remains unchanged pending
the S12/S27 user decision.

The in-progress AG-33 source scan found 17 matches for six exact statements:
an epoch guard repeated in renderer callbacks, three primitive metadata fields,
a Promise-finally opening, and an unchanged baseline SessionTracker expression
with a trailing comma. The last expression was checked against
`a786910e:electron/SessionTracker.ts` line 299. Surrounding code was reviewed;
only these exact lines are registered, with no expanded source pool or exclusion.
The first complete gates scan found four more occurrences of three generic
statements in the new tests: Playwright page evaluation/close and a Boolean
no-transport-open assertion. The real component and cancellation test bodies
were inspected; only those exact statements are registered.
The second complete scan found two occurrences of one additional assertion,
`assert.equal(engine.getActiveMode(), 'idle');`, in the real Engine timeout and
supersession regressions. Their fake-clock/request ownership controls were
reviewed; this exact public-API assertion is registered without changing the
scan scope. AG-33 adds ten exact idiom/baseline-punctuation registrations in total.

### AG-32 logical generation scheduling

The behavior requirement is section 3.2 of
`b8ade3f7:docs/fresh-release-implementation-plan.md`, read under PLAN S27–S28.
The scheduler is written on this branch around the AG-30/31 single-send
interface, Node abort signals and AsyncLocalStorage. No earlier Margin
scheduler implementation is copied or added to the approved-source pool.
Provider targets and safe credential transactions reuse this branch's existing
implementation. Cancellation, finite attempts and completion states are tested
with synthetic transports; no remote latency or quality claim follows from
these checks. The per-ticket evidence records failures and any exact generic
source matches after the implementation is frozen.

The in-progress scan in `evidence/AG-32/provenance-initial/` found five exact
generic statements: async stream collection, a zero-request assertion, remaining
deadline arithmetic, a cancellation callback declaration and a test promise
local. Their surrounding scheduler and scope/cancellation tests were reviewed;
only these statements are registered. No source pool or exclusion is enlarged.
This diagnostic is not final source or ticket acceptance.
The first full gates scan added two generic matches after the last implementation
checks: a standard AbortSignal cancellation check before debug success, and an
Engine reset call in the real transport-cancellation test. Both surrounding
paths were reviewed and those two exact statements registered as well.
The final full scan found one further standard Node resolution statement,
`const electronId = require.resolve('electron');`, in the log-redaction behavior
test. Its synthetic module-cache installation and restoration were reviewed;
only the exact statement is registered. The follow-up scan reports zero hits.
All eight registrations concern generic idioms, not copied implementation.

### AG-31 protocol and target configuration

The four-protocol behavior and explicit target requirements are read from the
earlier requirements document at
`b8ade3f7:docs/fresh-release-implementation-plan.md` sections 3.1–3.2, as already
referenced by ADAPTATION and permitted by PLAN S28. No earlier protocol,
credential or configuration implementation is imported by this ticket.
Implementation uses the retained branch's SDKs, transactional credential store,
outbound wrappers and AG-30 single-send contract. No new dependency is added.

OpenAI request/event behavior is checked against the installed SDK types and
official documentation fetched on 2026-10-10:

- https://developers.openai.com/api/docs/guides/streaming-responses
- https://developers.openai.com/api/reference/resources/responses

These establish typed Responses stream events and distinct response/refusal
states; EOF alone is not treated as successful completion. Tests use synthetic
keys and local transports, not a claim of compatibility with every third-party
endpoint. This work does not authorize real service calls or reuse of restricted
upstream code, and is not claimed as a verified clean-room rewrite.

The frozen-source first scan (`evidence/AG-31/provenance-initial/`) records
16 matches for 12 exact generic statements: optional URL/failure locals and a
URL field, fail-closed returns, a cache generation counter/capture, existing
cache constructor/clear calls, a mock policy, a standard HTTP fixture server
and a one-request assertion. Their surrounding new target, cache and protocol
test code was reviewed; only these exact statements are registered. Source
pools and exclusions are unchanged; no older implementation is approved.

### AG-30 Gemini single-send interface

Under PLAN S28, the earlier Margin snapshot `b8ade3f7` was read for the
interface and behavior of `electron/llm/generateContract.ts`,
`electron/llm/generateOnce.ts`, `electron/llm/answerGeneration.ts`,
`electron/llm/logicalGeneration.ts`, `electron/llm/actionGeneration.ts` and
their `electron/LLMHelper.ts` callers. The original single-send module addition was
`3eff9a6206eaa7e3e42887e0d3ef3a054430b287`. This is a structural reference,
not approval to import the old branch or its transitive contents. No old source
file is copied, cherry-picked or added to the approved-source pool.

The implementation on this branch separates one physical Gemini generation
from the existing caller-owned routing and retry policy. It is written against
the retained branch behavior, installed `@google/genai` request/response types
and synthetic transport checks. Unlike the older raw HTTP/SSE implementation,
it uses the installed SDK. Older multi-protocol adapters, capacity rules,
context orchestration and prompt text are not imported. This is not described
as a clean-room implementation. Restricted upstream sources remain prohibited;
G2 still scans the changed lines without widening path exclusions.

The first G2 run is retained at `evidence/AG-30/provenance-initial/` (exit 1).
Its 14 matches comprise 13 exact generic statements: ESM root resolution,
boolean test iteration, mock call recording/count assertions, an HTTP SSE
success header, AbortSignal return/rethrow/argument forwarding, a boolean
request field and an optional string local. Their surrounding code was checked
against the new interface tests and the retained branch callers. Only these
exact statements are registered in `provenance-config.json`; no old module or
upstream source pool is approved by this registration.

The S17 early AG-25 package diagnostic (`scripts/margin/package-inventory.cjs`,
its separate builder config and `packageInventory.test.mjs`) is written on this
branch from the approved actual-package inventory contract, Node standard-library
APIs and the already installed `@electron/asar` list/stat/read API. The existing
Margin workflow gains manual opt-in and an explicit gate-reference input; ordinary
runs do not package. Only GitHub Actions macOS arm64 may rebuild the temp identity
from empty generated directories and form a `--dir --publish never` bundle in a
dedicated runner temporary directory. Normal Vite build settings are retained;
extra renderer source maps are not generated or added to the package for diagnosis.
The independent diagnostic hook records the unchanged normal license verifier's
actual result, inventories the formed asar/unpacked/Resources/Frameworks tree, and
throws a unique receipt before any signing or publishing. Only a complete receipt
and that exact nonzero builder stop count as successful evidence collection, never
as package acceptance. Missing metadata/maps retain unknown component status;
dynamic-link inspection does not establish native static vendor composition.
Missing renderer maps are a documented evidence blind spot, not proof of absence.
Failures retain diagnostic JSON/logs where available. A separate text allowlist
check precedes five exact report uploads; no app, archive, source-map contents,
native binary or normal native-module artifact is uploaded in diagnostic mode.
The diagnostic, its config, its test and its workflow input and steps were removed
on 2026-10-10 (the AG-25 package checks replaced it); this paragraph is history.
This does not implement or pass the full AG-25 signing, launch or joint acceptance
contract, and does not resolve AG-26's outstanding license obligations.
The initial diagnostic source scan retained ten matches for eight generic lines:
`if (explicit) {`, `if-no-files-found: warn`, fixture parent-directory creation,
CommonJS repository-root resolution, SHA-256 initialization, `entries.push(entry);`,
the missing-directory early return, and `async function run() {`. These are the
standard operations in this independently written diagnostic and workflow.
Only their exact lines were allowlisted; no source pool or excluded path changed.
CI `37824733686` fetched newer references under the same configured upstream
prefixes and exposed six additional matches: the Blue Oak 1.0.0 heading
`## Acceptance` in five preserved license texts, and the collector's Node ESM
direct-entry comparison of `process.argv[1]` with `fileURLToPath(import.meta.url)`.
Refreshing those same references locally reproduced all six matches (606678
restricted line keys). The heading was checked against the official canonical
Blue Oak text and the manifest's original package sources; the entry comparison
is independently written standard module/CLI dispatch. Only these two exact
lines were approved. No source-import permission or path exclusion was expanded;
the failing CI and local red/green scans remain recorded as evidence.

The diagnostic's parenthesized-helper path fix is written on this branch from the
failed CI tool output and a minimized read-only system Mach-O reproduction.
`otool-classic` treats a basename ending in `(member)` as archive-member syntax.
The installed tool's help documents `-m` to disable that syntax: `-L` failed on
the `helper (GPU)` path, while `-m -L` succeeded on that exact same path with
unchanged SHA-256. The diagnostic now passes this official option when reading
individual Mach-O files, without copying, renaming or changing package inputs.
The small `inspectDynamicLinks` seam preserves timeout, exit/error handling and
original-path reporting. Real tool failures still make the inventory incomplete.
The regression cases were red before this fix and green afterward, including
an X2 run allowing only `otool` to read a synthetic copy of a system Mach-O
without executing it. That real-tool case is skipped in the default guard
profile, which grants no external executables; the synthetic path and error
regressions remain active there. The license verifier, static vendor-composition
limitations and source-map evidence gaps are unchanged.

The two SPDX-package notice bindings use exact-version published declarations:
`spdx-exceptions@2.5.0` declares CC-BY-3.0 and `spdx-license-ids@3.0.23` declares
CC0-1.0. Their official Creative Commons legalcode.txt full texts are pinned by
SHA-256 in `license-sources.json`; the binding version is the package version,
not the Creative Commons standard version. Each binding also retains the full
original licensing README: exceptions commit `3aa64bec339abc6a3eca00c3436aaa7e154b8799`,
blob `6c927ecc6911929acfeb11617dd067784105d7bb`; ids commit
`a2a975daf48bbc2afdc8e7c304405b44c656fd53`, blob
`ba650628aeb637a4791007f6b0dde09e8b6a78c7`. Both README hashes match the installed
originals. The Linux Foundation/Contributors 2010-2015 statement and Kyle
Mitchell's mechanical-extraction declaration are preserved, not replaced by
invented copyright or endorsement. README attachments alone do not close
missing-full-text entries. The S17 diagnostic observed both packages and their
unchanged identifier JSON bytes; CI 37829181248 completed evidence collection
without accepting the package. The four new source attachments add only three
unique stored texts because the freshly verified official CC0 text is byte-
identical to an existing copy. Byte deduplication borrows no other package's
grant: the new CC0 binding retains its own exact-version declaration and official
source. At that point, only these two former missing-text candidates were removed;
17 missing candidates and separate distribution/vendor/source duties remained.
No collector, dependency, runtime or package-diagnostic logic changes here.

Two further exact-version notice bindings use the same source configuration.
`highlightjs-vue@1.0.0` declares CC0-1.0 in its published package and licensing
README. The official CC0 full terms are retained, together with its complete
README at npm gitHead `2a0d197ec24ba70e019e12a13bd42f006124506a`, blob
`756b1af32b484403f747d57a5b79bd927865c553`, SHA-256
`80f9f8e1bc56298613fa5b2ee0b57ab040f319ce052b076d54c0f96f75c02d2b`.
The README bytes match the installed/published originals. No copyright is
invented from author metadata. The CC0 terms reuse identical stored bytes, not
another package's authorization.

`r-efi@5.3.0` retains its complete original AUTHORS from crate commit
`97b55bed1c2c91dcbf787674849f05337ff80b33`, blob
`7397b2bd6a8580d51fe7b23783f8f1a05fa70291`, SHA-256
`ff92bed461f50338dd703a9ba9aee496a425957873df1d91192776e4bdf5dda7`.
The immutable source and cached crate are byte-identical. This original contains
the full MIT grant and disclaimer; MIT is explicitly selected in the source
attachment, while the declared `MIT OR Apache-2.0 OR LGPL-2.1-or-later` identity
is unchanged. The three copyright statements (Red Hat 2017-2023, Microsoft
2019-2023, David Rheinsberg 2022-2023), all authors and alternative-license notices
remain in the original full text. No generic template or borrowed Apache terms
replace it. These three source attachments add only two unique texts, remove
only these two missing-text entries (17 to 15), and change no candidate or
excluded identity. The collector/checker logic, dependencies, runtime, CI and
package-diagnostic logic are unchanged. Neither this binding nor the platform
labels exclude r-efi/Oboe candidates or close native static-composition and
distribution obligations; at that checkpoint oboe/oboe-sys and realfft still
lacked full notices.

### AG-26 S19-A exact eastasianwidth override

S19-A changes only `eastasianwidth@0.2.0` to `0.3.0` through the exact npm
override `"eastasianwidth@0.2.0": "0.3.0"`. The upstream `string-width` 5.1.2
declaration remains `^0.2.0`; this is an explicit approved deviation, not a
semver-compatible resolution or an upgrade to string-width 7. An
install-script-disabled lock-only update keeps all 1334 lock nodes, dependency
edges and classification flags; only the target version, resolved URL and
integrity change. npm's 87 unrelated object-key reorderings are mechanically
restored without changing its parsed output. No native rebuild or other package
upgrade is performed locally.

The complete retained lock path is @google-cloud/speech -> google-gax -> rimraf
-> glob -> jackspeak -> @isaacs/cliui (also wrap-ansi) -> string-width 5.1.2 ->
eastasianwidth. The latter's only package consumer calls `eastAsianWidth` for
each string-iterator character after ANSI, emoji, control and combining filters.
An AST inspection of 162 production electron/src files finds no direct
eastasianwidth/string-width reference. Computed loads are limited to the
inspected native binary candidates and better-sqlite3/keytar ABI probe; this
does not prove arbitrary external native overrides or untrusted code safe.
Physical test-exclude/string-width cache leftovers are absent from the retained
lock graph and are not reclassified as production users.

An X2 comparison loads the unchanged installed string-width 5.1.2 module twice,
redirecting only its eastasianwidth import to verified 0.2.0/0.3.0 tarball bytes.
All 1114112 code points (including lone surrogates) have identical classifications,
characterLength and length results. Both ambiguous-width settings plus 15
ANSI/emoji/ZWJ/combining/CJK boundary strings yield 2228254 equal string-width
results. The full JavaScript diff is 94 strict-comparison changes and three
slice adjustments; no classification table changes. The unused `slice` export
does change: six tested null/zero endpoint cases differ, such as
`slice('abc', 0, 0)` returning `''` instead of `'a'`. Its upstream end fallback
tests `start === null` rather than `end === null`, after start normalization;
that suspected upstream defect is recorded, not patched or claimed equivalent.
No retained call path uses this export; the whole library is not claimed
behavior-identical.

The official 0.3.0 tarball still contains no LICENSE. Its four files
eastasianwidth.js, package.json, README.md and eastasianwidth.d.ts match both
published gitHead `e5ee638e2039093c924b60d8a2ba7c12c52549f8` and later
same-version notice commit `1d41951a59d63fb2d77cda021050fc070cae424a` byte-for-byte.
The latter adds only MIT-LICENSE.txt, retaining `Copyright komagata`; its
1043 original bytes, SHA-256
`94aa6016fb9d436508366433e9caba061443ca58f4c7eb515caec7badf90ae5a` and Git blob
`e8f4a01dd0f84a8156dcb334eb505d2088b0d1ab` bind only to 0.3.0. Tarball integrity,
both immutable refs and all four file SHA-256/Git blobs are recorded under
`sameVersionEvidence` in license-sources.json and separately checked; the
unchanged collector does not audit those extra provenance fields automatically.
No neighboring-version grant is borrowed for the old 0.2.0 candidate.

Regeneration keeps 726 candidates, 33 excluded paths and two deferred notices;
only eastasianwidth's version identity changes. One original notice raises
unique texts from 410 to 411 and reduces missing texts from three to two.
react-remove-scroll-bar 2.3.8 and realfft 3.5.0 remain unresolved, and normal
package acceptance still rejects the inventory. Native composition,
corresponding-source/relinking duties, fresh no-cache CI and actual artifact
review remain separate requirements; this local check is not AG-26 acceptance.

### AG-26 S19-B restricted published MIT metadata evidence

S19-B introduces `approved-metadata-MIT` only for
`react-remove-scroll-bar@2.3.8` and `realfft@3.5.0`, without changing dependencies,
lockfiles, runtime, CI or package-diagnostic behavior. This is a deliberately
weaker category: a published MIT metadata declaration plus fixed official
standard terms, not a recovered complete original notice, copyright grant,
legal verdict or native/distribution acceptance.

The exact npm archive at
`https://registry.npmjs.org/react-remove-scroll-bar/-/react-remove-scroll-bar-2.3.8.tgz`
matches lock integrity
`sha512-9r+yi9+mgU33AKcj6IbT9oRCO78WriSj6t/cF8DWBZJ9aOGPOTEDvdUDz1FwKim7QXWwmHqtdHnRJfhAxEG46Q==`
and archive SHA-256
`ccc872d7a2dc007cbf9d755f30d56b8d80eabdbe22c44c95a709129bfdc46f01`.
Its complete 2221-byte `package/package.json`, SHA-256
`e372f857ce05f266137c65293436b5380fec42ac311e6acb9378ed78b98d75d0`, is retained
verbatim and matches installed metadata. The exact crate at
`https://static.crates.io/crates/realfft/realfft-3.5.0.crate` matches Cargo.lock
checksum/archive SHA-256
`f821338fddb99d089116342c46e9f1fbf3828dba077674613e734e01d6ea8677`.
Its complete 990-byte `realfft-3.5.0/Cargo.toml.orig`, SHA-256
`d72ddbadf9bb55ed21ae973ac97f0bb4e8df2064af628c54b802b2c7d764c8de`, is retained
verbatim and matches the installed original manifest. Both archive entry lists
were checked for unsafe/duplicate paths and links before separate temporary
extraction; no package code or install scripts were executed.

Both original READMEs express a short MIT declaration: npm byte range
[1702,1715) is `# License` followed by `MIT`; crate range [6563,6575) is
`License: MIT`. Neither archive supplies a complete original license/copyright
notice file. The published npm gitHead's unresolved source and a later
add-LICENSE change are not used to give 2.3.8 an original grant. Package author
fields are not converted into copyright statements. Official SPDX MIT at commit
`d46e94e2c78ceede1cfc63cfa0396472d2798d4c`, Git blob
`d817195dad53ec992418c28ffca5fbd1cd86502a`, SHA-256
`b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5`, retains its
unfilled copyright placeholders; its bytes already existed in the inventory.

The collector restricts approval to these two exact identities/artifact pins,
checks current artifact integrity/checksum and original/installed metadata
bytes, verifies the declared name/version/MIT license and fixed SPDX URL/hash/
Git blob, and requires the explicit evidence category. Missing category cannot
fall through to the ordinary binding. Metadata attachments alone do not close
missing entries; both metadata texts become hash-checked bundle notice inputs.
Binding resolves after all attachments load, independently of source order.

Regeneration keeps 726 candidates, 33 exclusions and two deferred Electron
notices; the two retained original metadata texts raise unique texts from 411
to 413 and reduce unresolved notice candidates from two to zero. All previous
411 text bytes and unrelated component/source/deferred records remain intact.
The normal byte verifier can pass only with `candidateInventoryOnly:true`;
tampered/missing evidence or any unrelated unresolved notice still rejects.
The S17 diagnostic's mandatory pre-signing stop and acceptance=false are
unchanged. S19-C, actual native vendored composition, source/relinking duties,
fresh no-cache CI and actual artifact review remain separate open gates; this
does not mark AG-26 or distribution acceptance complete.

### AG-26 S18 dependency-scope reduction

S18 removes only the root production declarations for `tap`, `sqlite3` and
`screenshot-desktop`, after checking static imports, dynamic load sites and their
callers, root build configuration, native-loader defaults, setup, tests and CI.
The app's database route retains `better-sqlite3`; screenshots retain Electron
desktopCapturer and the existing Linux shell route. Node's built-in TAP test
reporter is not the removed npm `tap` package. The generated native entrypoint
permits an external `NAPI_RS_NATIVE_LIBRARY_PATH` override; arbitrary external
overrides are outside the static reachability proof, and were not executed.
The old S17 artifact's inclusion evidence is not reclassified as non-distribution.

An offline, install-script-disabled lock-only calculation removes 262 unreferenced
nodes while keeping shared nodes, all retained package versions, resolved sources,
integrities, dependency fields and independent root development declarations.
The 87 retained classification changes are 26 devOptional-to-dev transitions,
53 dev-only flags and 8 dev-plus-peer flags. The latter remain through ESLint
peer paths or electron-builder's peer Windows-installer chain. No new package,
version upgrade, replacement library or native rebuild is introduced here.
The generated lock's parsed values are retained exactly; old object key order is
restored mechanically to keep the diff focused.

The three removed root trees no longer supply the ansi-tokenize, npmcli/agent,
once 1.1.2 and screenshot-desktop candidates. err-code remains installed as a
development dependency, not an application-map candidate; eastasianwidth remains
in scope. Those missing notices leave the current candidate inventory through
the approved graph change, not a fabricated license grant or manual exclusion.
The collector still derives candidates from the lock and application source maps;
physical node_modules leftovers cannot alone re-enter the candidate inventory.
README and NOTICE current-inventory sections are regenerated together from the
manifest within strict markers, leaving original legal prose and attribution
outside those sections intact. Missing/duplicate markers fail collection.

Six now-unreferenced supplemental source entries are removed precisely: the
node-options-to-argv standard binding, both SPDX standard bindings and their two
README attachments, and the ansi-tokenize supplement. Their original licensing
records remain in checkpoints `45b11c5b` and `3ac02ece`; retained historical SPDX
attribution does not assert current manifest or Resources inclusion. All remaining
source bindings retain exact identity/hash checks. Native vendored composition,
remaining missing notices, corresponding-source/relinking duties, and acceptance
of a newly packaged artifact are separate unresolved obligations.

### AG-25 / S19-C packaging and native notices (Claude, 2026-10-09)

All new code here is written for this branch; no upstream or old-Margin code is
imported. Generic one-line idioms the provenance check matched are registered in
`provenance-config.json` with reasons.

- `scripts/build-local.cjs`, `scripts/margin/package.config.cjs`,
  `package-check.cjs`, `packaged-launch.mjs`, `download-ci-artifact.mjs`:
  CI-only packaging of both identities, package checks, launch check in a
  throwaway home, and download with sha256 verification.
- `scripts/ad-hoc-sign.js` (upstream): the baseline never had the
  `build/entitlements.mac.plist` it passes to codesign, so signing failed.
  Without the hardened runtime entitlements have no effect on an ad hoc
  signature; the script now signs without them when the file is absent.
- `native-module/.cargo/config.toml`: adds `-Wl,-map` so every link writes an
  ld64 map; `scripts/margin/native-link-set.mjs` reads the live inputs from it.
- `scripts/margin/libvips/`: a curl wrapper that keeps every download of the
  sharp-libvips recipe `20b5e899` with its sha256, the rebuild driver, a sharp
  smoke script and the replacement/re-sign check. The recipe itself is run
  unchanged from a clean clone.
- `scripts/margin/source-bundle.mjs`: the S19-C corresponding-source artifact.
- `scripts/margin/asar-smoke.mjs` and the `appPath` option of
  `tests/margin/launch-app.mjs`: the local launch smoke of a downloaded temp
  package's own app.asar in the repository's Electron under the X2 guard.
- `native-module/rust-toolchain.toml` pins rustc 1.98.1, the release whose
  standard library the native module links. Its notices are the Rust
  `COPYRIGHT` and `LICENSE-MIT` at tag 1.98.1 (`48a229ce`) and the
  `LICENSE-MIT` of hashbrown 0.17.1, gimli 0.32.3, addr2line 0.25.1, object
  0.37.3 and rustc-demangle 0.1.27 (the versions its `library/Cargo.lock`
  records; each file is identical in the checksum-verified crate and at the
  crate's source commit).
- Notice inputs: libfvad AUTHORS and its five distinct original file headers
  (each byte range verified against the published webrtc-vad 0.4.0 crate, whose
  sha256 matches Cargo.lock, and the local cache); the MIT licenses of
  Squirrel.Mac `0e5d146b`, ReactiveObjC `74ab5bac` and Mantle `2a8e2123`, the
  commits Electron 43.1.0's DEPS pins for the frameworks every Electron macOS
  app ships but `LICENSES.chromium.html` does not list.
- Removed as dead or redundant (S21 item 3): `electron/test/` (five live-API
  scripts that read `.env` keys, a loader and a test of regexes for the retired
  modes eval), `electron/db/seedDemo.ts` and `test-db.ts` (placeholders), and
  the source-string tests `CredentialStorage`, `PostCallSummarySafety` and
  `E2EParityEvidence`. `build-electron.js` bundles every `.ts` under
  `electron/`, so the deleted scripts were shipped inside the app.

### Stage 2 acceptance review fixes (Claude, 2026-10-09)

- The trusted-click link handler and the user-activation check for
  `openExternal` in `electron/preload.ts`, the refusal-only handlers in
  `electron/services/navigationPolicy.ts`, the verdict in
  `scripts/margin/libvips/sharp-smoke-local.mjs` and the added tests: written for
  this branch from Codex Astra's review findings, not from upstream code.
- Two generic lines are allowlisted in `provenance-config.json`:
  `return Promise.resolve();` and `const report = {`.
- `const bytes = fs.readFileSync(file);` in `scripts/margin/package-inventory.cjs`
  (written for this branch on 2026-10-08, `c49fb86d`) is allowlisted after upstream
  main added the same generic line in a test on 2026-10-10, found by the S24 local
  run's fresh upstream fetch.
- On 2026-10-10 `sharp-smoke-local.mjs` and `package-inventory.cjs` were removed
  (acceptance trimming; CI's `replace-check.sh` checks sharp on the package), and
  the allowlist entries for `const report = {` and `const bytes = fs.readFileSync(file);`
  with them.

### libvips Rust toolchain pin (Claude, 2026-10-10)

- The nightly and build-date pin and the embedded-rustc check in
  `scripts/margin/libvips/rebuild.sh` (the toolchain, mozjpeg and sha256 checks
  were made records only after run 38052543358 reproduced `64bcfea7`), and the
  `--rust-std` mode of `notice-inputs.py`: written for this branch.
- `scripts/margin/license-inputs/libvips/` gains the license files of the Rust
  standard library built by nightly-2026-10-09: verbatim files of rust-lang/rust
  at `a30aa906` (COPYRIGHT, LICENSE-MIT, LICENSE-APACHE, compiler-builtins and
  stdarch licenses) and of eleven crates.io crates, each checked against the
  sha256 in the script or the checksum in that commit's `library/Cargo.lock`. They
  are third-party license texts kept as notices, not code.

### Native module stdarch notice (Claude, 2026-10-10)

- `rust-sysroot:stdarch` in `scripts/margin/license-sources.json`: the verbatim
  `library/stdarch/LICENSE-MIT` of rust-lang/rust at tag 1.98.1 (`48a229ce`),
  checked by git blob and sha256; a third-party license text kept as a notice,
  not code.

### Upstream overlap found by CI 38052543358 (Claude, 2026-10-10)

- `const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');`
  in `scripts/margin/libvips/install-rebuilt.mjs` was written for this branch on
  2026-10-09 (`f142ca23`). Upstream `ea316087` (2026-10-10 11:33Z) added the same
  generic line, and the CI run's fresh upstream fetch flagged it. It is
  allowlisted as a generic sha256 helper; nothing was taken from that commit.

### Stage 2 re-acceptance fix (Claude, 2026-10-10)

- The declared-URL check for `openExternal` in `electron/preload.ts`, the
  `data-external-url` attributes on its callers and the timer and undeclared-URL
  cases of the navigation test: written for this branch from Codex Astra's
  re-acceptance finding, not from upstream code.
- `const timer = setInterval(() => {` in the test is allowlisted as a generic line.
- The first gate run also hit `const STT_KEY_URLS: Record<string, string> = {`: a
  map of speech-provider key URLs moved out of the button's click handler in
  `SettingsOverlay.tsx`, and later upstream code in the same file has a line with
  the same name. It was not allowlisted; the map stays inside the component as
  `sttKeyUrl`, its entries unchanged from the baseline.

### S22 shipped libvips rebuild (Claude, 2026-10-09)

- `scripts/margin/libvips/install-rebuilt.mjs`, `fetch-prebuilt.mjs`,
  `notice-inputs.py` and the drift checks in `rebuild.sh`: written for this
  branch. `notice-inputs.py` only reads the recorded source archives and crates.
- `scripts/margin/license-inputs/libvips/*.txt`: verbatim license files of the
  libraries and crates statically linked into the shipped libvips-cpp, each
  bound in `scripts/margin/libvips/notices.json` to its archive URL, archive
  sha256 and member path (crates: the librsvg `Cargo.lock` checksum). Third-party
  license text, not implementation code.
- `scripts/margin/libvips/librsvg-Cargo.lock`, `librsvg-compiled.txt` and
  `expected-sources.tsv`: records of run 37871598165's rebuild, used as the
  drift reference.

### S21 dependency removal

S21 removes the root production declarations `pdf-parse` and `mammoth`. Their
only caller in the baseline was the mode reference-file parser in
`electron/ipcHandlers.ts` (`a786910e`), deleted with the mode system in AG-13
(`5c17d80d`). After AG-13 no file under `electron`, `src`, `scripts` or `tests`
imports `pdf-parse`, `pdfjs-dist`, `@napi-rs/canvas` or `mammoth`, statically
or through `require`; `npm ls` showed `pdf-parse` as the only path to
`@napi-rs/canvas` and `pdfjs-dist`. Removing it takes `@napi-rs/canvas` and its
bundled Skia out of the package, which closes the canvas part of S19-C without
recovering its missing historical dependency records.

`npm uninstall --offline` with install scripts disabled removed 33 lock nodes
(11 canvas packages, pdf-parse, pdfjs-dist, mammoth and its 19 exclusive nodes)
and added none. No retained package changed version, resolved source or
integrity. Three retained nodes became development-only (`@xmldom/xmldom`,
`core-util-is`, `path-is-absolute`) and the root dependency list lost the two
entries. npm's key reordering was undone mechanically, keeping parsed values.
The collector's candidate inventory fell from 726 to 699 (the 24 removed nodes
installed on this platform plus the three now development-only); the 25 texts
no longer referenced were deleted with it. G3 rule set S21 forbids the four
package names in the dependency tree.

### AG-26 original-notice supplements

Twenty-six source entries supplement format 0.2.2 and oboe/oboe-sys 0.6.1.
format retains its exact commit `4f898096759776b7c84fa7a25b13c923dadfe46e`
README License section (Copyright 2010 - 2014 Sami Samhuri) and JavaScript
header (Copyright 2010 - 2013 Sami Samhuri), including the original MIT links.
The complete fixed official SPDX MIT text supplies standard terms, leaving its
copyright template placeholders unfilled; it neither replaces those original
declarations nor claims the changing linked website is a same-version grant.

Each Oboe wrapper keeps its own original Apache declaration at commit
`7ea2b9b3bc9cdfa9ed4cbfeafdcafb47b3fac4e7` and a separate exact-version
binding to the full official Apache-2.0 text. Author metadata does not become
a copyright notice; the Apache appendix placeholders remain standard
instructions. The wrapper's Google Oboe gitlink
`86165b8249bc22b9ef70b69e20323244b6f08d88` supplies its own complete
LICENSE/AUTHORS/CONTRIBUTORS. Google Inc. attribution does not replace the
Android Open Source Project's 16 distinct original Apache license comments.

All 140 cached vendor files match the exact Git tree blobs: 138 C++/header files
retain their complete leading license comments, and the remaining two README
files contain no additional copyright/license declarations. The exact tree is
not truncated and has no NOTICE. The source-byte inventory and 16-group mapping
are in `scripts/margin/license-inputs/original-notices/coverage.json`; these
checks are not a static-link, target-graph or distributed-binary determination.
The header range is byte zero through the closing `*/` inclusive; subsequent
non-license separator bytes are excluded without normalizing the comment.

Twenty repository-local input containers hold only original licensing bytes
followed by an explicit marker, never implementation source. Each container's
source URL/ref, complete source SHA-256/Git blob and exact byte range are
recorded. The unchanged collector checks input and extracted-text hashes,
copies only bytes before the marker, and retains its strict canonical component
identity checks. The extra provenance fields and 140-file coverage are audited
separately, not falsely represented as automatic collector checks.

Three additional sources retain later official notices without changing package
versions. dingbat-to-unicode's owner explicitly applies the 1.0.2 license to all
previous versions in issue 1 comment 5740760399; its original Copyright (c) 2021
Michael Williamson BSD-2-Clause LICENSE is bound to 1.0.1. stream-events PR 5
merge `3cfd35ab1a68c9fd41c992428e839ad54dcf8017` keeps version 1.0.5 and all
four installed files byte-identical; stubs PR 5 merge
`580b4d8b3a34c1193d5ec10e0db0d6ea4b4c0ec5` keeps version 3.0.0 and all four
installed files byte-identical. Both retain their original Stephen Sawchuk MIT
copyrights (2018 and 2017). This does not assert LICENSE was in the original npm
tarballs. (S21 later removed mammoth, and with it dingbat-to-unicode and this
binding; see "S21 dependency removal" below.)

tr46 0.0.3's original MIT LICENSE at same-version commit
`3a6f29721e7063b9ffd421e461a54beae6170001` keeps Copyright (c) 2016 Sebastian
Mayr. The installed package.json and index.js match that commit; the installed
mappingTable.json (SHA-256
`b6b39724dca9011113a08d9d6910204062b58169e98952acdfbd19bf2c31bbff`)
is reproduced using its documented converter from the official Unicode IDNA
8.0.0 data (793222 bytes, SHA-256
`5e9f5929130b713e698162ac5b60a99ccfb831606686b1c50777cd920b55dee2`).
The original data header keeps Copyright (c) 1991-2015 Unicode, Inc. and its
terms-of-use/source links. The current complete Unicode License v3 (1995 bytes,
SHA-256 `e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96`)
retains Copyright 1991-2026 Unicode, Inc. unchanged. The current official policy
applies v3 to /Public/ Data Files unless another license is indicated; the 8.0
header refers to terms_of_use without naming a different license. This current
coverage does not assert v3 was adopted in 2015 or interpret an upgrade advice
as a retroactive grant. Only the header, not data rows or implementation, enters
the new notice input container. The policy and mapping reproduction are separate
source evidence, not claimed as automatic collector validation.

These 32 new source entries close only seven missing-text entries; dependencies,
lockfiles, collector/checker/runtime/tests/CI code and candidate/excluded
identities are unchanged. Other missing notices and native composition, corresponding-source,
relinking, NOTICE and actual package acceptance obligations remain open.

AG-26's notice collector, package-byte checker, synthetic tests and rewritten
public documents are written for this branch from PLAN's license/documentation
contract and Node standard-library APIs. They import no later application
implementation. License texts retain their package/cache origins or official
immutable references in `licenses/manifest.json`; they are third-party licensing
material, not newly authored application code. Candidate coverage is kept
separate from the actual packaged set and from copyleft source/relinking duties.
Electron's full installed-version notices are copied through `extraResources`
and verified inside Resources before the existing signing hook runs, without
checking the large Chromium file into this repository. This byte check does not
fix or endorse the existing signing behavior, which remains a separate ticket.
The first AG-26 scanner run matched retained standard MIT terms. Fourteen exact
license clauses were reviewed against installed `retry@0.12.0` and
`better-sqlite3@12.11.1` license texts (SHA-256
`01ad164273e8e095abc9dbd1c21e194594a671af7d528cb43ee7b4c903ba7da3` and
`09856b52897c91ab67e7456ef43067019f31dfd3b87fda72e655736b1ebdee55`).
Only the exact reviewed clauses were allowlisted. Three separate generic
matches are the public heading `## Provenance`, the documented existing command
`node scripts/build-electron.js`, and `return found;` returning the collector's
local set. No source pool or path exclusion was broadened.
The final source scan found three additional generic lines: the synthetic test's
`fs.mkdirSync(path.dirname(destination), { recursive: true });`, `await sleep(1000);`
in the original `agent-base@6.0.2` README, and `## Installation` in the original
`isarray@1.0.0` README. The two full READMEs preserve embedded MIT attribution;
their source bytes match inventory hashes `f1425c3b72330fe4fb2aa5a2fb152e939bdf534692a32b5f0b38f74147b98556`
and `ff138e683771b187f3629c383db72ee7d632009010a36d08e18e8d2a34222ec7`.
Only those three exact generic lines were additionally allowlisted.
The exact `licenses/texts/*.txt` Git attributes disable text conversion and
whitespace rewriting for the retained third-party bytes. CRLF and original
trailing spaces remain part of their hashes; ordinary code whitespace checks
are unchanged. Five obsolete collector-generated text hashes, proven absent
from the final manifest references, were removed individually before packaging
configuration was frozen. No arbitrary notice or user artifact was cleaned.
`license-sources.json` separately records the original free-cluely Apache text,
the installed protobuf Google BSD header, authoritative BlueOak terms, libvips
source terms/version metadata, canonical LGPLv3 plus its GPLv3 companion from a
fixed official SPDX commit, and the exact canvas Skia-gitlink LICENSE/AUTHORS.
The later ansi-tokenize add-missing-LICENSE is explicitly supplemental, not
represented as part of the installed 0.1.3 release. Missing exact-version texts
and native distribution obligations remain unresolved and block completeness.
An offline replay exposed a collector cache mismatch for `cidre-macros`: its
cached manifest omits repository metadata while the previously checked official
source is `yury/cidre`. The reviewed fixed repository mappings now apply before
both collection and cache comparison. A synthetic missing-repository replay
failed before that change and passes afterwards, retaining version/checksum,
exact source URL, SHA-256 and Git-blob checks rather than weakening reuse.

### AG-26 authorized removals

Only the following PLAN-listed tracked files are removed. Each entry was checked
against the index before deletion and can be recovered from commit
`a623e3f79cbb31b6461eb43e7c3e386b8c99dd11` using its exact path. The `.mcp.json`
entry was inventoried by metadata only; its contents were not read or printed.
`CHANGELOG.md` and root `LICENSE` are preserved. No model, user data, credentials,
training output or unlisted file is removed.

| Path | Previous Git blob |
| --- | --- |
| `AUDIO_RELIABILITY_REPORT.md` | `82d96691f688b0cc3923b7769862c32eb0dd645f` |
| `AUDIT.md` | `0005221e83b2347c3a176187b9d605bd75672932` |
| `CROSS_PLATFORM_AUDIT.md` | `132b02b258701420f16274831124dfcb52008cc3` |
| `CROSS_PLATFORM_REVIEW.md` | `87b5187d193a7906a90a2c86bd5ceeec573919ad` |
| `QA_REPORT.md` | `e7c398ce6b36c7caf5e2f92ca1e4a8d45285a9f6` |
| `QAautomationprompt.md` | `c5773025a65b21f5fea14ec886276dc1baf8aa52` |
| `TOFIX.MD` | `66cbbc786bca56c500882c95a24d33bed63e06a3` |
| `apple-signing-report.md` | `7bc953c7ded21f1c10b6301bfb3edff179c0cfe8` |
| `changes.md` | `13047adf244e42e3eeec00361e31eff6c9b0e334` |
| `cluelyresearch.md` | `b18e86369d2bd75e5a621357d9266fa9422f4bde` |
| `comparisonreport.md` | `bdf439c4603b8101978b8626813f5ee4ad936687` |
| `fixreport.md` | `326039f8f60c9fa68c554ff7bd8511e08d9ea7ab` |
| `promptfix.md` | `8fe1aba8dfff40ba987f27f758688ae96e1ba4ec` |
| `report.md` | `925429251a7077c6511d706fdc49a789eea85bb9` |
| `tinypromptsreport.md` | `6196257432fd11b8614d7c2fc2af8fe35dc5eff6` |
| `visionpipelineresearch.md` | `889987f9b7177ce3d8b4fc2f95ac29adc0b4d610` |
| `visionupgrade.md` | `2357b7ce9b404fee042586e40243bf45b97b3a3d` |
| `refund.md` | `d0f3250d638de93faf7f405b3c2a877ab81ed2bd` |
| `termsandcondition.md` | `595c9d94e8f6176b7af09c16ed9bc262e731caf8` |
| `ROADMAP.md` | `beb363859c91809625275a0c13feb732dc883b84` |
| `.mcp.json` | `905d844840a9794b6fa1a93ca5608759c36bc29d` |

AG-24's outbound boundary, STT revocation distinction, Markdown image rejection,
endpoint inventory and synthetic behavior tests are written for this branch from
PLAN's requirements and the installed libraries' public interfaces. No later
upstream implementation is imported. The scanner's exact generic matches are
individually justified in `provenance-config.json`; no source pools or exclusions
are widened. The Google service-account validator, minimal public SDK options,
startup/selection integration and GoogleServiceAccountBoundary/OutboundInventory
tests are written from the user-approved PLAN S16 contract, Node standard APIs
and the installed libraries' public interfaces. Legacy account/project/universe
compatibility and synthetic transport checks are documented in [OUTBOUND.md](OUTBOUND.md).
These implementation checks alone are not evidence that the AG-24 exit has passed.
The S16 scanner's two exact generic statement matches are an event-loop drain
(`await new Promise(resolve => setImmediate(resolve));`) for synthetic streaming
cleanup and `return saved;` for the real persistence result in a file-change test
hook. Both were written for this branch; only these exact statements are added
to the allowlist, without widening any source pool or exclusion.
The independent serial `outbound-renderer` run-gates step is written from AG-24's
existing real-renderer regression and the runner's existing isolated Electron
step format. It adds only the precise Electron/esbuild execution capability and
a bounded timeout, so local full gates and CI retain this behavior check.
AG-24's bootstrap follow-up defers outbound/Axios module evaluation until the
identity and main log boundary are installed, but still installs fetch policy
before main/SDK evaluation. The identity VM records this dependency order; the
logging VM evaluates the real outbound source with a synthetic Axios import-time
canary, retaining existing real-bundle and privacy checks. This repair and test
adaptation were written for this branch after the first full-gate failures.
AG-24's AG-09 harness follow-up is written for this branch using Node promises
and the existing loopback mock. Separate browser polling and text reads can miss
a short partial state; a synthetic slow-observation diagnostic recorded a real
DOM partial before completion while the old sampling assertion failed. This is
a counterexample to the old observation method, not a reconstruction of the
original full-gate failure's complete timing. The test-only `afterChunk` gate
pauses the mock after two writes until the real renderer's partial is asserted,
then releases the tail; it does not change production streaming or its delays.
The hook is captured per request, reset by `setScript`, and released in the
test's `finally`. The red diagnostic, six-case green regression and hook
snapshot/reset self-check logs are archived by the main gate workflow; they do
not replace fresh full-gate or CI acceptance.

AG-20 is written on this branch from PLAN's application-identity requirements;
no earlier Margin implementation or icon asset is imported. The initial scanner
output is retained in `evidence/AG-20/checks/precommit-1/provenance.log`. Its five
matches were reviewed individually: `const electron = {` and the `const script`
template-literal opener are test scaffolding, `return require(id);` forwards a
CommonJS module load, `fs.mkdirSync(userData, { recursive: true });` uses Node's
standard recursive directory creation, and `for (const name of names) {` is a
JavaScript iteration statement. Only these exact lines were allowlisted; source
pools, approved files and scan exclusions were not widened.

Stage 1 review 8 is written on this branch from the scope-refusal behavior requirements.
The old Margin branch was inspected as a behavior reference, not copied. Four source
scanner matches are generic JavaScript: `signal?.throwIfAborted();` (the native
AbortSignal cancellation check), `lastError = error;` and `throw lastError;` (retain
and rethrow the final sequential-attempt error), and `const policy = { transcript: false };`
(one-field synthetic test policy). These exact lines are individually
allowlisted in the scanner configuration; matching them is not evidence of copying.

Rows are added as code is brought in. "Check" is what was done to confirm the source.

| Item on this branch | Source | Basis | Check | Commit |
| --- | --- | --- | --- | --- |
| Whole tree at branch start | Upstream `a786910e` | AGPLv3 | [BASELINE.md](BASELINE.md) | `a786910e` |

## AG-22 credential save transactions

The transaction changes, shared result types, IPC result handling and renderer
callbacks are written on this branch from PLAN's AG-22 requirements. No earlier
Margin or restricted upstream implementation was imported. All 22 setters build
a candidate object; memory changes only after encrypted temporary-file write and
rename succeed. An unread existing ciphertext locks subsequent saves until a
successful reload. Temporary paths use Node's `randomUUID`, exclusive creation
and mode `0600`; an `EEXIST` collision never transfers ownership of that path.

The existing plaintext cleanup behavior is retained, with no plaintext read or
fallback. Independently supplied environment credentials remain an authentication
source, not a claim that an unsuccessful opportunistic save succeeded.

`src/types/credentialSave.ts` defines the saving result used by both preload type
surfaces and all save consumers. A service-account dialog cancellation is an
independent `{ cancelled: true }` branch. Successful selection adds `path`.
Runtime application is attempted only after successful persistence; a failure to
apply returns `ok: true` with a fixed, non-sensitive `warning`, not `write_failed`.
A provider switch without a new key does not claim any credentials were saved.

| Stored values / entry point | IPC and renderer callers covered |
| --- | --- |
| Gemini, Groq, OpenAI, Claude, DeepSeek keys (5 setters) | Five `set-*-api-key` handlers; `switch-to-gemini` with a new key; AIProvidersSettings Save/Remove and ProviderCard auto-save / save-before-Fetch |
| Google service-account path | `select-service-account` and SettingsOverlay selection; main startup's environment-path save checks its result without disabling environment authentication |
| STT provider; Groq/OpenAI/Deepgram/ElevenLabs/Azure/IBM Watson/Soniox keys (8 setters) | `set-stt-provider`, seven key handlers; SettingsOverlay selection, validated Save and Remove |
| Groq STT model, OpenAI STT URL, Azure region, IBM Watson region (4 setters) | Corresponding four save handlers; SettingsOverlay model, URL and Azure region controls; IBM region has no current renderer call |
| STT language, AI response language (2 setters) | `set-recognition-language` through AppState and `set-ai-response-language`; SettingsOverlay explicit changes and detected-language save |
| Default model, per-provider preferred model (2 setters) | `set-default-model`, `set-provider-preferred-model`; AIProvidersSettings default selection and ProviderCard manual / fetched-model selection |

The behavior regression uses the installed TypeScript compiler and existing
`node:test`/VM pattern. It executes the real manager and production IPC, preload
and renderer callback bodies with synthetic dependencies; the original
source-pattern-only credential checks were replaced by these behavior checks.
Coverage includes all 22 setters and 23 IPC/bridge entry points, eight storage
failure cases, a warm-instance reload chain, partial-temp cleanup, `EEXIST`,
legacy plaintext non-use, stopped downstream effects, UI non-commit, warnings,
cancellation, and the full manager-to-renderer failure path. STT connection
validation remains before persistence; a validation result is not a Saved state.
These checks do not claim real keychain, provider or device acceptance.

The first source scan matched five occurrences of four generic statements:
`const appState = {` and `const context = {` open test dependency objects;
`const source = read('electron/main.ts');` reads the local callback under test;
`if (!result.ok) {` branches on the result explicitly required by AG-22. Each was
written independently for this branch. Only these exact statements were
allowlisted; source pools, approved files and exclusions were not broadened.

## AG-23 application log privacy boundary

The shared console installer (`electron/utils/consoleLogging.ts`), main-process
logging entry (`electron/logging.ts`), renderer entry (`src/logging.ts`), opaque
payload summarizer and log-evidence helper are written on this branch from
PLAN's AG-23 requirements. No earlier Margin or restricted upstream logging
implementation was imported. Existing bootstrap, main, preload, IPC, renderer,
audio and Rust modules are adapted in place from their versions on this branch;
their earlier provenance remains recorded by this ledger and Git history.

Application console payloads are reduced to type metadata and string length,
without string previews, primitive values, object keys, messages or stacks.
Errors are opaque objects too: no unknown object's prototype is inspected.
Only code-controlled event labels are retained. Main logging is installed before
business imports, and file output is enabled only after application identity
initialization. Renderer main-world and isolated preload consoles each install
the shared boundary. Sanitizer and sink failures do not fall back to raw
payloads; verbose mode controls safe forwarding, not payload privacy. The log
viewer uses the same identity-specific `logs/debug.log` destination.

The raw ElevenLabs development PCM dump and explicit meeting/transcript debug
prints are removed. Native changes remove dynamic device identifiers/names and
raw error/panic payloads from application-owned log statements. Returned errors,
JavaScript error notifications and audio recovery paths remain unchanged.
This boundary does not claim to intercept arbitrary raw file-descriptor writes,
Chromium/OS output, third-party-library output or a provider CLI's own logs.

`electron/margin/__tests__/loggingPrivacy.test.mjs` and the replacement behavior
checks in `electron/services/__tests__/RedactForLog.test.mjs` are written for this
branch using the installed TypeScript compiler and existing `node:test`/VM
pattern. External services, paths, processes and payloads are synthetic; the
built-bundle check uses the current application bundles, not imported fixtures.
The existing identity harness is adapted to keep its isolated identity tests
separate from process-wide logging. The startup harness retains its independent
error recorder and checks exact controlled critical-event counts in production
file/terminal output without requiring raw probe text there. In the same isolated
startup, synthetic canaries exercise main-process stdout/stderr and file logging
and both launcher/settings main-world consoles. Playwright console events must
contain the expected metadata line, so suppressing all renderer output cannot
satisfy the check. All captured production exits must exclude the canary text.

These checks are not real-provider, device or keychain acceptance. A pre-existing
local native binary cannot verify these Rust source changes; new native behavior
requires a build of the changed source. The eight changed Rust files, including
the Windows branch, pass installed `rustfmt --emit stdout` parsing with child
module traversal disabled; this is not a formatting or compilation result.
macOS native CI does not compile the Windows-specific branch. No new source
pool, approved file or scanner exclusion
is added for AG-23.

The first AG-23 source scan found four occurrences of three generic statements.
`await Promise.resolve(); await Promise.resolve();` drains the synthetic preload's
two asynchronous verbose-flag callbacks in two tests. `stt.isActive = true;
stt.isSessionReady = true;` selects the existing audio-write branch on a synthetic
ElevenLabs instance, without opening a provider connection. `const dirname =
path.dirname(fileURLToPath(import.meta.url));` resolves the test module's directory
using Node standard-library APIs. Each statement was independently written for
this branch; none imports a restricted implementation. Only these exact lines
are individually allowlisted, not broader files or source pools.

## AG-21 icon sources and generated assets

Only the following four files are approved from the earlier Margin commit
`cbb92b8ae1a310ae1af3323d45b2990757d781d9`. Each first appears in that commit;
the path history contains no earlier revision. The SVGs contain local geometric
shapes and an SVG shadow only, with no external links, embedded images, fonts or
upstream assets. The original generator uses Node standard-library functions,
the existing `sharp` dependency and macOS `iconutil`. Both the pre-import review
and this implementation inspected the complete four files. No generated binary
was copied from the earlier branch, and the commit as a whole is not approved.

| Imported path | Original Git blob | Basis / adaptation |
| --- | --- | --- |
| `scripts/icons/app-icon.svg` | `2ed3dff8702b205f5778d790cafe2f30959b97ec` | Margin-authored app geometry; copied verbatim |
| `scripts/icons/app-icon-small.svg` | `23f3c0c24040af4b8c8203700f5e1bd8f0d533b0` | Margin-authored 16–32px geometry; copied verbatim |
| `scripts/icons/glyph.svg` | `85ca117c975155b7df33f9f91154bc5a3b86f3a9` | Margin-authored rule and two bars; whitespace-only blank line normalized |
| `scripts/icons/generate.mjs` | `098beb1d465ffb28bd2804f32e2d954f5ca1e545` | Adapted on this branch: URL decoding with `fileURLToPath`, output-directory creation, precise temporary-directory cleanup on failure, removal of unused output copies, lossless WebP and a SHA-256 manifest |

The public repository `xbz123/margin` holds only this branch (PLAN S25), so the
earlier commit is not there. The four original files are checked in unchanged
under `docs/margin/approved-sources/cbb92b8a/` (outside the scanned paths), and
`provenance-config.json` records each one's blob id. `provenance-check.mjs` reads
the approved lines from these copies after checking that each copy hashes to its
blob id and, where the commit is present, that the file at the commit does too.
The approved pool is unchanged (128,377 line keys).

The inline geometry in `src/components/NativelyLogoMark.tsx` comes from the
approved `glyph.svg`, with `currentColor` replacing the fixed black fill. The
internal component name is retained. Consumer-path and Retina tray changes and
the asset checks are written on this branch from PLAN's AG-21 requirements.

The first AG-21 source scan reported three exact common statements. The Linux
restore expression `? path.join(process.resourcesPath, "assets/icon.png")` joins
the packaged resource root to the existing `assets/` destination configured in
`package.json`; the test loop `for (const platform of ['darwin', 'win32', 'linux']) {`
enumerates Node's platform identifiers; and `schemaVersion: 1,` is the initial
version field of the new generated-asset inventory. All three were written for
this branch, not imported from restricted sources. Only these exact statements
are allowlisted; no source pool or scan exclusion is expanded.

Generated output paths (all regenerated from the approved SVGs on this branch):

- `assets/margin.icns`, `assets/icon.png`;
- `assets/icons/png/icon_16x16.png`, `icon_32x32.png`, `icon_64x64.png`, `icon_128x128.png`, `icon_256x256.png`, `icon_512x512.png`, `icon_1024x1024.png`;
- `assets/icons/win/icon.ico`;
- `assets/iconTemplate.png`, `assets/iconTemplate@2x.png`;
- `src/components/icon.png`, `src/assets/logo.png`, `src/assets/logo.webp`.

The machine-readable source and output SHA-256 inventory is
[`scripts/icons/generated-assets.json`](../../scripts/icons/generated-assets.json).
Reproducibility checks regenerate twice in synthetic output directories with the
same installed toolchain and compare their manifests and bytes. This does not
claim byte-for-byte reproducibility across different OS or image-library versions.

### Removed unused Natively icon copies

Consumers were searched before removal. These are inherited N-circle app/icon
copies, confirmed through their PNG counterparts and the old website logo. The
paths below are Git-recoverable; no disguise, third-party or demonstration image
is removed. Existing referenced app/Linux/Windows and UI raster paths are instead
regenerated with Margin artwork as listed above.

| Removed path | Previous Git blob |
| --- | --- |
| `assets/natively.icns` | `61ee4b077d786f6d0b45a77caae3d9d2a1174f33` |
| `assets/icon.icns` | `b2fa79d71f727840d429fa8fb5ed5cfc4756977b` |
| `assets/icons/mac/icon.icns` | `b2fa79d71f727840d429fa8fb5ed5cfc4756977b` |
| `src/components/iconTemplate.png` | `8a13bfcdd2cb8fa91851980ca430733efdb3e3c2` |
| `src/assets/logowebsite.png` | `764299a58b4fef2f7d81e1dcfd75f4621cd30beb` |
| `src/icons/AppIcon.icns` | `b2fa79d71f727840d429fa8fb5ed5cfc4756977b` |
| `src/icons/icon_16x16.png`, `src/icons/natively.iconset/icon_16x16.png` | `15e04c9acff82e6446792fb805b1d6e43a0c1762` |
| `src/icons/icon_32x32.png`, `src/icons/natively.iconset/icon_16x16@2x.png`, `src/icons/natively.iconset/icon_32x32.png` | `d307942549af45202d72f60ea002465fd495bc3b` |
| `src/icons/icon_64x64.png`, `src/icons/natively.iconset/icon_32x32@2x.png` | `1a5e10c9e63832249239b6da332d8979b3163f57` |
| `src/icons/icon_128x128.png`, `src/icons/natively.iconset/icon_128x128.png` | `5a242b4846ddb447b4449b2e593b13bc79fd2f1a` |
| `src/icons/icon_256x256.png`, `src/icons/natively.iconset/icon_128x128@2x.png`, `src/icons/natively.iconset/icon_256x256.png` | `3e1a8b3ee6af22ecbc94043bb7b5d1efb41d6401` |
| `src/icons/icon_512x512.png`, `src/icons/natively.iconset/icon_256x256@2x.png`, `src/icons/natively.iconset/icon_512x512.png` | `b9244807cf374bbc03746596f42d72343d87ead3` |
| `src/icons/icon_1024x1024.png`, `src/icons/natively.iconset/icon_512x512@2x.png` | `f88e0e952f0e86b8de525bbd852f548e493ea255` |

## Earlier upstream: free-cluely

Natively's first commit (`0a73eb77`, 2026-01-27) has the Electron skeleton of [Prat011/free-cluely](https://github.com/Prat011/free-cluely), which is under the Apache License 2.0: the same file names (`main.ts`, `preload.ts`, `ipcHandlers.ts`, `LLMHelper.ts`, `WindowHelper.ts`, `ScreenshotHelper.ts`, `ProcessingHelper.ts`, `shortcuts.ts`) and structure. A line comparison against free-cluely `0ba93eff` (2025-12-05) found:

| Tree | Electron substantive lines | Same as free-cluely |
| --- | --- | --- |
| Natively `0a73eb77` | 5,104 | 1,004 (20%) |
| Baseline `a786910e` | 37,184 | 1,136 (3%) |
| Earlier Margin `b8ade3f7` | 77,408 | 656 (0.8%) |

The baseline credits neither free-cluely nor the Apache License. Apache-2.0 §4 requires keeping its license and attribution, so a NOTICE entry is added in phase 2. free-cluely covers none of the post-June code, so it does not reduce the rewrite.

## Open license questions

1. **The MIT authorization in the earlier Margin README.** Not seen; not relied on here.
2. **The status of 1–24 June 2026 upstream commits.** Not used. Revisit only with legal advice.
3. **Bundled third-party assets** (the Inter font under `src/font`, icons and images under `assets/` and `src/icons`). Each keeps its own license file. Their licenses are rechecked before any release.
