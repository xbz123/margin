# AG-32 — one logical generation budget

Starting commit: `85cade1cb18a532b56cc30b12d76f8766f2110ae`.
Implementation and local checks are complete; Claude review and phase-3 exit
acceptance remain separate.

## Contract

The requirement source is `b8ade3f7:docs/fresh-release-implementation-plan.md`
section 3.2, under PLAN S27–S28. A logical answer, summary or compression has at
most two physical generation attempts. One explicitly selected backup may be
used; configured providers are not an implicit fallback list. SDK retries stay
disabled. Scope denial, authentication/configuration failure, refusal, empty
success, incomplete output and any failure after answer text are terminal.

Only pre-text transient connection errors, HTTP 408/429/5xx or an explicit
model-unavailable response can justify another attempt. An explicit stale cache
reference has its own same-model recovery rule but spends that same second
attempt. Ordinary 404/not-found text is not cache evidence. All sends recheck
current data permissions, cancellation and remaining budget.

The primary, backup, endpoint, account and parameters are fixed per task.
Interview TTFT defaults to 10 seconds and total to 60; written total defaults to
180 seconds. The three settings are independent, positive and finite, with the
interview total at least its TTFT. Preparation, queuing, backoff and retries use
the same clock. Displayable answer text ends the TTFT timer; hidden reasoning,
usage and preparation output do not. Background tasks use a named 180-second
total without interview TTFT. Timing tests establish state transitions, not
real-service performance.

## Screenshot call-chain decision

The `generate-what-to-say` entry previously generated a one-image structured
screen description, then attached the original image again to the answer.
That preparation had its own provider traversal and lost the cancellation
signal at the vision registry. The stage-3 target is a direct text/image answer,
not a separately requested screen-analysis result. This ticket removes that
redundant generation at this entry while retaining image-path validation, all
original attachments, the existing direct-vision prompt and permission checks.
It must not invent structured screen metadata or claim the removed analysis
ran. Other still-used screen interfaces are not implicitly retired. Behavioral
evidence must show the answer still receives the image under the shared budget.

## Verification

`gates-final/` records 15/16 passing steps on the frozen repaired source:
901 unit tests, 896 passed, zero failed and five existing skips; AG-09 9/9,
storage 5/5, startup 1/1 and renderer outbound 2/2. Builds, both typechecks,
retirement, IPC/preload contracts and isolation checks passed. Only G2 failed
on one standard `require.resolve('electron')` statement in the new redaction
behavior test. Its surrounding mock-install/restore code was reviewed and the
exact line registered; no source pool or scan exclusion was expanded.
`provenance-final/` contains the subsequent G2 and diff-check results. These
are combined evidence, not a single 16/16 run. Application source and build
were unchanged for that follow-up.

`targeted/` retains the implementation history, including final 276/276 targeted
tests, GUI 9/9 and storage 5/5. The test-migration map records retained invariants
and replacement behavior tests; the two retired vision suites had 39 named
leaf tests. No new skip was added. Dependencies and native build are unchanged;
G7 reuses the accepted installation. No real model, credential or device was
used and no CI was triggered. Published logs normalize machine-specific paths;
raw copies are retained locally without altering test counts or failures.

## Failures found during implementation

- The first targeted migration reported 121 tests, 62 passed and 59 failed.
  Most failures referred to removed private routing methods or superseded
  multi-provider retry assumptions; each retained invariant is mapped to the
  selected-target interface rather than silently skipped.
- A later 220-test run had four real sentinel-display regressions: the old
  buffered Gemini path had hidden non-answer sentinel text, while the new
  streaming path delivered it early. The Engine now buffers only a possible
  sentinel prefix. Raw received text still prohibits retries, but only visible
  answer text ends TTFT; real Engine mock-clock tests cover both cases.
- A newly shared scheduling path incorrectly allowed connection tests to use
  the answer backup. Compatibility testing now sends once to its saved target,
  does not inherit a backup and can test the target that is itself the configured
  backup. Dedicated request-count tests cover the failure and success controls.
- The first GUI attempt failed at Electron launch under the OS sandbox, before
  the application guard loaded; it is not application behavior evidence. The
  same X2 command was rerun with GUI execution permission.
- The next GUI run passed 8/9. The actual WhatToSay action sent no model request
  under denied transcript scope, but displayed no error: the Engine's error
  event went to the current main window, while the invoking renderer suppressed
  its IPC response because the error had been marked as already emitted. An
  emission is not proof of delivery to the caller. The repair gives IPC-driven
  WhatToSay errors to that caller alone; automatic Engine calls retain event
  delivery. GUI04, GUI05 and the first full-gates AG-09 run verify exactly one
  displayed refusal and zero model sends; each GUI run passed 9/9.

`gates-first/` is retained failed evidence: 13/16 steps passed. Its 112 unit
test files reported 895 tests: 883 passed, seven failed and five existing skips;
none were isolation-blocked or unfinished. AG-09 passed 9/9, startup 1/1 and
renderer outbound 2/2. The two new source matches are registered in PROVENANCE.
Seven test failures still referenced removed private adapters/source spelling
or required a log line that no longer exists. The OpenAI-only summary test also
expected implicit provider selection; the new contract requires explicitly
selecting OpenAI before using it. Storage passed 1/5 because it saved only a
Groq key while leaving the unconfigured default Gemini selected: no title or
summary request was sent, and dependent meeting checks failed. Its setup must
select Groq explicitly without relaxing the stored-data assertions.

After explicit model selection, storage passed 4/5 but the allowed-recovery
control still failed. Synthetic shutdown diagnostics established a real
regression: `scrubKeys()` cancelled the active title generation with
`AbortError: Application quit`; the metadata catch then wrote an empty fallback
as `isProcessed: true`, so startup saw no work to recover. The narrow repair
preserves the existing unprocessed placeholder on cancellation and prevents new
generation after shutdown. Other failure/scope behavior and the AG-52
`MeetingPersistenceRace` work remain outside this change. The same storage
tests pass after repair, including the denied and allowed recovery controls.

## Later stage-3 work, not signed off here

AG-33 owns the full renderer lifecycle and actual image-handler validation:
request/task fences for late token/done/error, preserving partial and valid short
answers, and per-target image capability confirmation. In particular, aborting
the Engine must not flush an old buffered sentinel prefix into a newer answer,
and a second step of a shared task must not retain a first step's `completed`
metadata after a later scope failure or timeout. The current short-answer
replacement and these lifecycle cases are not accepted as final stage-3 behavior.

AG-34 replaces CLI generation. Its internal retries are not covered by the
cloud SDK physical-send proof. Google cached-content reasons used by the tests
are a strict synthetic contract, not a verified current service error schema.
