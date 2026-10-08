# S18 dependency reduction: implementation and required verification passed

The local checkpoint below was committed as `44377a01`. Its required no-cache
CI `37838491368` subsequently passed; actual package and artifact checks are in
`evidence/CI-37838491368/`. S18's defined verification is complete, pending the
user's independent read-only review. AG-26 and full AG-25 remain incomplete.

This separate change follows the seven approved S18 conditions. Its working-tree
base is `3ac02ece`. Only the root production declarations tap, sqlite3 and
screenshot-desktop are removed. No retained functionality or replacement library
is introduced. The normal notice verifier still rejects ten unresolved candidates.

## Reachability and lock evidence

`checks/dynamic-load-audit.json` records the pre-change tracked-source AST scan,
load expressions, source hashes and context. The production nonliteral callers
resolve fixed native-module candidates or better-sqlite3/keytar; test callers
resolve dist outputs and explicit SDK names. `dynamic-load-addendum.json` covers
the generated native entrypoint and root build configuration. Its arbitrary
NAPI_RS_NATIVE_LIBRARY_PATH override is an explicit static-analysis limit, not
executed or proven safe for arbitrary user-supplied modules. Setup, package
scripts and CI do not call the removed packages. Node's TAP reporter is built in.
Source maps alone are not used as proof of runtime non-use; CI/package evidence
is still required. Main-thread checks independently matched the recorded original
nonliteral-site source hashes and inspected the production callers.

The offline npm lock-only calculation used --ignore-scripts and no installation.
Lock entries fall from 1596 to 1334: 262 removed, zero added. All removed nodes
are in the three former root trees, none shared with remaining roots. Root
changes are exactly the three authorized dependencies; independent development
declarations remain. Every retained version, integrity, resolved source and
dependency field is unchanged. See lock-diff.json and lock-graph-check-final.json.

There are 87 retained-node classification changes: 26 devOptional-to-dev, 53
dev-only, and eight dev-plus-peer. The eight peer flags are the remaining ESLint
and electron-builder/Windows-installer development peer paths listed in the
final graph report. An initial narrower audit treated peer flags as unexpected;
their exact scope was then checked and accepted as necessary classification,
not a version or dependency change. The parsed npm output is unchanged after
restoring the old JSON key order (lock-normalization.json); the original npm
output remains locally available. `git diff --minimal` shows 168 added and 3716
removed lock lines, avoiding default diff alignment noise on repeated JSON.

## Automatically regenerated notices

The collector now rewrites only marked current-inventory blocks in README and
NOTICE. It validates both documents' marker boundaries before writing either;
the existing license selection/identity checks are unchanged. Missing or duplicate
markers fail, and original legal text remains outside the generated blocks.
Six exact supplemental sources belonging to removed candidates were removed;
the historical originals remain in Git, not falsely claimed in current Resources.

The generated inventory has 726 candidates, 382 texts, 33 exclusions, ten
unresolved candidates and two deferred Electron notices. Of 262 deleted lock
nodes, six were previously excluded and 256 were candidates. Of 87 newly dev
nodes, 86 leave the candidate set; has-flag remains because current application
maps contain it. Thus exactly 342 candidates and six exclusions leave the set.

The five removed gaps are ansi-tokenize, npmcli/agent, once 1.1.2,
screenshot-desktop and err-code. Eastasianwidth remains. All other unresolved
objects and retained component fields are unchanged except has-flag's basis.
`checks/main-integrity.json` independently verifies this result and every current
text hash. The 124 deleted generated texts total 190774 bytes; all were tracked,
ordinary non-symlink files with matching content-address hashes and no remaining
references. `orphan-texts.json` maps each to its old owners. Deletions are exactly
that list and recoverable from Git. No other cleanup occurred.

## Local checks and pending CI

All 16 local gate steps have actual exit code zero. There are 114 test files,
884 tests, 878 pass, zero failures and six unchanged skips. AG-09 6/6, storage
5/5, startup 1/1 and renderer 1/1 pass. Five skips predate diagnostics; the sixth
is the real otool case under the default no-exec guard, separately validated in
the previous AG-25 target run. All executable app tests used X2 and synthetic
HOME with mock keychain/providers/devices. No native rebuild happened locally.

The license target has the existing nine cases plus two summary/stale-install
cases. Logs retain the initial and final implementation runs; the last duplicate
run adds no coverage. Only the descriptive title changed afterward, and the full
gate run covers that final file. Collection remains exit 1 for ten missing notices.
Post-build regeneration of manifest, README and NOTICE is byte-identical.

Committed gate logs redact only local checkout/temporary-root prefixes; their
raw and stored hashes are recorded and raw originals remain locally available.
Check records replace local evidence paths with `<local-evidence>`. This evidence
does not claim a fresh installation on the local machine: physical old packages
remain installed, and the required no-cache CI must install from the reduced lock.

At the local checkpoint, no-cache CI and a new package diagnostic were pending.
Those checks subsequently passed on the exact implementation commit, including
clean installation/native build, all gates, removal and shared-package evidence,
native architecture/hash checks, expected stop and text-only upload scope. See
CI 37838491368. This does not accept AG-26, full AG-25, native vendor/source
obligations or the Claude stage-exit review.
