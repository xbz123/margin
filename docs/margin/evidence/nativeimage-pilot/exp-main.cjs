// Pilot (S33): can Electron's nativeImage replace sharp in the three live call sites?
// Runs as an Electron main script under the isolation guard (run.test.mjs). Builds
// synthetic screenshots, runs each sharp pipeline and its nativeImage replacement, and
// writes images plus results.json to EXP_OUT. sharp is used here only as the baseline
// and as a decoder for the measurements.
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(path.join(process.env.EXP_REPO, 'node_modules/sharp'));

const OUT = process.env.EXP_OUT;
const results = { electron: process.versions.electron, sharp: sharp.versions, cases: {} };
const ms = (t0) => Number((performance.now() - t0).toFixed(1));
const save = (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); return name; };

const fitInside = (w, h, max) => {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * s), height: Math.round(h * s) };
};

// nativeImage replacement for "resize inside max, encode JPEG q".
function nativeJpeg(png, max, quality) {
  const img = nativeImage.createFromBuffer(png);
  const { width, height } = img.getSize();
  const size = fitInside(width, height, max);
  const resized = size.width === width ? img : img.resize({ ...size, quality: 'best' });
  return { buf: resized.toJPEG(quality), ...resized.getSize() };
}

// nativeImage replacement for ScreenshotHelper.stitchImages: resize each capture, then
// copy its BGRA rows into one transparent canvas.
function nativeStitch(captures, outW, outH) {
  const canvas = Buffer.alloc(outW * outH * 4);
  for (const c of captures) {
    const img = nativeImage.createFromBuffer(c.png).resize({ width: c.w, height: c.h, quality: 'best' });
    const { width, height } = img.getSize();
    const bmp = img.toBitmap();
    for (let y = 0; y < height && c.top + y < outH; y++) {
      const rowW = Math.min(width, outW - c.left);
      bmp.copy(canvas, ((c.top + y) * outW + c.left) * 4, y * width * 4, (y * width + rowW) * 4);
    }
  }
  return nativeImage.createFromBitmap(canvas, { width: outW, height: outH }).toPNG();
}

// PSNR (RGB) of `buf` against `ref`, both decoded at the reference size.
async function psnr(buf, ref) {
  const r = await sharp(ref).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const t = await sharp(buf).removeAlpha().resize(r.info.width, r.info.height, { fit: 'fill' }).raw().toBuffer();
  let se = 0;
  for (let i = 0; i < r.data.length; i++) { const d = r.data[i] - t[i]; se += d * d; }
  const mse = se / r.data.length;
  return mse === 0 ? Infinity : Number((10 * Math.log10(255 * 255 / mse)).toFixed(2));
}

async function run() {
  // 1. Sources from make-sources.swift (renderer processes cannot start in the pilot
  //    environment): a Retina code screenshot (2880x1800) in light and dark, and a 1x one.
  const src = {};
  for (const k of ['retinaLight', 'retinaDark', 'plain1x']) src[k] = fs.readFileSync(path.join(process.env.EXP_SRC, `${k}.png`));
  for (const [k, v] of Object.entries(src)) {
    const m = await sharp(v).metadata();
    results.cases[`source:${k}`] = { file: save(`src-${k}.png`, v), width: m.width, height: m.height, bytes: v.length };
  }

  // 2. LLMHelper.processImage (1536, q80) and the four ImageOptimizer profiles.
  const profiles = { processImage: [1536, 80], fast: [1024, 78], balanced: [1280, 85], technical: [1536, 88], best: [1920, 90] };
  for (const [srcName, png] of Object.entries(src)) {
    for (const [name, [max, q]] of Object.entries(profiles)) {
      const mozjpeg = name !== 'processImage';
      let t0 = performance.now();
      const s = await sharp(png).resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
        .jpeg(mozjpeg ? { quality: q, mozjpeg: true, chromaSubsampling: '4:2:0' } : { quality: q }).toBuffer({ resolveWithObject: true });
      const sharpMs = ms(t0);
      t0 = performance.now();
      const n = nativeJpeg(png, max, q);
      const nativeMs = ms(t0);
      // Lossless reference at the same size: sharp's lanczos3 resize, PNG.
      const ref = await sharp(png).resize(s.info.width, s.info.height, { fit: 'fill' }).png().toBuffer();
      const key = `${srcName}:${name}`;
      results.cases[key] = {
        max, quality: q, mozjpeg,
        sharp: { file: save(`${key.replace(':', '-')}-sharp.jpg`, s.data), width: s.info.width, height: s.info.height, bytes: s.data.length, ms: sharpMs, psnr: await psnr(s.data, ref) },
        native: { file: save(`${key.replace(':', '-')}-native.jpg`, n.buf), width: n.width, height: n.height, bytes: n.buf.length, ms: nativeMs, psnr: await psnr(n.buf, ref) },
      };
    }
  }

  // 3. Stitching across two displays: a 2x display (2880x1800 -> 1440x900) left of a
  //    1x display (1920x1080), canvas 3360x1080.
  const captures = [
    { png: src.retinaLight, left: 0, top: 0, w: 1440, h: 900 },
    { png: src.plain1x, left: 1440, top: 0, w: 1920, h: 1080 },
  ];
  let t0 = performance.now();
  const composites = [];
  for (const c of captures) composites.push({ input: await sharp(c.png).resize(c.w, c.h, { fit: 'fill' }).png().toBuffer(), left: c.left, top: c.top });
  const sStitch = await sharp({ create: { width: 3360, height: 1080, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composites).png().toBuffer();
  const sharpStitchMs = ms(t0);
  t0 = performance.now();
  const nStitch = nativeStitch(captures, 3360, 1080);
  const nativeStitchMs = ms(t0);
  const sm = await sharp(sStitch).metadata(), nm = await sharp(nStitch).metadata();
  // Transparent area must stay transparent: alpha of the pixel below the 2x capture.
  const alphaAt = async (buf) => (await sharp(buf).extract({ left: 10, top: 1000, width: 1, height: 1 }).raw().toBuffer())[3];
  results.cases.stitch = {
    sharp: { file: save('stitch-sharp.png', sStitch), width: sm.width, height: sm.height, bytes: sStitch.length, ms: sharpStitchMs, alphaBelow2x: await alphaAt(sStitch) },
    native: { file: save('stitch-native.png', nStitch), width: nm.width, height: nm.height, bytes: nStitch.length, ms: nativeStitchMs, alphaBelow2x: await alphaAt(nStitch), psnrVsSharp: await psnr(nStitch, sStitch) },
  };

  // 4. Which input formats nativeImage decodes (the validator accepts png/jpg/webp/gif).
  const formats = {
    png: src.plain1x,
    jpeg: await sharp(src.plain1x).jpeg().toBuffer(),
    webp: await sharp(src.plain1x).webp().toBuffer(),
    gif: await sharp(src.plain1x).gif().toBuffer(),
  };
  results.cases.decode = {};
  for (const [f, buf] of Object.entries(formats)) {
    const file = save(`decode.${f}`, buf);
    const fromBuffer = nativeImage.createFromBuffer(buf);
    const fromPath = nativeImage.createFromPath(path.join(OUT, file));
    results.cases.decode[f] = { fromBuffer: fromBuffer.isEmpty() ? 'empty' : fromBuffer.getSize(), fromPath: fromPath.isEmpty() ? 'empty' : fromPath.getSize() };
  }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
}

app.whenReady().then(run).then(() => app.exit(0), (e) => {
  fs.writeFileSync(path.join(OUT, 'error.txt'), String(e && e.stack || e));
  process.exitCode = 1;
  app.exit(1);
});
