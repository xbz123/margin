# Margin

Margin is a desktop meeting assistant derived from the documented AGPLv3 Natively
baseline. It uses your configured providers for answers and transcription; it is
not a hosted service operated by this repository. The exact upstream baseline and
source boundaries are recorded in [BASELINE](docs/margin/BASELINE.md) and
[PROVENANCE](docs/margin/PROVENANCE.md).

## Current implementation

- Written-question practice and manual real-time meeting assistance, using text,
  screenshots, microphone speech and system-audio transcription.
- Separate **What to answer**, **Answer / Stop** and text-send entry points;
  Clarify, Brainstorm, Recap and Follow Up Question remain available. Stop finishes
  the current dictation for sending, not the meeting; ending a meeting is separate.
- Streamed answers, configurable deadlines and a retry of the current failed
  question. Retry retains the original input/context but uses current model and
  credential settings. Partial output stays separate from the retry answer;
  starting another question releases the old retry snapshot.
- OpenAI Chat/Responses, Anthropic Messages and Gemini answer protocols, including
  configured compatible endpoints. Cloud STT choices are **OpenAI, Soniox, Groq,
  Alibaba Cloud Bailian and Doubao**. There is no automatic answering or Judge.
- Full-text Local Context and prompt-only Skills configured before use. Context
  imports accept UTF-8 `.md`, `.markdown` and `.txt`, not PDF/DOCX. Skills append
  instructions; they do not run tools or scripts.
- Local meeting transcript and answer-usage records, with list/detail/copy. No
  automatic post-meeting summary, generated title or unfinished-meeting recovery.
- English/Simplified Chinese interface, independent recognition/answer language
  settings, configurable shortcuts, window protection, mouse passthrough and
  application disguise. Disguise does not hide a process from other software.

### Configure before use

Choose an answer provider/model in **Settings → AI Providers** and save its
configuration. Choose a speech provider and input devices under **Audio** when
using voice. For Bailian, Workspace ID is optional: blank selects the configured
generic Beijing endpoint; a supplied ID selects the dedicated workspace endpoint.
For Doubao, select the hourly or concurrent resource matching your account; the
application does not guess or silently switch billing resources.

Grant only the microphone/screen permissions needed for the workflow. Add optional
context and Skills under **Context & Skills**. Adding Local Context means it can
be sent in full to the chosen answer provider; review sensitive text first.
Configuration indicators do not prove account access, image support, device
operation or service connectivity. Connection tests are explicit user actions
and can send synthetic input to a provider; they are not automatic setup checks.

Default budgets are 10 seconds to the first **visible answer text** and 60 seconds
overall for interview answers; written answers have a 180-second total budget
without the interview first-text limit. These values are configurable deadlines,
not measured speed or accuracy guarantees. Timing begins with the action, Stop
or text submission and includes speech tail collection where applicable. Speech
actions collect both channels within the bounded window without ending their
connections; late revisions may update the transcript, not an answer already sent.

The optional **Codex login source** is separate from API-key providers. It reads
a supported local auth file only after explicit enablement/risk confirmation and
a local status check or generation action. It sends directly to a fixed Codex
Responses endpoint; it does not run the Codex CLI to generate answers. It does not
refresh or write credentials. Local file validity does not establish account
entitlement, model availability or service compatibility. Do not downgrade secure
credential storage to use this experimental source.

### Platform and sharing status

This is a development branch, not a signed-off distributable release. macOS is
the first delivery target; Windows implementation, acceptance and release follow,
before deciding final branch integration. The default build identity is `temp`.
The formal `Margin` identity currently refuses to build/run outside GitHub
Actions; changing that guard and releasing packages are separate decisions.
The separately approved `local` test identity uses `Natively Local` /
`local.natively.desktop` and a fresh `Natively Local` data directory, not the
legacy `natively-local` or `Margin` directory. On macOS arm64,
`MARGIN_APP_VARIANT=local node scripts/build-local.cjs` packages committed source
using existing verified native binaries without rebuilding them. It does not
install, migrate data or publish the package automatically.

**No real screen-sharing application/OS-version combination has been verified
for this branch.** In particular, whole-screen sharing through Chrome, Zoom,
Tencent Meeting and Feishu still needs receiver-side testing. A protection switch
or successful API call is not proof of invisibility, and a black replacement
rectangle is not an acceptable result. Verified combinations will be recorded
here with OS version, application version, sharing mode and observed result.

Tests use synthetic data and loopback transports. Local/macOS CI checks do not
establish real-device, real-provider, Windows/Linux, keychain or adversarial
security acceptance. This branch has no local model downloads, managed API,
paid activation, telemetry or automatic updater. Scope settings remain enforced
at the covered outbound boundary; remote Markdown images are not loaded.
Cancellation cannot retract data already received by a provider. See
[PRIVACY](PRIVACY.md) and [OUTBOUND](docs/margin/OUTBOUND.md) for precise boundaries.

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
