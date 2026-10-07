# CI run 37694684706 (uncached, commit ac879152)

Raw evidence of the GitHub Actions run that PLAN.md section 8 ("CI 门禁记录", "不使用缓存的运行")
quotes for phase 1 exit item 1 under S11. Run started by hand (`workflow_dispatch`)
with `no_cache: true` on commit `ac879152`. Downloaded with `gh run download` and
`gh run view --log` on 2026-10-08; the artifacts on GitHub expire on 2026-11-06.

| Path | What it is |
| --- | --- |
| `job.log` | The full job log (`gh run view 37694684706 --log`). GitHub masks the checkout token as `***`. Both `actions/cache` steps are absent from the step output because they were skipped; `Native setup` shows `Compiling cidre v0.11.10` |
| `job-steps.json` | Step names and conclusions from the run's job (`gh run view --json jobs`): both cache steps `skipped`, every other step `success` |
| `gates/` | The `margin-gates-ac879152…` artifact: the output of `run-gates.mjs` on the runner (summary.json, logs, tests.tap) |
| `native/` | The `margin-native-ac879152…` artifact without the built `index.darwin-arm64.node` binary: `BUILD-INFO.txt` (with the binary's sha256) and `setup-native.log` |

`gates/summary.json` counts 1 uncommitted path but, in this version of `run-gates.mjs`,
does not list it. The run's workflow wrote `native-artifact/` into the checkout before
the gates started; later runs keep that directory in `$RUNNER_TEMP` and the summary
lists the paths (PLAN.md AG-17 fourth review).
