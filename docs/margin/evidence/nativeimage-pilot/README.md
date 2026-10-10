# Pilot: Electron nativeImage in place of sharp (S33)

Question: can Electron's own `nativeImage` do what sharp does in Margin, so that
sharp, the rebuilt libvips and its CI jobs can be removed? Run by Claude on
2026-10-11 at the user's request, on `bb13f119`, with Electron 43.1.0 and sharp's
libvips 8.17.3. Synthetic images only; no app code changed.

## What sharp does today

| Call site | Work | Replacement tried |
| --- | --- | --- |
| `LLMHelper.processImage` | resize inside 1536 px, JPEG q80 | `resize({quality:'best'})` + `toJPEG(80)` |
| `ImageOptimizer.optimize` (4 profiles) | resize inside 1024–1920 px, mozjpeg q78–90 | same as above |
| `ScreenshotHelper.stitchImages` | resize each display's capture, composite on a transparent canvas | resize, then copy BGRA rows into one buffer, `createFromBitmap` |
| `ImageHashService` | 16×16 average hash | none: the class has no caller (dead code) |

## How

- `make-sources.swift` draws `ground-truth.txt` (a coding question with Chinese
  text, Menlo code and a small hint line) as 2880×1800 light and dark Retina
  screenshots and a 1920×1080 one. Electron's renderer processes could not start in
  this environment (Mach port lookup denied), so the sources are not drawn in
  Chromium; `exp-main.cjs` opens no window.
- `exp-main.cjs` runs in Electron under the isolation guard (`run.test.mjs`; the
  guard loaded and blocked nothing) and writes `results.json`: size, time and PSNR
  against a lossless lanczos resize at the same size, for every source × profile,
  for both libraries; the two-display stitch; and which formats nativeImage decodes.
- `ocr.swift` reads every source and output with macOS Vision (on device), and
  `score.py` scores each against the ground truth (`ocr.jsonl`, `ocr-score.json`).
- `compare-fast.png`: the same crop of the smallest profile (1024 px), sharp above,
  nativeImage below, enlarged 2×.

## Results

- **Same output size** in every case (15 of 15).
- **Quality**: nativeImage PSNR is equal for `processImage` (46.5 against 46.8 dB)
  and 3–6 dB higher for the four optimizer profiles, because sharp uses mozjpeg
  with 4:2:0 chroma there. OCR scores are within noise of each other: for example
  Retina light 1536 px 0.963 (sharp) against 0.955, dark 0.946 against 0.950,
  1024 px 0.770 against 0.798. The source PNGs themselves score 0.83–0.97 because
  Vision drops lines holding only `}`. The crop shows no visible difference.
- **Bytes**: nativeImage files are about 50% larger in the optimizer profiles
  (Retina 1536 px: 48 KB against 32 KB) and equal for `processImage`. Every output is
  under 70 KB, far below the 3.5 MB limit.
- **Time**: nativeImage was 2–13× faster (Retina 1536 px: 25 against 102 ms).
- **Stitch**: same 3360×1080 canvas, transparent area stays transparent, PSNR
  63 dB against sharp's result (practically identical), 62 against 80 ms.
- **Decoding**: PNG and JPEG work; **WebP and GIF do not** (empty image). The image
  validator accepts `.webp` and `.gif`, but it only admits files inside the app's
  data directory, and the app writes only PNG screenshots there; no code produces
  WebP or GIF.

## What removal would take (not done)

- Replace the three call sites as above, delete `ImageHashService`, narrow the
  validator to PNG/JPEG, drop `withoutEnlargement`/EXIF rotation (screenshots carry
  no EXIF) and the unused WebP branch.
- Remove the `sharp` dependency, `scripts/margin/libvips/` (11 files), the
  `libvips` and `libvips-replace` jobs of `margin-gates.yml`, the libvips steps of
  the gates job, the `libvips-rebuilt` package check, the libvips notices and
  sources artifact, and `scripts/ensure-sharp-mac-deps.js`; regenerate
  `licenses/manifest.json`.
- Gains: about 15 MB less in the package (`@img/sharp-libvips-darwin-arm64`),
  about 22 minutes less per full CI run, a 173 MB sources artifact and the pinned
  nightly Rust toolchain gone.
