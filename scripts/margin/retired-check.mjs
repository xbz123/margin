#!/usr/bin/env node
// Retired-feature check for the Margin AGPL branch (PLAN.md gate G3).
//
// Rules live in docs/margin/retired-rules.json, each tagged with the ticket that
// retires it. By default only rules of tickets listed in `completedTickets` are
// enforced; --all enforces every rule (phase exits). Exit 1 on any hit.
//
// Rule kinds:
//   path    - the tracked path (file or directory prefix) must not exist
//   symbol  - identifier must not appear as a whole word in scanned source files
//   host    - host name (or ":port") must not appear in scanned source files
//   dep     - npm package must not be in package.json or package-lock.json
//   cargo   - Rust crate must not be in native-module/Cargo.toml
//
// Usage: node scripts/margin/retired-check.mjs [--all] [--ticket AG-10] [--json]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/margin/retired-rules.json'), 'utf8'));
const args = process.argv.slice(2);
const ticketArg = args.includes('--ticket') ? args[args.indexOf('--ticket') + 1] : null;

const active = RULES.rules.filter((r) =>
  args.includes('--all') ? true : ticketArg ? r.ticket === ticketArg : RULES.completedTickets.includes(r.ticket));

// Tracked plus untracked-but-not-ignored files, so a check before commit sees new files.
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => f && fs.existsSync(path.join(ROOT, f)));
const inScope = (f) => RULES.scanRoots.some((r) => f === r || f.startsWith(r.endsWith('/') ? r : r + '/'))
  && !RULES.scanExclude.some((e) => f === e || f.startsWith(e.endsWith('/') ? e : e + '/'));
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|rs|toml|yml|yaml|html|css|d\.ts)$/;
const scanned = files.filter((f) => inScope(f) && TEXT.test(f));
const contents = new Map(scanned.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function grep(re) {
  const hits = [];
  for (const [f, text] of contents) {
    const lines = text.split('\n');
    lines.forEach((l, i) => { if (re.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  }
  return hits;
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const cargoPath = path.join(ROOT, 'native-module/Cargo.toml');
const cargo = fs.existsSync(cargoPath) ? fs.readFileSync(cargoPath, 'utf8') : '';

const results = [];
for (const r of active) {
  let hits = [];
  if (r.kind === 'path') {
    hits = files.filter((f) => f === r.value || f.startsWith(r.value + '/'));
    if (r.value === '.gitmodules' || /^[^/]+$/.test(r.value)) {
      // gitlinks (submodules) are not listed by ls-files --others; check the index too
      const idx = execFileSync('git', ['ls-files', '--stage', '--', r.value], { cwd: ROOT, encoding: 'utf8' }).trim();
      if (idx && !hits.length) hits = [idx];
    }
  } else if (r.kind === 'symbol') {
    hits = grep(new RegExp(`\\b${escape(r.value)}\\b`));
  } else if (r.kind === 'host') {
    hits = grep(new RegExp(escape(r.value)));
  } else if (r.kind === 'dep') {
    const declared = ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides']
      .filter((k) => pkg[k] && r.value in pkg[k]).map((k) => `package.json ${k}`);
    const locked = Object.keys(lock.packages || {}).filter((p) => p === `node_modules/${r.value}` || p.endsWith(`/node_modules/${r.value}`));
    hits = [...declared, ...locked.map((p) => `package-lock.json ${p}`)];
  } else if (r.kind === 'cargo') {
    hits = cargo.split('\n').filter((l) => new RegExp(`^\\s*${escape(r.value)}\\s*=`).test(l)).map((l) => `Cargo.toml: ${l.trim()}`);
  }
  results.push({ ...r, hits });
}

const failing = results.filter((r) => r.hits.length);
if (args.includes('--json')) {
  console.log(JSON.stringify({ mode: args.includes('--all') ? 'all' : ticketArg || 'completed', rules: results.length, failing }, null, 2));
} else {
  for (const r of failing) {
    console.log(`\n[${r.ticket}] ${r.kind} ${r.value}: ${r.hits.length} hit(s)`);
    for (const h of r.hits.slice(0, 10)) console.log(`  ${h}`);
    if (r.hits.length > 10) console.log(`  ... ${r.hits.length - 10} more`);
  }
  const mode = args.includes('--all') ? 'all rules' : ticketArg ? `rules of ${ticketArg}` : `rules of completed tickets (${RULES.completedTickets.join(', ') || 'none'})`;
  console.log(`\nretired-check: ${results.length} ${mode} checked, ${failing.length} failing`);
}
process.exitCode = failing.length ? 1 : 0; // not process.exit(): let piped stdout flush
