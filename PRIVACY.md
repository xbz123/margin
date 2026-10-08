# Privacy and data handling

This document describes the current Margin desktop implementation, not the
policies of Natively's hosted or commercial services. It makes no billing,
telemetry, retention-period or jurisdictional promise on their behalf. Review
your chosen providers' own policies before using them.

## Local data

Profiles are identity-specific: the development identity is `temp`, the release
identity is `Margin`. Startup does not migrate or read a legacy Natively profile.
Profiles contain settings, logs, credential ciphertext, the SQLite database and
screenshot files. OS and filesystem permissions remain part of the boundary.

- Transcripts, interactions and summaries are stored in `natively.db`. SQLite
  uses WAL. The application does **not** encrypt the database or its WAL at the
  application layer; backups, disk copies or sufficiently privileged processes
  can retain or read them.
- Credentials are serialized to `credentials.enc` using Electron `safeStorage`.
  Saving fails if encryption is unavailable without claiming a successful save.
  Protection depends on the OS/backend and account security, not a guarantee for
  every platform. Environment-provided credentials may also be used.
- For Google speech, the application stores a service-account **path**. You
  manage the original JSON file; the application does not encrypt or delete it.
  Only validated service-account fields configure the SDK. Never publish that
  original file.
- Screenshots can be written under `screenshots` and `extra_screenshots` in the
  profile. Local context, prompt skills and selected attachments may contain
  sensitive content too.
- Application-owned logs reduce payloads to opaque metadata. This does not
  intercept every Chromium/OS file-descriptor write, third-party library output
  or the Codex CLI's own logs.

Deleting a meeting is a logical database operation, not secure erasure. WAL,
backups, exports, provider copies or OS caches may remain. No verified fixed
retention period or universal secure-delete guarantee is asserted.

## Provider transmission

Answer providers may receive question text, permitted context and screenshots.
Summary generation requires both transcript and post-call summary scopes.
Speech providers receive live audio when an explicitly selected/configured STT
provider is used and a meeting is started. There is no separate raw-audio scope
toggle: the transcript scope governs text sent to an LLM, not audio consent.
Selecting a provider is not proof of a working device, valid account or consent
from other participants.

LLM send paths recheck their purpose/data-scope permissions; STT is governed by
the separate provider-selection/meeting-start workflow above. The shared HTTP
helper checks URL syntax and rejects redirects, not an origin-authorization
allowlist. Initial origins come from fixed or explicit configuration. Markdown
does not fetch remote images; opening an external link is a
separate user action. Custom endpoints and environment configuration can permit
HTTP, so **not all communication is guaranteed to use TLS**. Use trusted HTTPS
endpoints for sensitive data.

The Codex CLI uses its own credentials, configuration, subprocess behavior and
network transports. Application checks before launch cannot inspect all those
requests or internal retries. [OUTBOUND](docs/margin/OUTBOUND.md) records the
precise implementation boundary.

Cancellation and scope revocation stop or drop covered future work, not data
already submitted. Queued SDK connection/authentication attempts have different
cancellation behavior from application-owned audio writes; not every SDK-owned
transport is claimed to close synchronously.

## Your decisions

Record only with necessary permissions and participant consent. Choose providers,
scopes and endpoints carefully; protect service-account files and environment
variables; review profiles, exports and backups when removing data. Real
provider, device, keychain and adversarial security acceptance are separate from
synthetic tests and source inspection. See [SECURITY](SECURITY.md) for reports.
