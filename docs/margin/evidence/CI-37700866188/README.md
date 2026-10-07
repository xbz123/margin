# CI run 37700866188 (uncached, commit fd47de32)

Raw evidence of the GitHub Actions run that PLAN.md section 8 ("CI 门禁记录", "第五轮修复后的不使用缓存的运行")
records as the evidence for phase 1 exit item 1 under S11. Run started by hand
(`workflow_dispatch`) with `no_cache: true` on commit `fd47de32`, whose code is that
of `d26a9937`. Downloaded with `gh run download` and `gh run view --log` on
2026-10-08; the artifacts on GitHub expire on 2026-11-06.

| Path | What it is |
| --- | --- |
| `job.log` | The full job log (`gh run view 37700866188 --log`). GitHub masks the checkout token as `***`. Skipped steps print nothing, so the two cache steps do not appear; `Native setup` shows `Compiling cidre v0.11.10` |
| `job-steps.json` | Step names and conclusions: both `actions/cache` steps `skipped`, every other step `success` |
| `gates/` | The `margin-gates-fd47de32…` artifact: the output of `run-gates.mjs` on the runner. `summary.json` lists no uncommitted paths |
| `native/` | The `margin-native-fd47de32…` artifact without the built `index.darwin-arm64.node` binary: `BUILD-INFO.txt` (with the binary's sha256) and `setup-native.log` |
