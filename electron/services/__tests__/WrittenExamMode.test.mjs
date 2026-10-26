import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WrittenExamSession } = require('../../../dist-electron/electron/services/WrittenExamMode.js');
const { scenarioPrompt, writtenOutputPrompt, writtenOutputFormat, appendPromptGuidance } = require('../../../dist-electron/electron/llm/scenarioPrompts.js');
const defaults = { enabled: false, intervalSeconds: 20, hideScreenshots: true, codeOutputFormat: 'plain' };
function fixture(io = {}) {
  const frames = [], discarded = [];
  let captures = 0, cancelled = 0, now = 1;
  const session = new WrittenExamSession({ ...defaults, enabled: true }, {
    capture: async () => { captures++; return 'screen'; }, fingerprint: frame => frame,
    deliver: (frame, generation) => frames.push({ frame, generation }), busy: () => false,
    changed() {}, cancel: () => cancelled++, discard: frame => discarded.push(frame), now: () => now, ...io,
  });
  return { session, frames, discarded, get captures() { return captures; }, get cancelled() { return cancelled; }, advance: ms => now += ms };
}

test('S50 reused timer waits a whole interval; duplicate start and stop leave no timers', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = fixture(); f.session.start(); f.session.start();
  t.mock.timers.tick(19999); await Promise.resolve(); assert.equal(f.captures, 0);
  t.mock.timers.tick(1); await Promise.resolve(); assert.equal(f.captures, 1);
  f.session.stop(); f.session.stop(); t.mock.timers.tick(60000); assert.equal(f.captures, 1);
});
test('S50 pause/restart invalidates capture in flight and discards it; new busy work also discards', async () => {
  for (const reason of ['pause', 'busy']) {
    let release, busy = false;
    const f = fixture({ capture: () => new Promise(resolve => release = resolve), busy: () => busy });
    f.session.start(); const pending = f.session.tick(); await f.session.tick();
    if (reason === 'pause') { f.session.stop(); f.session.start(); } else busy = true;
    release('old'); await pending;
    assert.equal(f.frames.length, 0); assert.deepEqual(f.discarded, ['old']); f.session.stop();
  }
});
test('S50 each frame has an independent receipt; stale, duplicate, wrong and unacknowledged receipts do not dispatch', async () => {
  let image = 'one'; const f = fixture({ capture: async () => image });
  f.session.start(); await f.session.tick();
  const first = f.frames[0].generation;
  await f.session.tick(); assert.equal(f.frames.length, 1);
  assert.equal(f.session.accept(first - 1), false); assert.equal(f.session.accept(first), true);
  assert.equal(f.session.accept(first), false);
  image = 'two'; await f.session.tick();
  assert.equal(f.session.accept(first), false);
  f.advance(30000); await f.session.tick();
  assert.equal(f.session.status().running, false); assert.match(f.session.status().error, /did not respond/);
  assert.deepEqual(f.discarded, ['two']);
});
test('S50 busy and exact duplicate images skip, rejected receipts can be recaptured', async () => {
  let busy = true; const f = fixture({ busy: () => busy });
  f.session.start(); await f.session.tick(); assert.equal(f.captures, 0);
  busy = false; await f.session.tick(); f.session.accept(f.frames[0].generation);
  await f.session.tick(); assert.equal(f.frames.length, 1); assert.deepEqual(f.discarded, ['screen']);
  f.session.stop(); f.session.start(); await f.session.tick(); f.session.skip(f.frames.at(-1).generation);
  await f.session.tick(); assert.equal(f.frames.length, 3); f.session.stop();
});
test('S50 capture/delivery failure pauses with no raw error or false permission diagnosis and discards once', async () => {
  for (const failure of ['capture', 'deliver']) {
    const f = fixture({ [failure]: () => { throw Error('PRIVATE raw failure'); } });
    f.session.start(); await f.session.tick();
    assert.equal(f.session.status().running, false);
    assert.match(f.session.status().error, /capture failed/i);
    assert.doesNotMatch(f.session.status().error, /PRIVATE|permission/i);
    assert.equal(f.discarded.length, failure === 'capture' ? 0 : 1);
  }
});
test('S50 failed temporary-file cleanup pauses without an unhandled timer rejection', async () => {
  const f = fixture({ discard: async () => { throw Error('synthetic cleanup failure'); } });
  f.session.start(); await f.session.tick(); f.session.accept(f.frames[0].generation);
  await f.session.tick();
  assert.equal(f.session.status().running, false); assert.match(f.session.status().error, /cleanup failed/);
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 's50-settings-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
function settings(fsImpl = fs) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../../../dist-electron/electron/services/SettingsManager.js', import.meta.url), 'utf8'), {
    module, exports: module.exports, console: { log() {}, error() {} }, process, Object,
    require(id) {
      if (id === 'electron') return { app: { isReady: () => true, getPath: () => root } };
      return id === 'fs' ? fsImpl : require(id);
    },
  });
  return module.exports.SettingsManager.getInstance();
}
const plain = value => JSON.parse(JSON.stringify(value));
test('S50 saved settings validate strictly, preserve other fields, survive restart, and write failure changes nothing', () => {
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ uiLanguage: 'zh-CN' }));
  const manager = settings(); assert.deepEqual(plain(manager.getWrittenExamSettings()), defaults);
  for (const bad of [null, [], 2, {}, { ...defaults, extra: true }, ...[4, 301, 20.5, '20', NaN].map(intervalSeconds => ({ ...defaults, intervalSeconds }))]) {
    assert.throws(() => manager.saveWrittenExamSettings(bad), /Invalid/);
  }
  for (const intervalSeconds of [5, 20, 300]) manager.saveWrittenExamSettings({ ...defaults, enabled: true, hideScreenshots: false, codeOutputFormat: 'markdown', intervalSeconds });
  const saved = plain(manager.getWrittenExamSettings());
  const restarted = settings(); assert.deepEqual(plain(restarted.getWrittenExamSettings()), saved); assert.equal(restarted.getUiLanguage(), 'zh-CN');
  const before = fs.readFileSync(path.join(root, 'settings.json'), 'utf8');
  const failing = settings({ ...fs, renameSync() { throw Object.assign(Error('synthetic full disk'), { code: 'ENOSPC' }); } });
  assert.throws(() => failing.saveWrittenExamSettings(defaults), /could not be saved/);
  assert.deepEqual(plain(failing.getWrittenExamSettings()), saved); assert.equal(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(root), ['settings.json']);
  const f = fixture(); f.session.start(); f.session.configure(saved); assert.equal(f.session.status().running, false);
  assert.equal(new WrittenExamSession(saved, {}).status().running, false);
});
test('S50 format and opt-in complete-code keep S46 rules and do not enable themselves', () => {
  for (const format of ['plain', 'markdown']) {
    const prompt = writtenOutputPrompt(scenarioPrompt('written'), format);
    assert.match(prompt, /ACM-style/); assert.match(prompt, /LeetCode-style/); assert.match(prompt, /selected in the screenshot/);
    assert.match(prompt, /multiple-choice/); assert.match(prompt, /do not invent/i);
    if (format === 'plain') assert.doesNotMatch(prompt, /give the complete[^\n]*fenced code block/);
  }
  assert.equal(writtenOutputFormat('使用 Markdown', 'plain'), 'markdown');
  assert.equal(writtenOutputFormat('不要代码块，请用纯文本', 'markdown'), 'plain');
  const cfg = { skills: [], scenes: { written: { skillId: null, additional: '' } } };
  assert.equal(appendPromptGuidance('base', 'written', cfg), 'base');
  cfg.scenes.written.skillId = 'complete-code';
  assert.match(appendPromptGuidance('base', 'written', cfg), /selected editor language/);
  cfg.scenes.written.skillId = null;
  assert.equal(appendPromptGuidance('base', 'written', cfg), 'base');
});
