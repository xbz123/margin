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

This is the separate pre-ready CoreAudio device-enumeration stall, not evidence
that the repaired post-ready quit path failed. The sample was not waiting in a
keychain API; it does not rule out permissions as an underlying trigger.
The process subsequently reached `app-ready` at 12:55:33.428 and its launcher
was visibly readable. Later starts reached `app-ready` in **0.743 s** and
**0.321 s** from `logging-ready`; another observed start took **0.367 s**.
These intervals measure application initialization, not click-to-visible latency.
The installed app's `Cmd+Q` path was exercised and process absence verified before
reopening. New process creation and the visible launcher were verified. This
satisfies the user's bounded criterion for normal subsequent starts, not a claim
that the 150-second initial delay has a proven permission root cause.

No permissions were changed by the agent, no audio service reset, no real model
request sent, and the installed process was not forcibly terminated. The later
launcher reported system permissions allowed, but device capture was not tested.
Configuration and encrypted credential files remained byte-identical after the
follow-up starts as well. Lifecycle-only log excerpts are in [launch-events.log](launch-events.log).

## Remaining work

1. Resolve or characterize the first-launch authorization/device wait. The user
   accepts first-time authorization waiting if later launches are consistently
   normal; this package now meets that bounded observation. The initial cause
   remains unknown and further updates may prompt again under ad-hoc signing.
2. Repair meeting-save failure reporting/data retention: current persistence
   clears the session before database save and returns null on failure, while
   the ending IPC can still report success. The failure interaction is undecided.
3. Real microphone/system audio, device changes, selected model/STT compatibility,
   cancellation/retry, end-to-end latency and shared-screen receiver acceptance
   remain separate from synthetic tests and a single successful Gemini test.
4. Stable signing, formal identity/release, final icons and Windows remain later
   work. Ad-hoc rebuilds can change designated requirements and provoke renewed
   OS authorization. Public CI for this repair still awaits the separate
   disclosure decision for earlier unpublished document commits.

This record confirms installation and bounded startup/quit verification, not
model/device functionality or stage-6 sign-off.
