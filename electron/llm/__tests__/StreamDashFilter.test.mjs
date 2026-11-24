// The streamed-answer dash filter rewrites only em / en dashes in prose. The ASCII hyphen-minus
// is never touched, and em / en dashes inside code stay, however the provider splits the stream.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
const { StreamDashFilter, filterStreamDashes, reduceDashes } = require('../../../dist-electron/electron/llm/postProcessor.js');
// LLMHelper reads electron's app at load; stub it only for that require.
const builtHelper = path.join(REPO, 'dist-electron/electron/LLMHelper.js');
const electronId = require.resolve('electron', { paths: [path.dirname(builtHelper)] });
const previousElectron = require.cache[electronId];
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => os.tmpdir(), isPackaged: true, getVersion: () => '0.0.0' } } };
let LLMHelper;
try { ({ LLMHelper } = require(builtHelper)); } finally { if (previousElectron) require.cache[electronId] = previousElectron; else delete require.cache[electronId]; }

const TWO_SUM_CODE = [
  '```python',
  'def two_sum(nums, target):',
  '    """Pair finder — one pass."""',
  '    seen = {}',
  '    for i, n in enumerate(nums):',
  '        diff = target - n',
  '        if diff in seen:',
  '            return [seen[diff], i - 1 + 1]',
  '        seen[n] = i',
  '```',
].join('\n');
const TWO_SUM = `Use a hash map — one pass is enough.\n\n${TWO_SUM_CODE}\n\nIt runs in O(n) time - each element is seen once.`;
const TWO_SUM_OUT = TWO_SUM.replace('map — one', 'map, one');

/** Feeds `chunks` through one filter and returns the joined output. */
const run = (chunks, filter = new StreamDashFilter()) => chunks.map(chunk => filter.push(chunk)).join('');
/** Splits text into chunks of `size` characters. */
const every = (text, size) => Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, (i + 1) * size));
/** Splits text before each occurrence of `marker` and right after it. */
const around = (text, marker) => text.split(marker).flatMap((part, i, all) => i < all.length - 1 ? [part, marker] : [part]).filter(Boolean);
/** By line, keeping each newline: prose dashes never straddle a chunk boundary. */
const lines = text => text.split(/(?<=\n)/);
const hyphens = text => text.split('-').length - 1;

/**
 * Streams `text` at every fixed chunk size 1..text.length, per line and split at every backtick:
 * every ASCII hyphen survives, `code` snippets survive every split, and the whole text and the
 * per-line split give exactly `expected`.
 */
function assertEverySplit(text, code, expected) {
  const splits = [...Array.from({ length: text.length }, (_, i) => every(text, i + 1)), around(text, '`'), around(text, '~')];
  for (const chunks of splits) {
    const out = run(chunks);
    assert.equal(hyphens(out), hyphens(text), `ASCII hyphen changed (${chunks.length} chunks):\n${out}`);
    for (const snippet of code) assert.ok(out.includes(snippet), `${chunks.length} chunks: ${JSON.stringify(snippet)} changed:\n${out}`);
  }
  assert.equal(run([text]), expected);
  assert.equal(run(lines(text)), expected);
}

test('Two Sum: code fence keeps "target - n", "i - 1" and its em dash at every chunk size; prose " - " stays', () => {
  for (let size = 1; size <= TWO_SUM.length; size++) {
    const out = run(every(TWO_SUM, size));
    assert.ok(out.includes(TWO_SUM_CODE), `size ${size}: code block must be untouched:\n${out}`);
    assert.ok(out.endsWith('It runs in O(n) time - each element is seen once.'), `size ${size}: ${out}`);
  }
  assert.equal(run([TWO_SUM]), TWO_SUM_OUT);
  assert.equal(run(lines(TWO_SUM)), TWO_SUM_OUT);
  assert.equal(run(around(TWO_SUM, '`')), TWO_SUM_OUT);
  // Code lines and fences streamed two characters at a time, prose a line at a time.
  assert.equal(run(lines(TWO_SUM).flatMap(line => line.startsWith('```') || line.startsWith(' ') ? every(line, 2) : [line])), TWO_SUM_OUT);
  assert.equal(reduceDashes(TWO_SUM), TWO_SUM_OUT);
});

test('Two Sum: fence markers split across chunks and dashes right after a boundary', () => {
  const opener = TWO_SUM.replace('```python', '``\u0000`python').split('\u0000');
  const chunks = [opener[0], ...opener[1].split(/(?<=\n)/).flatMap(line => line.includes('target - n') ? ['        diff = target ', '- n\n'] : [line])];
  assert.equal(run(chunks), TWO_SUM_OUT);
  // An em dash chunk right after the fence opener stays; prose after the close converts.
  const out = run(['```', 'js\nlet a = b ', '-', ' c;\nlet d = "e ', '—', ' f";\n', '``', '`\nDone — ok - fine.']);
  assert.equal(out, '```js\nlet a = b - c;\nlet d = "e — f";\n```\nDone, ok - fine.');
});

test('Inline code keeps its em / en dashes; prose em / en dashes around it convert, " - " stays', () => {
  const text = 'Call `i - 1` first — then `a — b` and ``x – `y` — z`` later - done.';
  const expected = 'Call `i - 1` first, then `a — b` and ``x – `y` — z`` later - done.';
  assertEverySplit(text, ['`i - 1`', '`a — b`', '``x – `y` — z``'], expected);
  assert.equal(run(around(text, '`')), expected);
});

test('Prose outside code converts em / en dashes only; the ASCII hyphen passes through unchanged', () => {
  assert.equal(run(['Fast — and simple – mostly. Real-time, 3-5 items, a - b, --flag.']), 'Fast, and simple, mostly. Real-time, 3-5 items, a - b, --flag.');
  assert.equal(run(['- bullet stays\n', 'text - more\n', 'a—b and c – d\n']), '- bullet stays\ntext - more\na, b and c, d\n');
  assert.equal(run(['Before `x`', ' — after']), 'Before `x`, after');
  assert.equal(run(['Before `x`', ' - after']), 'Before `x` - after');
  for (const text of ['text - more', 'Then - done\n', 'x - y - z', ' - leading', 'trailing - ']) {
    assert.equal(run(every(text, 1)), text);
    assert.equal(run([text]), text);
    assert.equal(reduceDashes(text), text);
  }
  assert.equal(reduceDashes('Fast — and simple – mostly - right.'), 'Fast, and simple, mostly - right.');
});

test('Multiple code blocks (``` and ~~~) keep their em dashes, prose between them converts', () => {
  const text = 'First — one:\n```\na = b - c — d\n```\nThen — two:\n~~~sql\nSELECT a - b FROM t -- note — x\n~~~\nAnd:\n````md\n```\nx – y\n```\n````\nEnd - fin — ok.';
  const expected = 'First, one:\n```\na = b - c — d\n```\nThen, two:\n~~~sql\nSELECT a - b FROM t -- note — x\n~~~\nAnd:\n````md\n```\nx – y\n```\n````\nEnd - fin, ok.';
  const blocks = ['```\na = b - c — d\n```', '~~~sql\nSELECT a - b FROM t -- note — x\n~~~', '````md\n```\nx – y\n```\n````'];
  assertEverySplit(text, blocks, expected);
  assert.equal(run(lines(text).flatMap(line => /^[`~]/.test(line) ? every(line, 1) : [line])), expected);
});

test('An unmatched backtick only leaves later prose alone (until a blank line); it never corrupts code', () => {
  assert.equal(run(['It\'s a ` stray — here\n', 'next — line\n\nnew — para']), 'It\'s a ` stray — here\nnext — line\n\nnew, para');
  // A fence after a stray backtick is still code.
  assert.equal(run(['Stray ` tick:\n```\nx = y — z\n```\n']), 'Stray ` tick:\n```\nx = y — z\n```\n');
});

test('Each stream gets its own state: interleaved streams do not share code state', () => {
  const a = new StreamDashFilter(), b = new StreamDashFilter();
  const outA = [], outB = [];
  outA.push(a.push('```py\n')); outB.push(b.push('Plain — prose'));
  outA.push(a.push('x = y — z - w\n')); outB.push(b.push(' and more – prose - kept'));
  outA.push(a.push('```\nok — done'));
  assert.equal(outA.join(''), '```py\nx = y — z - w\n```\nok, done');
  assert.equal(outB.join(''), 'Plain, prose and more, prose - kept');
});

test('A mid-line backtick run is inline code, so a later line-start fence still opens a real block', () => {
  // "```" mid-line is an inline span that never closes; the next line's fence opens the block.
  const first = 'Start a block with ``` then the language:\n```python\nx = a - b  # a — b\n```\nDone — ok\n';
  assertEverySplit(first, ['```python\nx = a - b  # a — b\n```\n'], first.replace('Done — ok', 'Done, ok'));
  // "```x```" mid-line is a closed inline span, then a real fence follows.
  const text = 'Wrap it as ```x``` inline.\n\n```python\ndiff = target - n  # t — n\n```\nThen — done\n';
  assertEverySplit(text, ['```python\ndiff = target - n  # t — n\n```\n'], text.replace('Then — done', 'Then, done'));
  // A bare line-start fence after a mid-line run opens a block; it does not close the run.
  const bare = 'Type ``` to start one.\n```\nx = a — b\n```\nOk — go\n';
  assertEverySplit(bare, ['```\nx = a — b\n```\n'], bare.replace('Ok — go', 'Ok, go'));
});

test('A closing fence must be at most 3 columns deeper than the opener, with only whitespace after it', () => {
  // Indented 4 columns more than the opener: still code (here, a docstring holding a fence).
  const indented = '```python\ndef f():\n    """\n    ```\n    x = a — b\n    ```\n    """\n    return a — b\n```\nAfter — ok\n';
  assertEverySplit(indented, ['    x = a — b\n', '    return a — b\n```\n'], indented.replace('After — ok', 'After, ok'));
  // A fence-looking line with an info string does not close; the bare ``` does, and the next ``` opens.
  const info = 'Example README:\n```markdown\n# Title\n```js\nconst a = "b — c";\n```\n```\nDone — ok\n';
  assertEverySplit(info, ['const a = "b — c";\n', 'Done — ok\n'], info);
  // Text after the fence run cancels the close.
  const trailing = '```\nd = t — n\n``` trailing\ne = f — g\n```\nThen — x\n';
  assertEverySplit(trailing, ['e = f — g\n'], trailing.replace('Then — x', 'Then, x'));
  // Closes that must still count: nested in a list item, trailing whitespace, CRLF.
  const list = '1. Step:\n   ```js\n   let d = "t — n";\n   ```\n2. Next — step\n';
  assertEverySplit(list, ['   let d = "t — n";\n'], list.replace('Next — step', 'Next, step'));
  const spaces = '```\na — b\n  ```  \t\nc — d\n';
  assertEverySplit(spaces, ['a — b\n'], spaces.replace('c — d', 'c, d'));
  const crlf = '```\r\na — b\r\n```\r\nc — d\r\n';
  assertEverySplit(crlf, ['a — b\r\n'], crlf.replace('c — d', 'c, d'));
});

test('~~~ fences follow the same open and close rules', () => {
  const text = 'Intro ~~~ mid-line is text — yes\n~~~\na — b\n    ~~~\nc — d\n~~~ x\ne — f\n```\ng — h\n ~~~~ \ni — j\n';
  assertEverySplit(text, ['a — b\n', 'c — d\n', 'e — f\n', 'g — h\n'], text.replace('text — yes', 'text, yes').replace('i — j', 'i, j'));
});

test('Em / en dashes never swallow a line break, so the next line\'s fence stays on its own line', () => {
  const text = 'Here is the code —\n```python\nx = a - b\n```\nShort – \n- item\n';
  const expected = 'Here is the code, \n```python\nx = a - b\n```\nShort, \n- item\n';
  assertEverySplit(text, ['\n```python\nx = a - b\n```\n'], expected);
  assert.equal(reduceDashes(text), expected);
});

test('The ASCII hyphen is untouched in the hardest Markdown cases, byte for byte under any chunking', () => {
  const cases = [
    '- ```py\n  a = 1\n\n  b = c - d\n  ```\n',
    '1. ```bash\n   npm i\n\n   npm run a - b\n   ```\n',
    'Press the ` key, then:\n- run `a - b`\n',
    'Type \\` then `a - b`\n',
    '$a - b$ and - - -\n',
    '* - ~~~\n    x = a - b\n    ~~~\n',
  ];
  for (const text of cases) {
    const splits = [[text], lines(text), around(text, '`'), around(text, '~'), around(text, '-'), ...Array.from({ length: text.length }, (_, i) => every(text, i + 1))];
    for (const chunks of splits) assert.equal(run(chunks), text, `${JSON.stringify(text)} in ${chunks.length} chunks`);
    assert.equal(reduceDashes(text), text);
  }
});

test('filterStreamDashes yields every chunk, holds nothing back, and closes the source on early return', async () => {
  let closed = false;
  async function* source() { try { yield '```js\n'; yield 'a — b'; yield '\n```'; yield '\nx — y - z'; } finally { closed = true; } }
  const got = [];
  for await (const chunk of filterStreamDashes(source())) got.push(chunk);
  assert.deepEqual(got, ['```js\n', 'a — b', '\n```', '\nx, y - z']);
  closed = false;
  const early = filterStreamDashes(source());
  assert.deepEqual((await early.next()).value, '```js\n');
  assert.deepEqual((await early.next()).value, 'a — b', 'text is yielded as soon as it arrives');
  await early.return();
  assert.ok(closed, 'stopping early closes the provider stream');
});

const packet = (text, finishReason = 'STOP') => ({ text, candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] });

/** A real LLMHelper whose Gemini transport streams `texts` (as ResetConversation.test.mjs does). */
function streamingHelper(texts) {
  const stream = async function* () { for (let i = 0; i < texts.length; i++) yield packet(texts[i], i === texts.length - 1 ? 'STOP' : null); };
  const client = { models: {
    generateContent: async () => { throw Error('unexpected non-streaming send'); },
    generateContentStream: async () => stream(),
  }, caches: { create: async () => ({ name: 'cachedContents/explicit' }) } };
  return Object.assign(Object.create(LLMHelper.prototype), {
    client, selectedTarget: { provider: 'gemini', protocol: 'gemini', model: 'gemini-3.1-flash-lite' },
    currentModelId: 'gemini-3.1-flash-lite', geminiModel: 'gemini-3.1-flash-lite',
    generationPolicy: { interviewFirstTokenSeconds: 10, interviewTotalSeconds: 60, writtenTotalSeconds: 180 },
    customNotes: '', aiResponseLanguage: 'auto', codexCliConfig: { enabled: false },
    rateLimiters: { gemini: { acquire: async () => {} } }, getProviderScopePolicy: () => ({}),
    injectLanguageInstruction: value => value, processResponse: value => value, logScopeFallback: () => {},
    geminiPromptCache: { getOrCreate: async () => null, invalidate() {} },
  });
}

test('LLMHelper.streamChat keeps streamed code intact, converts prose em dashes and leaves prose " - "', async () => {
  // A line per chunk, the fences one backtick per chunk: "        diff = target - n\n" arrives whole, as in the repro.
  const chunks = lines(TWO_SUM).flatMap(line => line.startsWith('```') ? around(line, '`') : [line]);
  assert.equal(chunks.join(''), TWO_SUM);
  const llm = streamingHelper(chunks);
  let out = '';
  for await (const chunk of llm.streamChat('Solve Two Sum')) out += chunk;
  assert.equal(out, TWO_SUM_OUT);
});

test('Two LLMHelper.streamChat calls interleaved do not share filter state', async () => {
  const code = streamingHelper(['``', '`py\n', 'x = y — z - w\n']);
  const prose = streamingHelper(['Fast ', '— and', ' simple — yes - ok']);
  const a = code.streamChat('code'), b = prose.streamChat('prose');
  let outA = '', outB = '';
  for (;;) {
    const [ra, rb] = [await a.next(), await b.next()];
    if (!ra.done) outA += ra.value;
    if (!rb.done) outB += rb.value;
    if (ra.done && rb.done) break;
  }
  assert.equal(outA, '```py\nx = y — z - w\n');
  assert.ok(outB.endsWith(' simple, yes - ok'), outB);
});

test('reduceDashes restores code literally and keeps line breaks during comma cleanup', () => {
  assert.equal(reduceDashes('Use `$&` and `a$$b` here — ok\n```\nx = "$$" - y\n```\n'), 'Use `$&` and `a$$b` here, ok\n```\nx = "$$" - y\n```\n');
  assert.equal(reduceDashes('a —\n— b'), 'a, \nb');
  assert.equal(reduceDashes('a,\n, b'), 'a,\nb');
});
