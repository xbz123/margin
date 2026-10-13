# S42-05 local acceptance

2026-10-13. Source baseline `935f90a3` plus the S42-05 workflow, evidence checker,
three synthetic self-tests and exact generic-idiom provenance entries. No product
STT, prompt, recording, retry or platform behavior changed in this ticket.

Claude Opus 5.5 medium supplied the patch through a read-only session after the
earlier write-permission interruption. The main agent independently reviewed the
workflow and checker and applied it, fixing the explicit-reference trailing-newline
case before testing. The workflow still runs only on manual dispatch or the
existing push opt-in; S43 authorizes manual dispatch after each ticket commit.

Local checks:

- Guarded `gateEvidence.test.mjs`: 3/3 pass. Includes whitelist/path rejection,
  missing/failed/unfinished/skipped/isolation evidence and a valid control.
- Existing `yaml` parser accepts the workflow; no dependency added.
- Final `run-gates.mjs --out docs/margin/evidence/S42-05`: 16/16 passed,
  984 tests, 983 passed, 0 failed, 1 existing skip. See `summary.json` and raw
  per-step logs. The first full run failed only G2; `provenance-initial.log`
  records the reviewed generic matches. Final G2 has zero unreviewed hits.
- `gate-evidence.mjs required docs/margin/evidence/S42-05`: pass against the
  completed real output, not only the synthetic fixtures.
- `git diff --check`: pass.

The main agent also checked the pending AG-51 repair (`ccee35dd..935f90a3`):
removed library calls have no surviving consumers, scene guidance has one append
site, explicit empty system instructions remain empty, and both real chat IPC
paths retain data-scope rejection. Current guarded consumer and renderer tests
passed in the full run. This is repair verification, not real model quality or a
phase-5 product sign-off; initial AG-51 gate artifacts were not modified.

Machine-specific repository/account/temp prefixes and the Node binary path in
generated logs are normalized for publication. Outcomes, counts, test content and
source commit are unchanged. No real service, credential, audio or display was used.

Public CI: run [38333829717](https://github.com/xbz123/margin/actions/runs/38333829717)
succeeded on `a5b7c75ab8d80c55a555ecbb72b35f3cc30a0bfb`, including the required-check
and release-identity contract steps. See `ci-result.json`. `no_cache=false`,
`package_apps=false`; packaging, release and real-service checks were not run.
