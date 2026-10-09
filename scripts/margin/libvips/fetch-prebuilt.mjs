#!/usr/bin/env node
// S22 replacement check: fetches the prebuilt libvips-cpp of
// @img/sharp-libvips-darwin-arm64 from the tarball package-lock.json resolves,
// checks the lockfile integrity, and extracts the library to <out>. It is the
// "other build" a user puts into the package in place of the shipped rebuild.
//   node scripts/margin/libvips/fetch-prebuilt.mjs <out dir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { UPSTREAM_LIBVIPS_SHA256 } = createRequire(import.meta.url)('../package-check.cjs');
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: true });
const entry = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages['node_modules/@img/sharp-libvips-darwin-arm64'];
const response = await fetch(entry.resolved, { signal: AbortSignal.timeout(120_000) });
if (!response.ok) throw new Error(`HTTP ${response.status}: ${entry.resolved}`);
const bytes = Buffer.from(await response.arrayBuffer());
const [algorithm, expected] = entry.integrity.split(/-(.*)/s);
if (crypto.createHash(algorithm).update(bytes).digest('base64') !== expected) throw new Error('lockfile integrity mismatch');
const tarball = path.join(out, path.basename(new URL(entry.resolved).pathname));
fs.writeFileSync(tarball, bytes);
execFileSync('/usr/bin/tar', ['-xzf', tarball, '-C', out, '--strip-components=2', 'package/lib/libvips-cpp.8.17.3.dylib']);
const lib = path.join(out, 'libvips-cpp.8.17.3.dylib');
const sha = crypto.createHash('sha256').update(fs.readFileSync(lib)).digest('hex');
if (sha !== UPSTREAM_LIBVIPS_SHA256) throw new Error(`prebuilt sha256 ${sha} is not the recorded one`);
console.log(JSON.stringify({ resolved: entry.resolved, integrity: entry.integrity, sha256: sha }));
