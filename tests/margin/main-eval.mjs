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
// withMainOutputOnFailure: wraps a case body; on failure prints the tail of the main
//   process output of the apps it launched, then the original error.

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

// Runs one case body. `outputs` is the list that collects the `output` buffer of each
// app the case launches (launchApp's return value); it is emptied before and after.
// When the body throws, prints ONE marked block with the last `lines` lines of each
// buffer (only what the main process itself wrote; isolation-debug lines left out,
// as launchApp does) and rethrows the original error. Prints nothing when the body
// passes. The printing is guarded, so it can never replace the original error.
export async function withMainOutputOnFailure(label, outputs, body, lines = 40) {
  outputs.length = 0;
  try { return await body(); } catch (error) {
    try {
      const parts = outputs.map((output, i) => {
        const tail = output.join('').replace(/\s+$/, '').split('\n').filter((l) => !l.includes('isolation-debug')).slice(-lines).join('\n');
        return `--- app ${i + 1} of ${outputs.length}: last ${lines} lines ---\n${tail}`;
      });
      console.error([`[main-output] ===== main-process output of failed case: ${label} =====`,
        ...(parts.length ? parts : ['(no app was launched, or its startup failed and launchApp printed its output)']),
        '[main-output] ===== end of main-process output ====='].join('\n'));
    } catch (e) {
      try { console.error(`[main-output] could not print the main-process output: ${firstLine(e)}`); } catch { /* nothing left to do */ }
    }
    throw error;
  } finally { outputs.length = 0; }
}
