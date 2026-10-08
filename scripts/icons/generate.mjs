#!/usr/bin/env node
// Regenerates every app icon asset from the SVG sources in this folder.
// Run from the repository root on macOS (needs `iconutil`): node scripts/icons/generate.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const here = fileURLToPath(new URL('.', import.meta.url));
const large = readFileSync(join(here, 'app-icon.svg'));
const small = readFileSync(join(here, 'app-icon-small.svg'));
const glyph = readFileSync(join(here, 'glyph.svg'), 'utf8');
const artifacts = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function write(file, bytes) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  artifacts.push({ path: file, bytes: bytes.length, sha256: hash(bytes) });
}

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
try {
  mkdirSync(iconset);
  for (const base of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, `icon_${base}x${base}.png`), await appIcon(base));
    writeFileSync(join(iconset, `icon_${base}x${base}@2x.png`), await appIcon(base * 2));
  }
  const icns = join(work, 'margin.icns');
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns]);
  write('assets/margin.icns', readFileSync(icns));
} finally {
  rmSync(work, { recursive: true, force: true });
}

// Full-colour PNGs: Dock restore after disguise, window icon, Linux set.
write('assets/icon.png', await appIcon(512));
for (const size of [16, 32, 64, 128, 256, 512, 1024])
  write(`assets/icons/png/icon_${size}x${size}.png`, await appIcon(size));

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
write('assets/icons/win/icon.ico', Buffer.concat([header, ...images]));

// Menu bar template (black + alpha; macOS tints it) at 16pt with an @2x variant.
write('assets/iconTemplate.png', await glyphPng(16, '#000'));
write('assets/iconTemplate@2x.png', await glyphPng(32, '#000'));

// In-app logo: white glyph; `.force-black-icon` recolours it per theme.
const logo = await glyphPng(644, '#FFF', 2);
write('src/components/icon.png', logo);
write('src/assets/logo.png', logo);
write('src/assets/logo.webp', await sharp(logo).webp({ lossless: true }).toBuffer());

mkdirSync('scripts/icons', { recursive: true });
writeFileSync('scripts/icons/generated-assets.json', JSON.stringify({
  schemaVersion: 1,
  sources: ['app-icon.svg', 'app-icon-small.svg', 'glyph.svg', 'generate.mjs'].map(file => ({ path: `scripts/icons/${file}`, sha256: hash(readFileSync(join(here, file))) })),
  artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path)),
}, null, 2) + '\n');
console.log('Icons regenerated.');
