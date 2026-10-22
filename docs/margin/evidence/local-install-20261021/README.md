# Natively Local installation — 2026-10-21

User authorized installing the recent repairs. Installed source is
`44a5e3a8b41182d5ed2a5d7d4828c0099a59e8d5` on `codex/margin-agpl-migration`.
Identity remains Natively Local / `local.natively.desktop`, macOS arm64,
ad-hoc signed. Production code was not changed for this installation.

- Built with `MARGIN_APP_VARIANT=local node scripts/build-local.cjs`.
- Package checks: 12/12. Isolated package-owned asar startup: 10/10.
- Installed bundle checks: 12/12; all regular-file contents, modes and symlink
  targets match the verified package.
- Application: `/Applications/Natively Local.app`.
- Installed asar SHA-256: `91f37eb482caa56eb509ae3ef6541f1cd5c2089dfe5e0bb46766dbce367f7e57`.
- ZIP SHA-256: `ca4736361571afee988cf33c16c39dbaab011110de5941307e6d3361c3610c56`.
- Native audio module reused unchanged: `71f9cf8e25767a338e3c8a7bd73273db9b6428afcfd3ae21cb871e4759fb2603`.

Natively Local was not running before replacement. No user-data directory was
written by the installer; hashes of all existing top-level profile files,
including settings, encrypted credentials and the database, were unchanged.
The separate Margin application's asar hash was unchanged. No permissions or
Keychain settings were reset. The old bundle remains temporarily available at
`/private/tmp/natively-install-20261021-c25avR/previous.bundle` for rollback.

Raw build, package and smoke reports are in
`/private/var/folders/1k/d8x0x94s27g81fbsdbnhsfy00000gn/T/natively-local-package-Pb9n4I`;
installation report is `/private/tmp/natively-install-20261021-c25avR/installation.json`.
These temporary paths are local evidence, not public delivery artifacts.

The initial sandboxed Electron launch was denied. Running the project isolation
entry outside the execution sandbox launched successfully, but two path checks
failed because `/var` resolved to `/private/var`. Repeating the same check with
the canonical path passed all ten checks, without changing code or assertions.

The installed application has not been launched with the real user profile.
Real model/STT services, capture devices, shared-screen behavior and stage-6
user acceptance remain unverified. Ad-hoc identity changes may prompt for OS or
Keychain authorization again. No publish, remote CI or formal Margin release
was performed for this installation.
