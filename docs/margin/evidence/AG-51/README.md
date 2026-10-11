# AG-51 local implementation

Starting revision: `dd6ef564`, branch `codex/margin-agpl-migration`. Local-only
delivery; no push, CI, real credentials, real user data, model service, device,
permissions or formal application identity. Full Electron gates and review belong
to Claude. The iconutil sandbox failure is the predeclared exception, not a pass.

Review repair starts from `ccee35dd`. Claude reported full gates 16/16 on the
initial implementation (985 pass / one existing skip); `gates/` remains untracked
and is neither modified nor submitted by this repair. `checks/` now holds only
the final repair run, not a claim that Claude reviewed the repaired revision.

## Contract and entry map

- `generate-what-to-say` retains AG-42's manual preparation and
  IntelligenceManager/Engine -> WhatToAnswer -> LLMHelper -> stage-3 transport.
  Automatic scene is interview. The existing UI Written choice routes the action
  to its typed-question handler, as before.
- `gemini-chat-stream` (typed question, including attached images) defaults to
  written. Existing `generationKind` selects interview or written explicitly;
  Question mode adds `auto` and omits that override. The generation budget and
  prompt now follow the same choice. **With no Question mode selection, typed
  and screenshot questions use the written scene AND written generation policy.**
  This changes the previous default interview budget (10 s first token / 60 s
  total) to the configured written budget (default 180 s total, no interview
  first-token timer): written/code/image answers need the same complete-response
  policy as their scene. Explicit interview restores the interview policy;
  speech-driven manual answers still default to interview.
  Identity-only application replies remain local and do not call a model.
  NativelyInterface's spoken-question path explicitly sets skipSystemPrompt=true;
  this now produces no system message in both stream and non-stream chat, without
  bypassing scope checks. The option stays declared because it has a live caller.
- Recap, follow-up, brainstorm, code hint, assist, structured/image analysis and
  legacy non-streaming compatibility APIs retain their task-specific prompts;
  they are not reclassified as ordinary question entry points. No retired mode,
  profile or automatic-answer path is restored.
- `prompts.ts` exposes base and scene constants, composed by scenarioPrompts.
  Interview base is the settled identity/execution/context/coding prefix;
  interview scene is the settled answer instructions plus the default suffix.
  Written base is the settled identity/security prefix; written scene is the
  settled style/coding section. Different base variants preserve S29 wording.
  Tiny interview retains its tiny prefix and the same default suffix.
- Joined defaults have **zero text differences** from the starting commit:
  written 2880 UTF-8 bytes, SHA-256
  `a5111f07665fddb60bd5f413cc5af9aa867c0c6e1e7e2d2af9ba00dc30710997`;
  interview 22930 bytes, SHA-256
  `ee88d571732307617956d7d5cbf415975c86cfc6e31f4b4622564cfb1ced0c7b`.
- LLMHelper appends scene-selected Skill text and additional instructions after
  those defaults and before the existing language suffix. A labelled lower-trust
  block explicitly cannot replace defaults/security/data scope rules; its JSON
  text escapes XML delimiters. No capability is derived from this text: no tool,
  script, attachment loading, code execution or network operation. Existing
  provider scope checks and AG-50 Local Context placement remain unchanged.

## Local data and UI

`prompt-settings.json` under the application's userData is independent of
`local-context.json`. The unused baseline folder library has been retired, not
migrated. Existing user directories are not read, changed or removed. Only synthetic paths were
used here. It stores imported text snapshots, scene selections and additions;
it never reopens original files during generation. Atomic replacement, bounded
reads, UTF-8 validation and schema checks reject corrupt/oversized data.

The new card is inside the existing Skills settings tab, using SettingsKit and
useI18n. No tab/page reorganization or language persistence. Native-dialog import
installs one `.md` copy (no renderer-supplied path), with this intentionally small
format, not general YAML:

```markdown
---
name: concise-answer
description: Short direct answers
---
Keep the final answer focused on the question.
```

Names: lower-case ASCII letters/digits/hyphen/underscore, 1–80 characters and a
letter/digit first. Description: one line, 1–300 characters. Instructions must be
nonempty. File limit 32 KiB; maximum 16 Skills; duplicate names rejected, no silent
overwrite. Unknown metadata (including tool declarations) is rejected. Folders,
attachments, archives and block-style YAML are not imported. Existing directory
contents are not automatically activated or migrated into this format.

Additional instructions: at most 4000 JavaScript UTF-16 code units per scene,
enforced in UI and main process; empty string restores the default. Restore
scenario defaults also deselects its Skill. Removing a Skill clears its selections.
Both changes are saved locally and invalidate in-flight generations. Corrupt or
unreadable settings fail closed on scene-aware generation; the card offers a
separate confirmation/cancel action to atomically clear this store without parsing
it. Failed clear retains the recovery controls. Original imported files and the
existing user directories are never cleared by this action.

Skills now **append**, rather than replacing DEFAULT_ANSWER_PROMPT_SUFFIX. S29.3
requires user-authored additions to follow defaults, never replace them; applying
that rule to imported instructions prevents a Skill from becoming a second
replacement channel. The dead activeSkill parameter chain is removed. Both
selected Skill and added text enter one shared user_guidance block, asserted at
the protocol boundary.

## Review retirement and G6 test map

Deleted files: `src/components/settings/SkillsSettings.tsx` and
`electron/services/__tests__/SkillsIpcWiring.test.mjs`. SkillsManager retains only
the prompt import/store facade; its folder library and builtin prompt text are
deleted in place. The generic test moves to IpcInvokeCoverage.test.mjs.

| Original SkillsIpcWiring case | Disposition |
| --- | --- |
| skills:list and skills:open-folder handlers are registered | Removed: both obsolete channels retired |
| preload exposes skillsRefresh / skillsOpenFolder | Removed: obsolete bridge methods retired |
| electron.d.ts declares SkillSummary and the two skills methods | Removed: obsolete types and bridge retired |
| SkillsSettings renderer guards against a missing bridge | Removed with that page; PromptSettingsUi covers the surviving card and bridge behavior |
| every preload ipcRenderer.invoke channel has a matching ipcMain.handle registration | Preserved in IpcInvokeCoverage; all channels checked, no missing-channel allowlist |
| SkillsManager.listSkills returns the builtin humanize-ai-text skill | Removed: no builtin seeding or directory library remains |

The existing mounted language test now mounts PromptSettings, preserves unsaved
text across language switches, and checks that switches do not add IPC reads.
The translation fallback test uses the surviving Save label instead of Open Folder.
Thirteen retired rules guard skills:list, skills:open-folder, skillsRefresh,
skillsOpenFolder, skillsDir, getSkillsDir, ensureBuiltinSkills, BUILTIN_SKILLS,
humanize-ai-text, humanize-text, activeSkill, and the two deleted file paths.

## Evidence

Final logs only: `checks/`. `summary.json` records the selected local gate steps;
this is not a full 16/16 gate report. `tests.files.json` and `tests.tap` are the
125-file unit inventory/result. Commands are run from this worktree; TMPDIR and
npm cache are directed to the disposable worktree-local `.agy-tmp/`.
Machine-specific path prefixes in logs are normalized to `<repo>` / `<account>`;
test outcomes and diagnostics are unchanged. Isolation selftests: 12/12 pass.

| Command | Exit/result |
| --- | --- |
| `npm run build:electron` | 0 |
| `npx --no-install vite build` | 0; existing chunk-size advisory |
| `node_modules/.bin/tsc --noEmit -p .` | 0 |
| `node_modules/.bin/tsc -p electron/tsconfig.json --noEmit` | 0 |
| `node scripts/margin/preload-contract-check.mjs` | 0 |
| `node scripts/margin/ipc-channel-check.mjs` | 0 |
| `node scripts/margin/isolation/run-node.mjs --test --test-timeout=60000 --test-reporter=tap <file>` for all 125 unit files | 981 tests: 979 pass, 1 fail (known iconutil sandbox restriction), 1 existing skip; no hung files or isolation violations |
| Guard/native isolation selftests via run-node `--allow-blocked` | 0; deliberately attempted operations are blocked, not executed |
| `node --check tests/margin/answer-regression.test.mjs` and `outbound-renderer.test.mjs` | 0 |
| `node scripts/margin/retired-check.mjs --all` | 0 |
| `node scripts/margin/provenance-check.mjs --max-hits 0` | 0 |
| `git diff --check` | 0 |

AG-51's seven behavior tests cover immutable default text, validation/bounds/installation,
per-scene selection, the full manual/typed IPC-to-protocol chain, denied scope
zero-send, rejected sender, native selection cancellation, preload contracts,
both UI languages and successful/failed/cancelled recovery. The review additionally
checks single-block guidance, explicit skip on both chat paths, scope denial when
skipping, and default written generation deadlines. Five retired-feature tests
are deleted as mapped above; no general invariant is weakened. Source dispositions and every new exact G2 match are in
PROVENANCE's AG-51 ledger.

Not verified: full Electron gates, real file picker/interactive UI, actual model
quality or injection resistance, real services/devices, packaging and CI. Tests
prove request structure and local scope enforcement, not model obedience.
No domain stop condition was encountered. Builds and test fixtures are
regenerable; `.agy-tmp/` is deleted before commit.
