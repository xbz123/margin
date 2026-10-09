#!/usr/bin/env node
// Reads the ld64 map written while linking the native module (native-module/.cargo/
// config.toml) and reports which inputs contribute live symbols to the shipped
// binary: Cargo crates (rlibs), Rust sysroot crates, vendored C archives and system
// libraries (PLAN S19-C). Dead-stripped inputs are listed separately.
//   node scripts/margin/native-link-set.mjs <map> [report.json]
import fs from 'node:fs';
import path from 'node:path';

export function parseMap(text) {
  const objects = new Map();
  const live = new Map();
  const dead = new Map();
  let section = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('# Object files:')) { section = 'objects'; continue; }
    if (line.startsWith('# Sections:')) { section = 'sections'; continue; }
    if (line.startsWith('# Symbols:')) { section = 'symbols'; continue; }
    if (line.startsWith('# Dead Stripped Symbols:')) { section = 'dead'; continue; }
    if (line.startsWith('#') || !line.trim()) continue;
    if (section === 'objects') {
      const match = line.match(/^\[\s*(\d+)\]\s+(.*)$/);
      if (match) objects.set(Number(match[1]), match[2]);
    } else if (section === 'symbols' || section === 'dead') {
      const match = line.match(/^(?:0x[0-9A-Fa-f]+|<<dead>>)\s+0x([0-9A-Fa-f]+)\s+\[\s*(\d+)\]/);
      if (!match) continue;
      const target = section === 'symbols' ? live : dead;
      const index = Number(match[2]);
      target.set(index, (target.get(index) ?? 0) + parseInt(match[1], 16));
    }
  }
  return { objects, live, dead };
}

// Classifies one map input path.
export function classify(input) {
  if (input === 'linker synthesized') return { kind: 'linker', name: 'linker synthesized' };
  const member = input.match(/^(.*)\(([^()]+)\)$/);
  const archive = member ? member[1] : input;
  const base = path.basename(archive);
  if (/\.tbd$|\.dylib$/.test(base) || archive.startsWith('/usr/lib/') || archive.includes('.framework/')) return { kind: 'system', name: base };
  const rlib = base.match(/^lib(.+)-[0-9a-f]{16}\.rlib$/);
  if (rlib) {
    const sysroot = /\/lib\/rustlib\/[^/]+\/lib\//.test(archive);
    return { kind: sysroot ? 'rust-sysroot' : 'cargo', name: rlib[1], member: member?.[2] };
  }
  const build = archive.match(/(?:^|\/)build\/([A-Za-z0-9_-]+?)-[0-9a-f]{16}\/out\//);
  if (base.endsWith('.a') && build) return { kind: 'vendored-c', name: build[1], archive: base, member: member?.[2] };
  if (/\/deps\/[^/]+\.o$/.test(archive) || /\.rcgu\.o$/.test(base)) {
    const crate = base.match(/^([A-Za-z0-9_]+)\./);
    return { kind: 'cargo', name: crate ? crate[1] : base };
  }
  return { kind: 'other', name: base };
}

export function linkSet(text) {
  const { objects, live, dead } = parseMap(text);
  const groups = new Map();
  for (const [index, input] of objects) {
    const info = classify(input);
    const key = `${info.kind}:${info.name}`;
    const group = groups.get(key) ?? { ...info, liveBytes: 0, deadBytes: 0, inputs: 0, members: new Set() };
    group.inputs++;
    group.liveBytes += live.get(index) ?? 0;
    group.deadBytes += dead.get(index) ?? 0;
    if (info.member) group.members.add(info.member);
    groups.set(key, group);
  }
  const list = [...groups.values()].map(({ members, member, ...rest }) => ({ ...rest, members: [...members].sort() }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return {
    objectInputs: objects.size,
    linked: list.filter((item) => item.liveBytes > 0),
    deadStrippedOnly: list.filter((item) => item.liveBytes === 0),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [map, out] = process.argv.slice(2);
  const report = { map: path.basename(map), ...linkSet(fs.readFileSync(map, 'utf8')) };
  const summary = {};
  for (const item of report.linked) summary[item.kind] = (summary[item.kind] ?? 0) + 1;
  report.summary = summary;
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(summary));
}
