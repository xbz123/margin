# Natively Local UI update installation — 2026-10-22

User authorized installing the Settings redesign. Installed source:
`9ea320d688ee3ae5f30149729ecc2df7ca8321cc`, including UI commit `16c565a7`.
The intervening commit contains only the previous installation records.

- Target: `/Applications/Natively Local.app`; identity `local.natively.desktop`, macOS arm64, ad-hoc signed.
- Existing local build entry: `MARGIN_APP_VARIANT=local node scripts/build-local.cjs`.
- Package checks 12/12; isolated package-owned asar startup 10/10; installed package checks 12/12.
- Installed regular-file contents, modes and symlink targets match the verified package.
- Installed asar SHA-256: `48a88d1f3e23b3853fe723ad79ca81d7a4b91474f9e033f79319464a0bf567f5`.
- ZIP SHA-256: `5881d3dbdee413b729bcd19e321306cd62225eab2040fb2a86f28c14247470bd`.
- Natively Local was stopped before replacement. All existing top-level profile file hashes remained unchanged, including settings, encrypted credentials and database. No profile directory was written by the installer.
- The separate Margin application's asar remained unchanged. No permissions or Keychain settings were modified.

Build/package/smoke evidence:
`/private/var/folders/1k/d8x0x94s27g81fbsdbnhsfy00000gn/T/natively-local-package-LE8Ire`.
Installation report: `/private/tmp/natively-install-20261022-B32r9m/installation.json`.
Previous app temporarily retained at `/private/tmp/natively-install-20261022-B32r9m/previous.bundle` for rollback.

The first installation approval attempt failed due to the approval service's credit limit and performed no installation. Following the user's request to continue, the same approval route succeeded; installation exited 0.

No real-profile launch, model/STT request, device capture, public push or new remote CI was performed. Version remains 2.7.0; the installed UI includes nine settings pages, violet accents and a top-right close button. The redesign also changes global accent variables, the Launcher start button and meeting-detail accents; it is not strictly Settings-only. Real UI acceptance remains with the user. Ad-hoc updates may prompt for OS/Keychain authorization again.
