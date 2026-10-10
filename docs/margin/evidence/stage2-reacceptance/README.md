# Stage 2 re-acceptance fix

Codex Astra re-checked stage 2 on 2026-10-10 (`8f2590f1..95b88e84`, read only;
report `astra-reacceptance-review.txt`). Three of the four earlier findings were
closed; one P2 remained: `electronAPI.openExternal` checked only
`navigator.userActivation.isActive`, which stays true for about 5 s after any
click. Astra's script (`astra-activation-window.mjs`) arms a timer without a user
gesture, clicks a plain button with no URL or handler, and the timer then opens
`https://automatic.example/after-unrelated-click`
(`astra-activation-window-before-fix.log`; the guard recorded the call, no
browser opened).

## Fix (Claude, `a0090760`, `85eb3d02`)

- `electron/preload.ts`: `openExternal(url)` sends the open-external IPC only
  while a trusted click is still being dispatched (a capture listener keeps the
  last trusted click; its `eventPhase` is `NONE` once dispatch ends), and only for
  the URL the clicked control declares: `data-external-url` on the control, or the
  href of a link. A timer cannot run during a dispatch, and a handler of another
  control cannot open a URL it does not declare.
- Every caller declares its URL: the 12 key links in `HelpSettings.tsx`,
  `ProviderCard.tsx`, the speech key link in `SettingsOverlay.tsx` (the URL map is
  computed in the component as `sttKeyUrl`), the permission warning in
  `NativelyInterface.tsx` and the screen settings button in
  `PermissionsToaster.tsx` (through a new `actionUrl` prop, darwin only). The
  links in `AboutSection.tsx` already carry their URL as href. The unused
  `openKeyUrl` in `AIProvidersSettings.tsx` is removed.
- `scripts/margin/source-bundle.mjs` no longer calls its artifact private (S25),
  the non-blocking wording note of the report.

## Tests

`tests/margin/outbound-renderer.test.mjs` installs its controls and a timer with
`executeJavaScript(…, false)` (Playwright's evaluate carries a user gesture and
armed the timer before any click in the first attempt). The timer calls
`openExternal` 20 times while a click's activation lasts, with an undeclared URL
and with the URL a control declares. The first click goes to a plain button;
further buttons call `openExternal` with an undeclared URL or with none declared.

- `navigation-red-before-fix.log`: on the activation-only preload the test fails;
  nothing opened before the first click, then the timer's URLs (both), the
  undeclared and the not-declared URL were recorded.
- `navigation-green.log`: with the fix exactly the three expected URLs open (two
  https links and the declared button).
- `astra-activation-window-after-fix.log`: Astra's script, unchanged, records no
  open after the click.

Remaining boundary (also in `OUTBOUND.md`): a page script that handles the same
click can open the URL the clicked control declares, as the app's handler does,
and a script that can change the page could change a declared URL, as it could
change a link's href. Without a real click on that control nothing opens.

## Gates

- `gates-first-failed/` (`a0090760`): two failures. Provenance hit
  `const STT_KEY_URLS: Record<string, string> = {` (the map first moved to module
  level; later upstream code in the same file has a line with that name, so it was
  restructured, not allowlisted) and the generic `const timer = setInterval(() => {`
  of the test (allowlisted). `FormatPermissionMessageCrossPlatform` refused the
  screen settings URL as a top-level constant without a darwin check nearby; it is
  inline in the darwin branch again.
- `gates/` (`85eb3d02`, clean tree, against AG-26): 16/16 exit 0; 111 files, 853
  tests, 847 pass, 0 fail, 6 existing skips; AG-09 6/6, storage 5/5, startup 1/1,
  outbound renderer 2/2, guard self-test 12/12; provenance 0 hits (128,377
  approved line keys); retired rules 261, 0 failing.

The `FormatPermissionMessageCrossPlatform` test was also run once directly with
`node --test`, outside the guard, after the fix; it only reads source files. All
other runs were under the guard. No CI run was started for these commits.
