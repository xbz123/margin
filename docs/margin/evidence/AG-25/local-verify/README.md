# AG-25 local checks of the downloaded CI artifacts

Claude, 2026-10-09, on the artifacts of run 37871598165 (commit `46e5c0cc`, see
`../../CI-37871598165/`). Downloads went to the session scratchpad, not the
repository; paths in these reports are shown as `<download>`, `<app>`, `<asar>` or
`<sandbox>`.

## Download and verification

`scripts/margin/download-ci-artifact.mjs` downloaded each artifact with
`gh run download` and checked every file its `BUILD-INFO.txt` lists before use,
including the commit: the native module, the libvips build, both app zips and the
source manifest. All matched.

- **Native module (S11 item 5).** `--install-native` replaced the local
  `native-module/index.darwin-arm64.node` (the X3 cargo-cache build, sha256
  `b29eefde…`, kept as a backup in the scratchpad) with the verified CI build
  `71f9cf8e…`. The final local gate run (`../gates-final/`) uses it.
- **Source bundle** (`source-bundle-verify.json`): all 592 files listed in
  `MANIFEST.json` match their size and sha256, and no file is unlisted. The app
  archive decompresses to the same tar, byte for byte, as a local
  `git archive --format=tar --prefix=margin-<commit>/ 46e5c0cc`
  (sha256 `c0a4b5db…`).
- **libvips sources** (`libvips-sources-verify.json`): all 37 captured downloads
  match `manifest.tsv`; the 184 kept crates match the checksums in librsvg's
  `Cargo.lock`; all 169 crates compiled from the registry are kept. One URL is a
  moving branch (`THIRD-PARTY-NOTICES.md` from `main`); its fetched bytes are
  kept.

## Packages (read-only)

`package-check.cjs` was run locally on both unzipped apps
(`package-check-temp.json`, `package-check-release.json`), and Info.plist and
`codesign --verify --deep --strict` were also checked separately
(`plist-codesign.txt`). Both pass every check with the same result as on CI, and
the 21 Mach-O files have the same paths and sha256 as in the CI reports.

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
  shipped libvips (UUID `52C60631…`).

## Rehearsal

The same steps were first rehearsed on the temp package of run 37870671533
(`2f11ad59`). Its notice check failed locally only because that package predates
the standard library notices added in `46e5c0cc`. That rehearsal led to two
changes in the smoke script: the native-module check reads lsof (the module
cache is not visible from Playwright's evaluate), and the readiness signal is the
launcher window, because app logs are redacted. Those reports are not kept.
