# Gate evidence

Raw outputs of `scripts/margin/run-gates.mjs`, kept so every gate result in
[PLAN.md](../PLAN.md) can be checked against what the commands actually printed.

Each run directory holds:

- `summary.json`: the commit (`head`), how many paths were uncommitted, an optional
  `note` on how the run was made, and for every step the exact command, exit code,
  duration and log path. Compared steps also list inherited, new and resolved items
  against the reference run (`reference`).
- `<step>.log`: stdout and stderr of the step, unedited. For `tests` it holds the
  stderr of every test file that wrote any (for example the isolation guard's list
  of blocked attempts).
- `tests.tap`: the TAP report of every test file, each after a `# ===== <file>` line;
  `tests.files.json`: per file, its exit code, duration, counts, and whether it
  finished, timed out or was ended after its footer; `test-failures.txt`: the
  failing tests as `file :: name`.
- `tsc-electron.diagnostics.txt`: Electron type errors without line numbers, with
  their counts (the repository path inside messages is written as `<repo>`).
- `preload-contract.gaps.txt`, `ipc-channels.gaps.txt`: the gaps the contract checks
  listed.

## How the steps are judged

A step passes when it exits 0. `tsc-electron`, `tests`, `preload-contract` and
`ipc-channels` exited non-zero because of inherited problems until AG-17, so for
them the step passes when nothing is new compared with the reference run. Two
things fail the `tests` step regardless of the reference: an attempt the isolation
guard blocked in any test file (`isolationBlocked` in `summary.json`), and a file
that exited non-zero with no failing test in its TAP (`unexplainedExits`).
"Inherited" therefore means "already present in the reference run"; whether a
reference item comes from upstream is shown by comparing with `baseline-a786910e/`.

The `tests` step runs each test file in its own guarded process (`run-node.mjs`)
with a 180 s limit, four at a time, and takes every count from that file's TAP
footer. A file whose TAP has no footer is listed as `file :: <did not finish>`.
Some baseline files leave handles open after their last test; such a file is ended
5 s after its footer arrived and marked `endedAfterFooter`. (An earlier version ran
all files in one `node --test --test-force-exit` process; on the same tree it
reported 907 and then 892 tests, so it dropped files and is not used.)

The build starts from an empty `dist-electron`: esbuild never deletes outputs, so
before this, modules deleted from the source stayed in `dist-electron` and tests
that imported them still ran (see the AG-13 record in PLAN.md).

## Runs

| Directory | What it is |
| --- | --- |
| `baseline-a786910e/` | `test-failures.txt` only: the failing tests of the guarded X2 run (2026-10-07, commit `f6b3f2a1`, whose `electron/` and `src/` are identical to the baseline `a786910e`). 991 tests, 33 failed. Extracted with the same rule as `run-gates.mjs` |
| `pre-AG-13/` | Reference for AG-13: the tree of `fdf9cd7c` (exported with `git archive` into a throwaway local repository, so `git ls-files` works), run with the runner from the AG-13 commit. Provenance and `diff-check` need the real history and were run on `fdf9cd7c` itself (0 hits, clean) |
| `AG-13/` | AG-13 on the worktree, compared with `pre-AG-13/` |
| `AG-14/` | AG-14 on the worktree, compared with `AG-13/` |
| `AG-15/` | AG-15 on the worktree, compared with `AG-14/`; also `install-check.log` (models and model dependencies after `npm ci`) |
| `AG-16/` | AG-16 on the worktree, compared with `AG-15/`; also `install-check.log` (removed packages after `npm ci`) and `validateImagePath.log` (an `electron/utils` test, which the `tests` step does not cover, run by hand under the guard) |
| `AG-17/` | AG-17 on the worktree (Electron 43.1.0), compared with `AG-16/`; also `install-check.log` (`npm ci` and `setup:native` with Electron 43). From AG-17 the `tests` step also covers `electron/utils`, `electron/test` and `src/lib` tests, and a `startup` step runs `tests/margin/startup-smoke.test.mjs` |
| `AG-17-review/` | The fixes for the Astra review of the phase 1 exit (PLAN.md section 9), on the uncommitted tree over `e9b25ec3`, compared with `AG-17/`. From this run, any blocked isolation attempt or a non-zero exit without a failing test fails the `tests` step on its own |
| `AG-17-review2/` | The fixes for the second Astra review, on the committed, clean tree of `94a10fb1`, compared with `AG-17-review/`. From this run the `tests` step reads each file's isolation log itself (a file without a guard-loaded record fails too). `checks/` holds the raw outputs of the one-off checks and incident runs (see its README) |
| `AG-17-review3/` | The fixes for the third Astra review, on the committed, clean tree of `02d4cb2e`, compared with `AG-17-review2/`. From this run the `tests` step accepts only a guard-loaded record whose `ppid` is the run-node.mjs process it started. `checks/` holds the raw outputs of the one-off and mutation checks (see its README) |
| `AG-17-review4/` | The fixes for the fourth Astra review, on the committed, clean tree of `4bd2eb00`, compared with `AG-17-review3/`. From this run the `tests` step accepts only a guard-loaded record from the process that ran the file (below the `node --test` runner that run-node.mjs started), and `summary.json` lists uncommitted paths (`uncommittedPathList`). `checks/` holds the one-off and mutation check outputs and the first, failed gate run on `4523c762` (see its README) |
| `CI-37694684706/` | Raw evidence of the uncached GitHub Actions run on `ac879152` (job log, step conclusions, gate artifact, native artifact without the binary); see its README |
| `CI-37698721357/` | Raw evidence of the uncached GitHub Actions run on `5e2dac07` (code of `4bd2eb00`): the evidence for phase 1 exit item 1 under S11; see its README |
| `AG-17-review5/` | The fixes for the fifth Astra review, on the committed, clean tree of `d26a9937`, compared with `AG-17-review4/`. `checks/` holds the one-off and mutation check outputs and the full test run before the commit (see its README) |
| `CI-37700866188/` | Raw evidence of the uncached GitHub Actions run on `fd47de32` (code of `d26a9937`): the evidence for phase 1 exit item 1 under S11; see its README |
| `AG-17-review6/` | The fixes for the sixth Astra review, on the committed, clean tree of `fa70efc8`, compared with `AG-17-review5/`. `checks/` holds the one-off and mutation check outputs, the earlier failing runs of the new storage case, and the checks run before the commit (see its README) |
| `CI-37703373985/` | Raw evidence of the uncached GitHub Actions run on `78015838` (code of `fa70efc8`): the evidence for phase 1 exit item 1 under S11; see its README |

Rerun: `node scripts/margin/run-gates.mjs --out docs/margin/evidence/<name> --ref docs/margin/evidence/<reference> [--note "..."]`.
The `regression`, `storage` and `startup` steps need a display session (they launch the app
under the isolation guard); everything runs offline.

CI (`.github/workflows/margin-gates.yml`) runs the same command on a clean macOS runner
against the newest `AG-*` directory and keeps its output as a run artifact (30 days),
not in this directory; PLAN.md records how each CI run compares with the local one.
