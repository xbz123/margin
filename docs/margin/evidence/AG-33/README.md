# AG-33 — answer lifecycle and image admission

Starting commit: `060061497153de763c90e65b3f95c4bec909e76f`.
The code changes and local gates have passing evidence. The S12/S27 prompt
decision, Claude review and stage-exit acceptance remain pending.

## Scope and requirement source

PLAN S27–S28 and `b8ade3f7:docs/fresh-release-implementation-plan.md` sections
3.1–3.2 define the retained behavior. This ticket covers text/image questions,
written tasks, streaming, cancellation, late-event isolation, partial output
and actual target/terminal metadata. Full Local Context capacity, Skills and
incremental meeting storage remain later-stage work.

Trace all paths through LLMHelper / GenerationTask, IntelligenceEngine,
IntelligenceManager, main event batching, IPC, preload and the three consumers:
NativelyInterface, GlobalChatOverlay and MeetingChatOverlay. A cancelled or
superseded task cannot append text, finish or report an error into another task.
Failures preserve received text, and manual retry creates a separate answer.
Valid short answers are not replaced with fabricated clarification text.

Image admission uses the actual target, including any explicit backup.
Known unsupported targets are refused before sending. Unknown or compatible
targets require the user's explicit image-support confirmation, bound to the
model/protocol/endpoint; edits invalidate that confirmation. Failure preserves
input and attachments, never silently removes an image or chooses another
vision model. S27 replaces image-path source-spelling tests with actual handler
negative cases and positive controls.

The default-answer suffix and the two other S12 prompt passages remain unchanged
pending the user's direct decision. No real model quality comparison is run.

## Verification

`gates-final/` records 15/16 passing steps: 112 unit files, 925 tests, 920 passed,
zero failed and five existing skips; no isolation-blocked or unfinished tests.
AG-09 passed 15/15, storage 5/5, startup 1/1 and renderer outbound/component
checks 3/3. Build, both typechecks, retirement and IPC/preload checks passed.
Only G2 failed on two occurrences of one public-API idle assertion; its exact
registration was reviewed. `provenance-final/` then passed G2 (zero hits) and
diff-check on unchanged application/test source and build. This is combined
passing evidence, not a single 16/16 run.

`targeted/ag33-test-migration-map.md` maps retired or adapted checks to their
replacement behavior evidence. Final targeted checks are 224/224, storage 5/5
and SQLite save/load/save/load 1/1. Earlier failures remain in distinct files.
No new skip, dependency or native change was introduced; G7 reuses the accepted
installation. Published logs mechanically normalize machine-specific paths;
raw copies are retained locally, with counts/errors/exit codes unchanged.

Tests use X2 synthetic
HOME, temp identity, fake credentials and loopback transports only. No native
rebuild, dependency change, local package build, installation or CI is part of
this ticket. Claude review and phase-exit packaging remain separate.

## Failures found during implementation

- The actual built Engine replaced valid short answers with a canned response
  and could flush a held sentinel prefix after outer cancellation. Targeted
  behavior tests exercise the real helper/Engine path, not source spelling.
- A follow-up metadata assertion initially failed because a test stub discarded
  the new argument. The successful-session path must pass metadata explicitly
  from the helper; a separate bundled module's AsyncLocalStorage is not assumed
  to be the same instance.
- `critical-03.log` records seven targeted cases with one failure: an explicit
  server `unsupported_image` error combined with HTTP 503 sent to both A and B.
  Image rejection must remain terminal regardless of that transient status.
  The other six cases passed, including second-step timeout overriding an
  earlier completed state and distinct same-provider backup confirmation.
- Read-only boundary tracing found missing image validation on ordinary chat
  IPC and a validator fallback that accepted an app-prefixed symlink even when
  its real target escaped the app directory. Handler behavior evidence and
  positive screenshot controls are required before accepting the repair.
- `targeted-02.log` caught an inherited-object-property admission bug: the model
  ID `toString` was treated as a known capability because lookup read the
  object's prototype. The table must use own-property membership. This is a
  real rejection failure, not a relaxed fixture expectation; fresh-build green
  evidence is required after the fix. `codehint-red-01.log`, despite its name,
  was a passing control and is not red evidence.
- Reachability review found that ProcessingHelper's written-task budget alone
  was insufficient: its legacy success events have no current React consumer,
  while the visible screenshot action routes through WhatToSay. Written mode
  must therefore be reachable through the retained text/image interface and
  select the written budget at the real IPC entry, not merely pass an internal
  ProcessingHelper test. No legacy Solutions page is restored.
- The first integrated GUI run (`gui-01.log`) passed 10/14. WhatToSay rejected
  with AbortError, its scope-refusal display timed out, and retry after image
  confirmation timed out. The written-budget inspection also accidentally
  required a second bundled main module and attempted to register duplicate
  keybind handlers. That inspection is not budget evidence and must not be
  repaired by exposing a new production test API. Each application failure
  remains pending until its actual cause and green control are recorded.

The WhatToSay cause was ownership: the older handler closed the inherited task
while the new outer IPC wrapper still awaited it. Only the owner now closes it.
The image-confirmation retry was suppressed by the same-text double-submit
window; failure and cancellation now clear that window so explicit retry creates
a new request. The second GUI run and final AG-09 verify both repairs. Written timing is
checked by the real registered handler and real GenerationTask (180,000 ms,
no interview first-token timer), plus delayed mock responses through the actual
text and auto-captured-image UI. This is deadline behavior, not a latency claim.

Intermediate evidence: `targeted-04.log` reports 126/126 passing targeted tests.
`component-03.log` passes the real Global/Meeting React component test covering
partial failure, actual target/timeout display, a separate retry record, forced
late callbacks after close and no invocation when closing during the delay.
Neither intermediate run substitutes for the frozen-source full gates.

`gates-first/` is retained failed evidence: 13/16 steps passed. The 112-file unit
inventory reports 922 tests, 891 passed, 26 failed and five existing skips.
AG-09 passed 15/15, startup 1/1 and renderer 3/3; builds, typechecks, retirement,
IPC/preload and isolation checks passed. G2 found four occurrences of three
new generic test statements, reviewed and registered separately. Unit failures
include outdated task doubles, unconfirmed synthetic image targets and source
checks tied to old signatures/batch shapes; replacements must retain their
original safety assertions. Storage passed 3/5: the meeting-chat refusal
observer timed out, so the later recovery assertion also lacked the prior chat
answer. Neither failure is silently accepted as an inherited baseline.

Independent persistence tracing also found a real new representation mismatch:
`getMeetingDetails` returns nested `usage.generation`, but `saveMeeting` only
recognized flat generation fields. Startup recovery reads and re-saves this
data, losing metadata. The repair must preserve both supported forms and show
the saved outcome in MeetingDetails without changing the recovery algorithm or
introducing an AG-52 storage schema.

The 26 unit failures were traced to three old source-shape expectations,
15 Engine doubles missing the new task interface, and eight image tests lacking
explicit capability admission. Image serialization, scopes, cancellation and
sentinel assertions remain; synthetic image-capable targets are explicitly
configured instead of treating the known text-only Groq model as visual.
`gates-failed-targeted-02.log` passes all 150 checks in that collection.
The storage observer was listening as `natively` while the real MeetingChat
request was owned by `meeting`; only the observer was corrected and a visible
page-error assertion added alongside the unchanged zero-send check.
`storage-04.log` passes 5/5, including actual startup recovery of nested
generation metadata and its incomplete/timeout display in MeetingDetails.
`db-roundtrip-03.log` passes the SQLite save/load/save control.

An additional real task-fence regression was reproduced in
`engine-mode-red-01.log`: timeout and model switch left the Engine in
`what_to_say` because aborted inner work was correctly forbidden from resetting
mode but no outer cleanup owned that reset. Cleanup must set idle only while
the finishing task still owns the Engine; an older finalizer must leave a newer
task untouched. Idle must be delivered before terminal removes renderer routing.
These cases require fresh-build checks and the second full gate run.

## Official image-capability evidence (2026-10-10)

These facts apply only to the named model at its official endpoint. They do not
authorize inferring capabilities from a similar model name or a compatible
server. Pages were searched and opened; DeepSeek's page opener failed, so its
official HTML was fetched directly with `curl` and the relevant text read.

| Exact model | Image-input evidence | Source |
| --- | --- | --- |
| `gpt-5.4` | Image input, text output; Chat and Responses endpoints listed | [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-5.4) |
| `claude-sonnet-4-6` | Text and images to text | [Claude model page](https://platform.claude.com/docs/en/models/sonnet-4-6/overview) |
| `gemini-3.1-flash-lite-preview` | Historical input modalities include images; model is shut down | [Google model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview) |
| `gemini-3.1-pro-preview` | Input modalities include images; preview availability is not a live-service test | [Google model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview.md) |
| `llama-3.3-70b-versatile` | Input and output both listed as text | [Groq model page](https://console.groq.com/docs/model/llama-3.3-70b-versatile) |
| `deepseek-v4-flash` | Inferred from official alias routing: this legacy ID is accepted and served by V4.1 Flash; current Flash supports image input | [DeepSeek first call](https://api-docs.deepseek.com/) and [vision guide](https://api-docs.deepseek.com/guides/vision/) |

Availability is distinct from modality. Google reports that the retained Gemini
preview ID shut down on 2026-05-25. Groq's retained Llama 3.3 model page now says
Enterprise; this does not establish ordinary account availability. This ticket
does not silently select new defaults or claim a real-service compatibility
test. Users can explicitly configure another target. Alias routing and service
availability can change independently of these synthetic acceptance checks.
