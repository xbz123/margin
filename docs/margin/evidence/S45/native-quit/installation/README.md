# Native quit repair: local installation

2026-10-15, Europe/Stockholm. User authorized updating Natively Local.

- Source: `cfa3470552ad1cd1ad3ff5aaecf619bc71741a6b`.
- Identity: Natively Local / `local.natively.desktop`, macOS arm64, ad-hoc signed.
- Package checks: **12/12**; package-owned isolated asar startup: **10/10**.
- ZIP SHA-256: `592b33589cab4d36b3d00458577a82ebb2e909898ac83af7361a06311f8ffd04`.
- Installed asar SHA-256: `2e5bed548a0ab39ef03de11555d4a7570f1113caefdbedaaec447d7e384d7872`.
- Reused native audio SHA-256: `71f9cf8e25767a338e3c8a7bd73273db9b6428afcfd3ae21cb871e4759fb2603`.

The old application's visible launcher showed no active meeting. Its in-app
Quit action ended the process before replacement. The new package was staged,
verified, moved into the existing installation location and verified again.
The local settings and encrypted credential files were byte-identical before
and immediately after replacement; the separate Margin application was also
unchanged. No user data was removed, migrated or copied into these records.
The temporary old bundle (786 MB) and empty installation directories were
removed after verification, consistent with the existing no-old-bundle-backup
preference. No old application backup is retained.

## Runtime result: initial delay, then normal launches

The new installed executable started and wrote `logging-ready` at
12:53:03.209 local time. Initial window inspection timed out before `app-ready`.
A two-second main-thread sample
showed this chain:

```text
get_input_devices_c_callback
  -> microphone::list_input_devices
  -> cpal::Device::supported_input_configs
  -> AudioDeviceCreateIOProcID
  -> HALC_ProxyObject::SetPropertyData
  -> mach_msg
```

The sample captured the first, microphone-authorization phase of initialization,
not the later keychain wait. It was not a failure of the repaired quit path.
The process subsequently reached `app-ready` at 12:55:33.428 and its launcher
was visibly readable. Later starts reached `app-ready` in **0.743 s** and
**0.321 s** from `logging-ready`; another observed start took **0.367 s**.
These intervals measure application initialization, not click-to-visible latency.
The installed app's `Cmd+Q` path was exercised and process absence verified before
reopening. New process creation and the visible launcher were verified. This
satisfies the user's bounded criterion for normal subsequent starts.

No permissions were changed by the agent, no audio service reset, no real model
request sent, and the installed process was not forcibly terminated. The later
launcher reported system permissions allowed, but device capture was not tested.
Configuration and encrypted credential files remained byte-identical after the
follow-up starts as well. Lifecycle-only log excerpts are in [launch-events.log](launch-events.log).

## Authorization cause confirmed; user closed the issue

Read-only macOS unified-log inspection subsequently established the complete
timeline (2026-10-15, Europe/Stockholm):

| Time | Evidence | Duration |
| --- | --- | --- |
| 12:53:03.358 | TCC reports `Failed to match existing code requirement` for this app's microphone authorization after the ad-hoc package update | — |
| 12:53:03.420–12:54:11.187 | `AUTHREQ_PROMPTING` for `kTCCServiceMicrophone`, request `70230.3588`, then authorization result/reply | 67.767 s |
| 12:54:11.352–12:55:33.272 | securityd displays the app's keychain prompt, then records the user's `always allow` / `allow` approval | about 81.92 s |
| 12:55:33.428 | Application reaches `app-ready`, 0.156 s after keychain approval | total initialization 150.219 s |
| 12:55:34.381 | Screen-capture authorization request occurs after app readiness | not the preceding 150-second wait |

The installed ad-hoc designated requirement differs from the previously stored
authorization requirement. Both the renewed microphone prompt and keychain prompt
are recorded; this is no longer merely a suspected permission cause. No secret
values or full keychain records were read or retained.

The user explicitly accepted marking this problem **resolved**: waiting for
first-time authorization is acceptable when subsequent launches are normal.
This closes the current slow-start incident; it does not claim a source change
removed synchronous initialization or that every historical stall has the same
cause. Reopen only if startup still blocks after the required grants are complete.
Future ad-hoc updates may prompt again; stable signing remains separate later work.

## Remaining work

1. Repair meeting-save failure reporting/data retention: current persistence
   clears the session before database save and returns null on failure, while
   the ending IPC can still report success. The failure interaction is undecided.
2. Real microphone/system audio, device changes, selected model/STT compatibility,
   cancellation/retry, end-to-end latency and shared-screen receiver acceptance
   remain separate from synthetic tests and a single successful Gemini test.
3. Stable signing, formal identity/release, final icons and Windows remain later
   work. Ad-hoc rebuilds can change designated requirements and provoke renewed
   OS authorization. Public CI for this repair still awaits the separate
   disclosure decision for earlier unpublished document commits.

This record confirms installation and bounded startup/quit verification, not
model/device functionality or stage-6 sign-off.
