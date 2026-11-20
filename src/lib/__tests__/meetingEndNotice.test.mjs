// The end-of-meeting "transcript tail incomplete" notice: main sends it on audio-capture-failed
// after the overlay is hidden; the launcher maps it to its notice, the overlay ignores it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { REPO } from '../../../scripts/margin/isolation/env.mjs';

const require = createRequire(import.meta.url);
function sourceModule(file) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(`${REPO}/${file}`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, require });
  return module.exports;
}

const { meetingEndNotice, isMeetingEndNotice, TRANSCRIPT_TAIL_INCOMPLETE } = sourceModule('src/lib/meetingEndNotice.ts');
const { chinese } = sourceModule('src/i18n.zh.ts');

// The payload electron/main.ts endMeeting sends.
const tail = { channel: 'audio', kind: 'transcript-tail-incomplete', message: TRANSCRIPT_TAIL_INCOMPLETE, terminal: true, failedChannels: ['user'], timedOut: false };

test('the transcript-tail payload maps to the launcher notice, with a Chinese translation', () => {
  assert.equal(meetingEndNotice(tail), 'The last part of the transcript was not completed.');
  assert.equal(meetingEndNotice({ ...tail, failedChannels: [], timedOut: true }), TRANSCRIPT_TAIL_INCOMPLETE);
  assert.equal(chinese[TRANSCRIPT_TAIL_INCOMPLETE], '最后一段转写未完成。');
});

test('in-meeting capture failures are not launcher notices', () => {
  for (const payload of [
    { channel: 'mic', message: 'Microphone stopped', terminal: true, stuck: true },
    { channel: 'system', message: 'System audio failed', attempt: 3, maxAttempts: 3, terminal: true },
    { channel: 'audio', message: 'other', terminal: true },
    null, undefined, {},
  ]) {
    assert.equal(meetingEndNotice(payload), null);
    assert.equal(isMeetingEndNotice(payload), false);
  }
  assert.equal(isMeetingEndNotice(tail), true);
});

test('main sends the same English text and kind the renderer maps', () => {
  const main = fs.readFileSync(`${REPO}/electron/main.ts`, 'utf8');
  assert.ok(main.includes(`'${TRANSCRIPT_TAIL_INCOMPLETE}'`));
  assert.match(main, /kind: 'transcript-tail-incomplete'/);
});

test('the overlay drops the end-of-meeting notice; the launcher shows it', () => {
  const overlay = fs.readFileSync(`${REPO}/src/components/NativelyInterface.tsx`, 'utf8');
  const handler = overlay.slice(overlay.indexOf('onAudioCaptureFailed?.('));
  assert.ok(handler.indexOf('if (isMeetingEndNotice(payload)) return;') < handler.indexOf('setSystemAudioWarning('));
  const launcher = fs.readFileSync(`${REPO}/src/components/Launcher.tsx`, 'utf8');
  assert.match(launcher, /<MeetingEndNotice \/>/);
  const notice = fs.readFileSync(`${REPO}/src/components/MeetingEndNotice.tsx`, 'utf8');
  assert.match(notice, /onAudioCaptureFailed/);
  assert.match(notice, /if \(isActive\) setNotice\(null\)/, 'a new meeting clears it');
});
