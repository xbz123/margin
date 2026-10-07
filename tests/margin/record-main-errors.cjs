// Main-process exception recorder for the Margin app harness (PLAN.md AG-17 review).
//
// launch-app.mjs loads it with `-r` before the app code, so it sees uncaught
// exceptions and unhandled rejections even when the app's own handlers or its debug
// log fail. It writes JSON lines to MARGIN_MAIN_ERRORS_LOG: one "loaded" record when
// it starts, then one record per event. The app (electron/main.ts) installs its own
// uncaughtException and unhandledRejection handlers, so listening here does not
// change how the app reacts to either.

'use strict';

const fs = require('node:fs');

const LOG = process.env.MARGIN_MAIN_ERRORS_LOG;
if (LOG) {
  const write = (kind, detail) => {
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), pid: process.pid, kind, detail }) + '\n');
  };
  const describe = (e) => (e && e.stack) || String(e);
  write('loaded', process.argv.slice(1).join(' '));
  // The monitor event observes without counting as a handler.
  process.on('uncaughtExceptionMonitor', (err, origin) => write(origin, describe(err)));
  process.on('unhandledRejection', (reason) => write('unhandledRejection', describe(reason)));
}
