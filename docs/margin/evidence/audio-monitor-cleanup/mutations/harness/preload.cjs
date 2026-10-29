// Rewrites source text in memory as tests read it; files on disk are never touched.
const fs = require('fs');
const read0 = fs.readFileSync;
const spec = JSON.parse(read0(__dirname + '/spec.json', 'utf8'));
const read = fs.readFileSync;
const applied = new Set();
fs.readFileSync = function (file, ...rest) {
  let out = read.call(this, file, ...rest);
  const name = String(file instanceof URL ? file.pathname : file);
  if (typeof out !== 'string') return out;
  spec.forEach((m, i) => {
    if (!name.endsWith('/' + m.file)) return;
    let at = -1;
    for (let n = 0; n < (m.nth ?? 1); n++) { at = out.indexOf(m.from, at + 1); if (at < 0) throw new Error(`mutation ${i} not found in ${m.file}`); }
    out = out.slice(0, at) + m.to + out.slice(at + m.from.length);
    applied.add(i);
  });
  return out;
};
process.on('exit', () => {
  process.stderr.write(`[mutation] applied ${[...applied].sort().join(',')} of ${spec.length}\n`);
  if (applied.size !== spec.length) { process.stderr.write('[mutation] NOT ALL APPLIED\n'); process.exitCode = 3; }
});
