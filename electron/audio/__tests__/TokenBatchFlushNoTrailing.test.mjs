import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

function extractAround(needle, before = 200, after = 1500) {
  const idx = mainSource.indexOf(needle);
  assert.ok(idx >= 0, `could not locate ${needle}`);
  return mainSource.slice(Math.max(0, idx - before), idx + after);
}

test('intelligence token batch flush cancels its pending setImmediate so trailing tokens cannot land after a final answer', () => {
  const region = extractAround('const tokenBatches = new Map<string, { kind: BatchKind; items: any[]; metadata: any }>()', 100, 1_800);

  assert.ok(
    /let\s+pendingFlushHandle:\s*NodeJS\.Immediate\s*\|\s*null\s*=\s*null/.test(region),
    'BUG: token batcher must track its pending setImmediate handle so it can cancel it.',
  );
  assert.ok(
    /clearImmediate\s*\(\s*pendingFlushHandle\s*\)/.test(region),
    'BUG: flushBatchesNow must clearImmediate the pending handle to prevent trailing batches after the final answer send.',
  );
  assert.ok(
    /pendingFlushHandle\s*=\s*null;[\s\S]{0,200}batchFlushScheduled\s*=\s*false/.test(region),
    'BUG: flushBatchesNow must reset pendingFlushHandle and batchFlushScheduled synchronously so a follow-up queueBatch can schedule a fresh flush.',
  );
  assert.ok(
    /pendingFlushHandle\s*=\s*setImmediate\s*\(/.test(region),
    'BUG: scheduleBatchFlush must capture the setImmediate handle when it queues a flush.',
  );
});
