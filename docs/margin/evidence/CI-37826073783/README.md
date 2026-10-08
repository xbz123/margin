# Second S17 CI attempt: complete code gates, incomplete native inspection

Run `37826073783`, source `a7168997baee2e91b631436bbba773a18a2da828`,
workflow_dispatch with package_inventory=true, gate_ref=AG-25 and no_cache=false.
The checkout was clean. All 16 gates exited zero, with 880 tests / 875 passes /
zero failures / five existing skips. The release-identity contract passed 6/6.
These successes do not imply package or license acceptance.

## Actual diagnostic evidence

The normal-config temp app was formed, without signing or publishing. The
unchanged normal license verifier rejected 19 unresolved candidates. The
inventory contains 49,322 filesystem/asar entries, 1,080 package-metadata records
(including nested module-scope metadata, not 1,080 distinct packages), and 25
Mach-O files, each observed by lipo as arm64.

All 15 unresolved npm components have positive included-file or matching
package-metadata evidence. All four unresolved Cargo candidates remain unknown;
this is not proof that they are absent. Across all 1,068 candidates the report
has 846 included-files, one bundle-source-map-only and 221 unknown observations.
There are 2,388 source-map records whose mapped output was not observed; these
remain blind spots, not evidence of absence. Dynamic libraries do not prove the
composition of statically embedded native code.

The diagnostic itself failed closed because otool returned 1 on the three
helper executables ending in `(GPU)`, `(Plugin)` and `(Renderer)`. Their file and
lipo reads succeeded, but otool-classic removed the final parenthesized suffix
and tried opening a nonexistent filename. The other 22 dynamic-link inspections
succeeded. `inventory/excerpt.json` retains these exact failures and positive
component observations; it is explicitly an excerpt, not the whole inventory.
The normal 19-candidate license rejection remains separate and unchanged.

## Artifact verification and retention

The API returned exactly two artifacts, both text-only; no native or application
artifact was created. Native artifact upload was skipped. Before extraction,
every ZIP entry was checked as a regular relative file without traversal/links.

- Gate artifact 11572285778: 57,295 bytes, 26 files, ZIP SHA-256
  `a1c2a2dfa4e5bcc542201c7ec7b7e8b74ae50f45fab5fb928fb53be6a68eec87`.
  Its unmodified files are archived here.
- Inventory artifact 11571681850: 3,790,734 bytes, five JSON/log files, ZIP SHA-256
  `ec56caf8b962f9d3f17811981d71a3172e60933cb5da8955a519ac33a2c00227`.
  The four small raw files are under `inventory/`. The original inventory JSON
  is 50,487,681 bytes: retained in the verified local download and the 30-day CI
  artifact, not committed as a large generated file. The excerpt records its
  full SHA-256 and identifies its source artifact.

Both ZIP digests match the API. No app/native binary was downloaded. The otool
path handling requires a new checked CI run; AG-26, full AG-25 and stage-2 exit
acceptance remain incomplete.
