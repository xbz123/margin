# AG-20 identity implementation

Implementation, local gates and clean-checkout CI are complete for source
`831234342e5059029afed6a0fecec5393ebfeefa`; Claude's ticket review is pending.
This is not phase 2 exit or packaged-app acceptance.

## Scope

- Build-time identity comes from `scripts/margin/app-identity.cjs`: `temp` by
  default, `release` only with the GitHub Actions environment. Electron, Vite
  and electron-builder consume it. Runtime initialization rejects release
  outside CI until the release decision at AG-62 changes that boundary.
- Bootstrap initializes name, userData, sessionData and logs before loading
  main and its storage imports. Tray, disguise restoration, window titles and
  displayed names use the selected identity; upstream attribution is retained.
- Tests use synthetic HOME, mock keychain and the existing X2 network/device
  doubles. Known legacy/other-identity paths are guarded at Node fs entry points.
  Native recursive enumerators/glob and dereferencing copies are conservatively
  refused. This is not an OS sandbox or a native/Chromium filesystem audit.
- No icon import, credential-policy change, native rebuild, packaging,
  installation, real keychain or provider access was performed locally.

## Local validation

`checks/precommit-3/` retains the final complete raw local gate output:
15 steps, all actual exit codes zero; 105 test files, 773 tests, 768 pass,
0 fail, 5 existing skips. AG-09 answer regression 6/6, meeting storage 5/5,
startup smoke 1/1. Identity behavior checks 6/6 include persistence/restart,
bootstrap order, first-launch guard preflight, disguise restoration, 15 direct
protected-path probes and 25 recursive/ancestor probes using only synthetic data.

The root `summary.json` is an unchanged copy of the final local summary; its
paths point into `checks/precommit-3/`. The four empty diagnostic/failure lists
are copied for the CI runner's existing reference convention. This is explicitly
a precommit run over `fe83da31`, not a clean-tree fixed-commit run.

Earlier failed gates and the red/green recursive-guard probes are retained under
`checks/`; see that directory's README. Five independently reviewed generic
source-scanner matches are documented in PROVENANCE; scan pools were not widened.

## Remaining gates

CI [37756383369](../CI-37756383369/README.md) passed `npm ci`, all temp gates,
then built the release identity and passed its 6/6 fake-Electron contract checks
without launching a release app. Raw evidence was downloaded and verified.
Actual two-variant Info.plist, package content and signature checks remain in AG-25.
Claude's read-only review remains pending. On 2026-10-08 the user requested
continued phase 2 work, consistent with the earlier per-ticket-or-phase-exit
review arrangement; subsequent implementation does not imply that review passed.
