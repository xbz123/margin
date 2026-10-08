import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
// Diagnostic only: use the existing X2 runner and an independently verified tar root.
// The tar root must contain tar-0.2.0/package and tar-0.3.0/package; this script
// downloads or extracts nothing and writes its report only inside that directory.
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
assert.equal(process.argv.length, 3, 'Usage: node scripts/margin/isolation/run-node.mjs docs/margin/evidence/AG-26/S19-A/checks/compare-widths.mjs <verified-tar-root>');
const out = path.resolve(process.argv[2]);
assert(process.env.MARGIN_ISOLATION_HOME && process.env.HOME === process.env.MARGIN_ISOLATION_HOME);
assert(process.env.NODE_OPTIONS.includes('guard.cjs'));
const require = createRequire(import.meta.url);
const oldEaw = require(path.join(out, 'tar-0.2.0/package/eastasianwidth.js'));
const newEaw = require(path.join(out, 'tar-0.3.0/package/eastasianwidth.js'));
const stringWidthURL = pathToFileURL(path.join(root, 'node_modules/google-gax/node_modules/string-width/index.js')).href;
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'node_modules/google-gax/node_modules/string-width/package.json'))).version, '5.1.2');
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'eastasianwidth' && context.parentURL?.startsWith(stringWidthURL + '?')) {
    const version = new URL(context.parentURL).searchParams.get('eaw');
    assert(['0.2.0', '0.3.0'].includes(version));
    return next(pathToFileURL(path.join(out, 'tar-' + version + '/package/eastasianwidth.js')).href, context);
  }
  return next(specifier, context);
} });
const oldWidth = (await import(stringWidthURL + '?eaw=0.2.0')).default;
const newWidth = (await import(stringWidthURL + '?eaw=0.3.0')).default;
const counts = { codePoints: 0, classifications: 0, characterLengths: 0, lengths: 0, stringWidths: 0, strings: 0 };
const report = { stringWidthVersion: '5.1.2', method: 'Actual installed string-width/index.js loaded twice with only its eastasianwidth import resolved to independently verified tarball JS; every other module resolved unchanged', x2: true, apiKeys: Object.keys(newEaw), counts, samples: [], sliceDifferences: [], sourceAnalysis: {} };
assert.deepEqual(Object.keys(oldEaw), Object.keys(newEaw));
for (let cp = 0; cp <= 0x10ffff; cp++) {
  const character = String.fromCodePoint(cp);
  assert.equal(oldEaw.eastAsianWidth(character), newEaw.eastAsianWidth(character), 'classification U+' + cp.toString(16));
  assert.equal(oldEaw.characterLength(character), newEaw.characterLength(character), 'characterLength U+' + cp.toString(16));
  assert.equal(oldEaw.length(character), newEaw.length(character), 'length U+' + cp.toString(16));
  for (const ambiguousIsNarrow of [true, false]) {
    assert.equal(oldWidth(character, { ambiguousIsNarrow }), newWidth(character, { ambiguousIsNarrow }), 'string-width U+' + cp.toString(16) + ' ' + ambiguousIsNarrow);
    counts.stringWidths++;
  }
  counts.codePoints++; counts.classifications++; counts.characterLengths++; counts.lengths++;
}
const samples = ['', '\0\x1f\x7f\x9f', '\x1b[31m中文abc\x1b[0m', 'a\u0300\u036f\u0370', 'α·Ω', 'Ａｶ한中文', '\ud800', '\udfff', '\ud800A\udfff', '\ud800\udc00', '\udbff\udfff', '𠀀𰀀', '👩‍💻🏳️‍🌈1️⃣🇸🇪', '\ufe00\ufe0f\u200d', 'e\u0301'];
for (const value of samples) {
  const widths = [];
  for (const ambiguousIsNarrow of [true, false]) {
    assert.equal(oldWidth(value, { ambiguousIsNarrow }), newWidth(value, { ambiguousIsNarrow }));
    widths.push(newWidth(value, { ambiguousIsNarrow })); counts.stringWidths++;
  }
  assert.equal(oldEaw.length(value), newEaw.length(value));
  report.samples.push({ value, widths, eawLength: newEaw.length(value) }); counts.strings++;
}
for (const value of [undefined, null, 0, false, {}, []]) assert.equal(oldWidth(value), newWidth(value));
for (const text of ['', 'abc', '中a文', '𠀀a']) {
  for (const start of [undefined, null, 0, 1, -1, 2]) {
    for (const end of [undefined, null, 0, 1, -1, 2]) {
      const oldValue = oldEaw.slice(text, start, end);
      const newValue = newEaw.slice(text, start, end);
      if (oldValue !== newValue) report.sliceDifferences.push({ text, start: start ?? String(start), end: end ?? String(end), oldValue, newValue });
    }
  }
}
const oldJS = fs.readFileSync(path.join(out, 'tar-0.2.0/package/eastasianwidth.js'), 'utf8');
const newJS = fs.readFileSync(path.join(out, 'tar-0.3.0/package/eastasianwidth.js'), 'utf8');
const expected = oldJS.replaceAll(' == ', ' === ').replace('  textLen = eaw.length(text)', '  var textLen = eaw.length(text)').replace('  start = start ? start : 0;', '  start = start === undefined || start === null ? 0 : start;').replace('  end = end ? end : 1;', '  end = end === undefined || start === null ? 1 : end;');
assert.equal(newJS, expected, 'Entire JS diff must equal reviewed strict-comparison and slice changes, including no classification table updates');
report.sourceAnalysis = { entireJSDiffChecked: true, classificationTableUnchanged: true, strictComparisonChanges: (oldJS.match(/ == /g) ?? []).length, sliceChanges: ['textLen becomes local rather than implicit global', 'start falsey fallback becomes explicit undefined/null fallback', 'end falsey fallback becomes end undefined or start null fallback; upstream uses start null, not end null'], sliceUsedByStringWidth: false };
hooks.deregister();
report.widthDifferences = 0;
report.x2Log = process.env.MARGIN_ISOLATION_LOG;
fs.writeFileSync(path.join(out, 'width-comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
