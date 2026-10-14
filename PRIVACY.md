# Privacy and data handling

This document describes the current Margin desktop implementation, not the
policies of Natively's hosted or commercial services. It makes no billing,
telemetry, retention-period or jurisdictional promise on their behalf. Review
your chosen providers' own policies before using them.

## Local data

Profiles are identity-specific: development uses `temp`, the approved local test
variant uses `local` / `Natively Local`, and release uses `release` / `Margin`.
Their data directories are independent. The local test variant uses a fresh
`Natively Local` directory, not the legacy `natively-local` or `Margin` directory.
Startup does not migrate or read a legacy Natively profile.
Profiles contain settings, logs, credential ciphertext, the SQLite database and
screenshot files. OS and filesystem permissions remain part of the boundary.

- Meeting transcripts and answer-usage records are stored in `natively.db`.
  New meetings do not generate summaries or titles; legacy schema fields are not
  evidence of an active summary service. SQLite
  uses WAL. The application does **not** encrypt the database or its WAL at the
  application layer; backups, disk copies or sufficiently privileged processes
  can retain or read them.
- Credentials are serialized to `credentials.enc` using Electron `safeStorage`.
  Saving fails if encryption is unavailable without claiming a successful save.
  Protection depends on the OS/backend and account security, not a guarantee for
  every platform. Environment-provided credentials may also be used.
- Screenshots can be written under `screenshots` and `extra_screenshots` in the
  profile. Local Context imports are stored as text snapshots, not live links to
  the original files. Prompt Skills, scenario selections and additional
  instructions are stored locally in `prompt-settings.json`. These text stores,
  settings and screenshots are not encrypted by the application.
- Application-owned logs reduce payloads to opaque metadata. This does not
  intercept every Chromium/OS file-descriptor write, third-party library output
  or software outside this application.

Deleting a meeting is a logical database operation, not secure erasure. WAL,
backups, exports, provider copies or OS caches may remain. No verified fixed
retention period or universal secure-delete guarantee is asserted.

## Provider transmission

Answer providers may receive question text, permitted transcript/history context
and screenshots. Adding Local Context means consenting to send its full text
with generation requests to the selected provider; it has no separate scope
toggle. Selected prompt Skills and additional instructions are sent as prompt
text, not executed as code. Existing scope checks still apply to the other data
in the request. Configure these materials before the session and remove anything
you do not want to send. Removing local content cannot recall a provider's copy.

Speech providers receive live audio when an explicitly selected/configured STT
provider is used and a meeting is started. There is no separate raw-audio scope
toggle: the transcript scope governs text sent to an LLM, not audio consent.
Selecting a provider is not proof of a working device, valid account or consent
from other participants. The supported providers are OpenAI, Soniox, Groq,
Alibaba Cloud Bailian and Doubao; Google service-account STT is no longer used.
Explicit connection tests can send synthetic input and incur provider usage.
Setup status checks do not perform those tests automatically.

Manual speech actions take a bounded snapshot of microphone and system-audio
transcription. A late correction can update local context/records without
rewriting an answer already generated. The current failed question's retry input
is retained in memory until replaced or released; retry uses that input with the
current provider configuration, which may send it to a different provider.
The first partial answer and retry result remain distinct. There is no persistent
retry-snapshot library or claim of secure memory erasure.

LLM send paths recheck their purpose/data-scope permissions; STT is governed by
the separate provider-selection/meeting-start workflow above. The shared HTTP
helper checks URL syntax and rejects redirects, not an origin-authorization
allowlist. Initial origins come from fixed or explicit configuration. Markdown
does not fetch remote images; opening an external link is a
separate user action. Custom endpoints and environment configuration can permit
HTTP, so **not all communication is guaranteed to use TLS**. Use trusted HTTPS
endpoints for sensitive data.

The optional Codex file-login source is independent of API-key providers and does
not launch the CLI for generation. Startup and ordinary configuration getters do
not inspect auth files. After enablement and explicit risk confirmation, a local
status check or generation can read the supported `auth.json` from the configured
Codex home. Tokens remain in the main process's private request context, not the
renderer, ordinary settings or surfaced error text. Margin does not refresh,
rewrite or migrate that credential file and does not support every credential
store. A passing local format/expiry check is not service authorization.

This source sends only to `https://chatgpt.com/backend-api/codex/responses`, with
`store: false`; that request field is not a universal provider-retention promise.
Its consent, scope and retry checks are described in
[OUTBOUND](docs/margin/OUTBOUND.md#codex-file-login-source-ag-34-local-verification).
Actual account, model and service compatibility remain unverified.

Cancellation and scope revocation stop or drop covered future work, not data
already submitted. Queued SDK connection/authentication attempts have different
cancellation behavior from application-owned audio writes; not every SDK-owned
transport is claimed to close synchronously.

## Your decisions

Record only with necessary permissions and participant consent. Choose providers,
scopes and endpoints carefully; protect credential files and environment
variables; review profiles, exports and backups when removing data. Real
provider, device, keychain and adversarial security acceptance are separate from
synthetic tests and source inspection. See [SECURITY](SECURITY.md) for reports.

Window protection and application disguise are not an assurance of invisibility
or a substitute for consent. Receiver-side screen-sharing compatibility has not
been verified for this branch. Mouse passthrough only changes interaction with
the assistant window; it does not establish capture protection or process hiding.
