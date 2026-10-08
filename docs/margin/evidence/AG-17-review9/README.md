# Ninth review: phase 1 acceptance checks (2026-10-08)

Supplementary checks run by Claude during the read-only acceptance review of source
`c43b10e9` (PLAN.md section 8, "阶段 1 出口验收"). All ran under the X2 isolation guard
on the build output of the clean-tree gate run in `AG-17-review8/gates/`; no source
file was changed.

| File | What it shows |
| --- | --- |
| `scope.tap` | `ScopeLocalFallback.test.mjs` rerun: 51/51 pass |
| `storage-1.log` .. `storage-3.log` | The meeting storage harness run three times in a row (the first local run of review 8 stalled on a restart): 5/5 each, about 23 to 25 s |
| `m25-null-reload-keeps-edit.storage.log` | Mutation (renderer bundle `dist/assets/index-CgmbF9wB.js`): when the reload after a failed save returns null, the field is not restored (`if(r(nt=>ehe(nt,Ze,ie)),…` became `if((Ue||Q)&&r(nt=>ehe(nt,Ze,ie)),…`). Step 6 fails: "a deleted meeting does not leave an unsaved title on screen". The bundle was copied first, restored from the copy and compared with `cmp` (identical) |

Commands (from the checkout root):

    node scripts/margin/isolation/run-node.mjs --test --test-reporter=tap electron/services/__tests__/ScopeLocalFallback.test.mjs
    node scripts/margin/isolation/run-node.mjs --allow-exec Electron --test --test-timeout=240000 tests/margin/meeting-storage.test.mjs

`retired-check.mjs --all` was also run directly (257 rules, 0 failing); its output is
one line and is not archived separately.
