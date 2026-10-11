import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const requireFromRepo = createRequire(new URL('../../package.json', import.meta.url));
const ts = requireFromRepo('typescript');

function fixture() {
  const source = fs.readFileSync(new URL('../TranscriptDisplayThrottle.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const timers = [];
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    setTimeout: (callback, delay) => {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: t => { t.cancelled = true; },
  });
  const emitted = [];
  const throttle = new exports.TranscriptDisplayThrottle(payload => emitted.push(payload));
  const advance = () => {
    for (const timer of timers.splice(0)) {
      if (!timer.cancelled) timer.callback();
    }
  };
  return { throttle, emitted, advance, timers };
}

test('partials coalesce independently per speaker and preserve the latest payload', () => {
  const f = fixture();
  f.throttle.send({ speaker: 'interviewer', text: 'hello', timestamp: 1, final: false });
  f.throttle.send({ speaker: 'interviewer', text: 'hello world', timestamp: 2, final: false });
  f.throttle.send({ speaker: 'user', text: 'hi', timestamp: 3, final: false });
  assert.equal(f.emitted.length, 0);
  assert.equal(f.timers.length, 2);
  f.advance();
  assert.deepEqual(f.emitted, [
    { speaker: 'interviewer', text: 'hello world', timestamp: 2, final: false },
    { speaker: 'user', text: 'hi', timestamp: 3, final: false },
  ]);
});

test('final emits synchronously and cancels an unsent partial', () => {
  const f = fixture();
  f.throttle.send({ speaker: 'interviewer', text: 'hello', timestamp: 1, final: false });
  f.throttle.send({ speaker: 'interviewer', text: 'hello.', timestamp: 2, final: true });
  assert.deepEqual(f.emitted, [
    { speaker: 'interviewer', text: 'hello.', timestamp: 2, final: true },
  ]);
  assert.equal(f.timers[0].cancelled, true);
  f.advance();
  assert.equal(f.emitted.length, 1);
});

test('clear cancels pending timers and permits a clean next session', () => {
  const f = fixture();
  f.throttle.send({ speaker: 'interviewer', text: 'pending', timestamp: 1, final: false });
  f.throttle.clear();
  assert.equal(f.timers[0].cancelled, true);
  f.advance();
  assert.equal(f.emitted.length, 0);
  f.throttle.send({ speaker: 'interviewer', text: 'fresh', timestamp: 2, final: false });
  f.advance();
  assert.deepEqual(f.emitted, [
    { speaker: 'interviewer', text: 'fresh', timestamp: 2, final: false },
  ]);
});
