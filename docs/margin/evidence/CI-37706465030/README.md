# CI run 37706465030 (uncached, commit d70e585d)

Raw evidence of the GitHub Actions run that PLAN.md section 8 ("CI 门禁记录", "第七轮修复后的不使用缓存的运行")
records as the evidence for phase 1 exit item 1 under S11. Run started by hand
(`workflow_dispatch`) with `no_cache: true` on commit `d70e585d`, whose code is that
of `9a7dcf1c`. Downloaded with `gh run download` and `gh run view --log` on
2026-10-08; the artifacts on GitHub expire on 2026-11-07.

| Path | What it is |
| --- | --- |
| `job.log` | The full job log (`gh run view 37706465030 --log`). GitHub masks the checkout token as `***`. Skipped steps print nothing, so the two cache steps do not appear; `Native setup` shows `Compiling cidre v0.11.10` |
| `job-steps.json` | Step names and conclusions: both `actions/cache` steps `skipped`, every other step `success` |
| `gates/` | The `margin-gates-d70e585d…` artifact: the output of `run-gates.mjs` on the runner. `summary.json` lists no uncommitted paths |
| `native/` | The `margin-native-d70e585d…` artifact without the built `index.darwin-arm64.node` binary: `BUILD-INFO.txt` (with the binary's sha256) and `setup-native.log`. `sha256-recheck.txt` records the download: the recomputed sha256 of the binary matches `BUILD-INFO.txt`, and both kept files are byte-identical to the download |
