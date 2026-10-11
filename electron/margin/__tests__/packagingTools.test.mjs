import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { linkSet, classify } from '../../../scripts/margin/native-link-set.mjs';
import { readBuildInfo, verifyDirectory } from '../../../scripts/margin/download-ci-artifact.mjs';
import { createRequire } from 'node:module';

const { FORBIDDEN } = createRequire(import.meta.url)('../../../scripts/margin/package-check.cjs');

// AG-25 / S19-C helpers. The real map, artifacts and package exist only on CI; these
// cases pin the parsing those checks rely on.
const MAP = `# Path: /w/target/aarch64-apple-darwin/release/deps/libnatively_audio.dylib
# Arch: arm64
# Object files:
[  0] linker synthesized
[  1] /w/target/aarch64-apple-darwin/release/deps/natively_audio.natively_audio.abc-cgu.0.rcgu.o
[  2] /w/target/aarch64-apple-darwin/release/deps/librealfft-0123456789abcdef.rlib(realfft-0123456789abcdef.realfft.x-cgu.0.rcgu.o)
[  3] /w/target/aarch64-apple-darwin/release/build/webrtc-vad-fedcba9876543210/out/libfvad.a(vad_core.o)
[  4] /home/.rustup/toolchains/stable-aarch64-apple-darwin/lib/rustlib/aarch64-apple-darwin/lib/libstd-1111111111111111.rlib(std-1111111111111111.std.y-cgu.0.rcgu.o)
[  5] /w/target/aarch64-apple-darwin/release/deps/liboboe-2222222222222222.rlib(oboe.o)
[  6] /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk/usr/lib/libSystem.tbd
# Sections:
# Address\tSize    \tSegment\tSection
0x00001000\t0x00000100\t__TEXT\t__text
# Symbols:
# Address\tSize    \tFile  Name
0x00001000\t0x00000010\t[  1] _napi_register_module_v1
0x00001010\t0x00000020\t[  2] __ZN7realfft3fft
0x00001030\t0x00000008\t[  3] _WebRtcVad_CalcVad8khz
0x00001040\t0x00000004\t[  4] __ZN3std2io
# Dead Stripped Symbols:
#        \tSize    \tFile  Name
<<dead>> \t0x00000040\t[  5] __ZN4oboe5Stream
<<dead>> \t0x00000004\t[  3] _WebRtcVad_unused
`;

test('the linker map separates linked crates, sysroot, vendored C and dead-stripped inputs', () => {
  const report = linkSet(MAP);
  const linked = Object.fromEntries(report.linked.map((item) => [`${item.kind}:${item.name}`, item.liveBytes]));
  assert.deepEqual(linked, { 'cargo:natively_audio': 16, 'cargo:realfft': 32, 'rust-sysroot:std': 4, 'vendored-c:webrtc-vad': 8 });
  assert.deepEqual(report.deadStrippedOnly.map((item) => `${item.kind}:${item.name}`).sort(), ['cargo:oboe', 'linker:linker synthesized', 'system:libSystem.tbd']);
  assert.equal(report.linked.find((item) => item.name === 'webrtc-vad').members[0], 'vad_core.o');
  assert.equal(classify('/usr/lib/libc++.1.dylib').kind, 'system');
});

test('artifact files are used only when every BUILD-INFO sha256 matches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-artifact-'));
  const bytes = Buffer.from('synthetic native module');
  fs.writeFileSync(path.join(dir, 'index.darwin-arm64.node'), bytes);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(dir, 'BUILD-INFO.txt'), `commit: abc\nrun: 1 (attempt 1)\nfile native-artifact/x: Mach-O\n${digest}  native-artifact/index.darwin-arm64.node\n`);
  assert.deepEqual(readBuildInfo(fs.readFileSync(path.join(dir, 'BUILD-INFO.txt'), 'utf8')).files, [{ sha256: digest, file: 'index.darwin-arm64.node' }]);
  assert.equal(verifyDirectory(dir, { commit: 'abc' }).fields.run, '1 (attempt 1)');
  assert.throws(() => verifyDirectory(dir, { commit: 'other' }), /commit/);
  fs.writeFileSync(path.join(dir, 'index.darwin-arm64.node'), 'tampered');
  assert.throws(() => verifyDirectory(dir), /sha256 mismatch/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('forbidden content matches shipped model locations and removed packages, not SDK resource names', () => {
  const forbidden = (entry) => FORBIDDEN.some((re) => re.test(entry));
  for (const entry of ['Resources/models/silero_vad.onnx', 'Resources/app.asar/resources/models/x.bin',
    'Resources/app.asar.unpacked/node_modules/@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node',
    'Resources/app.asar/node_modules/pdf-parse/index.js', 'Resources/app.asar/node_modules/mammoth/lib/index.js',
    'Resources/app.asar/node_modules/sharp/lib/index.js',
    'Resources/app.asar.unpacked/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.17.3.dylib']) {
    assert.equal(forbidden(entry), true, entry);
  }
  for (const entry of ['Resources/app.asar/node_modules/@anthropic-ai/sdk/resources/models.js',
    'Resources/app.asar/dist-electron/electron/ModelSelectorWindowHelper.js']) {
    assert.equal(forbidden(entry), false, entry);
  }
});
