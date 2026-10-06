# Margin AGPL baseline

Margin is a modified version of Natively. This branch (`codex/margin-agpl-migration`) starts from one published AGPLv3 upstream commit. Margin's later changes are re-applied on top of it, and each change records where its code came from (see [PROVENANCE.md](PROVENANCE.md)).

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

The baseline therefore has to be a commit that was public under AGPLv3 before 1 June 2026 in every timezone. Commit dates are set by the author and cannot prove when a commit was published. GitHub's own fork creation times can: an unmodified fork's `main` shows what upstream `main` was when the fork was made.

| Fork | Created (GitHub, UTC) | Fork `main` |
| --- | --- | --- |
| odzorp/natively-cluely-ai-assistant | 2026-05-30T03:08:21Z | `a786910e` |
| KOKOSde/natively-cluely-ai-assistant | 2026-05-31T20:24:24Z (01:54 IST, 1 June) | `a786910e` |
| RMPOD/natively-cluely-ai-assistant | 2026-06-01T03:03:01Z | `a786910e` |

Checked on 2026-10-07 with `gh api repos/<fork>/commits/main` and the upstream fork listing.

Rejected candidates:

- `f311389f` (package version 2.7.0): committed 2026-06-01T05:12:40+05:30, and still not on upstream `main` at 2026-06-01T03:03Z. It was published on or after the effective date.
- `73d9b76a` / `f63d4b93` (2026-05-31, 14:11 IST): there is no evidence they were public before 1 June, and `main` was still `a786910e` after midnight IST.
- Commits from 1 June to 24 June: the root LICENSE still said AGPL, but the later license claims them. They are treated as restricted.
- `v2.6.0` (`f9098520`, 2026-05-05): an AGPL tag and an ancestor of `a786910e`. Usable, but it lacks 60 later commits and offers no stronger evidence.

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
