#!/usr/bin/env node
// S22: before packaging on CI, replaces the prebuilt libvips-cpp of
// @img/sharp-libvips-darwin-arm64 in node_modules with the one this run rebuilt
// from the sharp-libvips recipe (job `libvips`, artifact margin-libvips-<commit>).
// It checks the artifact's BUILD-INFO and commit, that the rebuild carries the
// same component versions as the npm package, is arm64 with the same install name,
// and exports every symbol sharp imports from the prebuilt. The prebuilt is kept
// for the replacement check, and the record is written for the package checks.
// GitHub Actions only.
//   node scripts/margin/libvips/install-rebuilt.mjs <downloaded margin-libvips dir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyDirectory } from '../download-ci-artifact.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Installing the rebuilt libvips runs only on GitHub Actions');
const artifact = path.resolve(process.argv[2]);
const temp = process.env.RUNNER_TEMP;
const record = path.join(temp, 'libvips-installed.json');
if (fs.existsSync(record)) throw new Error('rebuilt libvips already installed in this job');

const PACKAGE = path.join(ROOT, 'node_modules/@img/sharp-libvips-darwin-arm64');
const LIB = path.join(PACKAGE, 'lib/libvips-cpp.8.17.3.dylib');
const SHARP = path.join(ROOT, 'node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tool = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const symbols = (args, file) => new Set(tool('/usr/bin/nm', [...args, file]).split('\n').map((line) => line.trim().split(/\s+/).pop()).filter(Boolean));

verifyDirectory(artifact, { commit: process.env.GITHUB_SHA });
const extracted = fs.mkdtempSync(path.join(temp, 'libvips-rebuilt-'));
tool('/usr/bin/tar', ['-xzf', path.join(artifact, 'sharp-libvips-darwin-arm64v8.tar.gz'), '-C', extracted, 'lib/libvips-cpp.8.17.3.dylib', 'versions.json']);
const rebuilt = path.join(extracted, 'lib/libvips-cpp.8.17.3.dylib');

const versions = (file) => JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')));
if (versions(path.join(extracted, 'versions.json')) !== versions(path.join(PACKAGE, 'versions.json'))) throw new Error('rebuilt component versions differ from the npm package');
if (tool('/usr/bin/lipo', ['-archs', rebuilt]).trim() !== 'arm64') throw new Error('rebuilt libvips is not arm64-only');
const installName = (file) => tool('/usr/bin/otool', ['-D', file]).trim().split('\n').pop();
if (installName(rebuilt) !== installName(LIB)) throw new Error('rebuilt libvips install name differs');
const shipped = symbols(['-gU'], LIB);
const provided = symbols(['-gU'], rebuilt);
const needed = [...symbols(['-u'], SHARP)].filter((name) => shipped.has(name));
const missing = needed.filter((name) => !provided.has(name));
if (!needed.length || missing.length) throw new Error(`rebuilt libvips lacks ${missing.length} symbols sharp imports: ${missing.slice(0, 5).join(', ')}`);

const upstreamDir = path.join(temp, 'libvips-upstream');
fs.mkdirSync(upstreamDir);
fs.copyFileSync(LIB, path.join(upstreamDir, path.basename(LIB)));
const upstreamSHA256 = sha(LIB);
fs.copyFileSync(rebuilt, LIB);
const result = {
  upstreamSHA256, rebuiltSHA256: sha(LIB), installName: installName(LIB), sharpImports: needed.length,
  uuid: tool('/usr/bin/dwarfdump', ['--uuid', LIB]).split(/\s+/)[1], artifactRun: verifyDirectory(artifact).fields.run,
  upstreamCopy: path.join(upstreamDir, path.basename(LIB)),
};
if (result.rebuiltSHA256 !== sha(rebuilt)) throw new Error('installation did not take');
fs.writeFileSync(record, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
