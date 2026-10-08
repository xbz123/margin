import assert from 'node:assert/strict';

// Production messages carry no probe text. Count only the controlled event
// prefix, separately for each exit, and reject every unexpected critical event.
export function criticalEvents(text) {
  return text.split('\n').filter(line => /^(?:\S+ \[ERROR\] )?\[CRITICAL\]/.test(line)).map(line => {
    if (/\[CRITICAL\] Uncaught Exception /.test(line)) return 'uncaughtException';
    if (/\[CRITICAL\] Unhandled Rejection /.test(line)) return 'unhandledRejection';
    return 'unknownCritical';
  });
}

export function assertCriticalEvents(text, expected) {
  assert.deepEqual(criticalEvents(text).sort(), [...expected].sort(), 'exact critical event count (missing or extra events fail)');
}
