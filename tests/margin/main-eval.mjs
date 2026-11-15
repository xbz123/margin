// Main-process calls for Electron suites that launch their own apps
// (tests/margin/outbound-renderer.test.mjs). The same two entries as the regression
// harness (tests/margin/regression-harness.mjs, mainRead / mainDo), with the app passed
// in instead of taken from the harness state.
//
// Playwright's electronApplication.evaluate now and then fails with "Execution context
// was destroyed, most likely because of a navigation" (a transient inspector protocol
// error; when it happens it is unknown whether the function ran).
//
// mainRead: for a function that two runs in a row leave in the same end state as one
//   (pure reads, or installs that a guard in the function makes repeatable). Retried up
//   to 3 times, 200 ms apart, only on "context was destroyed" and only while the app
//   process is alive; one diagnostic line per failed attempt.
// mainDo: for a function with side effects that must happen exactly once (sends an
//   event, triggers an action). Never retried; one diagnostic line, then the original
//   error.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function appAlive(app) {
  try {
    const child = app.process();
    return child.exitCode === null && child.signalCode === null;
  } catch {
    return false;
  }
}

const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

export async function mainRead(app, fn, arg, label = 'mainRead') {
  for (let attempt = 0; ; attempt++) {
    try { return await app.evaluate(fn, arg); } catch (e) {
      const alive = appAlive(app);
      const retry = attempt < 3 && alive && /context was destroyed/.test(String(e?.message ?? e));
      console.error(`[main-eval] ${label} attempt ${attempt + 1} failed: ${firstLine(e)} alive=${alive}${retry ? `; retry ${attempt + 1}/3` : ''}`);
      if (!retry) throw e;
      await sleep(200);
    }
  }
}

export async function mainDo(app, fn, arg, label = 'mainDo') {
  try { return await app.evaluate(fn, arg); } catch (e) {
    console.error(`[main-eval] ${label} failed (not retried): ${firstLine(e)} alive=${appAlive(app)}`);
    throw e;
  }
}
