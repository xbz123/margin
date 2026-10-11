# W4 local checks of the W3 exit run (stage 3)

Claude, 2026-10-11, at the user's request ("做 W4 本机核对，通过后签收阶段 3").
The artifacts are from run 38123550800 (commit `d2bd8146`, see
`../CI-38123550800/`, where the download verification is recorded). Downloads
and the unpacked app stayed in the session scratchpad; paths in the reports are
shown as `<asar>` or `<sandbox>`. Since PLAN S26 these are the two local checks.

- **Source bundle** (`source-bundle-verify.json`): all 587 files listed in
  `MANIFEST.json` match their size and sha256, none is missing and none is
  unlisted. The app archive decompresses to the same tar, byte for byte, as a
  local `git archive --format=tar --prefix=margin-<commit>/ d2bd8146`
  (`9ecda9b7…`, 202547200 bytes). The manifest has no libvips section (S34).
- **`asar-smoke`** (`asar-smoke-temp.json`): the temp package's `app.asar` ran in
  the repository's Electron under the isolation guard; all 10 checks pass. The
  native module and better-sqlite3 were mapped from `app.asar.unpacked`, none
  from the repository; no main-process error and no outbound attempt. Since S34
  there is no sharp or libvips to load.

The packaged binaries were not launched locally (S9); they launched on CI in a
throwaway HOME.
