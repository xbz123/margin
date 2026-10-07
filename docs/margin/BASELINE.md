# Margin AGPL baseline

Margin is a modified version of Natively. This branch (`codex/margin-agpl-migration`) starts from one AGPLv3 upstream commit. The evidence for its publication date, and the limits of that evidence, are set out below. Margin's later changes are re-applied on top of it, and each change records where its code came from (see [PROVENANCE.md](PROVENANCE.md)).

## Fixed baseline

| Item | Value |
| --- | --- |
| Upstream repository | https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant |
| Commit | `a786910e33767a00116a519a3009ec14db812123` |
| Subject | `feat: v2.7 release — audio reliability, vision capability, macOS signing, UI polish & license hardening` |
| Committer date | 2026-05-30T03:03:16+05:30 (2026-05-29T21:33:16Z) |
| `package.json` | `natively` 2.7.0 |
| Root `LICENSE` | GNU Affero General Public License v3 |
| README license section | "Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0)" |
| Tree twin on current `upstream/main` | `d6a1e801ba946370fe9e1849fa7ff1fc3ae80867` (identical tree `96dd6413`; upstream later rewrote history, so `a786910e` itself is only reachable from other upstream branches) |

## Why this commit

On 2026-06-24 upstream replaced the root license with the "Natively Personal Use Source License v1.0". That license states an effective date of 1 June 2026, says it applies to versions released on or after that date, and says it does not take back rights already granted under an earlier license. Upstream is based in India (IST, UTC+05:30).

The aim is a commit that was public under AGPLv3 before 1 June 2026 in every timezone. Commit dates are set by the author and do not show when a commit was published. The baseline was chosen using indirect evidence from GitHub's fork records:

| Fork | Created (GitHub, UTC) | Last push (GitHub, UTC) | Fork `main` today |
| --- | --- | --- | --- |
| odzorp/natively-cluely-ai-assistant | 2026-05-30T03:08:21Z | 2026-05-29T21:33:26Z | `a786910e` |
| KOKOSde/natively-cluely-ai-assistant | 2026-05-31T20:24:24Z (01:54 IST, 1 June) | 2026-05-31T20:25:11Z | `a786910e` |
| RMPOD/natively-cluely-ai-assistant | 2026-06-01T03:03:01Z | 2026-06-01T00:00:33Z | `a786910e` |

Checked on 2026-10-07 with `gh api repos/<fork>/commits/main` and the upstream fork listing.

How strong this is:

- **What is recorded.** The creation and last-push times are recorded by GitHub, not set by the author. The `main` values are what those forks show today.
- **What the odzorp fork shows.** Its last push is earlier than its creation time. That is consistent with a fork that has not been pushed to since it was made. If so, `a786910e` was public on GitHub by 2026-05-30T03:08:21Z, which is before 1 June in every timezone.
- **What remains unproven.** This is an inference from current API data, not a historical snapshot of upstream. It is not independently proven that the forks' `main` was never changed, or what upstream `main` pointed to at any particular moment. No archived copy of the upstream repository from that time was checked.
- **Which time we cannot know.** GitHub only records the upstream repository's latest push. The push history of the upstream repository itself before 1 June is not available to us.

The baseline stays `a786910e`. It is the commit with the most direct pre-1-June evidence found, and the user confirmed it on 2026-10-07. This evidence is not a legal determination.

Other candidates and what is known about them:

- **`f311389f`** (package version 2.7.0). Committed 2026-06-01T05:12:40+05:30. The RMPOD fork, created 2026-06-01T03:03Z, shows `a786910e` rather than `f311389f`. That suggests `f311389f` was not on upstream `main` at that time. When it first became public, and on which branch, is unknown; no evidence shows publication before 1 June.
- **`73d9b76a` / `f63d4b93`** (committed 2026-05-31, 14:11 IST). No evidence was found either way about whether they were public before 1 June. Not used.
- **Commits from 1 June to 24 June.** The root LICENSE still said AGPL, but the later license claims versions released from 1 June. Their status is uncertain, and they are treated as restricted.
- **`v2.6.0`** (`f9098520`, tag and committer date 2026-05-05). An AGPL tag and an ancestor of `a786910e`. Its publication date is not independently evidenced either. It lacks 60 later commits.

## Verification commands

```bash
git show a786910e:LICENSE | head -3
git show a786910e:package.json | grep '"version"'
gh api repos/RMPOD/natively-cluely-ai-assistant/commits/main --jq .sha
gh api 'repos/Natively-AI-assistant/natively-cluely-ai-assistant/forks?sort=oldest&per_page=100' --paginate --jq '.[] | [.created_at,.full_name] | @tsv'
```

## Baseline state at checkout

Run in this worktree on 2026-10-07, with Node 26.0.0 and dependencies from `npm ci --ignore-scripts` (no model downloads):

- `node scripts/build-electron.js`: exit 0.
- `vite build`: exit 0.
- `tsc -p tsconfig.json --noEmit` (renderer): exit 0.
- `tsc -p electron/tsconfig.json --noEmit`: exit 2, 33 errors already present upstream.
- `premium` and `natively-api` are empty submodule gitlinks; upstream's open-source build loads premium code only when it exists.

## Scope note

The README of the earlier Margin branch says Margin is MIT-licensed "based on the original author's written authorization". That authorization has not been seen or verified. This branch does not rely on it: the work as a whole is AGPLv3, and third-party components keep their own licenses.
