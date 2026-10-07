# Gate evidence

Raw outputs of `scripts/margin/run-gates.mjs`, kept so every gate result in
[PLAN.md](../PLAN.md) can be checked against what the commands actually printed.

Each run directory holds:

- `summary.json`: the commit (`head`), how many paths were uncommitted, and for every
  step the exact command, exit code, duration and log path. Compared steps also list
  inherited, new and resolved items against the reference run (`reference`).
- `<step>.log`: stdout and stderr of the step, unedited.
- `tests.tap`: the full node:test TAP report; `test-failures.txt` lists the failing
  tests as `file :: name`.
- `tsc-electron.diagnostics.txt`: Electron type errors without line numbers, with
  their counts.
- `preload-contract.gaps.txt`, `ipc-channels.gaps.txt`: the gaps the contract checks
  listed.

A step passes when it exits 0. For `tsc-electron`, `tests`, `preload-contract` and
`ipc-channels`, which still exit non-zero because of inherited problems until AG-17,
the step passes when nothing is new compared with the reference run. "Inherited"
therefore means "already present in the reference run"; whether a reference item
comes from upstream is shown by comparing with `baseline-a786910e/`.

| Directory | What it is |
| --- | --- |
| `baseline-a786910e/` | `test-failures.txt` only: the failing tests of the guarded X2 run (2026-10-07, commit `f6b3f2a1`, whose `electron/` and `src/` are identical to the baseline `a786910e`). 991 tests, 33 failed. Extracted with the same rule as `run-gates.mjs` |
| `pre-AG-13/` | Reference run on `31a86aa6` plus the new gate runner, before any AG-13 change. All 21 failing tests also fail in `baseline-a786910e/` |

Rerun: `node scripts/margin/run-gates.mjs --out docs/margin/evidence/<name> --ref docs/margin/evidence/<reference>`.
The `regression` step needs a display session (it launches the app under the
isolation guard); everything runs offline.
