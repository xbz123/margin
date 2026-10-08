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

The S17 early AG-25 package diagnostic (`scripts/margin/package-inventory.cjs`,
its separate builder config and `packageInventory.test.mjs`) is written on this
branch from the approved actual-package inventory contract, Node standard-library
APIs and the already installed `@electron/asar` list/stat/read API. The existing
Margin workflow gains manual opt-in and an explicit gate-reference input; ordinary
runs do not package. Only GitHub Actions macOS arm64 may rebuild the temp identity
from empty generated directories and form a `--dir --publish never` bundle in a
dedicated runner temporary directory. Normal Vite build settings are retained;
extra renderer source maps are not generated or added to the package for diagnosis.
The independent diagnostic hook records the unchanged normal license verifier's
actual result, inventories the formed asar/unpacked/Resources/Frameworks tree, and
throws a unique receipt before any signing or publishing. Only a complete receipt
and that exact nonzero builder stop count as successful evidence collection, never
as package acceptance. Missing metadata/maps retain unknown component status;
dynamic-link inspection does not establish native static vendor composition.
Missing renderer maps are a documented evidence blind spot, not proof of absence.
Failures retain diagnostic JSON/logs where available. A separate text allowlist
check precedes five exact report uploads; no app, archive, source-map contents,
native binary or normal native-module artifact is uploaded in diagnostic mode.
This does not implement or pass the full AG-25 signing, launch or joint acceptance
contract, and does not resolve AG-26's outstanding license obligations.
The initial diagnostic source scan retained ten matches for eight generic lines:
`if (explicit) {`, `if-no-files-found: warn`, fixture parent-directory creation,
CommonJS repository-root resolution, SHA-256 initialization, `entries.push(entry);`,
the missing-directory early return, and `async function run() {`. These are the
standard operations in this independently written diagnostic and workflow.
Only their exact lines were allowlisted; no source pool or excluded path changed.
CI `37824733686` fetched newer references under the same configured upstream
prefixes and exposed six additional matches: the Blue Oak 1.0.0 heading
`## Acceptance` in five preserved license texts, and the collector's Node ESM
direct-entry comparison of `process.argv[1]` with `fileURLToPath(import.meta.url)`.
Refreshing those same references locally reproduced all six matches (606678
restricted line keys). The heading was checked against the official canonical
Blue Oak text and the manifest's original package sources; the entry comparison
is independently written standard module/CLI dispatch. Only these two exact
lines were approved. No source-import permission or path exclusion was expanded;
the failing CI and local red/green scans remain recorded as evidence.

The diagnostic's parenthesized-helper path fix is written on this branch from the
failed CI tool output and a minimized read-only system Mach-O reproduction.
`otool-classic` treats a basename ending in `(member)` as archive-member syntax.
The installed tool's help documents `-m` to disable that syntax: `-L` failed on
the `helper (GPU)` path, while `-m -L` succeeded on that exact same path with
unchanged SHA-256. The diagnostic now passes this official option when reading
individual Mach-O files, without copying, renaming or changing package inputs.
The small `inspectDynamicLinks` seam preserves timeout, exit/error handling and
original-path reporting. Real tool failures still make the inventory incomplete.
The regression cases were red before this fix and green afterward, including
an X2 run allowing only `otool` to read a synthetic copy of a system Mach-O
without executing it. That real-tool case is skipped in the default guard
profile, which grants no external executables; the synthetic path and error
regressions remain active there. The license verifier, static vendor-composition
limitations and source-map evidence gaps are unchanged.

The two SPDX-package notice bindings use exact-version published declarations:
`spdx-exceptions@2.5.0` declares CC-BY-3.0 and `spdx-license-ids@3.0.23` declares
CC0-1.0. Their official Creative Commons legalcode.txt full texts are pinned by
SHA-256 in `license-sources.json`; the binding version is the package version,
not the Creative Commons standard version. Each binding also retains the full
original licensing README: exceptions commit `3aa64bec339abc6a3eca00c3436aaa7e154b8799`,
blob `6c927ecc6911929acfeb11617dd067784105d7bb`; ids commit
`a2a975daf48bbc2afdc8e7c304405b44c656fd53`, blob
`ba650628aeb637a4791007f6b0dde09e8b6a78c7`. Both README hashes match the installed
originals. The Linux Foundation/Contributors 2010-2015 statement and Kyle
Mitchell's mechanical-extraction declaration are preserved, not replaced by
invented copyright or endorsement. README attachments alone do not close
missing-full-text entries. The S17 diagnostic observed both packages and their
unchanged identifier JSON bytes; CI 37829181248 completed evidence collection
without accepting the package. The four new source attachments add only three
unique stored texts because the freshly verified official CC0 text is byte-
identical to an existing copy. Byte deduplication borrows no other package's
grant: the new CC0 binding retains its own exact-version declaration and official
source. At that point, only these two former missing-text candidates were removed;
17 missing candidates and separate distribution/vendor/source duties remained.
No collector, dependency, runtime or package-diagnostic logic changes here.

Two further exact-version notice bindings use the same source configuration.
`highlightjs-vue@1.0.0` declares CC0-1.0 in its published package and licensing
README. The official CC0 full terms are retained, together with its complete
README at npm gitHead `2a0d197ec24ba70e019e12a13bd42f006124506a`, blob
`756b1af32b484403f747d57a5b79bd927865c553`, SHA-256
`80f9f8e1bc56298613fa5b2ee0b57ab040f319ce052b076d54c0f96f75c02d2b`.
The README bytes match the installed/published originals. No copyright is
invented from author metadata. The CC0 terms reuse identical stored bytes, not
another package's authorization.

`r-efi@5.3.0` retains its complete original AUTHORS from crate commit
`97b55bed1c2c91dcbf787674849f05337ff80b33`, blob
`7397b2bd6a8580d51fe7b23783f8f1a05fa70291`, SHA-256
`ff92bed461f50338dd703a9ba9aee496a425957873df1d91192776e4bdf5dda7`.
The immutable source and cached crate are byte-identical. This original contains
the full MIT grant and disclaimer; MIT is explicitly selected in the source
attachment, while the declared `MIT OR Apache-2.0 OR LGPL-2.1-or-later` identity
is unchanged. The three copyright statements (Red Hat 2017-2023, Microsoft
2019-2023, David Rheinsberg 2022-2023), all authors and alternative-license notices
remain in the original full text. No generic template or borrowed Apache terms
replace it. These three source attachments add only two unique texts, remove
only these two missing-text entries (17 to 15), and change no candidate or
excluded identity. The collector/checker logic, dependencies, runtime, CI and
package-diagnostic logic are unchanged. Neither this binding nor the platform
labels exclude r-efi/Oboe candidates or close native static-composition and
distribution obligations; at that checkpoint oboe/oboe-sys and realfft still
lacked full notices.

### AG-26 S19-A exact eastasianwidth override

S19-A changes only `eastasianwidth@0.2.0` to `0.3.0` through the exact npm
override `"eastasianwidth@0.2.0": "0.3.0"`. The upstream `string-width` 5.1.2
declaration remains `^0.2.0`; this is an explicit approved deviation, not a
semver-compatible resolution or an upgrade to string-width 7. An
install-script-disabled lock-only update keeps all 1334 lock nodes, dependency
edges and classification flags; only the target version, resolved URL and
integrity change. npm's 87 unrelated object-key reorderings are mechanically
restored without changing its parsed output. No native rebuild or other package
upgrade is performed locally.

The complete retained lock path is @google-cloud/speech -> google-gax -> rimraf
-> glob -> jackspeak -> @isaacs/cliui (also wrap-ansi) -> string-width 5.1.2 ->
eastasianwidth. The latter's only package consumer calls `eastAsianWidth` for
each string-iterator character after ANSI, emoji, control and combining filters.
An AST inspection of 162 production electron/src files finds no direct
eastasianwidth/string-width reference. Computed loads are limited to the
inspected native binary candidates and better-sqlite3/keytar ABI probe; this
does not prove arbitrary external native overrides or untrusted code safe.
Physical test-exclude/string-width cache leftovers are absent from the retained
lock graph and are not reclassified as production users.

An X2 comparison loads the unchanged installed string-width 5.1.2 module twice,
redirecting only its eastasianwidth import to verified 0.2.0/0.3.0 tarball bytes.
All 1114112 code points (including lone surrogates) have identical classifications,
characterLength and length results. Both ambiguous-width settings plus 15
ANSI/emoji/ZWJ/combining/CJK boundary strings yield 2228254 equal string-width
results. The full JavaScript diff is 94 strict-comparison changes and three
slice adjustments; no classification table changes. The unused `slice` export
does change: six tested null/zero endpoint cases differ, such as
`slice('abc', 0, 0)` returning `''` instead of `'a'`. Its upstream end fallback
tests `start === null` rather than `end === null`, after start normalization;
that suspected upstream defect is recorded, not patched or claimed equivalent.
No retained call path uses this export; the whole library is not claimed
behavior-identical.

The official 0.3.0 tarball still contains no LICENSE. Its four files
eastasianwidth.js, package.json, README.md and eastasianwidth.d.ts match both
published gitHead `e5ee638e2039093c924b60d8a2ba7c12c52549f8` and later
same-version notice commit `1d41951a59d63fb2d77cda021050fc070cae424a` byte-for-byte.
The latter adds only MIT-LICENSE.txt, retaining `Copyright komagata`; its
1043 original bytes, SHA-256
`94aa6016fb9d436508366433e9caba061443ca58f4c7eb515caec7badf90ae5a` and Git blob
`e8f4a01dd0f84a8156dcb334eb505d2088b0d1ab` bind only to 0.3.0. Tarball integrity,
both immutable refs and all four file SHA-256/Git blobs are recorded under
`sameVersionEvidence` in license-sources.json and separately checked; the
unchanged collector does not audit those extra provenance fields automatically.
No neighboring-version grant is borrowed for the old 0.2.0 candidate.

Regeneration keeps 726 candidates, 33 excluded paths and two deferred notices;
only eastasianwidth's version identity changes. One original notice raises
unique texts from 410 to 411 and reduces missing texts from three to two.
react-remove-scroll-bar 2.3.8 and realfft 3.5.0 remain unresolved, and normal
package acceptance still rejects the inventory. Native composition,
corresponding-source/relinking duties, fresh no-cache CI and actual artifact
review remain separate requirements; this local check is not AG-26 acceptance.

### AG-26 S19-B restricted published MIT metadata evidence

S19-B introduces `approved-metadata-MIT` only for
`react-remove-scroll-bar@2.3.8` and `realfft@3.5.0`, without changing dependencies,
lockfiles, runtime, CI or package-diagnostic behavior. This is a deliberately
weaker category: a published MIT metadata declaration plus fixed official
standard terms, not a recovered complete original notice, copyright grant,
legal verdict or native/distribution acceptance.

The exact npm archive at
`https://registry.npmjs.org/react-remove-scroll-bar/-/react-remove-scroll-bar-2.3.8.tgz`
matches lock integrity
`sha512-9r+yi9+mgU33AKcj6IbT9oRCO78WriSj6t/cF8DWBZJ9aOGPOTEDvdUDz1FwKim7QXWwmHqtdHnRJfhAxEG46Q==`
and archive SHA-256
`ccc872d7a2dc007cbf9d755f30d56b8d80eabdbe22c44c95a709129bfdc46f01`.
Its complete 2221-byte `package/package.json`, SHA-256
`e372f857ce05f266137c65293436b5380fec42ac311e6acb9378ed78b98d75d0`, is retained
verbatim and matches installed metadata. The exact crate at
`https://static.crates.io/crates/realfft/realfft-3.5.0.crate` matches Cargo.lock
checksum/archive SHA-256
`f821338fddb99d089116342c46e9f1fbf3828dba077674613e734e01d6ea8677`.
Its complete 990-byte `realfft-3.5.0/Cargo.toml.orig`, SHA-256
`d72ddbadf9bb55ed21ae973ac97f0bb4e8df2064af628c54b802b2c7d764c8de`, is retained
verbatim and matches the installed original manifest. Both archive entry lists
were checked for unsafe/duplicate paths and links before separate temporary
extraction; no package code or install scripts were executed.

Both original READMEs express a short MIT declaration: npm byte range
[1702,1715) is `# License` followed by `MIT`; crate range [6563,6575) is
`License: MIT`. Neither archive supplies a complete original license/copyright
notice file. The published npm gitHead's unresolved source and a later
add-LICENSE change are not used to give 2.3.8 an original grant. Package author
fields are not converted into copyright statements. Official SPDX MIT at commit
`d46e94e2c78ceede1cfc63cfa0396472d2798d4c`, Git blob
`d817195dad53ec992418c28ffca5fbd1cd86502a`, SHA-256
`b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5`, retains its
unfilled copyright placeholders; its bytes already existed in the inventory.

The collector restricts approval to these two exact identities/artifact pins,
checks current artifact integrity/checksum and original/installed metadata
bytes, verifies the declared name/version/MIT license and fixed SPDX URL/hash/
Git blob, and requires the explicit evidence category. Missing category cannot
fall through to the ordinary binding. Metadata attachments alone do not close
missing entries; both metadata texts become hash-checked bundle notice inputs.
Binding resolves after all attachments load, independently of source order.

Regeneration keeps 726 candidates, 33 exclusions and two deferred Electron
notices; the two retained original metadata texts raise unique texts from 411
to 413 and reduce unresolved notice candidates from two to zero. All previous
411 text bytes and unrelated component/source/deferred records remain intact.
The normal byte verifier can pass only with `candidateInventoryOnly:true`;
tampered/missing evidence or any unrelated unresolved notice still rejects.
The S17 diagnostic's mandatory pre-signing stop and acceptance=false are
unchanged. S19-C, actual native vendored composition, source/relinking duties,
fresh no-cache CI and actual artifact review remain separate open gates; this
does not mark AG-26 or distribution acceptance complete.

### AG-26 S18 dependency-scope reduction

S18 removes only the root production declarations for `tap`, `sqlite3` and
`screenshot-desktop`, after checking static imports, dynamic load sites and their
callers, root build configuration, native-loader defaults, setup, tests and CI.
The app's database route retains `better-sqlite3`; screenshots retain Electron
desktopCapturer and the existing Linux shell route. Node's built-in TAP test
reporter is not the removed npm `tap` package. The generated native entrypoint
permits an external `NAPI_RS_NATIVE_LIBRARY_PATH` override; arbitrary external
overrides are outside the static reachability proof, and were not executed.
The old S17 artifact's inclusion evidence is not reclassified as non-distribution.

An offline, install-script-disabled lock-only calculation removes 262 unreferenced
nodes while keeping shared nodes, all retained package versions, resolved sources,
integrities, dependency fields and independent root development declarations.
The 87 retained classification changes are 26 devOptional-to-dev transitions,
53 dev-only flags and 8 dev-plus-peer flags. The latter remain through ESLint
peer paths or electron-builder's peer Windows-installer chain. No new package,
version upgrade, replacement library or native rebuild is introduced here.
The generated lock's parsed values are retained exactly; old object key order is
restored mechanically to keep the diff focused.

The three removed root trees no longer supply the ansi-tokenize, npmcli/agent,
once 1.1.2 and screenshot-desktop candidates. err-code remains installed as a
development dependency, not an application-map candidate; eastasianwidth remains
in scope. Those missing notices leave the current candidate inventory through
the approved graph change, not a fabricated license grant or manual exclusion.
The collector still derives candidates from the lock and application source maps;
physical node_modules leftovers cannot alone re-enter the candidate inventory.
README and NOTICE current-inventory sections are regenerated together from the
manifest within strict markers, leaving original legal prose and attribution
outside those sections intact. Missing/duplicate markers fail collection.

Six now-unreferenced supplemental source entries are removed precisely: the
node-options-to-argv standard binding, both SPDX standard bindings and their two
README attachments, and the ansi-tokenize supplement. Their original licensing
records remain in checkpoints `45b11c5b` and `3ac02ece`; retained historical SPDX
attribution does not assert current manifest or Resources inclusion. All remaining
source bindings retain exact identity/hash checks. Native vendored composition,
remaining missing notices, corresponding-source/relinking duties, and acceptance
of a newly packaged artifact are separate unresolved obligations.

### AG-26 original-notice supplements

Twenty-six source entries supplement format 0.2.2 and oboe/oboe-sys 0.6.1.
format retains its exact commit `4f898096759776b7c84fa7a25b13c923dadfe46e`
README License section (Copyright 2010 - 2014 Sami Samhuri) and JavaScript
header (Copyright 2010 - 2013 Sami Samhuri), including the original MIT links.
The complete fixed official SPDX MIT text supplies standard terms, leaving its
copyright template placeholders unfilled; it neither replaces those original
declarations nor claims the changing linked website is a same-version grant.

Each Oboe wrapper keeps its own original Apache declaration at commit
`7ea2b9b3bc9cdfa9ed4cbfeafdcafb47b3fac4e7` and a separate exact-version
binding to the full official Apache-2.0 text. Author metadata does not become
a copyright notice; the Apache appendix placeholders remain standard
instructions. The wrapper's Google Oboe gitlink
`86165b8249bc22b9ef70b69e20323244b6f08d88` supplies its own complete
LICENSE/AUTHORS/CONTRIBUTORS. Google Inc. attribution does not replace the
Android Open Source Project's 16 distinct original Apache license comments.

All 140 cached vendor files match the exact Git tree blobs: 138 C++/header files
retain their complete leading license comments, and the remaining two README
files contain no additional copyright/license declarations. The exact tree is
not truncated and has no NOTICE. The source-byte inventory and 16-group mapping
are in `scripts/margin/license-inputs/original-notices/coverage.json`; these
checks are not a static-link, target-graph or distributed-binary determination.
The header range is byte zero through the closing `*/` inclusive; subsequent
non-license separator bytes are excluded without normalizing the comment.

Twenty repository-local input containers hold only original licensing bytes
followed by an explicit marker, never implementation source. Each container's
source URL/ref, complete source SHA-256/Git blob and exact byte range are
recorded. The unchanged collector checks input and extracted-text hashes,
copies only bytes before the marker, and retains its strict canonical component
identity checks. The extra provenance fields and 140-file coverage are audited
separately, not falsely represented as automatic collector checks.

Three additional sources retain later official notices without changing package
versions. dingbat-to-unicode's owner explicitly applies the 1.0.2 license to all
previous versions in issue 1 comment 5740760399; its original Copyright (c) 2021
Michael Williamson BSD-2-Clause LICENSE is bound to 1.0.1. stream-events PR 5
merge `3cfd35ab1a68c9fd41c992428e839ad54dcf8017` keeps version 1.0.5 and all
four installed files byte-identical; stubs PR 5 merge
`580b4d8b3a34c1193d5ec10e0db0d6ea4b4c0ec5` keeps version 3.0.0 and all four
installed files byte-identical. Both retain their original Stephen Sawchuk MIT
copyrights (2018 and 2017). This does not assert LICENSE was in the original npm
tarballs.

tr46 0.0.3's original MIT LICENSE at same-version commit
`3a6f29721e7063b9ffd421e461a54beae6170001` keeps Copyright (c) 2016 Sebastian
Mayr. The installed package.json and index.js match that commit; the installed
mappingTable.json (SHA-256
`b6b39724dca9011113a08d9d6910204062b58169e98952acdfbd19bf2c31bbff`)
is reproduced using its documented converter from the official Unicode IDNA
8.0.0 data (793222 bytes, SHA-256
`5e9f5929130b713e698162ac5b60a99ccfb831606686b1c50777cd920b55dee2`).
The original data header keeps Copyright (c) 1991-2015 Unicode, Inc. and its
terms-of-use/source links. The current complete Unicode License v3 (1995 bytes,
SHA-256 `e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96`)
retains Copyright 1991-2026 Unicode, Inc. unchanged. The current official policy
applies v3 to /Public/ Data Files unless another license is indicated; the 8.0
header refers to terms_of_use without naming a different license. This current
coverage does not assert v3 was adopted in 2015 or interpret an upgrade advice
as a retroactive grant. Only the header, not data rows or implementation, enters
the new notice input container. The policy and mapping reproduction are separate
source evidence, not claimed as automatic collector validation.

These 32 new source entries close only seven missing-text entries; dependencies,
lockfiles, collector/checker/runtime/tests/CI code and candidate/excluded
identities are unchanged. Other missing notices and native composition, corresponding-source,
relinking, NOTICE and actual package acceptance obligations remain open.

AG-26's notice collector, package-byte checker, synthetic tests and rewritten
public documents are written for this branch from PLAN's license/documentation
contract and Node standard-library APIs. They import no later application
implementation. License texts retain their package/cache origins or official
immutable references in `licenses/manifest.json`; they are third-party licensing
material, not newly authored application code. Candidate coverage is kept
separate from the actual packaged set and from copyleft source/relinking duties.
Electron's full installed-version notices are copied through `extraResources`
and verified inside Resources before the existing signing hook runs, without
checking the large Chromium file into this repository. This byte check does not
fix or endorse the existing signing behavior, which remains a separate ticket.
The first AG-26 scanner run matched retained standard MIT terms. Fourteen exact
license clauses were reviewed against installed `retry@0.12.0` and
`better-sqlite3@12.11.1` license texts (SHA-256
`01ad164273e8e095abc9dbd1c21e194594a671af7d528cb43ee7b4c903ba7da3` and
`09856b52897c91ab67e7456ef43067019f31dfd3b87fda72e655736b1ebdee55`).
Only the exact reviewed clauses were allowlisted. Three separate generic
matches are the public heading `## Provenance`, the documented existing command
`node scripts/build-electron.js`, and `return found;` returning the collector's
local set. No source pool or path exclusion was broadened.
The final source scan found three additional generic lines: the synthetic test's
`fs.mkdirSync(path.dirname(destination), { recursive: true });`, `await sleep(1000);`
in the original `agent-base@6.0.2` README, and `## Installation` in the original
`isarray@1.0.0` README. The two full READMEs preserve embedded MIT attribution;
their source bytes match inventory hashes `f1425c3b72330fe4fb2aa5a2fb152e939bdf534692a32b5f0b38f74147b98556`
and `ff138e683771b187f3629c383db72ee7d632009010a36d08e18e8d2a34222ec7`.
Only those three exact generic lines were additionally allowlisted.
The exact `licenses/texts/*.txt` Git attributes disable text conversion and
whitespace rewriting for the retained third-party bytes. CRLF and original
trailing spaces remain part of their hashes; ordinary code whitespace checks
are unchanged. Five obsolete collector-generated text hashes, proven absent
from the final manifest references, were removed individually before packaging
configuration was frozen. No arbitrary notice or user artifact was cleaned.
`license-sources.json` separately records the original free-cluely Apache text,
the installed protobuf Google BSD header, authoritative BlueOak terms, libvips
source terms/version metadata, canonical LGPLv3 plus its GPLv3 companion from a
fixed official SPDX commit, and the exact canvas Skia-gitlink LICENSE/AUTHORS.
The later ansi-tokenize add-missing-LICENSE is explicitly supplemental, not
represented as part of the installed 0.1.3 release. Missing exact-version texts
and native distribution obligations remain unresolved and block completeness.
An offline replay exposed a collector cache mismatch for `cidre-macros`: its
cached manifest omits repository metadata while the previously checked official
source is `yury/cidre`. The reviewed fixed repository mappings now apply before
both collection and cache comparison. A synthetic missing-repository replay
failed before that change and passes afterwards, retaining version/checksum,
exact source URL, SHA-256 and Git-blob checks rather than weakening reuse.

### AG-26 authorized removals

Only the following PLAN-listed tracked files are removed. Each entry was checked
against the index before deletion and can be recovered from commit
`a623e3f79cbb31b6461eb43e7c3e386b8c99dd11` using its exact path. The `.mcp.json`
entry was inventoried by metadata only; its contents were not read or printed.
`CHANGELOG.md` and root `LICENSE` are preserved. No model, user data, credentials,
training output or unlisted file is removed.

| Path | Previous Git blob |
| --- | --- |
| `AUDIO_RELIABILITY_REPORT.md` | `82d96691f688b0cc3923b7769862c32eb0dd645f` |
| `AUDIT.md` | `0005221e83b2347c3a176187b9d605bd75672932` |
| `CROSS_PLATFORM_AUDIT.md` | `132b02b258701420f16274831124dfcb52008cc3` |
| `CROSS_PLATFORM_REVIEW.md` | `87b5187d193a7906a90a2c86bd5ceeec573919ad` |
| `QA_REPORT.md` | `e7c398ce6b36c7caf5e2f92ca1e4a8d45285a9f6` |
| `QAautomationprompt.md` | `c5773025a65b21f5fea14ec886276dc1baf8aa52` |
| `TOFIX.MD` | `66cbbc786bca56c500882c95a24d33bed63e06a3` |
| `apple-signing-report.md` | `7bc953c7ded21f1c10b6301bfb3edff179c0cfe8` |
| `changes.md` | `13047adf244e42e3eeec00361e31eff6c9b0e334` |
| `cluelyresearch.md` | `b18e86369d2bd75e5a621357d9266fa9422f4bde` |
| `comparisonreport.md` | `bdf439c4603b8101978b8626813f5ee4ad936687` |
| `fixreport.md` | `326039f8f60c9fa68c554ff7bd8511e08d9ea7ab` |
| `promptfix.md` | `8fe1aba8dfff40ba987f27f758688ae96e1ba4ec` |
| `report.md` | `925429251a7077c6511d706fdc49a789eea85bb9` |
| `tinypromptsreport.md` | `6196257432fd11b8614d7c2fc2af8fe35dc5eff6` |
| `visionpipelineresearch.md` | `889987f9b7177ce3d8b4fc2f95ac29adc0b4d610` |
| `visionupgrade.md` | `2357b7ce9b404fee042586e40243bf45b97b3a3d` |
| `refund.md` | `d0f3250d638de93faf7f405b3c2a877ab81ed2bd` |
| `termsandcondition.md` | `595c9d94e8f6176b7af09c16ed9bc262e731caf8` |
| `ROADMAP.md` | `beb363859c91809625275a0c13feb732dc883b84` |
| `.mcp.json` | `905d844840a9794b6fa1a93ca5608759c36bc29d` |

AG-24's outbound boundary, STT revocation distinction, Markdown image rejection,
endpoint inventory and synthetic behavior tests are written for this branch from
PLAN's requirements and the installed libraries' public interfaces. No later
upstream implementation is imported. The scanner's exact generic matches are
individually justified in `provenance-config.json`; no source pools or exclusions
are widened. The Google service-account validator, minimal public SDK options,
startup/selection integration and GoogleServiceAccountBoundary/OutboundInventory
tests are written from the user-approved PLAN S16 contract, Node standard APIs
and the installed libraries' public interfaces. Legacy account/project/universe
compatibility and synthetic transport checks are documented in [OUTBOUND.md](OUTBOUND.md).
These implementation checks alone are not evidence that the AG-24 exit has passed.
The S16 scanner's two exact generic statement matches are an event-loop drain
(`await new Promise(resolve => setImmediate(resolve));`) for synthetic streaming
cleanup and `return saved;` for the real persistence result in a file-change test
hook. Both were written for this branch; only these exact statements are added
to the allowlist, without widening any source pool or exclusion.
The independent serial `outbound-renderer` run-gates step is written from AG-24's
existing real-renderer regression and the runner's existing isolated Electron
step format. It adds only the precise Electron/esbuild execution capability and
a bounded timeout, so local full gates and CI retain this behavior check.
AG-24's bootstrap follow-up defers outbound/Axios module evaluation until the
identity and main log boundary are installed, but still installs fetch policy
before main/SDK evaluation. The identity VM records this dependency order; the
logging VM evaluates the real outbound source with a synthetic Axios import-time
canary, retaining existing real-bundle and privacy checks. This repair and test
adaptation were written for this branch after the first full-gate failures.
AG-24's AG-09 harness follow-up is written for this branch using Node promises
and the existing loopback mock. Separate browser polling and text reads can miss
a short partial state; a synthetic slow-observation diagnostic recorded a real
DOM partial before completion while the old sampling assertion failed. This is
a counterexample to the old observation method, not a reconstruction of the
original full-gate failure's complete timing. The test-only `afterChunk` gate
pauses the mock after two writes until the real renderer's partial is asserted,
then releases the tail; it does not change production streaming or its delays.
The hook is captured per request, reset by `setScript`, and released in the
test's `finally`. The red diagnostic, six-case green regression and hook
snapshot/reset self-check logs are archived by the main gate workflow; they do
not replace fresh full-gate or CI acceptance.

AG-20 is written on this branch from PLAN's application-identity requirements;
no earlier Margin implementation or icon asset is imported. The initial scanner
output is retained in `evidence/AG-20/checks/precommit-1/provenance.log`. Its five
matches were reviewed individually: `const electron = {` and the `const script`
template-literal opener are test scaffolding, `return require(id);` forwards a
CommonJS module load, `fs.mkdirSync(userData, { recursive: true });` uses Node's
standard recursive directory creation, and `for (const name of names) {` is a
JavaScript iteration statement. Only these exact lines were allowlisted; source
pools, approved files and scan exclusions were not widened.

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

## AG-22 credential save transactions

The transaction changes, shared result types, IPC result handling and renderer
callbacks are written on this branch from PLAN's AG-22 requirements. No earlier
Margin or restricted upstream implementation was imported. All 22 setters build
a candidate object; memory changes only after encrypted temporary-file write and
rename succeed. An unread existing ciphertext locks subsequent saves until a
successful reload. Temporary paths use Node's `randomUUID`, exclusive creation
and mode `0600`; an `EEXIST` collision never transfers ownership of that path.

The existing plaintext cleanup behavior is retained, with no plaintext read or
fallback. Independently supplied environment credentials remain an authentication
source, not a claim that an unsuccessful opportunistic save succeeded.

`src/types/credentialSave.ts` defines the saving result used by both preload type
surfaces and all save consumers. A service-account dialog cancellation is an
independent `{ cancelled: true }` branch. Successful selection adds `path`.
Runtime application is attempted only after successful persistence; a failure to
apply returns `ok: true` with a fixed, non-sensitive `warning`, not `write_failed`.
A provider switch without a new key does not claim any credentials were saved.

| Stored values / entry point | IPC and renderer callers covered |
| --- | --- |
| Gemini, Groq, OpenAI, Claude, DeepSeek keys (5 setters) | Five `set-*-api-key` handlers; `switch-to-gemini` with a new key; AIProvidersSettings Save/Remove and ProviderCard auto-save / save-before-Fetch |
| Google service-account path | `select-service-account` and SettingsOverlay selection; main startup's environment-path save checks its result without disabling environment authentication |
| STT provider; Groq/OpenAI/Deepgram/ElevenLabs/Azure/IBM Watson/Soniox keys (8 setters) | `set-stt-provider`, seven key handlers; SettingsOverlay selection, validated Save and Remove |
| Groq STT model, OpenAI STT URL, Azure region, IBM Watson region (4 setters) | Corresponding four save handlers; SettingsOverlay model, URL and Azure region controls; IBM region has no current renderer call |
| STT language, AI response language (2 setters) | `set-recognition-language` through AppState and `set-ai-response-language`; SettingsOverlay explicit changes and detected-language save |
| Default model, per-provider preferred model (2 setters) | `set-default-model`, `set-provider-preferred-model`; AIProvidersSettings default selection and ProviderCard manual / fetched-model selection |

The behavior regression uses the installed TypeScript compiler and existing
`node:test`/VM pattern. It executes the real manager and production IPC, preload
and renderer callback bodies with synthetic dependencies; the original
source-pattern-only credential checks were replaced by these behavior checks.
Coverage includes all 22 setters and 23 IPC/bridge entry points, eight storage
failure cases, a warm-instance reload chain, partial-temp cleanup, `EEXIST`,
legacy plaintext non-use, stopped downstream effects, UI non-commit, warnings,
cancellation, and the full manager-to-renderer failure path. STT connection
validation remains before persistence; a validation result is not a Saved state.
These checks do not claim real keychain, provider or device acceptance.

The first source scan matched five occurrences of four generic statements:
`const appState = {` and `const context = {` open test dependency objects;
`const source = read('electron/main.ts');` reads the local callback under test;
`if (!result.ok) {` branches on the result explicitly required by AG-22. Each was
written independently for this branch. Only these exact statements were
allowlisted; source pools, approved files and exclusions were not broadened.

## AG-23 application log privacy boundary

The shared console installer (`electron/utils/consoleLogging.ts`), main-process
logging entry (`electron/logging.ts`), renderer entry (`src/logging.ts`), opaque
payload summarizer and log-evidence helper are written on this branch from
PLAN's AG-23 requirements. No earlier Margin or restricted upstream logging
implementation was imported. Existing bootstrap, main, preload, IPC, renderer,
audio and Rust modules are adapted in place from their versions on this branch;
their earlier provenance remains recorded by this ledger and Git history.

Application console payloads are reduced to type metadata and string length,
without string previews, primitive values, object keys, messages or stacks.
Errors are opaque objects too: no unknown object's prototype is inspected.
Only code-controlled event labels are retained. Main logging is installed before
business imports, and file output is enabled only after application identity
initialization. Renderer main-world and isolated preload consoles each install
the shared boundary. Sanitizer and sink failures do not fall back to raw
payloads; verbose mode controls safe forwarding, not payload privacy. The log
viewer uses the same identity-specific `logs/debug.log` destination.

The raw ElevenLabs development PCM dump and explicit meeting/transcript debug
prints are removed. Native changes remove dynamic device identifiers/names and
raw error/panic payloads from application-owned log statements. Returned errors,
JavaScript error notifications and audio recovery paths remain unchanged.
This boundary does not claim to intercept arbitrary raw file-descriptor writes,
Chromium/OS output, third-party-library output or a provider CLI's own logs.

`electron/margin/__tests__/loggingPrivacy.test.mjs` and the replacement behavior
checks in `electron/services/__tests__/RedactForLog.test.mjs` are written for this
branch using the installed TypeScript compiler and existing `node:test`/VM
pattern. External services, paths, processes and payloads are synthetic; the
built-bundle check uses the current application bundles, not imported fixtures.
The existing identity harness is adapted to keep its isolated identity tests
separate from process-wide logging. The startup harness retains its independent
error recorder and checks exact controlled critical-event counts in production
file/terminal output without requiring raw probe text there. In the same isolated
startup, synthetic canaries exercise main-process stdout/stderr and file logging
and both launcher/settings main-world consoles. Playwright console events must
contain the expected metadata line, so suppressing all renderer output cannot
satisfy the check. All captured production exits must exclude the canary text.

These checks are not real-provider, device or keychain acceptance. A pre-existing
local native binary cannot verify these Rust source changes; new native behavior
requires a build of the changed source. The eight changed Rust files, including
the Windows branch, pass installed `rustfmt --emit stdout` parsing with child
module traversal disabled; this is not a formatting or compilation result.
macOS native CI does not compile the Windows-specific branch. No new source
pool, approved file or scanner exclusion
is added for AG-23.

The first AG-23 source scan found four occurrences of three generic statements.
`await Promise.resolve(); await Promise.resolve();` drains the synthetic preload's
two asynchronous verbose-flag callbacks in two tests. `stt.isActive = true;
stt.isSessionReady = true;` selects the existing audio-write branch on a synthetic
ElevenLabs instance, without opening a provider connection. `const dirname =
path.dirname(fileURLToPath(import.meta.url));` resolves the test module's directory
using Node standard-library APIs. Each statement was independently written for
this branch; none imports a restricted implementation. Only these exact lines
are individually allowlisted, not broader files or source pools.

## AG-21 icon sources and generated assets

Only the following four files are approved from the earlier Margin commit
`cbb92b8ae1a310ae1af3323d45b2990757d781d9`. Each first appears in that commit;
the path history contains no earlier revision. The SVGs contain local geometric
shapes and an SVG shadow only, with no external links, embedded images, fonts or
upstream assets. The original generator uses Node standard-library functions,
the existing `sharp` dependency and macOS `iconutil`. Both the pre-import review
and this implementation inspected the complete four files. No generated binary
was copied from the earlier branch, and the commit as a whole is not approved.

| Imported path | Original Git blob | Basis / adaptation |
| --- | --- | --- |
| `scripts/icons/app-icon.svg` | `2ed3dff8702b205f5778d790cafe2f30959b97ec` | Margin-authored app geometry; copied verbatim |
| `scripts/icons/app-icon-small.svg` | `23f3c0c24040af4b8c8203700f5e1bd8f0d533b0` | Margin-authored 16–32px geometry; copied verbatim |
| `scripts/icons/glyph.svg` | `85ca117c975155b7df33f9f91154bc5a3b86f3a9` | Margin-authored rule and two bars; whitespace-only blank line normalized |
| `scripts/icons/generate.mjs` | `098beb1d465ffb28bd2804f32e2d954f5ca1e545` | Adapted on this branch: URL decoding with `fileURLToPath`, output-directory creation, precise temporary-directory cleanup on failure, removal of unused output copies, lossless WebP and a SHA-256 manifest |

The inline geometry in `src/components/NativelyLogoMark.tsx` comes from the
approved `glyph.svg`, with `currentColor` replacing the fixed black fill. The
internal component name is retained. Consumer-path and Retina tray changes and
the asset checks are written on this branch from PLAN's AG-21 requirements.

The first AG-21 source scan reported three exact common statements. The Linux
restore expression `? path.join(process.resourcesPath, "assets/icon.png")` joins
the packaged resource root to the existing `assets/` destination configured in
`package.json`; the test loop `for (const platform of ['darwin', 'win32', 'linux']) {`
enumerates Node's platform identifiers; and `schemaVersion: 1,` is the initial
version field of the new generated-asset inventory. All three were written for
this branch, not imported from restricted sources. Only these exact statements
are allowlisted; no source pool or scan exclusion is expanded.

Generated output paths (all regenerated from the approved SVGs on this branch):

- `assets/margin.icns`, `assets/icon.png`;
- `assets/icons/png/icon_16x16.png`, `icon_32x32.png`, `icon_64x64.png`, `icon_128x128.png`, `icon_256x256.png`, `icon_512x512.png`, `icon_1024x1024.png`;
- `assets/icons/win/icon.ico`;
- `assets/iconTemplate.png`, `assets/iconTemplate@2x.png`;
- `src/components/icon.png`, `src/assets/logo.png`, `src/assets/logo.webp`.

The machine-readable source and output SHA-256 inventory is
[`scripts/icons/generated-assets.json`](../../scripts/icons/generated-assets.json).
Reproducibility checks regenerate twice in synthetic output directories with the
same installed toolchain and compare their manifests and bytes. This does not
claim byte-for-byte reproducibility across different OS or image-library versions.

### Removed unused Natively icon copies

Consumers were searched before removal. These are inherited N-circle app/icon
copies, confirmed through their PNG counterparts and the old website logo. The
paths below are Git-recoverable; no disguise, third-party or demonstration image
is removed. Existing referenced app/Linux/Windows and UI raster paths are instead
regenerated with Margin artwork as listed above.

| Removed path | Previous Git blob |
| --- | --- |
| `assets/natively.icns` | `61ee4b077d786f6d0b45a77caae3d9d2a1174f33` |
| `assets/icon.icns` | `b2fa79d71f727840d429fa8fb5ed5cfc4756977b` |
| `assets/icons/mac/icon.icns` | `b2fa79d71f727840d429fa8fb5ed5cfc4756977b` |
| `src/components/iconTemplate.png` | `8a13bfcdd2cb8fa91851980ca430733efdb3e3c2` |
| `src/assets/logowebsite.png` | `764299a58b4fef2f7d81e1dcfd75f4621cd30beb` |
| `src/icons/AppIcon.icns` | `b2fa79d71f727840d429fa8fb5ed5cfc4756977b` |
| `src/icons/icon_16x16.png`, `src/icons/natively.iconset/icon_16x16.png` | `15e04c9acff82e6446792fb805b1d6e43a0c1762` |
| `src/icons/icon_32x32.png`, `src/icons/natively.iconset/icon_16x16@2x.png`, `src/icons/natively.iconset/icon_32x32.png` | `d307942549af45202d72f60ea002465fd495bc3b` |
| `src/icons/icon_64x64.png`, `src/icons/natively.iconset/icon_32x32@2x.png` | `1a5e10c9e63832249239b6da332d8979b3163f57` |
| `src/icons/icon_128x128.png`, `src/icons/natively.iconset/icon_128x128.png` | `5a242b4846ddb447b4449b2e593b13bc79fd2f1a` |
| `src/icons/icon_256x256.png`, `src/icons/natively.iconset/icon_128x128@2x.png`, `src/icons/natively.iconset/icon_256x256.png` | `3e1a8b3ee6af22ecbc94043bb7b5d1efb41d6401` |
| `src/icons/icon_512x512.png`, `src/icons/natively.iconset/icon_256x256@2x.png`, `src/icons/natively.iconset/icon_512x512.png` | `b9244807cf374bbc03746596f42d72343d87ead3` |
| `src/icons/icon_1024x1024.png`, `src/icons/natively.iconset/icon_512x512@2x.png` | `f88e0e952f0e86b8de525bbd852f548e493ea255` |

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
