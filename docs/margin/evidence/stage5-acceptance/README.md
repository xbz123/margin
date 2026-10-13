# Stage 5 exit acceptance: technical exit passed

2026-10-13. Reviewed commit: `7915b627a736ba66867cc47e527974a594d59a1a`.
The user requested acceptance after the S42 delivery. This is the technical
exit review, not user product sign-off. The initial review changed no application source.

**Latest:** the user subsequently authorized fixing F1. The main agent added
one cancellation statement (plus its ordering comment) to the existing input
release path. Claude independently reviewed the repair and returned PASS
without blocking findings (`f1-review.md`). The initially reported sandbox 401
did not persist outside the sandbox; no user re-login was needed.
Current evidence: targeted tests **92/92**, the original failing actual-UI probe
**1/1**, complete local gates **16/16**, **127 files / 1108 tests / 1107 pass /
0 fail / 1 existing AG-61 skip**, mounted answer regression **21/21**, and all
16 required files plus renderer evidence pass (`f1-gates/`). No provenance
exception, dependency, framework or Local Context/Skill behavior was changed.

The repair was committed and pushed to both repositories as
`aaf9b0711515fa92032e1698dd42fa8e81fac648`.
[Exit CI 38447881500](https://github.com/xbz123/margin/actions/runs/38447881500)
completed successfully on that exact commit with `package_apps=true`,
`no_cache=false` and `gate_ref=docs/margin/evidence/S42-04`. All job steps passed.
Artifact download and local S26 verification passed: all five artifact digests,
499 source-manifest entries and the exact git archive match; guarded asar smoke
passed 10/10. See the [exit receipt](../CI-38447881500/README.md).
The technical exit is complete; user product sign-off remains separate.

Claude Opus 5.5 medium performed the required read-only review of AG-50/AG-51
and their S42 integration. The main agent checked the governing contracts,
current source and existing passing evidence, then independently reproduced
two withdrawal defects and one cancelled-import side effect using the existing
real IPC/helper fixtures with synthetic data and mocked transports.

Scope correction after user clarification: Local Context and Skills are configured
before use, not edited during an active session. The IPC-level F2/F3 probes below
do not establish an in-scope normal-use failure. Their earlier blocker labels are
withdrawn; they are defensive edge cases outside this round's acceptance scope.
The probes are preserved as diagnostics, not added to the required CI suite.
This does not authorize removing existing security checks or assert that all UI
paths have been tested and are technically locked during use.

## Findings

### F1 — P1 confirmed through actual UI: superseded retry image withdrawal

`electron/llm/preparedInput.ts:111` drops a window's held entry without aborting
its active task. Start a manual Retry containing a screenshot and hold it at
the provider limiter; begin a new speech action on the same sender, remove that
screenshot, then release the limiter. The old Retry is no longer in the held
map and has no speech-action registry entry to cancel. It sends the withdrawn
image. Observed: **one later send containing the withdrawn image**, expected zero.

Claude's suggested original-action-to-text example is not accepted as proof:
that path has `speechActions.cancel`. The main agent reproduced the distinct
manual-Retry-to-new-speech-action path above against the real handlers.
The subsequent isolated Electron check establishes a normal-use variant through
actual visible buttons, not direct action IPC calls:

1. Attach a synthetic screenshot through the normal screenshot shortcut and send
   a question. The local mock returns HTTP 400; the UI offers Retry.
2. Click Retry. The mock returns HTTP 503 with `Retry-After: 4`, exercising the
   application's existing automatic retry wait without changing task internals.
3. Click the enabled Answer button; the UI changes it to Stop (new dictation).
4. Click the enabled Remove all button; the screenshot chip disappears.
5. Let the retry delay expire. One additional request containing `data:image/`
   reaches the loopback mock after removal, while the expected count is zero.

`ui-answer-retry.test.mjs` reproduces this on the existing real renderer, preload,
IPC and generation path. Only the screenshot capture and HTTP service are mocked;
no AppState, limiter, collector, action handler or UI state is replaced. Answer
marks dictation but no microphone or real STT is started. This case is unrelated
to editing Local Context/Skills. Two earlier scratch harness attempts failed
to access a module export; they are not counted as application failures.
Fix direction: preserve active-task revocation ownership when replacing retry
state, or explicitly cancel the superseded task. Keep one failed snapshot and
the settled D9 lifecycle; do not introduce a persistent snapshot store.

### F2 — out-of-scope defensive case, not an acceptance blocker

`electron/ipcHandlers.ts:145` calls `revokePreparedContext()` before cancelling
in-flight tasks. That helper also reads prompt settings. If prompt settings are
corrupt, it throws after the Local Context removal has already been saved.
A non-presentation-owned request held at its limiter retains the old Local
Context and can send it afterward. The handler also reports a failed save with
previous contents kept, even though the stored entry is gone.

Observed: persisted context `[]`, **one send containing withdrawn context**,
`ok:false`; expected zero sends and `ok:true`. Fix direction: ensure successful
mutations always cancel affected work, and fail closed when checking dependent
snapshots, without misreporting the completed storage mutation.

### F3 — out-of-scope defensive case, not an acceptance blocker

`electron/ipcHandlers.ts:1854` uses the default mutating `promptOperation`, even
when the native picker returns `canceled:true`. The wrapper unconditionally
calls `cancelGenerationTasks`. Observed: an otherwise live generation task is
aborted after the cancelled picker, despite unchanged settings.
Fix direction: distinguish an actual successful mutation from a cancelled/no-op
import; retain cancellation on successful imports and settings changes.

## Reproduction and accepted evidence

The two diagnostic files in this directory reuse current repository fixtures;
they do not change the production tests or create a new framework. Run from
the repository root against this revision's built Electron outputs:

```sh
node scripts/margin/isolation/run-node.mjs --test --test-reporter=tap docs/margin/evidence/stage5-acceptance/revocation-probes.test.mjs
node scripts/margin/isolation/run-node.mjs --test --test-reporter=tap docs/margin/evidence/stage5-acceptance/cancel-import-probe.test.mjs
node scripts/margin/isolation/run-node.mjs --allow-exec Electron --test --test-timeout=180000 docs/margin/evidence/stage5-acceptance/ui-answer-retry.test.mjs
```

All three expected-safety assertions fail on the reviewed revision, with the
specific observations above. F2/F3 remain out of scope. The additional actual-UI
F1 test also fails, with one post-removal image request versus zero expected.
These are uncovered cases, not a reinterpretation
of the previous passing gate logs. Existing S42-04 local gates 16/16, unit tests
1105 pass / one existing AG-61 skip, renderer 20/20 and public CI 38394532024
remain truthful historical evidence but do not cover these cases.
The main agent reran `retired-check.mjs --all`: **309 rules, zero failures**.
The stage-5 store/consumer suites are present in the accepted inventory:
LocalContext 7/7, LocalContextBridge 2/2, PromptSettingsUi 3/3 and
PromptSkillConsumerChain 5/5.

## Exit decision

F1 is **closed locally and by Claude review**; F2/F3 remain outside this round.
The supported screenshot-withdrawal promise now passes its previously failing
normal-UI reproduction. Exit CI and artifact verification passed; the stage-5
technical exit is complete (see the linked exit receipt).
No real service, key, user data or device was used. No phase-6 ticket was started.
Do not require concurrent Local Context/Skill
editing or hot-update behavior to close this round; product sign-off remains
with the user.
