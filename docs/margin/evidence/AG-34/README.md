# AG-34 — read-only Codex login source

Starting commit: `49b44e8c9e4450f8b1e5264a6f58a9db67d94cdc`.
Implementation and full local gates pass. Claude review and phase-exit
acceptance remain pending; this is not real-service verification.

## Final local result

`summary.json` records a single full 16/16 passing run on the frozen source:
113 unit files, 971 tests, 966 passed, zero failed and five existing skips.
There are no isolation-blocked attempts, unfinished files or unexplained exits.
AG-09 passes 15/15, storage 5/5, startup 1/1 and renderer checks 5/5.
Source scanning reports zero hits without adding an allowlist entry, changing
the approved pool or excluding new paths; all 261 retirement rules pass.
Both builds, both typechecks and the IPC/preload contracts pass.

`targeted/related-tests-06.log` passes 277/277. `targeted/gui-final-02.log`
passes the two complementary controls: actual React/preload/handler functions
composed with fault injection, and a real Electron launcher preload/main IPC
round trip. The latter opens only a synthetic auth file, verifies no read on
enablement, and cancels generation and local-status checks during delayed file
open. After withdrawal, releasing the delayed open closes the handle without
reading more bytes; generation reports cancelled with zero sends. The composed
fault/restart matrix is not claimed as a native IPC persistence-fault test.

`targeted/ag34-test-migration-map.md` lists every removed CLI test by its original
name, the replacement safety evidence and intentional behavior changes. Failed
and intermediate runs remain alongside the final results. Published logs only
normalize machine-specific paths; original output is retained locally. Source,
counts, errors and exit outcomes are unchanged by that normalization.

## Scope

Replace CLI generation subprocesses with an independent, explicitly enabled
file-login source. The source is separate from API-key Responses targets,
credentials and parameters. Main owns the fixed destination, file location and
versioned risk confirmation. Startup, configuration getters and model selectors
must not read login credentials. Explicit local inspection or generation may
read only after enablement and current risk confirmation.

No CLI execution, OAuth login, refresh, credential writeback, keyring access,
environment-token fallback, caller-selected destination or redirect is allowed.
The supported file shape and unsupported storage choices must be documented
without asking users to weaken their credential storage. Secrets do not enter
renderer state, ordinary settings, logs or surfaced errors. Requests remain
subject to live scopes, cancellation and the shared two-send/deadline budget.
Only a changed token for the same pinned account may recover a source-specific
401 once; this is not an extra retry allowance.

Existing main/fast model, reasoning and service-tier configuration is retained
with strict validation. CLI executable and sandbox controls disappear; generation
timeouts use the shared policy. Unsupported service parameters must produce an
honest failure, not silently disappear or cause an unbudgeted alternate request.

## Verification boundary

Tests use synthetic login files and controlled transports under X2, with temp
identity, synthetic HOME and simulated keychain. The test migration map must
identify the replacements for the old CLI-service assertions, including security
and lifecycle behavior. Each failure and subsequent passing control is retained.
Full local gates, AG-09, storage, startup and renderer checks use the frozen
implementation. Dependencies and native inputs are unchanged; G7 reuses accepted
installation evidence. No real login, model, device, native rebuild or local
package build is authorized by this ticket.

Claude review, the S12/S27 prompt decision and the stage-exit CI/package checks
are separate outstanding requirements. File readability and synthetic success
do not prove this unsupported third-party interface works with a real account.

## Intermediate checks

The first consent red run has three failures: two new APIs were absent, and an
actual counterexample showed the legacy writer publishing enabled state after a
failed disk save. The second consent green run passes 3/3 after the scoped
transaction is implemented. The earlier green attempt failed because its VM
loader did not yet load the new shared configuration module; that failed attempt
is retained, not described as an application regression.

The first source-only run passes 52/52. The first related run reports 213 tests,
184 passed and 29 failed: 27 old harness/loaders needed the new non-secret
imports or read-only entry points, one synthetic token fixture accidentally
changed expiry on every read, and the expanded outbound scanner treated a
dynamic authority template as the fixed origin `https://synthetic`. The latter
is not an allowed endpoint. The second related run has two failures because new
re-export behavior checks ran against stale build output. The third related run,
after a fresh build, passes 269/269. These checks include the real LLMHelper
source/backup/image/scope paths, the four-protocol adapter, credential
transactions, outbound inventory and redaction. Builds and both typechecks have
passing intermediate results. The source pre-scan has zero hits without new
allowlist entries. These intermediate results are superseded by the full local
result above, not substituted for it.

`targeted/remaining-red-01.log` preserves five failures in the added normal/fast
same-model and HTTP-200 SSE error controls. After the repair,
`remaining-green-01.log` passes 8/8: explicit pre-text model unavailability may
use the one backup; arbitrary errors, image rejection and partial output cannot
replay. Ordinary and fast image confirmations no longer select the wrong field
when both model IDs are equal.

`targeted/status-red-01.log` is a real additional permission race: after a local
status check was withdrawn, its delayed open still read another synthetic token
(202 bytes rather than the 101-byte baseline). The status operation now carries
an AbortSignal, cancelled on configuration change, supersession and shutdown.
Its native IPC green control verifies no additional bytes are read after release.

The first composed GUI attempt used the wrong named export; the second could
not launch Electron inside the default sandbox. Both failures remain recorded.
The subsequent runs used normal GUI permission while retaining the X2 guard,
synthetic HOME, temp identity, fake keychain and no external service access.

No ticket CI was triggered. The phase-exit packaging run remains pending the
S12/S27 prompt decision so the single exit build can use the settled source.
