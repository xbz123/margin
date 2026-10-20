import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Preserve the general bridge invariant formerly bundled with the retired library tests.
test('every preload ipcRenderer.invoke channel has a matching ipcMain.handle registration', () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
  const channels = new Set([...preload.matchAll(/ipcRenderer\.invoke\(\s*['"]([a-z0-9:_\-./]+)['"]/gi)].map(match => match[1]));
  assert.ok(channels.size > 50, `expected many invoke channels, found ${channels.size}`);
  const registered = new Set();
  const handleRe = /(?:ipcMain\.handle|safeHandle|registerGenerationHandler|registerStealthHandler|registerHandler|handle)\(\s*['"]([a-z0-9:_\-./]+)['"]/gi;
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '__tests__', 'dist', 'dist-electron'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
        for (const match of fs.readFileSync(full, 'utf8').matchAll(handleRe)) registered.add(match[1]);
      }
    }
  };
  walk(path.join(root, 'electron'));
  assert.deepEqual([...channels].filter(channel => !registered.has(channel)).sort(), []);
});
