# Contributing to Margin

Keep changes scoped. Explain the observable behavior, boundary and checks
actually run. Preserve unrelated edits. Do not commit recordings, datasets,
credentials, models, build directories or machine-specific configuration.

## Provenance

Application source is AGPL-3.0-only. Read [BASELINE](docs/margin/BASELINE.md),
[ADAPTATION](docs/margin/ADAPTATION.md) and [PROVENANCE](docs/margin/PROVENANCE.md)
before imports. Later upstream code or an older personal branch is not an
automatically approved source. Renaming copied code proves no license right.
Record the exact reference, path, license and applicable approval. Third-party
components retain their own original license and copyright notices.

## Development safety

Use locked dependencies and install without lifecycle scripts. Do not repair
unrelated dependencies, change global configuration or rebuild native code as
an incidental check. Native modules need their own toolchain and build
provenance; JS success is not clean native or Windows/Linux acceptance.

Run executable tests through `scripts/margin/isolation/run-node.mjs`. It uses a
temporary profile, clears provider credentials and records blocked access.
Grant only exact needed local executables. Electron tests must retain fake
credentials, synthetic content, mock devices/keychain and loopback transports.

```sh
node scripts/build-electron.js
npx vite build
node scripts/margin/isolation/run-node.mjs --allow-exec Electron \
  --test --test-timeout=180000 tests/margin/answer-regression.test.mjs
node scripts/margin/run-gates.mjs --out <new-evidence-directory> --ref <verified-reference>
git diff --check
```

Keep implementation, synthetic checks, full gates, fresh CI, package inspection,
real-service/device tests and independent review separate. State deferred cases
and excluded platforms. Older CI cannot validate new code.

## License inventory

`scripts/margin/collect-licenses.mjs` reads original local notices from installed
lock candidates, dependencies embedded in main-bundle source maps and an
existing Cargo registry cache. It installs nothing and does not build native
code. `--fetch-missing` retrieves only licensing material and version metadata
from official references; `--github-via-gh` can use an existing GitHub session
for public read-only metadata without printing credentials.

Review `licenses/manifest.json` unresolved entries. SPDX fields do not solve
missing texts, native vendored components, multi-license choices or copyleft
source/relinking obligations. See [licenses/README](licenses/README.md).
Packaging must retain LICENSE, NOTICE, the inventory/texts and full fixed-version
Electron/Chromium notices; the package hook checks hashes. Actual asar, unpacked
libraries, Resources and Frameworks still require complete artifact-to-inventory
comparison before claiming distribution compliance.
