# AG-60 settings and bilingual UI acceptance

2026-10-13. Source baseline `88b79c52` plus the AG-60 working diff. Phase 5 was
signed off by the user before this ticket began. This is ticket acceptance,
not phase-6 exit approval or a release.

## Delivered

- Application, Answers, Speech and Support settings groups; existing `skills`
  and `local-context` tab references resolve to Context & Skills. Existing
  settings and manual actions remain available.
- English/Simplified Chinese interface language is stored atomically in main,
  validated before writes, broadcast only after successful persistence and
  restored after restart. A failed save preserves the previous disk/memory state.
  Recognition and answer languages remain separate.
- Explicit translations cover retained settings, launcher, meeting/answer UI,
  history, auxiliary windows, help, application menus and dialogs. Translation
  does not remount unsaved settings or regenerate answers. Real user/model text,
  code, provider/model identifiers and raw diagnostic text remain unchanged.
- Help/About descriptions match retained functionality; protection wording
  reports configuration state, not unverified screen-sharing invisibility.

## Review and repairs

Claude Opus 5.5 medium produced the first implementation and tests. When its
session quota was exhausted, one `gpt-6.1-sol` worker completed the bounded review
repairs under the current user routing rule. There was no concurrent code writer;
the main agent reviewed integration and ran the final complete gates.

The first pass was not accepted as complete: reachable Help prose was still
English. Review also found three behavior gaps, now covered and repaired:

1. A late successful save reply could undo a newer language broadcast. The
   renderer now applies that reply only if no newer main update arrived.
2. A visible class-based error fallback did not subscribe to language changes.
   A small hook-based fallback updates its labels while retaining diagnostics.
3. Finalized answer headings captured the old translator in `useCallback`.
   Its dependency list now includes `t`; an en/zh/en behavior case verifies the
   headings change and answer/code content does not.

Synthetic mounted coverage expands all eight Help sections, reads Chinese
meeting history, retains draft identity/content across windows, tests failed
writes, and relaunches with the persisted language. Earlier fixture/import and
esbuild-allow-list failures were repaired without weakening safety assertions.

## Final evidence

- Main-agent complete gates **16/16**, every exit code 0 (`summary.json`).
- **128 files, 1124 tests: 1123 pass, 0 fail, 1 existing AG-61 skip**.
- Actual-button answer regression **21/21**, storage **2/2**, startup **1/1**,
  full outbound-renderer suite **9/9**, including the AG-60 mounted cases.
- Both typechecks/builds, IPC/preload contracts, isolation and retired checks pass.
- G2: zero unreviewed hits. Exact line review and original-source mapping are in
  `provenance-line-review.json`; no source pool or path exclusion was expanded.
- Existing CI discovers the new unit file and extended renderer cases through
  its existing globs/steps; the S42 required-evidence check also passes.

Machine-specific prefixes in generated evidence are normalized for publication;
test results, counts and content are unchanged. No dependencies, native modules,
icons or packaging configuration changed. Public ticket CI passed on the
committed source; no earlier green run substitutes for it.

Delivery recovery: `968ea59d54e6c5a95a664b4051b9f738ded8be9f` is pushed to both
repositories. [Public ticket CI 38465269168](https://github.com/xbz123/margin/actions/runs/38465269168)
was dispatched on that SHA with `gate_ref=docs/margin/evidence/AG-60`,
`no_cache=false`, `package_apps=false`; it completed successfully. The downloaded
gate artifact matches the GitHub digest and this exact SHA: gates 16/16, unit
counts unchanged, required evidence passes and release identity contract 6/6.
The API job response omitted its step details; those artifact reports supply the
check evidence instead. See `ci-result.json` and the two `ci-*.log` receipts.

## Limits

No real model/STT service, credential, microphone, screen capture or sharing test
was used. No installation or release occurred. Brand/model names, protocol IDs,
language autonyms and native OS-owned text are not translated as application prose.
Unreferenced components were not revived. The existing Vite chunk/dynamic-import
warnings remain; AG-61 activation policy is still the one existing skip.
