# AG-23 application log privacy

Implementation and final local/CI gates passed on source `ca7ff686`;
[CI 37789252078](../CI-37789252078/README.md) raw evidence was verified.
Claude's read-only review remains pending. Dependencies were unchanged. No real
provider, device or keychain acceptance is claimed.

Application-owned console payloads contain types and string lengths only, never
string previews, primitive values, arbitrary object keys, error messages or
stacks. Unknown objects remain opaque without prototype/getter/serializer calls.
Controlled event labels preserve critical-error detection. Bootstrap installs
the boundary before business imports and enables the file sink only after
identity setup. Main, preload and renderer main-world consoles are covered;
sanitizer/sink failures have no raw fallback. Reentrant logging is suppressed.

Log viewing uses the same identity-owned debug.log. Raw ElevenLabs development
PCM recording and explicit meeting/transcript prints were removed. Application
Rust logging drops dynamic device identifiers and raw error/panic payloads while
preserving audio behavior and returned error notifications. This is not an OS
interceptor for raw file descriptors, Chromium, dependencies or CLI-owned logs.

Final `checks/precommit-2/`: all 15 commands exit zero, 108 completed test files,
812 tests / 807 pass / 0 fail / 5 existing skips; AG-09 6/6, storage 5/5, startup
1/1. Raw TAP totals match the summary. The root summary/reference files are
unchanged copies; their log paths still reference the original checks directory.
This is a precommit run over `310b9341`, with its dirty paths recorded.

The real temp startup checks main-process file/stdout/stderr and launcher/settings
main-world console canaries with positive evidence of safe output. Its independent
error recorder remains active; exact controlled critical-event counts detect
missing probes, extra errors and unknown events without retaining probe text in
production logs. VM/built-module checks cover isolated preload, verbose changes,
IPC paths, load/call/sink failures, hostile values and separate esbuild bundles.

Retained failures: original six privacy failures; a prototype trap that was
executed by `instanceof Error` (now removed); first full gates failing only the
three explained source-scanner statements; restricted outer-tool Electron launch
failure. The identical temp/X2 startup passed with GUI permission, and the final
complete gates passed. None of these failed runs is counted as acceptance.

Eight changed Rust files passed rustfmt parsing without formatting or rebuilding
the native module. The local native binary is unchanged; this run does not verify
the new Rust binary. macOS CI compiled the changed crate successfully; AG-25
artifact verification remains required. Windows-specific code was parsed but not
compiled. No app was installed,
formal Margin was not launched, and no release was published.
