# CI 37868935310: first full packaging run (failed)

Commit `59426500`, dispatched 2026-10-09 with `no_cache=true`, `package_apps=true`
and `libvips_rebuild=true`. Kept as the failure record for AG-25.

- **gates job: failure.** Clean install, native build from scratch (cidre compiled),
  the 16 gates and the release identity contract passed. The temp package then
  failed one check: the forbidden-content rule `(^|/)resources/models(/|$)` (case
  insensitive) matched 20 paths of the ElevenLabs SDK's
  `api/resources/models` client (`package-step-excerpt.log`). Every other check of
  that package passed. The step stopped there, so the release package, both
  launches and the source bundle did not run, and the release upload found no
  file.
- **libvips job: success.** Used to check the rebuild record. Two gaps were found
  in it and fixed in the next commit: the cargo-c version line was empty, and
  nothing proved that every registry crate compiled for librsvg was kept (184 of
  353 locked crates were kept; the build log shows 169 compiled from the registry).
- **libvips-replace: skipped** (it needed the gates job).

The rule was a false positive, not forbidden content. Fix `2f11ad59`: the model
rule now matches only `Resources/models` (where upstream's `extraResources` put
models) and the app's own `resources/models` inside the asar. Checked offline
against the 40,511 package entries of run 37852628461 before pushing: the only
matches were the packages S21 removed (canvas, pdf-parse, pdfjs-dist, mammoth).
`packagingTools.test.mjs` pins both sides. The same commit made each packaging,
launch and source step run regardless of an earlier step, so one run reports every
failing check.

Run 37870671533 on `2f11ad59` then passed all three jobs. Its artifacts were used
only to rehearse the local checks; the accepted evidence is run 37871598165 on the
final code commit (`../CI-37871598165/`).
