import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load RateLimiter for testing
async function loadRateLimiter() {
  const limiterPath = path.resolve(__dirname, '../../../dist-electron/electron/services/RateLimiter.js');
  return import(pathToFileURL(limiterPath).href);
}

describe('RateLimiter', () => {
  let RateLimiter, createProviderRateLimiters;

  beforeEach(async () => {
    const module = await loadRateLimiter();
    RateLimiter = module.RateLimiter;
    createProviderRateLimiters = module.createProviderRateLimiters;
  });

  test('createProviderRateLimiters creates rate limiters for all providers', async () => {
    const limiters = createProviderRateLimiters();

    assert.ok(limiters.groq instanceof RateLimiter, 'groq rate limiter created');
    assert.ok(limiters.gemini instanceof RateLimiter, 'gemini rate limiter created');
    assert.ok(limiters.openai instanceof RateLimiter, 'openai rate limiter created');
    assert.ok(limiters.claude instanceof RateLimiter, 'claude rate limiter created');
  });

  test('acquire() allows requests when tokens available', async () => {
    const limiter = new RateLimiter(10, 1.0); // 10 tokens, refill 1/s

    // Should not throw
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    // Successfully acquired 3 tokens
  });

  test('acquire() throws when queue is full', async () => {
    const limiter = new RateLimiter(0, 0.0); // 0 tokens, no refill

    // Fill the queue to MAX_QUEUE_DEPTH (20)
    const waiters = [];
    for (let i = 0; i < 20; i++) {
      waiters.push(limiter.acquire().catch(() => {}));
    }

    // Give time for all waiters to be queued
    await new Promise(resolve => setTimeout(resolve, 10));

    // 21st request should throw (MAX_QUEUE_DEPTH = 20)
    try {
      await limiter.acquire();
      assert.fail('Should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('queue full'), 'Should indicate queue full');
    }
  });
});