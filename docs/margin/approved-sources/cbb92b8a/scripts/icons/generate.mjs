#!/usr/bin/env node
// Regenerates every app icon asset from the SVG sources in this folder.
// Run from the repository root on macOS (needs `iconutil`): node scripts/icons/generate.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const here = new URL('.', import.meta.url).pathname;
const large = readFileSync(join(here, 'app-icon.svg'));
const small = readFileSync(join(here, 'app-icon-small.svg'));
const glyph = readFileSync(join(here, 'glyph.svg'), 'utf8');

// The small variant keeps the rule and bars legible at list and Dock-stack sizes.
const appIcon = size => sharp(size <= 32 ? small : large, { density: 72 * size / 1024 * 4 })
  .resize(size, size).png().toBuffer();
const glyphPng = (size, color, pad = 0) => {
  const svg = glyph.replace('fill="#000"', `fill="${color}"`)
    .replace('viewBox="0 0 22 22"', `viewBox="${-pad} ${-pad} ${22 + 2 * pad} ${22 + 2 * pad}"`);
  return sharp(Buffer.from(svg), { density: 72 * size / 22 * 4 }).resize(size, size).png().toBuffer();
};

// macOS .icns through iconutil.
const work = mkdtempSync(join(tmpdir(), 'margin-icon-'));
const iconset = join(work, 'margin.iconset');
execFileSync('mkdir', ['-p', iconset]);
for (const base of [16, 32, 128, 256, 512]) {
  writeFileSync(join(iconset, `icon_${base}x${base}.png`), await appIcon(base));
  writeFileSync(join(iconset, `icon_${base}x${base}@2x.png`), await appIcon(base * 2));
}
const icns = join(work, 'margin.icns');
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns]);
for (const out of ['assets/margin.icns', 'assets/icon.icns', 'assets/icons/mac/icon.icns']) copyFileSync(icns, out);

// Full-colour PNGs: Dock restore after disguise, window icon, Linux set.
writeFileSync('assets/icon.png', await appIcon(512));
writeFileSync('assets/icon-512.png', await appIcon(512));
for (const size of [16, 32, 64, 128, 256, 512, 1024])
  writeFileSync(`assets/icons/png/icon_${size}x${size}.png`, await appIcon(size));

// Windows .ico with PNG-compressed entries.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(icoSizes.map(appIcon));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((png, i) => {
  const e = 6 + 16 * i, size = icoSizes[i];
  header.writeUInt8(size >= 256 ? 0 : size, e); header.writeUInt8(size >= 256 ? 0 : size, e + 1);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(png.length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
writeFileSync('assets/icons/win/icon.ico', Buffer.concat([header, ...images]));

// Menu bar template (black + alpha; macOS tints it) at 16pt with an @2x variant.
for (const dir of ['assets', 'src/components']) {
  writeFileSync(`${dir}/iconTemplate.png`, await glyphPng(16, '#000'));
  writeFileSync(`${dir}/iconTemplate@2x.png`, await glyphPng(32, '#000'));
}

// In-app logo: white glyph; `.force-black-icon` recolours it per theme.
writeFileSync('src/components/icon.png', await glyphPng(644, '#FFF', 2));

rmSync(work, { recursive: true, force: true });
console.log('Icons regenerated.');
