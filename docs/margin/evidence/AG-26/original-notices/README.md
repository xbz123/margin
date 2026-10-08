# Original notices: seven missing-text entries closed, distribution not accepted

Base: `ec1385c0d913fffe4c6a1cc8af1ce66fd9669f0a`. This supplement changes
license inputs, generated inventory/texts and provenance documentation, not
dependencies, lockfiles, production code, collector rules or license thresholds.
It adds 32 supplemental sources, 20 license-only input containers and 28 distinct
original texts. Nothing is deleted. Current totals are 726 candidates, 410 texts,
33 excluded paths, three unresolved candidates and two deferred Electron notices.

## Exact source basis

- format 0.2.2: preserve both exact original README and JavaScript MIT
  declarations and their distinct copyright years. Accompany them with fixed
  official MIT full terms; do not fill template placeholders with inferred names.
- oboe/oboe-sys 0.6.1: preserve the separate wrapper Apache declarations, full
  terms and exact Google Oboe gitlink LICENSE/AUTHORS/CONTRIBUTORS. All 140 cached
  vendor files match the official Git blobs; 138 leading notices form 16 original
  byte groups. This does not establish target linking or other binary obligations.
- dingbat-to-unicode 1.0.1: the repository owner's explicit retrospective grant
  applies the later 1.0.2 LICENSE to all previous versions. Do not claim the file
  was present in the older npm archive.
- stream-events 1.0.5 and stubs 3.0.0: later maintainer-merged original LICENSE
  files at unchanged package versions; every installed file matches the fixed
  licensed source byte-for-byte. No neighboring version is substituted.
- tr46 0.0.3: later original MIT LICENSE at the same version, with matching
  package/code files. The installed mapping table is reproduced byte-for-byte
  from official Unicode IDNA 8.0 data using the original generator's transform.
  Preserve the original 1991–2015 data attribution separately from current official
  Unicode v3 terms and the policy applying them to Public Data Files. Do not claim
  v3 existed in 2015 or treat an upgrade recommendation as a retrospective grant.

`checks/main-primary-sources.json` records source hashes, owner grant and Unicode
reproduction/policy. `main-integrity.json` independently refetches the 20 input
containers' full upstream sources and verifies their exact excerpt boundaries,
remote notices and inventory integrity. `main-format-header.json` covers the
remaining locally extracted supplemental source. `main-vendor-coverage.json`
independently verifies the exact gitlink and all cached vendor bytes. All 410
text files are referenced and hash-correct; no orphan text is removed or hidden.
`final-integrity-tr46.json` is the final worker snapshot; earlier intermediate
four-gap snapshots are not used as the result.

## Verification boundary

The collector's final online supplement and offline runs both exit 1, correctly
rejecting three unresolved candidates. The existing license target passes all
11 cases, with no skips. Its separately archived direct-node target logs are
supplementary only, not G4 isolation evidence; the full gate runner executes this
same target under X2. The normal acceptance threshold has not changed.

`gates/` is the first full local run and remains a failed run: 15 of 16 steps
pass; storage fails at its first main-process dbPath query with Playwright's
execution-context error. Unit tests are 884 total / 878 pass / 0 fail / 6 existing
skips; AG-09 passes 6/6. The failure predates any test-harness correction and is
not erased by later passing runs. Raw logs are retained privately; committed
copies redact local path prefixes only, with hashes in
`checks/gates-log-redactions.json`. Subsequent diagnosis/verification must be
recorded separately, not overwrite this first result.

The separate `f759094c` correction (`../storage-query/`) reuses the existing bounded startup
read to return userData along with the guard status. It removes only the extra
unguarded dbPath lookup from the storage test, not the sandbox assertion or any
storage operation. Raw CDP evidence identifies `Promise was collected`, which
Playwright 1.60.0 rewrites to the misleading execution-context message. The
same-protocol deterministic test is red before and green after; exhausted retry,
visible JavaScript error and terminated-process cases reject. The original
natural first-test loop passes 20/20 afterward. Main-thread review independently
hash-matches both corrected files and all 14 raw/retained diagnostic artifacts.

`gates-fixed/` subsequently passes all 16 steps with actual exit code 0: 884
unit tests / 878 pass / 0 fail / 6 unchanged skips, AG-09 6/6, storage 5/5,
startup 1/1 and outbound-renderer 1/1. These run under X2. Raw copies are retained
and path-only transformations are recorded in `checks/gates-fixed-log-redactions.json`.
Post-build offline collection again returns 726/410/33/3/2 and exit 1; all six
frozen license files remain byte-identical. Fresh no-cache CI is still required
for the submitted checkpoint, not inferred from this local run.

The first staged whitespace check found two false conflict markers: format's
verbatim Markdown title underline is seven equals signs. `staged-check-initial.log`
retains that failure. Two exact-file `.gitattributes` entries set the conflict
marker length to eight; no licensing byte, collector rule or other source-file
check changes. All 49 newly staged notice/input files independently match their
verified working bytes. The final staged check must pass before the commit.

No app was packaged, uploaded, installed or accepted by this supplement. No
upstream issue/comment was posted. No real provider, keychain, device or formal
Margin identity was used. AG-26, full AG-25 and the stage exit remain incomplete;
the independent read-only review is still pending.

## Remaining authority and source gaps

`checks/remaining-decisions.md` explains why the three remaining candidates are
not covered by this supplement. The S18 dependency approval does not authorize
upgrading/removing them or changing the retained resampler. Separate native
vendor coverage, corresponding-source and replacement/relinking obligations
also remain unresolved. Three missing-text entries are not the whole remaining
AG-26 acceptance scope.
