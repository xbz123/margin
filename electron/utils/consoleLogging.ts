export type LogLevel = 'log' | 'info' | 'debug' | 'warn' | 'error';
type LogSink = (level: LogLevel, line: string) => void;
type CriticalEvent = 'uncaughtException' | 'unhandledRejection';
type AppEvent = 'logging-ready' | 'app-ready' | 'app-quitting';
const installed = Symbol.for('margin.safeConsole');

// The payload never selects its event or level. This also protects console
// format strings, Error stacks and custom inspectors without migrating callers.
export function installConsoleLogging(target: Console, sink?: LogSink, summarize?: (args: unknown[]) => string) {
  const previous = (target as unknown as Record<symbol, SafeLogger | undefined>)[installed];
  if (previous) return previous;
  const outputs = {
    log: target.log.bind(target), info: target.info.bind(target), debug: target.debug.bind(target),
    warn: target.warn.bind(target), error: target.error.bind(target),
  };
  let emitting = false;
  const emit = (level: LogLevel, event: string, args: unknown[]) => {
    if (emitting) return;
    emitting = true;
    try {
      let payload = '[log payload unavailable]';
      try {
        const summary = summarize?.(args);
        if (typeof summary === 'string') payload = summary;
      } catch { /* Never fall back to raw args. */ }
      const line = `${event} ${payload}`;
      try { sink?.(level, line); } catch { /* Broken file/IPC sink: no raw fallback. */ }
      try { outputs[level](line); } catch { /* Detached terminal: do not recurse. */ }
    } finally { emitting = false; }
  };
  const methods: Record<string, LogLevel> = {
    log: 'log', info: 'info', debug: 'debug', warn: 'warn', error: 'error', trace: 'error',
    dir: 'log', dirxml: 'log', table: 'log', group: 'log', groupCollapsed: 'log', groupEnd: 'log',
    time: 'log', timeLog: 'log', timeEnd: 'log', count: 'log', countReset: 'log', clear: 'log',
    profile: 'debug', profileEnd: 'debug', timeStamp: 'debug',
  };
  for (const [method, level] of Object.entries(methods)) {
    (target as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => emit(level, `console.${method}`, args);
  }
  target.assert = (condition?: boolean, ...args: unknown[]) => {
    if (!condition) emit('error', 'console.assert', args);
  };
  const logger: SafeLogger = {
    critical(event, value) {
      if (event === 'uncaughtException') emit('error', '[CRITICAL] Uncaught Exception', [value]);
      else if (event === 'unhandledRejection') emit('error', '[CRITICAL] Unhandled Rejection', [value]);
    },
    appEvent(event) {
      if (event === 'logging-ready' || event === 'app-ready' || event === 'app-quitting') emit('info', event, []);
    },
  };
  Object.defineProperty(target, installed, { value: logger });
  return logger;
}

type SafeLogger = { critical(event: CriticalEvent, value: unknown): void; appEvent(event: AppEvent): void };

// Separate Electron bundles have separate module variables, but the console
// object and this well-known symbol are shared within the same JS world.
export function logAppEvent(event: AppEvent, target: Console = console): void {
  (target as unknown as Record<symbol, SafeLogger | undefined>)[installed]?.appEvent(event);
}
