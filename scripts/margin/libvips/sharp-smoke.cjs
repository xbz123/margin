'use strict';
// Run with the packaged app's own Electron in Node mode (ELECTRON_RUN_AS_NODE=1):
// loads sharp from the app's asar and exercises PNG, WebP and SVG (librsvg).
const path = require('node:path');
const app = process.argv[2];
const sharp = require(path.join(app, 'Contents/Resources/app.asar/node_modules/sharp'));
(async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
  const webp = await sharp(png).resize(4, 4).webp().toBuffer();
  const meta = await sharp(webp).metadata();
  const svg = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#00f"/></svg>')).raw().toBuffer();
  console.log(JSON.stringify({ vips: sharp.versions.vips, webp: meta.format, width: meta.width, svgFirstPixel: [...svg.subarray(0, 3)] }));
})().catch((error) => { console.error(error.message); process.exit(1); });
