# Margin

Margin is a desktop meeting assistant derived from the documented AGPLv3 Natively
baseline. It uses your configured providers for answers and transcription; it is
not a hosted service operated by this repository. The exact upstream baseline and
source boundaries are recorded in [BASELINE](docs/margin/BASELINE.md) and
[PROVENANCE](docs/margin/PROVENANCE.md).

## Current implementation

- Text questions, optional screenshots, streamed answers and cancellation.
- Configurable cloud answer providers and cloud speech-to-text providers.
- Microphone and system-audio capture through the native audio module.
- Meeting transcripts, AI interactions and summaries stored locally in SQLite.
- Data-scope settings applied at the application's covered outbound boundary;
  Markdown images are rejected rather than loaded from a remote server.
- Prompt skills and local context in the existing desktop workflow.

Provider protocols, models and account permissions differ. A configured provider
is not proof that a real account or device has been validated. Regression tests
use synthetic data and loopback transports. macOS CI and local isolated checks do
not establish Windows/Linux, real capture devices, provider, keychain or security
acceptance. This branch does not provide local model downloads, a managed API,
paid activation, an updater, or the retired retrieval and mode-selection features.

The Codex CLI integration is a subprocess boundary: the application can gate
launch and submitted input, but cannot inspect or enforce every request, retry,
cache or configuration inside the CLI. Cancellation cannot retract data already
received by a provider. See [PRIVACY](PRIVACY.md) and
[OUTBOUND](docs/margin/OUTBOUND.md) for the precise boundaries.

## Development and checks

The source includes Node/Electron, React/TypeScript and a Rust native module.
Use the exact versions in `package-lock.json` and `native-module/Cargo.lock`.
Install dependencies without package lifecycle scripts. Clean installation and
native builds are separate checks, not consequences of a successful JS build.
The recorded `react-query` alias is malformed; the actual `@tanstack/react-query`
dependency is separately installed. This development checkout does not prove
every clean-install path works. Fresh CI installation has separate archived
evidence; it does not turn this known alias anomaly into a repaired dependency
or establish every platform's installation path.

```sh
npm ci --ignore-scripts
node scripts/build-electron.js
npx vite build
node scripts/margin/isolation/run-node.mjs --allow-exec Electron \
  --test --test-timeout=180000 tests/margin/answer-regression.test.mjs
```

The example test uses a temporary profile, mock keychain, fake credentials and
synthetic screenshots. The isolation guard blocks real provider traffic and
device access. Native rebuilds require the appropriate toolchain; on macOS some
dependencies require full Xcode, not only CommandLineTools. Do not launch an
unverified build against a personal profile. Packaging and inspection use
separate development and release identities; configuration alone does not prove
that a distributable artifact passed review. See [CONTRIBUTING](CONTRIBUTING.md).

## License and notices

The application source is **AGPL-3.0-only**; the full text is in [LICENSE](LICENSE).
Preserve copyright and license notices. Distribution of modified copies and
remote interaction with a modified program have the source availability
requirements specified in the AGPL; this description does not replace its terms.

[NOTICE](NOTICE) records Natively provenance, free-cluely attribution and changes.
Third-party code, fonts and icons retain their own licenses. [licenses](licenses/README.md)
contains original texts and a versioned candidate inventory. Large Electron/
Chromium notices are copied from the fixed distribution during packaging and
hash-checked in Resources. Candidate coverage is not an actual-package or legal
verdict: unresolved texts, native vendored notices and copyleft corresponding-
source/relinking obligations must be closed before distribution.
