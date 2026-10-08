# Code provenance

This file records where every non-baseline piece of code, test, script or asset on this branch came from. Anything not listed here and not changed in a commit on this branch is unmodified baseline code from `a786910e` (see [BASELINE.md](BASELINE.md)).

## Source rules

| Source | May be used | Record |
| --- | --- | --- |
| Baseline `a786910e` and its ancestors | Yes, under AGPLv3 | Nothing extra; git history shows it |
| Other upstream AGPL commits published before 2026-06-01 IST | Only after checking the exact commit, file contents and license, and finding evidence of publication | Commit, path, blob, evidence |
| Upstream commits published on or after 2026-06-01 IST (including the 1–24 June AGPL-labelled window) | No. Not copied or cherry-picked, and not used as a template | — |
| Earlier Margin branch (`codex/ai-assistant-refactor`, personal import `fcfbb02a` onward) | Only lines and files written for Margin that contain no post-June upstream code, prompts, comments, tests or assets | Margin commit, path, check performed |
| New code written on this branch | Yes | Written against the behavior described in [ADAPTATION.md](ADAPTATION.md); the commit message says so |

Notes:

- Renaming, reformatting, moving or lightly rewriting code does not resolve a provenance problem.
- The person writing this branch has read later upstream code while auditing. New implementations are therefore described as "written for this branch from the behavior requirements". They are not claimed to be a verified clean-room rewrite.
- Third-party packages, fonts and icons keep their own licenses. They are not relabelled AGPL.
- Commit dates and authors are recorded as evidence, but do not by themselves prove a license right.

## Ledger

AG-20 is written on this branch from PLAN's application-identity requirements;
no earlier Margin implementation or icon asset is imported. The initial scanner
output is retained in `evidence/AG-20/checks/precommit-1/provenance.log`. Its five
matches were reviewed individually: `const electron = {` and the `const script`
template-literal opener are test scaffolding, `return require(id);` forwards a
CommonJS module load, `fs.mkdirSync(userData, { recursive: true });` uses Node's
standard recursive directory creation, and `for (const name of names) {` is a
JavaScript iteration statement. Only these exact lines were allowlisted; source
pools, approved files and scan exclusions were not widened.

Stage 1 review 8 is written on this branch from the scope-refusal behavior requirements.
The old Margin branch was inspected as a behavior reference, not copied. Four source
scanner matches are generic JavaScript: `signal?.throwIfAborted();` (the native
AbortSignal cancellation check), `lastError = error;` and `throw lastError;` (retain
and rethrow the final sequential-attempt error), and `const policy = { transcript: false };`
(one-field synthetic test policy). These exact lines are individually
allowlisted in the scanner configuration; matching them is not evidence of copying.

Rows are added as code is brought in. "Check" is what was done to confirm the source.

| Item on this branch | Source | Basis | Check | Commit |
| --- | --- | --- | --- | --- |
| Whole tree at branch start | Upstream `a786910e` | AGPLv3 | [BASELINE.md](BASELINE.md) | `a786910e` |

## AG-22 credential save transactions

The transaction changes, shared result types, IPC result handling and renderer
callbacks are written on this branch from PLAN's AG-22 requirements. No earlier
Margin or restricted upstream implementation was imported. All 22 setters build
a candidate object; memory changes only after encrypted temporary-file write and
rename succeed. An unread existing ciphertext locks subsequent saves until a
successful reload. Temporary paths use Node's `randomUUID`, exclusive creation
and mode `0600`; an `EEXIST` collision never transfers ownership of that path.

The existing plaintext cleanup behavior is retained, with no plaintext read or
fallback. Independently supplied environment credentials remain an authentication
source, not a claim that an unsuccessful opportunistic save succeeded.

`src/types/credentialSave.ts` defines the saving result used by both preload type
surfaces and all save consumers. A service-account dialog cancellation is an
independent `{ cancelled: true }` branch. Successful selection adds `path`.
Runtime application is attempted only after successful persistence; a failure to
apply returns `ok: true` with a fixed, non-sensitive `warning`, not `write_failed`.
A provider switch without a new key does not claim any credentials were saved.

| Stored values / entry point | IPC and renderer callers covered |
| --- | --- |
| Gemini, Groq, OpenAI, Claude, DeepSeek keys (5 setters) | Five `set-*-api-key` handlers; `switch-to-gemini` with a new key; AIProvidersSettings Save/Remove and ProviderCard auto-save / save-before-Fetch |
| Google service-account path | `select-service-account` and SettingsOverlay selection; main startup's environment-path save checks its result without disabling environment authentication |
| STT provider; Groq/OpenAI/Deepgram/ElevenLabs/Azure/IBM Watson/Soniox keys (8 setters) | `set-stt-provider`, seven key handlers; SettingsOverlay selection, validated Save and Remove |
| Groq STT model, OpenAI STT URL, Azure region, IBM Watson region (4 setters) | Corresponding four save handlers; SettingsOverlay model, URL and Azure region controls; IBM region has no current renderer call |
| STT language, AI response language (2 setters) | `set-recognition-language` through AppState and `set-ai-response-language`; SettingsOverlay explicit changes and detected-language save |
| Default model, per-provider preferred model (2 setters) | `set-default-model`, `set-provider-preferred-model`; AIProvidersSettings default selection and ProviderCard manual / fetched-model selection |

The behavior regression uses the installed TypeScript compiler and existing
`node:test`/VM pattern. It executes the real manager and production IPC, preload
and renderer callback bodies with synthetic dependencies; the original
source-pattern-only credential checks were replaced by these behavior checks.
Coverage includes all 22 setters and 23 IPC/bridge entry points, eight storage
failure cases, a warm-instance reload chain, partial-temp cleanup, `EEXIST`,
legacy plaintext non-use, stopped downstream effects, UI non-commit, warnings,
cancellation, and the full manager-to-renderer failure path. STT connection
validation remains before persistence; a validation result is not a Saved state.
These checks do not claim real keychain, provider or device acceptance.

The first source scan matched five occurrences of four generic statements:
`const appState = {` and `const context = {` open test dependency objects;
`const source = read('electron/main.ts');` reads the local callback under test;
`if (!result.ok) {` branches on the result explicitly required by AG-22. Each was
written independently for this branch. Only these exact statements were
allowlisted; source pools, approved files and exclusions were not broadened.

## AG-23 application log privacy boundary

The shared console installer (`electron/utils/consoleLogging.ts`), main-process
logging entry (`electron/logging.ts`), renderer entry (`src/logging.ts`), opaque
payload summarizer and log-evidence helper are written on this branch from
PLAN's AG-23 requirements. No earlier Margin or restricted upstream logging
implementation was imported. Existing bootstrap, main, preload, IPC, renderer,
audio and Rust modules are adapted in place from their versions on this branch;
their earlier provenance remains recorded by this ledger and Git history.

Application console payloads are reduced to type metadata and string length,
without string previews, primitive values, object keys, messages or stacks.
Errors are opaque objects too: no unknown object's prototype is inspected.
Only code-controlled event labels are retained. Main logging is installed before
business imports, and file output is enabled only after application identity
initialization. Renderer main-world and isolated preload consoles each install
the shared boundary. Sanitizer and sink failures do not fall back to raw
payloads; verbose mode controls safe forwarding, not payload privacy. The log
viewer uses the same identity-specific `logs/debug.log` destination.

The raw ElevenLabs development PCM dump and explicit meeting/transcript debug
prints are removed. Native changes remove dynamic device identifiers/names and
raw error/panic payloads from application-owned log statements. Returned errors,
JavaScript error notifications and audio recovery paths remain unchanged.
This boundary does not claim to intercept arbitrary raw file-descriptor writes,
Chromium/OS output, third-party-library output or a provider CLI's own logs.

`electron/margin/__tests__/loggingPrivacy.test.mjs` and the replacement behavior
checks in `electron/services/__tests__/RedactForLog.test.mjs` are written for this
branch using the installed TypeScript compiler and existing `node:test`/VM
pattern. External services, paths, processes and payloads are synthetic; the
built-bundle check uses the current application bundles, not imported fixtures.
The existing identity harness is adapted to keep its isolated identity tests
separate from process-wide logging. The startup harness retains its independent
error recorder and checks exact controlled critical-event counts in production
file/terminal output without requiring raw probe text there. In the same isolated
startup, synthetic canaries exercise main-process stdout/stderr and file logging
and both launcher/settings main-world consoles. Playwright console events must
contain the expected metadata line, so suppressing all renderer output cannot
satisfy the check. All captured production exits must exclude the canary text.

These checks are not real-provider, device or keychain acceptance. A pre-existing
local native binary cannot verify these Rust source changes; new native behavior
requires a build of the changed source. The eight changed Rust files, including
the Windows branch, pass installed `rustfmt --emit stdout` parsing with child
module traversal disabled; this is not a formatting or compilation result.
macOS native CI does not compile the Windows-specific branch. No new source
pool, approved file or scanner exclusion
is added for AG-23.

The first AG-23 source scan found four occurrences of three generic statements.
`await Promise.resolve(); await Promise.resolve();` drains the synthetic preload's
two asynchronous verbose-flag callbacks in two tests. `stt.isActive = true;
stt.isSessionReady = true;` selects the existing audio-write branch on a synthetic
ElevenLabs instance, without opening a provider connection. `const dirname =
path.dirname(fileURLToPath(import.meta.url));` resolves the test module's directory
using Node standard-library APIs. Each statement was independently written for
this branch; none imports a restricted implementation. Only these exact lines
are individually allowlisted, not broader files or source pools.

## AG-21 icon sources and generated assets

Only the following four files are approved from the earlier Margin commit
`cbb92b8ae1a310ae1af3323d45b2990757d781d9`. Each first appears in that commit;
the path history contains no earlier revision. The SVGs contain local geometric
shapes and an SVG shadow only, with no external links, embedded images, fonts or
upstream assets. The original generator uses Node standard-library functions,
the existing `sharp` dependency and macOS `iconutil`. Both the pre-import review
and this implementation inspected the complete four files. No generated binary
was copied from the earlier branch, and the commit as a whole is not approved.

| Imported path | Original Git blob | Basis / adaptation |
| --- | --- | --- |
| `scripts/icons/app-icon.svg` | `2ed3dff8702b205f5778d790cafe2f30959b97ec` | Margin-authored app geometry; copied verbatim |
| `scripts/icons/app-icon-small.svg` | `23f3c0c24040af4b8c8203700f5e1bd8f0d533b0` | Margin-authored 16–32px geometry; copied verbatim |
| `scripts/icons/glyph.svg` | `85ca117c975155b7df33f9f91154bc5a3b86f3a9` | Margin-authored rule and two bars; whitespace-only blank line normalized |
| `scripts/icons/generate.mjs` | `098beb1d465ffb28bd2804f32e2d954f5ca1e545` | Adapted on this branch: URL decoding with `fileURLToPath`, output-directory creation, precise temporary-directory cleanup on failure, removal of unused output copies, lossless WebP and a SHA-256 manifest |

The inline geometry in `src/components/NativelyLogoMark.tsx` comes from the
approved `glyph.svg`, with `currentColor` replacing the fixed black fill. The
internal component name is retained. Consumer-path and Retina tray changes and
the asset checks are written on this branch from PLAN's AG-21 requirements.

The first AG-21 source scan reported three exact common statements. The Linux
restore expression `? path.join(process.resourcesPath, "assets/icon.png")` joins
the packaged resource root to the existing `assets/` destination configured in
`package.json`; the test loop `for (const platform of ['darwin', 'win32', 'linux']) {`
enumerates Node's platform identifiers; and `schemaVersion: 1,` is the initial
version field of the new generated-asset inventory. All three were written for
this branch, not imported from restricted sources. Only these exact statements
are allowlisted; no source pool or scan exclusion is expanded.

Generated output paths (all regenerated from the approved SVGs on this branch):

- `assets/margin.icns`, `assets/icon.png`;
- `assets/icons/png/icon_16x16.png`, `icon_32x32.png`, `icon_64x64.png`, `icon_128x128.png`, `icon_256x256.png`, `icon_512x512.png`, `icon_1024x1024.png`;
- `assets/icons/win/icon.ico`;
- `assets/iconTemplate.png`, `assets/iconTemplate@2x.png`;
- `src/components/icon.png`, `src/assets/logo.png`, `src/assets/logo.webp`.

The machine-readable source and output SHA-256 inventory is
[`scripts/icons/generated-assets.json`](../../scripts/icons/generated-assets.json).
Reproducibility checks regenerate twice in synthetic output directories with the
same installed toolchain and compare their manifests and bytes. This does not
claim byte-for-byte reproducibility across different OS or image-library versions.

### Removed unused Natively icon copies

Consumers were searched before removal. These are inherited N-circle app/icon
copies, confirmed through their PNG counterparts and the old website logo. The
paths below are Git-recoverable; no disguise, third-party or demonstration image
is removed. Existing referenced app/Linux/Windows and UI raster paths are instead
regenerated with Margin artwork as listed above.

| Removed path | Previous Git blob |
| --- | --- |
| `assets/natively.icns` | `61ee4b077d786f6d0b45a77caae3d9d2a1174f33` |
| `assets/icon.icns` | `b2fa79d71f727840d429fa8fb5ed5cfc4756977b` |
| `assets/icons/mac/icon.icns` | `b2fa79d71f727840d429fa8fb5ed5cfc4756977b` |
| `src/components/iconTemplate.png` | `8a13bfcdd2cb8fa91851980ca430733efdb3e3c2` |
| `src/assets/logowebsite.png` | `764299a58b4fef2f7d81e1dcfd75f4621cd30beb` |
| `src/icons/AppIcon.icns` | `b2fa79d71f727840d429fa8fb5ed5cfc4756977b` |
| `src/icons/icon_16x16.png`, `src/icons/natively.iconset/icon_16x16.png` | `15e04c9acff82e6446792fb805b1d6e43a0c1762` |
| `src/icons/icon_32x32.png`, `src/icons/natively.iconset/icon_16x16@2x.png`, `src/icons/natively.iconset/icon_32x32.png` | `d307942549af45202d72f60ea002465fd495bc3b` |
| `src/icons/icon_64x64.png`, `src/icons/natively.iconset/icon_32x32@2x.png` | `1a5e10c9e63832249239b6da332d8979b3163f57` |
| `src/icons/icon_128x128.png`, `src/icons/natively.iconset/icon_128x128.png` | `5a242b4846ddb447b4449b2e593b13bc79fd2f1a` |
| `src/icons/icon_256x256.png`, `src/icons/natively.iconset/icon_128x128@2x.png`, `src/icons/natively.iconset/icon_256x256.png` | `3e1a8b3ee6af22ecbc94043bb7b5d1efb41d6401` |
| `src/icons/icon_512x512.png`, `src/icons/natively.iconset/icon_256x256@2x.png`, `src/icons/natively.iconset/icon_512x512.png` | `b9244807cf374bbc03746596f42d72343d87ead3` |
| `src/icons/icon_1024x1024.png`, `src/icons/natively.iconset/icon_512x512@2x.png` | `f88e0e952f0e86b8de525bbd852f548e493ea255` |

## Earlier upstream: free-cluely

Natively's first commit (`0a73eb77`, 2026-01-27) has the Electron skeleton of [Prat011/free-cluely](https://github.com/Prat011/free-cluely), which is under the Apache License 2.0: the same file names (`main.ts`, `preload.ts`, `ipcHandlers.ts`, `LLMHelper.ts`, `WindowHelper.ts`, `ScreenshotHelper.ts`, `ProcessingHelper.ts`, `shortcuts.ts`) and structure. A line comparison against free-cluely `0ba93eff` (2025-12-05) found:

| Tree | Electron substantive lines | Same as free-cluely |
| --- | --- | --- |
| Natively `0a73eb77` | 5,104 | 1,004 (20%) |
| Baseline `a786910e` | 37,184 | 1,136 (3%) |
| Earlier Margin `b8ade3f7` | 77,408 | 656 (0.8%) |

The baseline credits neither free-cluely nor the Apache License. Apache-2.0 §4 requires keeping its license and attribution, so a NOTICE entry is added in phase 2. free-cluely covers none of the post-June code, so it does not reduce the rewrite.

## Open license questions

1. **The MIT authorization in the earlier Margin README.** Not seen; not relied on here.
2. **The status of 1–24 June 2026 upstream commits.** Not used. Revisit only with legal advice.
3. **Bundled third-party assets** (the Inter font under `src/font`, icons and images under `assets/` and `src/icons`). Each keeps its own license file. Their licenses are rechecked before any release.
