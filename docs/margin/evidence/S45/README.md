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
records the focused recheck. Follow-up public run
[38657160310](https://github.com/xbz123/margin/actions/runs/38657160310) succeeded
on `1bcd8ea07795e5b5727fb6c2e71831331932fba8`: downloaded evidence confirms
**16/16**, **1187/1187** unit tests, answer **21/21**, storage **2/2**, startup
**1/1**, renderer **13/13**, and the required S42 checks. The release/local
identity checks passed; packaging, packaged launch and source-bundle steps were
skipped as requested. This commit's application/test trees are identical to
`dd3eb703`; the later receipt commit changes documentation only, so it does not
repeat testing of the same source. S45 software acceptance is complete.
During software acceptance, no installation, packaging, release, live API call,
personal-key read, OS permission reset or device/shared-screen acceptance was
performed. Synthetic protocol acceptance does not establish a gateway's real
model availability, supported output limits or reasoning implementation.
The UI supports configuring a gateway, not a new multi-gateway management suite.

## User-authorized local installation (2026-10-15)

The user requested installation for hands-on testing. Committed source
`31587a4404c00f65a0ff8697a7364d7133a23431` was packaged through the existing local
identity path: Natively Local / `local.natively.desktop`, macOS arm64, ad-hoc
signature and no publishing. Package checks passed **12/12**; the package's own
asar and native modules passed the isolated startup smoke **10/10**. The native
audio module was reused, not rebuilt, and still has SHA-256
`71f9cf8e25767a338e3c8a7bd73273db9b6428afcfd3ae21cb871e4759fb2603`.

The previous application exited normally before replacement. Only the installed
Natively Local application bundle was replaced, without retaining that old bundle.
No user data was deleted or migrated. The installed bundle identity, strict code
signature verification and asar digest were checked after copying. Asar SHA-256:
`7ad11f8c355de03064b59095f9d1e76e65fe5eaef55b4d799fc1af305fd1b2d8`.
The built ZIP digest is
`3eee649f6e3f595aa352116c5f05101704b10d16b771b27a6909b7a205e80022`.
The separate Margin application's asar hash was unchanged before/after installation.

The installed executable was launched and its process path verified. Automatic
window inspection timed out, so successful real-profile UI startup is **not**
claimed. No forced termination, permission reset, credential inspection or real
API test followed. The user owns the requested hands-on test; repeated permission
prompts and the existing CoreAudio startup risk remain separate unresolved items.
