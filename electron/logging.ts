import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { installConsoleLogging } from './utils/consoleLogging';
const installed = Symbol.for('margin.mainLogging');

export function installMainLogging(): () => void {
  const processState = process as unknown as Record<symbol, (() => void) | undefined>;
  if (processState[installed]) return processState[installed]!;
  let fileEnabled = false;
  const logger = installConsoleLogging(console, (level, line) => {
    if (!fileEnabled) return;
    const filename = path.join(app.getPath('logs'), 'debug.log');
    if (fs.existsSync(filename) && fs.statSync(filename).size >= 10 * 1024 * 1024) {
      const previous = filename + '.1';
      if (fs.existsSync(previous)) fs.unlinkSync(previous);
      fs.renameSync(filename, previous);
    }
    fs.appendFileSync(filename, `${new Date().toISOString()} [${level.toUpperCase()}] ${line}\n`, { mode: 0o600 });
  }, args => require('./utils/redactForLog').redactForLog(args));
  process.stdout?.on?.('error', () => {});
  process.stderr?.on?.('error', () => {});
  process.on('uncaughtException', error => logger.critical('uncaughtException', error));
  process.on('unhandledRejection', reason => logger.critical('unhandledRejection', reason));
  // Identity initialization must succeed before any file output is enabled.
  const enableFileLogging = () => {
    if (fileEnabled) return;
    fileEnabled = true;
    logger.appEvent('logging-ready');
  };
  Object.defineProperty(process, installed, { value: enableFileLogging });
  return enableFileLogging;
}
