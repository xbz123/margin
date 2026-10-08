# Code provenance

This file records where every non-baseline piece of code, test, script or asset on this branch came from. Anything not listed here and not changed in a commit on this branch is unmodified baseline code from `a786910e` (see [BASELINE.md](BASELINE.md)).

## Source rules

| Source | May be used | Record |
| --- | --- | --- |
| Baseline `a786910e` and its ancestors | Yes, under AGPLv3 | Nothing extra; git history shows it |
| Other upstream AGPL commits published before 2026-06-01 IST | Only after checking the exact commit, file contents and license, and finding evidence of publication | Commit, path, blob, evidence |
| Upstream commits published on or after 2026-06-01 IST (including the 1–24 June AGPL-labelled window) | No. Not copied or cherry-picked, and not used as a template | — |
| Earlier Margin branch (`codex/ai-assistant-refactor`, personal import `fcfbb02a` onward) | Only lines and files written for Margin that contain no post-June upstream code, prompts, comments, tests or assets | Margin commit, path, check performed |
| New code written on this branch | Yes | Written against the behavior described in [ADAPTATION.md](ADAPTATION.md); the commit message says so |

Notes:

- Renaming, reformatting, moving or lightly rewriting code does not resolve a provenance problem.
- The person writing this branch has read later upstream code while auditing. New implementations are therefore described as "written for this branch from the behavior requirements". They are not claimed to be a verified clean-room rewrite.
- Third-party packages, fonts and icons keep their own licenses. They are not relabelled AGPL.
- Commit dates and authors are recorded as evidence, but do not by themselves prove a license right.

## Ledger

Stage 1 review 8 is written on this branch from the scope-refusal behavior requirements.
The old Margin branch was inspected as a behavior reference, not copied. Four source
scanner matches are generic JavaScript: `signal?.throwIfAborted();` (the native
AbortSignal cancellation check), `lastError = error;` and `throw lastError;` (retain
and rethrow the final sequential-attempt error), and `const policy = { transcript: false };`
(one-field synthetic test policy). These exact lines are individually
allowlisted in the scanner configuration; matching them is not evidence of copying.

Rows are added as code is brought in. "Check" is what was done to confirm the source.

| Item on this branch | Source | Basis | Check | Commit |
| --- | --- | --- | --- | --- |
| Whole tree at branch start | Upstream `a786910e` | AGPLv3 | [BASELINE.md](BASELINE.md) | `a786910e` |

## Earlier upstream: free-cluely

Natively's first commit (`0a73eb77`, 2026-01-27) has the Electron skeleton of [Prat011/free-cluely](https://github.com/Prat011/free-cluely), which is under the Apache License 2.0: the same file names (`main.ts`, `preload.ts`, `ipcHandlers.ts`, `LLMHelper.ts`, `WindowHelper.ts`, `ScreenshotHelper.ts`, `ProcessingHelper.ts`, `shortcuts.ts`) and structure. A line comparison against free-cluely `0ba93eff` (2025-12-05) found:

| Tree | Electron substantive lines | Same as free-cluely |
| --- | --- | --- |
| Natively `0a73eb77` | 5,104 | 1,004 (20%) |
| Baseline `a786910e` | 37,184 | 1,136 (3%) |
| Earlier Margin `b8ade3f7` | 77,408 | 656 (0.8%) |

The baseline credits neither free-cluely nor the Apache License. Apache-2.0 §4 requires keeping its license and attribution, so a NOTICE entry is added in phase 2. free-cluely covers none of the post-June code, so it does not reduce the rewrite.

## Open license questions

1. **The MIT authorization in the earlier Margin README.** Not seen; not relied on here.
2. **The status of 1–24 June 2026 upstream commits.** Not used. Revisit only with legal advice.
3. **Bundled third-party assets** (the Inter font under `src/font`, icons and images under `assets/` and `src/icons`). Each keeps its own license file. Their licenses are rechecked before any release.
