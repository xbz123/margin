# S19-A: exact eastasianwidth override

Base: `518101fd`. The approved override changes only eastasianwidth 0.2.0 to
0.3.0. All 1334 lock nodes remain; only this node's version, resolved URL and
integrity change. Every other parsed lock value, dependency edge and flag stays
unchanged. npm's unrelated JSON key reordering was mechanically normalized back
without changing parsed data. string-width remains 5.1.2.

## Source and retained behavior

Both original tarballs were integrity-checked and their entry paths/types
inspected before isolated extraction, without install scripts. The 0.3.0 archive
still has no LICENSE. All four files match its published gitHead and same-version
commit `1d41951a59d63fb2d77cda021050fc070cae424a`; that later commit adds only
MIT-LICENSE.txt. Its 1043 original bytes retain Copyright komagata. The new
notice is not described as an original tarball member or a grant for 0.2.0.

The complete retained dependency path and the actual string-width call are in
`checks/caller-trace.json`. Only eastAsianWidth is called. X2 comparison of
all 1114112 code points and actual string-width under both ambiguous-width
settings, plus 15 boundary strings, yields 2228254 equal width results.
The unchanged real string-width source was loaded twice with only its eaw
import redirected. The classification table is unchanged. The unused slice
export has six tested boundary differences and a suspected upstream null-check
defect; both are recorded, not patched or claimed behavior-identical.

`checks/compare-widths.mjs` preserves the executed comparison logic with only
paths parameterized. It is diagnostic evidence, not a new runtime or gate
dependency. Run it through the existing X2 run-node wrapper, passing a fresh
directory containing the independently verified tar-0.2.0/package and
tar-0.3.0/package trees. Its saved report includes the isolation-log location.
It downloads/extracts nothing. Arbitrary external native overrides remain
outside the static caller analysis.

Only the local eastasianwidth cache directory was replaced, after identity,
type and byte checks. Its previous 0.2.0 directory is retained privately and
recoverable. No local npm ci, native rebuild or unrelated cache cleanup occurred.

## Inventory and validation

The collector automatically produces 726 candidates, 411 original texts,
33 excluded paths, two unresolved candidates and two deferred Electron notices.
All other 725 components and 44 prior attachments are byte-for-byte unchanged.
All 411 stored text hashes match and no orphan text exists. Main-thread
verification independently refetched the original notice and four source files,
checked tarball integrity, package scope, lock delta and inventory preservation.

Targeted X2 checks retain the full-width comparison, license tests, idempotent
offline regeneration and synthetic Resources verification. The synthetic
verifier reaches all notice-byte checks then correctly rejects the two missing
candidates. A helper's successful expected-failure assertion is not normal
license acceptance.

The complete local gate run in `gates/` has 16 actual zero exit codes:
884 tests, 878 pass, zero fail and six unchanged skips; AG-09 6/6, storage 5/5,
startup 1/1 and renderer 1/1. Raw gate logs remain privately retained; only local
path prefixes are redacted in the committed copies, with both hashes recorded.
Fresh no-cache CI, native-from-scratch and actual package verification are
required for the submitted checkpoint and are not inferred from this local run.

S19-B is not implemented here: react-remove-scroll-bar 2.3.8 and realfft 3.5.0
still fail normal notice verification. Native vendor coverage, corresponding
source/relinking, full AG-25 and independent review remain separate requirements.
No app, native artifact or Release has been distributed by this change.
