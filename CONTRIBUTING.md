# Contributing to Margin

These rules apply to every contributor and to every coding agent working for one.
Agents load them through [AGENTS.md](AGENTS.md). Where a rule below cites PLAN,
[docs/margin/PLAN.md](docs/margin/PLAN.md) holds the full text.

Keep changes scoped. Explain the observable behavior, boundary and checks
actually run. Preserve unrelated edits. Do not commit recordings, datasets,
credentials, models, build directories or machine-specific configuration.

## Where things are written

Each kind of fact has one home. Update that home in the same commit as the
change it describes; do not start a second copy somewhere else.

| What | Home | Changes when |
| --- | --- | --- |
| What the product should do | [docs/product.md](docs/product.md) | A user decision changes behavior. Replace the old text in place; mark unconfirmed items `(proposed)`. |
| Reader summary | [docs/overview.md](docs/overview.md) | Any change to the spec or architecture that it summarizes. |
| System structure and route | [docs/architecture.md](docs/architecture.md) | A change adds a component, interface, data-model change or deployment shape. |
| Execution rules, gates, open tickets | [docs/margin/PLAN.md](docs/margin/PLAN.md) | A rule changes, or a ticket opens or closes. |
| Current state and what waits on whom | [docs/wayfinder.md](docs/wayfinder.md) | Work finishes, gets blocked, or starts waiting on a person. |
| Test runs, CI ids, device results | `docs/margin/evidence/<ticket>/` | Each recorded check. Evidence is written once and never rewritten. |
| History | `docs/margin/archive/` | A document stops being current. Move it there; fix only its links. |

Do not add new plan, handoff or report files next to these. A handoff is a
wayfinder entry plus a pushed branch. Code that changes behavior without a
matching spec entry is not finished.

## Branches

- **One mainline: `main`.** Test packages, public CI and
  releases come only from it (PLAN R16). Mac and Windows share it; there is no
  per-platform branch. Until 2026-11-28 the mainline was called
  `codex/margin-unified`; that name is retired, do not commit to it.
- **Work branches** start from the latest mainline and carry one topic:
  `<name>/<topic>`, for example `xbz/practice-demo` or `codex/practice-demo`
  for an agent's branch.
- **Push a work branch the same day it gets its first commit.** A branch that
  exists only on one machine does not exist for anyone else, and work on it
  counts as not done.
- **Keep branches short.** Merge within a few days. If a branch must live
  longer, merge the mainline into it at least weekly and say why in its
  wayfinder entry.
- **Finish a branch** by merging it into the mainline with a merge commit
  (`git merge --no-ff`) as described in Merging into the mainline. Do not squash or rebase
  commits that evidence files already cite by SHA. Then delete the branch on
  `origin` and locally, and remove its worktree.
- **Never** force-push the mainline, rewrite pushed history, or push any branch
  other than the mainline to the public repository `xbz123/margin` (PLAN R15).
- **The old ai-assistant line is read-only history.** The branch `old` and the
  tags `v1.0.0-macos` / `v1.0.0-windows` have no common history with Margin. Do not merge or cherry-pick from them (PLAN R3); if
  something there is still wanted, write it into the spec and implement it
  again.

## Commits

- One logical change per commit, in the form already used here:
  `type(scope): what changed`, where type is `feat`, `fix`, `refactor`,
  `test`, `docs` or `chore`.
- The body says why, cites the user decision or ticket, and names what was not
  checked.
- Commit the docs that describe a change together with the change.

## Merging into the mainline

1. On the work branch, run the full local gates and keep the output
   (PLAN R17): `node scripts/margin/run-gates.mjs --out docs/margin/evidence/<ticket>`
2. Update the spec, overview, architecture, PLAN ticket and wayfinder entry
   that the change touches.
3. Merge into the mainline, push it to `origin` and to the public repository,
   then run public CI on that exact commit and wait for success (PLAN R15,
   R18). The public repository only mirrors the mainline, so this is the first
   CI run the change gets. If it fails, fixing it comes before any other merge.
   A docs-only commit skips CI.
4. Test-package tags (`margin-v2.7.0-test.<n>-windows` / `-macos`) go only on
   mainline commits whose public CI passed (PLAN R14).

## Working with coding agents

The person who runs an agent is responsible for what it commits.

- An agent reads [AGENTS.md](AGENTS.md) and this file before its first change.
- One task, one branch, one worktree under `.worktrees/<branch>`. Only one
  writer works in a worktree at a time (PLAN R25). Parallel agents use separate
  worktrees.
- An agent does not commit, push, tag, open pull requests or install builds
  unless its human authorized that for the task (PLAN R9). Authorization for
  one task does not carry over.
- An agent does not call paid services or use real devices without per-run
  approval naming the service, count and cost (PLAN R7), and never reads or
  prints keys.
- An agent finishes in one of two states: merged into the mainline as above,
  or handed off as a pushed branch with a wayfinder entry saying what is done,
  what is not, and the next step. It reports changed files and the commands it
  actually ran with their exit codes. A passing check from an agent is not user
  sign-off (PLAN R23).

## Provenance

Application source is AGPL-3.0-only. Read [BASELINE](docs/margin/BASELINE.md),
[ADAPTATION](docs/margin/ADAPTATION.md) and [PROVENANCE](docs/margin/PROVENANCE.md)
before imports. Later upstream code or an older personal branch is not an
automatically approved source. Renaming copied code proves no license right.
Record the exact reference, path, license and applicable approval. Third-party
components retain their own original license and copyright notices.

## Development safety

Use locked dependencies and install without lifecycle scripts. Do not repair
unrelated dependencies, change global configuration or rebuild native code as
an incidental check. Native modules need their own toolchain and build
provenance; JS success is not clean native or Windows/Linux acceptance.

Run executable tests through `scripts/margin/isolation/run-node.mjs`. It uses a
temporary profile, clears provider credentials and records blocked access.
Grant only exact needed local executables. Electron tests must retain fake
credentials, synthetic content, mock devices/keychain and loopback transports.

```sh
node scripts/build-electron.js
npx vite build
node scripts/margin/isolation/run-node.mjs --allow-exec Electron \
  --test --test-timeout=180000 tests/margin/answer-regression.test.mjs
node scripts/margin/run-gates.mjs --out <new-evidence-directory>
git diff --check
```

Keep implementation, synthetic checks, full gates, fresh CI, package inspection,
real-service/device tests and independent review separate. State deferred cases
and excluded platforms. Older CI cannot validate new code.

## License inventory

`scripts/margin/collect-licenses.mjs` reads original local notices from installed
lock candidates, dependencies embedded in main-bundle source maps and an
existing Cargo registry cache. It installs nothing and does not build native
code. `--fetch-missing` retrieves only licensing material and version metadata
from official references; `--github-via-gh` can use an existing GitHub session
for public read-only metadata without printing credentials.

Review `licenses/manifest.json` unresolved entries. SPDX fields do not solve
missing texts, native vendored components, multi-license choices or copyleft
source/relinking obligations. See [licenses/README](licenses/README.md).
Packaging must retain LICENSE, NOTICE, the inventory/texts and full fixed-version
Electron/Chromium notices; the package hook checks hashes. Actual asar, unpacked
libraries, Resources and Frameworks still require complete artifact-to-inventory
comparison before claiming distribution compliance.
