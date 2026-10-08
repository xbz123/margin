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

The current snapshot retains 19 missing exact-version notice candidates. Fifteen
installed npm candidates may be distributed and have not been excluded by actual
package evidence: @alcalzone/ansi-tokenize 0.1.3, @npmcli/agent 4.0.0,
dingbat-to-unicode 1.0.1, eastasianwidth 0.2.0, err-code 2.0.3, format 0.2.2,
highlightjs-vue 1.0.0, react-remove-scroll-bar 2.3.8, screenshot-desktop 1.15.4,
spdx-exceptions 2.5.0, spdx-license-ids 3.0.23, @tootallnate/once 1.1.2,
stream-events 1.0.5, stubs 3.0.0 and tr46 0.0.3. A declared SPDX identifier is
recorded, not silently converted into a fabricated package copyright/grant.

The official ansi-tokenize later add-missing-LICENSE text is retained as a
supplement, not proof that it accompanied 0.1.3. For format, the old installed
header's copyright/date and external MIT URL are not replaced by an assumed
same-version grant from a changing website. react-remove-scroll-bar's published
gitHead does not resolve in the identified repository; a neighboring version is
not substituted.

Four Cargo candidates lack full texts: realfft 3.5.0 needs target-linked review;
oboe/oboe-sys 0.6.1 are Android candidates and r-efi 5.3.0 is a UEFI candidate,
pending target-graph/artifact exclusion evidence. The 37 missing incompatible
platform-optional npm paths and two verified dangling aliases are recorded under
`excluded`, not treated as installed binaries. None of those counts proves the
actual package set.

Separately, libvips's bundled dependency texts and corresponding-source/relinking
route, canvas/Skia's actual static vendored set, and icon-set terms for any whole
React Icons package distributed still require artifact-level closure. The
retained Skia root LICENSE/AUTHORS and libvips license table are not complete
aggregated notices. Missing candidates cause the package-byte hook to fail;
even resolving them all would not, by itself, close these separate obligations.
