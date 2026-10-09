# AG-24 follow-up and S21 dependency removal (local evidence)

Made by Claude on 2026-10-09 under PLAN S21, before the commit. The gate run in
`gates/` covers the combined working tree of both changes; `summary.json` lists
the uncommitted paths it saw.

## Changes

- **P1, navigation and child windows.** `electron/services/navigationPolicy.ts`
  is installed in bootstrap before `main`. Every webContents may navigate only to
  the app's own `dist/index.html` (or the dev server in an unpackaged dev run);
  window.open is always denied; webview attachment is refused. A refused https
  link (no userinfo), or the macOS settings scheme on macOS, opens in the default
  browser; anything else is dropped. The open-external IPC uses the same rule
  instead of the earlier Gmail-only allowlist.
- **P2, unreadable credentials.** `CredentialsManager.getLoadStatus()` and
  `discardUnreadableCredentials()`, IPC `credentials-load-status` and
  `credentials-discard-unreadable`, preload methods and the settings banner
  `CredentialLoadBanner`. Discard is offered only when bytes were read and failed
  to decrypt or parse; it needs a confirmation and keeps the original bytes as
  `credentials.enc.unreadable-<time>` (hard link, then unlink).
- **P3.** The identity reply and the permission-reset message use the build's
  app name instead of "Natively". The prompts' own identity text stays for
  phase 3 (S12).
- **AG-62 note** in PLAN: the release-identity guard must be lifted before
  distribution.
- **S21.** `pdf-parse` and `mammoth` removed (33 lock nodes, none added, no
  retained version/integrity/source change); license inventory regenerated
  (726 to 699 candidates, 25 texts no longer referenced deleted); G3 rules S21.
- **Tests.** The isolation guard records `shell.openExternal` as
  `external-open` instead of opening the browser. New behaviour tests:
  `tests/margin/outbound-renderer.test.mjs` (navigation in the real launcher
  window), `electron/margin/__tests__/navigationPolicy.test.mjs` and three
  credential recovery tests. Removed `ExternalUrlIpc.test.mjs`, which only
  matched source strings of the old allowlist; the policy test replaces it.

## Results

- `gates/`: 16/16 steps exit 0. Unit tests 928, 922 pass, 0 fail, 6 existing
  skips; regression, storage, startup and outbound-renderer pass.
- `navigation-red-without-policy.log`: the navigation test run with the policy
  line removed from bootstrap fails (`location.href` replaced the app page with
  the loopback URL). The line was restored before the gate run.

Two earlier local gate runs before these results are not kept: the first failed
on 8 new provenance hits (generic Electron/React lines, registered with reasons
in `provenance-config.json`) and on test harnesses that did not yet know the new
bootstrap module; the second failed because the guard's new stub recorded a
blocked attempt against a contract test's fake Electron without `shell`.
