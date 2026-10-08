# Third-party notices and distribution review

`manifest.json` is a **candidate inventory**, not a package SBOM or completed
legal review. It includes installed non-dev lock candidates, dependencies in
current main-bundle source maps, registry Cargo.lock entries across platforms,
and Inter. It does not claim every candidate is linked or distributed.

`texts/` retains original bytes and copyright statements. Each text entry records
its component/version, original path, SHA-256 and, for remote files, immutable
reference, URL and Git blob. Only identical bytes share storage. README files
containing complete embedded licenses are retained rather than replaced by
generic templates. Unresolved entries remain unresolved.

Missing optional paths are excluded only when their OS/CPU constraints do not
match the collection host. The two malformed react-query aliases are explicitly
identified; the separately installed @tanstack/react-query is inventoried. This
does not repair the alias or prove clean installation. Missing required/current-
platform package metadata fails collection.

## Electron and assets

The fixed Electron distribution's full LICENSE and LICENSES.chromium.html are
copied during packaging to Resources/licenses/electron. Version, release source
and hashes are under `deferred`. These large notices are not stored twice here;
the package hook rejects absent or altered copies, so placeholders cannot pass.
Inter's OFL and React Icons' package/icon-set notices are separate. Shipping more
icon sets than the renderer uses requires their terms too.

## Native and copyleft boundary

@img/sharp-libvips-darwin-arm64@1.2.4 declares LGPL-3.0-or-later. Its README lists
bundled dependencies under several licenses. The wrapper's Apache-2.0 LICENSE
is **not** the license of the whole binary. Exact wrapper tag v1.2.4 records
libvips 8.17.3 and other versions in versions.properties. Libvips's source LICENSE
is LGPL-2.1; the binary distributor states LGPLv3 through the applicable "any
later version" clause. Retain these statements and original terms together.

LGPLv3 incorporates GPLv3 terms. Combined-work distribution needs the applicable
notices, license copies and a compliant modification/recombination/relinking
route. A source URL or generic license text is not a completed corresponding-
source offer. Exact source, build configuration/patches and the actual library
replacement/relinking route must be checked against the artifact and made
available by an appropriate license-compliant method before release. MPL and
other dependencies have their own source/notice requirements. No unverified
source hosting, written offer or universal relinking support is promised here.

The canvas native package contains Skia-related code; its MIT wrapper alone
does not close Skia/vendored coverage. Rust wrapper texts do not replace vendored
C notices, including libfvad BSD terms and PATENTS, or prove the target-specific
linked set. These limits remain until native build provenance and package
contents are checked. The license-only collector downloads no full source
archives or new implementation files.

## Package acceptance

Before claiming complete notices: inspect packaged modules/libraries, asar,
unpacked files, Resources, Frameworks and assets; resolve all actually
distributed vendored notices; determine multi-license choices; fulfill
corresponding-source/relinking obligations; and hash-check the package's actual
license files. Collector/hook tests alone do not establish those obligations.

## Recorded unresolved categories

<!-- margin-license-inventory:start -->
Generated from licenses/manifest.json; candidate inventory, not distribution acceptance.
726 candidates; 413 unique stored texts; 33 excluded paths; 0 unresolved candidates; 2 deferred notices.

Current supplemental notice bindings:
- npm:highlightjs-vue@1.0.0: CC0-1.0
- cargo:r-efi@5.3.0: MIT OR Apache-2.0 OR LGPL-2.1-or-later (selected MIT)
- npm:format@0.2.2: MIT
- cargo:oboe@0.6.1: Apache-2.0
- cargo:oboe-sys@0.6.1: Apache-2.0
- npm:dingbat-to-unicode@1.0.1: BSD-2-Clause
- npm:eastasianwidth@0.3.0: MIT
- npm:stream-events@1.0.5: MIT
- npm:stubs@3.0.0: MIT
- npm:tr46@0.0.3: MIT
- npm:react-remove-scroll-bar@2.3.8: MIT (published MIT metadata + standard terms; not a complete original notice)
- cargo:realfft@3.5.0: MIT (published MIT metadata + standard terms; not a complete original notice)

Unresolved candidates:
None recorded; separate distribution obligations still require review.
<!-- margin-license-inventory:end -->

A declared SPDX identifier is recorded, not silently converted into a fabricated
package copyright/grant. The S17 temp-app diagnostic (CI 37829181248) observed
the then-candidate npm packages as included files/metadata; S18 changes the root
dependency graph but does not retroactively reclassify that old artifact or
establish the contents of a new package.

S19-A overrides only eastasianwidth 0.2.0 to 0.3.0; it does not upgrade
string-width 5.1.2 or assert that 0.3.0's npm tarball contained LICENSE. All four
published files match both its npm gitHead
`e5ee638e2039093c924b60d8a2ba7c12c52549f8` and same-version notice commit
`1d41951a59d63fb2d77cda021050fc070cae424a`, whose sole addition is the original
MIT-LICENSE.txt retaining `Copyright komagata`. The immutable notice and all
four byte comparisons are recorded in license-sources.json; those extra
provenance fields are checked separately, not automatically by the collector.
This closes only the new 0.3.0 missing-text entry, not an old-version grant,
native obligations or distribution acceptance.

S19-B separately accepts `approved-metadata-MIT` evidence only for the exact
published artifacts react-remove-scroll-bar 2.3.8 and realfft 3.5.0. Both READMEs
contain short MIT declarations, but no complete original license/copyright
notice was located. Their verbatim published package.json/Cargo.toml.orig bytes
and fixed official SPDX MIT standard terms are retained together in the
verified inventory. Exact identity, published artifact integrity, original and
installed metadata hashes, and fixed standard text/ref are checked fail-closed;
metadata alone cannot close an entry. Author fields are not copyright statements,
and standard copyright placeholders remain unchanged. This weaker evidence
category is not an original complete notice, copyright grant, legal verdict or
native/distribution acceptance. S19-C and separate native/source/relinking
obligations remain open; the S17 diagnostic still stops before signing and has
acceptance=false.

At checkpoints 45b11c5b and 3ac02ece, spdx-exceptions 2.5.0 (CC-BY-3.0) and
spdx-license-ids 3.0.23 (CC0-1.0) bound their exact-version published license
declarations to the full official Creative Commons standard terms. Each also
retained its complete original licensing README from the immutable npm gitHead;
README attribution alone does not close a missing full-text entry. The actual
then-packaged identifier JSON hashes matched the installed originals. NOTICE
preserves the supplied Linux Foundation/Contributors attribution and Kyle Mitchell's
mechanical-extraction statement without inventing copyright or endorsement.
CC BY's attribution, retained notices, license/source links and applicable change
identification remain distribution obligations; CC0 grants no trademark or
patent rights and does not warrant third-party clearance. These two text bindings
did not accept a distributable or resolve the other candidates. S18 removes
their now-unreferenced candidates and supplemental sources from the current
inventory; the original texts and metadata remain recoverable from those Git
checkpoints, not claimed present in the current Resources or manifest.

highlightjs-vue 1.0.0 similarly binds its exact-version CC0 declaration to the
official full terms and retains its complete original README at npm gitHead
2a0d197ec24ba70e019e12a13bd42f006124506a. Its README bytes match the installed
package; author metadata is not converted into a copyright statement. The
official CC0 bytes share storage, not another package's authorization.

r-efi 5.3.0's complete original AUTHORS at commit
97b55bed1c2c91dcbf787674849f05337ff80b33 contains a full MIT grant and disclaimer.
It matches the cached crate byte-for-byte. MIT is selected in the source binding
while the manifest preserves MIT OR Apache-2.0 OR LGPL-2.1-or-later. The full
AUTHORS retains all three original copyright statements, the author list, and
the Apache/LGPL alternative notices. No generic MIT template is substituted and
no Apache/LGPL selection or target-linked claim is made. These two further text
bindings remove only their missing-text entries; other candidates and separate
distribution obligations are not resolved by those bindings.

The ansi-tokenize later add-missing-LICENSE supplement was retained at those
checkpoints, not proof that it accompanied 0.1.3; S18 removes its unreferenced
supplement. format 0.2.2 now retains the exact original README License section
(Copyright 2010 - 2014 Sami Samhuri) and JavaScript header (Copyright 2010 - 2013
Sami Samhuri), including their external MIT authorization links, from commit
`4f898096759776b7c84fa7a25b13c923dadfe46e`. The accompanying fixed SPDX MIT full
text is standard terminology: its copyright placeholders remain unfilled and
are not substituted for either original attribution or an invented grant from
the changing linked website. react-remove-scroll-bar's published
gitHead does not resolve in the identified repository; a neighboring version is
not substituted.

realfft 3.5.0 still lacks a complete original notice and declares only MIT (no
Apache alternative was found in its exact original manifest/version sources);
S19-B records the weaker metadata-plus-standard-terms category above, while
target-linked review remains necessary. oboe/oboe-sys 0.6.1 retain their separate
exact wrapper Apache declarations at `7ea2b9b3bc9cdfa9ed4cbfeafdcafb47b3fac4e7` and official full
Apache-2.0 terms. Their Google Oboe gitlink
`86165b8249bc22b9ef70b69e20323244b6f08d88` retains LICENSE, AUTHORS and
CONTRIBUTORS plus all 16 distinct leading license comments from the 138 cached
C++/header files, without replacing Android Open Source Project notices with
Google or wrapper author metadata. The complete 140-file cache coverage is
recorded in `scripts/margin/license-inputs/original-notices/coverage.json`.
That exact tree has no NOTICE; absence is not proof of linked-binary composition
or fulfillment of any other NOTICE obligation. Target-graph/artifact and native
distribution review remain open; target labels do not exclude these candidates.

The 20 original-notice input containers hold only verbatim license excerpts and
an explicit end marker. Each records the complete original source URL/ref,
file SHA-256, Git blob and byte range. The unchanged collector validates input
and excerpt hashes and emits only bytes before the marker. It does not
automatically audit every provenance field or the separate 140-file coverage.
For C++ headers the range ends immediately after the closing `*/`, excluding
subsequent non-license separator bytes; no implementation bytes are retained.

dingbat-to-unicode 1.0.1 retains the later 1.0.2 original BSD-2-Clause LICENSE,
Copyright (c) 2021 Michael Williamson, because the repository owner explicitly
applied that license to every previous version in issue 1 comment 5740760399.
stream-events 1.0.5 and stubs 3.0.0 retain later officially merged original MIT
notices, Copyright (c) 2018 and 2017 Stephen Sawchuk respectively. Their merge
commits still declare those exact versions and all four installed files of each
package match the corresponding commit byte-for-byte. These bindings do not
claim that the original npm tarballs included LICENSE and do not change versions.

tr46 0.0.3 retains the original MIT LICENSE added at same-version commit
`3a6f29721e7063b9ffd421e461a54beae6170001`, Copyright (c) 2016 Sebastian Mayr.
Its package.json and index.js match the installed files; the installed generated
mappingTable.json is reproduced byte-for-byte from official Unicode IDNA 8.0.0
data using that commit's conversion. The data's original header, Copyright (c)
1991-2015 Unicode, Inc. and its source/terms links, is retained separately from
the complete current Unicode License v3, Copyright 1991-2026 Unicode, Inc.
The current official copyright policy applies v3 to /Public/ Data Files unless
otherwise indicated; the old header points to terms_of_use without naming a
different license. This does not claim that v3 was adopted in 2015, rewrite either
copyright date, or treat a recommendation to upgrade as a retroactive grant.
The source data and installed mapping are not modified or copied into notices.

Missing incompatible platform-optional npm paths and verified dangling aliases
are recorded under
`excluded`, not treated as installed binaries. None of those counts proves the
actual package set.

Separately, libvips's bundled dependency texts and corresponding-source/relinking
route, canvas/Skia's actual static vendored set, and icon-set terms for any whole
React Icons package distributed still require artifact-level closure. The
retained Skia root LICENSE/AUTHORS and libvips license table are not complete
aggregated notices. Missing candidates cause the package-byte hook to fail;
even resolving them all would not, by itself, close these separate obligations.
