#!/usr/bin/env node
// Checks that every member the renderer's ElectronAPI type declares
// (src/types/electron.d.ts) is actually provided by the preload bridge
// (electron/preload.ts). A declared-but-missing member type-checks fine but is
// `undefined` at runtime, which is how retired features leave broken UI behind.
//   node scripts/margin/preload-contract-check.mjs
// Exit 1 when the renderer declares members preload does not provide.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const preload = fs.readFileSync(path.join(ROOT, 'electron/preload.ts'), 'utf8');
const dts = fs.readFileSync(path.join(ROOT, 'src/types/electron.d.ts'), 'utf8');

// The bridge object passed to contextBridge.exposeInMainWorld('electronAPI', ...).
const implStart = preload.search(/contextBridge\.exposeInMainWorld\(\s*['"]electronAPI['"]/);
if (implStart < 0) throw new Error('electronAPI bridge not found in preload.ts');
const objStart = preload.indexOf('{', implStart);
const provided = new Set();
let depth = 0;
for (const line of preload.slice(objStart).split('\n')) {
  const m = depth === 1 && line.match(/^\s+(\w+)\s*[:(]/);
  if (m) provided.add(m[1]);
  for (const ch of line.replace(/(['"`]).*?\1/g, '')) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  if (depth <= 0 && provided.size) break;
}

const ifaceStart = dts.search(/interface\s+ElectronAPI\s*\{/);
if (ifaceStart < 0) throw new Error('interface ElectronAPI not found in electron.d.ts');
const declared = new Set();
depth = 0;
for (const line of dts.slice(dts.indexOf('{', ifaceStart)).split('\n')) {
  const m = depth === 1 && line.match(/^\s+(\w+)\??\s*:/);
  if (m) declared.add(m[1]);
  for (const ch of line.replace(/(['"`]).*?\1/g, '')) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  if (depth <= 0 && declared.size) break;
}

const missing = [...declared].filter((n) => !provided.has(n)).sort();
console.log(`declared ${declared.size}, provided ${provided.size}, declared-but-missing ${missing.length}`);
for (const n of missing) console.log(`  ${n}`);
process.exitCode = missing.length ? 1 : 0;
