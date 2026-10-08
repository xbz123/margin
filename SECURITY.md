# Security boundaries and reporting

Margin uses local storage, native capture APIs, configured providers and optional
provider subprocesses. This repository asserts no security-audit certification,
penetration-test result, bug bounty, response-time SLA or commercial support.

Important boundaries include renderer/preload/IPC inputs, credentials and
service-account files, outbound purposes/scopes/destinations, Markdown links and
images, native audio, logging and package provenance. safeStorage depends on the
OS/backend. SQLite and WAL are not encrypted by the application. Custom HTTP
endpoints and opaque CLI transports remain limitations; see [PRIVACY](PRIVACY.md)
and [OUTBOUND](docs/margin/OUTBOUND.md).

Synthetic checks and CI are not proof that a real provider, device, platform or
hostile input passed security review. Reproduce issues with a temporary profile
and synthetic data. Never test against another person's data, credentials,
accounts or systems without authorization.

A report should identify version/commit, platform, minimal reproduction,
expected/observed behavior and the affected boundary. Do not post API keys,
service-account JSON, account tokens, recordings, personal screenshots, private
paths or unredacted logs.

Use the repository's private vulnerability-reporting facility **if available**;
this document does not claim that one is enabled or invent a contact address.
If no private channel is configured, do not disclose a working sensitive exploit
or secrets in a public issue. A non-sensitive issue may ask for a reporting
channel without the confidential details. No legal safe-harbor or third-party
service commitment is created here.
