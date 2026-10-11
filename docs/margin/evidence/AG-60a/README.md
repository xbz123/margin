# AG-60a shared settings foundation

Implementation starts at `8c0c88ec`, on `codex/margin-agpl-migration`.
Acceptance remains separate from Claude's read-only review and the stage exit.

## Scope and contracts

- `translate(language, english)`: English source strings are the fallback, including
  unknown keys and object-prototype names; Chinese uses only own dictionary entries.
- `getUiLanguage`, `setUiLanguage`, `useI18n`: default `en`, supported `zh-CN`,
  synchronous per-renderer changes observed by mounted React consumers. Unsupported
  runtime values are rejected without changing the current language.
- `SettingsHeading` and `SettingsCard`: extract this branch's existing Skills heading
  and card styles, retaining native headings, children and React text escaping.
- The existing Skills page consumes these contracts for four labels. Its layout,
  IPC callbacks, disabled state and folder selection are not redesigned. There is
  no language selector yet; persisted preferences, cross-window synchronization,
  full translation and settings organization remain AG-60, not this prerequisite.

No old Margin source or dictionary is imported. See the AG-60a PROVENANCE entry
and the six individually justified generic scan matches in the source config.
No source pool or exclusion changes. No dependencies, native inputs or CI changes.

## Behavioral checks

All test commands run under `scripts/margin/isolation/run-node.mjs`.
`src/lib/__tests__/settingsFoundation.test.mjs` is already covered by `npm test`
and the gate runner; no new test framework or fixture is introduced.

| Slice | Red evidence | Green evidence |
| --- | --- | --- |
| Lookup and fallback | `checks/lookup-red.log`: missing module, exit 1 | `checks/lookup-green.log`: 1/1, exit 0 |
| Switching and invalid language | `checks/switch-red.log`: missing public getter, exit 1 | `checks/switch-green.log`: 2/2, exit 0 |
| Shared rendering | `checks/components-red.log`: missing component module, exit 1 | `checks/components-green.log`: 3/3, exit 0 |

Reproduce these unit checks with:

```sh
node scripts/margin/isolation/run-node.mjs --test --test-reporter=tap src/lib/__tests__/settingsFoundation.test.mjs
```

The AG-60a case added to the existing `tests/margin/outbound-renderer.test.mjs`
also mounts the actual Skills component in isolated Electron. English → Chinese →
English must update both headings and controls without remounting/resetting the
selected synthetic folder or causing extra refresh IPC. Refresh and Open Folder
still call their synthetic IPC boundaries after switching. This supplementary
integration check runs in the full gate's existing `outbound-renderer` step.

No existing test is deleted or newly skipped (G6). The existing five skips remain
the four OpenAI cases assigned to AG-41 and the activation-policy case assigned
to AG-61.

## Full local gate result (2026-10-11)

`node scripts/margin/run-gates.mjs --out docs/margin/evidence/AG-60a/gates`
completed with exit 0 and **16/16** steps passing, using Node v26.0.0.
The application source, tests and source-scan configuration were unchanged during
the run; their exact SHA-256 values are in `source-sha256.json`.

- Both type checks and both builds exit 0.
- G2 zero hits; 261 active retirement rules have zero failures.
- `gates/tests.files.json` and `gates/tests.tap`: 112 files, 967 tests,
  962 pass, 0 fail, 5 existing skips; no unfinished files or isolation blocks.
- Answer regression 16/16; storage 2/2; startup 1/1; renderer 6/6.
- Guard self-tests deliberately provoke 18 blocked attempts and pass; these are
  distinct from application/test isolation violations (none reported).
- `git diff --check` passes. No dependency changed, so no install was performed.

Implementation and local gates pass; **Claude read-only review is pending**.
AG-40 is not started while awaiting that review.

## Evidence handling and limits

`checks/provenance-first.log` preserves the initial six-hit source report.
Local-path prefixes in seven published files are normalized to `<repo>`, `<tmp>`
and `node`; assertions, errors, counts and outcomes are unchanged. The working-tree code is the implementation under
test, not the gate summary's starting HEAD alone.

No real-service or device acceptance: no real API key, meeting, microphone,
screen capture, credential store or installed application is used. Local automated
Electron checks use the existing isolation guard and temporary `temp` identity.
No stage-exit CI, package build, release or stage-7 work is authorized here.
