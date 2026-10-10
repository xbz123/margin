# AG-25 local checks of the downloaded CI artifacts

Claude, 2026-10-10. The temp package and source reports here are from run
38004311007 (commit `9ef2ed4a`, public `xbz123/margin`, see
`../../CI-38004311007/`). The release identity's zip is no longer uploaded (PLAN
S25), so `package-check-release.json` and the release lines of
`plist-codesign.txt` are still from run 37996030056 (`cd71f14b`, private
repository, `../../CI-37996030056/`), checked on 2026-10-09; the app code of the
two commits is the same. Earlier versions (runs 37944613051 and 37871598165) are
in git history. Downloads went to the session scratchpad, not the repository;
paths in these reports are shown as `<app>`, `<asar>` or `<sandbox>`.

## Download and verification

`scripts/margin/download-ci-artifact.mjs` downloaded each artifact with
`gh run download` and checked every file its `BUILD-INFO.txt` lists before use,
including the commit: the native module, the libvips build, the temp app zip and
the source manifest. All matched; for the release artifact everything but the
absent zip matched. The gates, libvips-sources and libvips-replace
artifacts carry no BUILD-INFO; the gates records are copied unchanged to the CI
evidence directory, and the libvips sources are checked below.

- **Native module.** The CI build is `0f92a0b1…`. It differs from the
  `71f9cf8e…` of the private repository's runs only through the build path in its
  install name (`../../CI-38004311007/native/compare-with-37996030056.log`). The
  worktree keeps `71f9cf8e…`, installed from run 37871598165; it was not
  reinstalled.
- **Source bundle** (`source-bundle-verify.json`): all 592 files listed in
  `MANIFEST.json` match their size and sha256, and no file is unlisted. The app
  archive decompresses to the same tar, byte for byte, as a local
  `git archive --format=tar --prefix=margin-<commit>/ 9ef2ed4a`.
- **libvips sources** (`libvips-sources-verify.json`): all 37 captured downloads
  match `manifest.tsv` (one, `rustup-init`, was an empty response and keeps no
  file); the 184 kept crates match the checksums in librsvg's `Cargo.lock`; all
  169 crates compiled from the registry are kept; the `Cargo.lock` and the
  compiled list equal the records in `scripts/margin/libvips/`. One URL is a
  moving branch (`THIRD-PARTY-NOTICES.md` from `main`); its fetched bytes are
  kept.
- **Rebuilt libvips.** The dylib extracted from the libvips artifact has sha256
  `64bcfea7…` and UUID `57E6BFB0…`, the same as in the two earlier rebuilds.

## Packages (read-only)

`package-check.cjs` was run locally on the unzipped apps with
`MARGIN_LIBVIPS_SHA256` set to the rebuild's sha256 (`package-check-temp.json`
from 38004311007, `package-check-release.json` from 37996030056); Info.plist and
`codesign --verify --deep --strict` were also checked separately
(`plist-codesign.txt`). Both pass every check with the same result as on CI,
including `libvips-rebuilt` (both packages carry `64bcfea7…`, not the prebuilt
`ad39fe2d…`) and the 1,316 notice references, and the 21 Mach-O files have the
same paths and sha256 as in the CI reports.

The release identity `Margin.app` was only inspected, never launched (S15). Its
unzipped copy and its zip were deleted after the check. The installed Margin
and its data directory were not touched.

## Temp package launch smoke

The packaged binary itself is not launched here. A packaged Electron app ignores
`NODE_OPTIONS` and `-r`, so the X2 guard cannot be injected. Its first launch also
asks for Screen Recording permission (`desktopCapturer.getSources` at startup), and
no permission prompt may appear on this machine (S9). It was launched on CI
instead (`packaging/*/launch.json` there). Locally, the package's own code ran in
the repository's Electron 43.1.0 under the guard:

- `asar-smoke-temp.json` (`scripts/margin/asar-smoke.mjs`): the temp package's
  `app.asar` as the app. All checks pass:
  - the launcher window rendered from `<asar>/dist/index.html`, and the preload
    API was present;
  - app path `<asar>` and name `temp`; userData was in the sandbox;
  - mapped into the main process (lsof): the package's `natively-audio`,
    sharp, libvips and better-sqlite3 binaries from `app.asar.unpacked`, and none
    from the repository;
  - alive after 10 s, no main-process exception, no outbound attempt.
- `sharp-smoke-temp.json` (`scripts/margin/libvips/sharp-smoke-local.mjs`): sharp
  from the package (Electron in Node mode, guard preloaded) produced PNG, WebP and
  SVG output identical to CI's (`{"vips":"8.17.3",…}`). dyld loaded the package's
  shipped libvips, the rebuild (UUID `57E6BFB0…`).

## Earlier runs

The same steps were first rehearsed on the temp package of run 37870671533
(`2f11ad59`) and then run on 37871598165. The rehearsal led to two changes in the
smoke script: the native-module check reads lsof (the module cache is not visible
from Playwright's evaluate), and the readiness signal is the launcher window,
because app logs are redacted. The X3 cargo-cache native module (sha256
`b29eefde…`) was replaced by the verified CI build `71f9cf8e…` at that time; its
scratchpad backup was deleted with the scratchpad on 2026-10-09 at the user's
request.
