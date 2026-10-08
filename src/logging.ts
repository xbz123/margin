import { installConsoleLogging } from '../electron/utils/consoleLogging';
import { redactForLog } from '../electron/utils/redactForLog';

// Main-world boundary, independent of the isolated preload's console object.
installConsoleLogging(console, undefined, redactForLog);
