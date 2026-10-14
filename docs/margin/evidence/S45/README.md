# S45 settings and independent gateways

2026-10-15. Change over `dca94aef`. Claude implemented the initial UI and
gateway contract; the main agent completed integration tests and review repairs.
The user explicitly chose fresh-install use with manually entered keys, without
legacy retention, migration or compatibility requirements. No real application
data was removed or migrated.

## Delivered behavior

- Primary/backup models and three deadlines precede Cloud services / Gateway /
  Privacy tabs. Official rows expand without a connection-mode or URL field.
  Model choices come from explicit upstream discovery; the saved model remains
  visible. Shared selectors use saved official or gateway targets, not a second
  hardcoded model catalog. Groq answering is retired; Groq STT is unchanged.
- Gateways have independent IDs, encrypted keys and configurations. The same
  identity flows through selection, restart, generation, backup, retry, model
  discovery and connection tests. Changed origins require re-entered keys;
  missing gateways never fall back to an official endpoint. Four protocols use
  the existing adapters. No new dependencies or native/audio changes.
- Plain Save is local. Save and test waits for a successful save and sends the
  expected target; failed saves send nothing. Drafts survive tab changes, stale
  discovery/test results are ignored, and a pending creation stays locked even
  if the draft changes. Saved backup target changes update the selector without
  discarding unsaved deadlines or another backup draft.
- Gateway SDK errors are replaced after retry classification, before they can
  reach renderer/log consumers; raw payloads, headers and causes are not copied.

## Review and repairs

Independent read-only backend and frontend review found one P1 and two P2s:
raw gateway error leakage, unsynchronized backup selection, and duplicate
first-time gateway creation while a save is pending. All three were repaired
and statically re-reviewed without remaining confirmed blockers. The main agent
also removed hardcoded official model candidates and registered the new SDK
construction sites in the existing outbound inventory. Source review and exact
generic-line entries are in PROVENANCE.md; no old component bodies were copied.

The first full run in `gates/` is retained as a failed run: the outbound inventory
and answer fixture still assumed the old official-slot gateway contract. The
answer fixture now uses a separately identified synthetic gateway, preserving
the changed-origin rejection and real preload/renderer coverage. An intermediate
assertion expecting a raw provider error was updated to require the safe HTTP
error, and the typed-only target test explicitly clears earlier screenshots.
No tests were skipped to pass acceptance.

## Final local evidence

`final-gates/summary.json`: **16/16 gates passed** on the frozen final application
and test source, using the established runner and AG-62 reference.

- Unit tests: **1187/1187**, 133 files, zero failures/skips or isolation violations.
- Real app harness: answer **21/21**, meeting storage **2/2**, startup **1/1**.
- Mounted renderer: **13/13**, including save/test ordering and failure, stale
  replies, keyboard tabs, draft preservation, delayed creation and backup follow.
- Four-protocol suite: **43/43**, including real SDKs receiving synthetic
  key-bearing error bodies; those bodies do not escape and 401 is not retried.
- Both builds/typechecks, IPC/preload, retirement, source check, isolation
  selftests, required S42 evidence and whitespace checks passed.

Commands: `node scripts/margin/run-gates.mjs --out docs/margin/evidence/S45/final-gates
--ref docs/margin/evidence/AG-62`, followed by `node scripts/margin/gate-evidence.mjs
required docs/margin/evidence/S45/final-gates` and `git diff --check`.
Machine-specific paths in retained evidence are replaced with stable placeholders.

## Delivery boundary

Implementation `dd3eb703` reached both established repositories. Public run
[38655838677](https://github.com/xbz123/margin/actions/runs/38655838677) passed
15/16 gates: all 1187 unit tests and all app/renderer tests passed; only G2 failed
after its refreshed upstream pool introduced 51 exact matches. The same result
was reproduced locally and reviewed against source context, blame and approved
baseline method contracts. The repair registers 21 exact generic forms, without
changing runtime source/tests or broadening exclusions. `provenance-recheck/`
records the focused recheck; the full follow-up public run remains pending.
No installation, packaging, release, live API call,
personal-key read, OS permission reset or device/shared-screen acceptance was
performed. Synthetic protocol acceptance does not establish a gateway's real
model availability, supported output limits or reasoning implementation.
The UI supports configuring a gateway, not a new multi-gateway management suite.
