// Regression test for: LLM chat-stream AbortController plumbing.
//
// Bug: When stream A was superseded by stream B, the IPC handler's for-await
// loop bailed out via the `_chatStreamId !== myStreamId` check — but
// LLMHelper.streamChat's generator kept yielding tokens that were silently
// discarded. The producer (provider HTTP call) kept running until its own
// per-call timeout (~60s for Gemini Pro), wasting quota and delaying the
// first token of the superseding question.
//
// Contract:
//   1. The logical task cancels streamChat and its provider transport. Actual
//      cancellation / model switch / consumer return are exercised by
//      llm/__tests__/generationInterfaces.test.mjs; AG09 tests real IPC late drops.
//   2. ipcHandlers' gemini-chat-stream creates a fresh AbortController per
//      invocation, aborts the prior one on supersession, and passes the new
//      signal to the streamChat/task boundary.
//   3. A new `ipcMain.on('gemini-chat-stream-stop', ...)` handler aborts the
//      active controller so the renderer can cancel explicitly.
//   4. preload.ts exposes `cancelChatStream` mapped to
//      `ipcRenderer.send('gemini-chat-stream-stop')`; the binding is typed
//      in src/types/electron.d.ts.
//
// These static checks retain sender ownership and preload binding invariants.
// Retired generator spelling checks are mapped to the real task/GUI tests above.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const ipcHandlersPath = path.join(repoRoot, 'electron/ipcHandlers.ts');
const preloadPath = path.join(repoRoot, 'electron/preload.ts');
const electronDtsPath = path.join(repoRoot, 'src/types/electron.d.ts');

const ipcHandlersSrc = readFileSync(ipcHandlersPath, 'utf8');
const preloadSrc = readFileSync(preloadPath, 'utf8');
const electronDtsSrc = readFileSync(electronDtsPath, 'utf8');

// Brace-balancing body extractor (mirrors the helper in
// MicRecoveryUsesCanonicalWiring.test.mjs). Extracts the body of the first
// method matching `signatureRe` so assertions only apply to that scope and
// don't get false-positive matches from unrelated callsites elsewhere in
// the (47k-line) file.
function extractBalancedBody(src, signatureRe, label) {
    const m = signatureRe.exec(src);
    assert.ok(m, `could not locate ${label} signature`);
    // Find the first '{' at or after the match end (handles multi-line sigs).
    let i = src.indexOf('{', m.index + m[0].length);
    assert.ok(i >= 0, `could not find opening brace for ${label}`);
    i++;
    const start = i;
    let depth = 1;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, `unbalanced braces while extracting ${label}`);
    return src.slice(start, i - 1);
}

// ---------------------------------------------------------------------------
// ipcHandlers — gemini-chat-stream creates a per-sender AbortController,
// aborts only that sender's prior stream on supersession, and passes the signal to streamChat.
// Also: gemini-chat-stream-stop is scoped to the sender that requested cancellation.
// ---------------------------------------------------------------------------

test('ipcHandlers tracks active gemini chat streams by sender id', () => {
    assert.ok(
        /const\s+_chatStreamsBySender\s*=\s*new\s+Map\s*</.test(ipcHandlersSrc),
        'BUG: ipcHandlers must track chat streams by event.sender.id so launcher and overlay streams cannot cancel each other.',
    );
    assert.ok(
        !/let\s+_chatStreamController\s*:\s*AbortController\s*\|\s*null\s*=\s*null/.test(ipcHandlersSrc),
        'BUG: a single module-scoped _chatStreamController reintroduces cross-renderer cancellation.',
    );
});

test('gemini-chat-stream handler supersedes only the current sender and passes signal to streamChat', () => {
    const handlerStart = ipcHandlersSrc.indexOf("'gemini-chat-stream'");
    assert.ok(handlerStart >= 0, "could not locate 'gemini-chat-stream' safeHandle registration");
    const handlerRegion = ipcHandlersSrc.slice(handlerStart, handlerStart + 12_000);

    assert.ok(
        /const\s+senderId\s*=\s*event\.sender\.id/.test(handlerRegion),
        'BUG: gemini-chat-stream handler must key stream ownership by event.sender.id.',
    );
    assert.ok(
        /const\s+priorStream\s*=\s*_chatStreamsBySender\.get\s*\(\s*senderId\s*\)/.test(handlerRegion),
        'BUG: gemini-chat-stream handler must look up only the current sender prior stream.',
    );
    assert.ok(
        /priorStream\.controller\.abort\s*\(\s*\)/.test(handlerRegion),
        'BUG: same-sender supersession must abort that sender\'s prior controller.',
    );
    assert.ok(
        /_chatStreamsBySender\.set\s*\(\s*senderId\s*,\s*\{\s*streamId\s*:\s*myStreamId\s*,\s*controller\s*:\s*myController\s*\}\s*\)/.test(handlerRegion),
        'BUG: gemini-chat-stream handler must store the fresh controller under senderId.',
    );
    assert.ok(
        /_chatStreamsBySender\.get\s*\(\s*senderId\s*\)\?\.streamId\s*!==\s*myStreamId/.test(handlerRegion),
        'BUG: supersession checks must compare against the current sender stream id, not a global active stream id.',
    );
    assert.ok(
        /llmHelper\.streamChat\s*\([\s\S]*?myController!?\.signal\s*,?\s*\)/.test(handlerRegion),
        'BUG: gemini-chat-stream handler must pass myController.signal to llmHelper.streamChat.',
    );
});

test('gemini-chat-stream-stop handler aborts only the requesting sender stream', () => {
    const stopRegPattern = /safeOn\s*\(\s*['"]gemini-chat-stream-stop['"]\s*,/;
    assert.ok(
        stopRegPattern.test(ipcHandlersSrc),
        "BUG: ipcMain.on('gemini-chat-stream-stop', ...) must be registered so the renderer's cancelChatStream can reach the main process.",
    );

    const stopHandlerBody = extractBalancedBody(
        ipcHandlersSrc,
        stopRegPattern,
        "gemini-chat-stream-stop handler",
    );
    assert.ok(
        /_chatStreamsBySender\.get\s*\(\s*senderId\s*\)/.test(stopHandlerBody),
        'BUG: gemini-chat-stream-stop must look up the stream for the captured senderId only.',
    );
    assert.ok(
        /stream\.controller\.abort\s*\(\s*\)/.test(stopHandlerBody),
        'BUG: gemini-chat-stream-stop handler must abort the sender-owned controller.',
    );
    assert.ok(
        /const\s+senderId\s*=\s*event\.sender\.id/.test(stopHandlerBody),
        'BUG: gemini-chat-stream-stop must capture event.sender.id before cancelling.',
    );
    assert.ok(
        /_chatStreamsBySender\.delete\s*\(\s*senderId\s*\)/.test(stopHandlerBody),
        'BUG: gemini-chat-stream-stop handler must remove only the sender-owned stream entry.',
    );
    assert.ok(
        !/_chatStreamsBySender\.clear\s*\(/.test(stopHandlerBody),
        'BUG: gemini-chat-stream-stop must not clear streams owned by other renderers.',
    );
});

// ---------------------------------------------------------------------------
// preload.ts — cancelChatStream binding.
// ---------------------------------------------------------------------------

test('preload exposes cancelChatStream mapped to ipcRenderer.send("gemini-chat-stream-stop")', () => {
    // The binding must use .send (not .invoke) because the main-side handler
    // is registered with ipcMain.on, not ipcMain.handle / safeHandle.
    const cancelBindingPattern =
        /cancelChatStream\s*:\s*\(\s*\)\s*=>\s*\{[\s\S]*?ipcRenderer\.send\s*\(\s*['"]gemini-chat-stream-stop['"]\s*\)/;
    assert.ok(
        cancelBindingPattern.test(preloadSrc),
        "BUG: preload.ts must expose cancelChatStream as () => ipcRenderer.send('gemini-chat-stream-stop'). " +
        'Using ipcRenderer.invoke would deadlock the renderer (no main-side handle), and any other ' +
        'channel name would silently miss the gemini-chat-stream-stop handler.',
    );
});

test('preload ElectronAPI interface and src/types/electron.d.ts both type cancelChatStream', () => {
    // Type-level binding in the preload module's interface.
    assert.ok(
        /cancelChatStream\s*:\s*\(\s*\)\s*=>\s*void/.test(preloadSrc),
        'preload.ts ElectronAPI interface must declare `cancelChatStream: () => void`',
    );
    // And the renderer-facing type declaration. Without this, renderer
    // callers (e.g., chat-overlay unmount) get a type error and the
    // cancellation path is removed by the build, regressing the bug.
    assert.ok(
        /cancelChatStream\s*:\s*\(\s*\)\s*=>\s*void/.test(electronDtsSrc),
        'src/types/electron.d.ts must declare `cancelChatStream: () => void` so renderer code can call it type-safely',
    );
});
