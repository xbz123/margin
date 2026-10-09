import { app, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every window shows the app's own page next to the preload API. A renderer
// navigation elsewhere would load foreign content beside that API, and a child
// window would be an unconfigured Electron window. Both are refused for every
// webContents, and neither opens the browser: Electron does not say whether a
// user gesture caused them, so a script could open links without the user. The
// browser opens only through the open-external IPC, which the preload sends for a
// trusted click on a link or for openExternal while the frame has user activation
// (electron/preload.ts), and then only when isExternalLink accepts the URL.

const DEV_ORIGIN = 'http://localhost:5180';

export function isAppPage(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol === 'file:') {
    return path.resolve(fileURLToPath(parsed)) === path.join(app.getAppPath(), 'dist', 'index.html');
  }
  return !app.isPackaged && process.env.NODE_ENV === 'development' && parsed.origin === DEV_ORIGIN;
}

export function isExternalLink(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol === 'https:') return !!parsed.hostname && !parsed.username && !parsed.password;
  return parsed.protocol === 'x-apple.systempreferences:' && process.platform === 'darwin';
}

export async function openExternalLink(url: string): Promise<boolean> {
  if (!isExternalLink(url)) {
    console.warn('[Navigation] Blocked external link');
    return false;
  }
  try {
    await shell.openExternal(url);
    return true;
  } catch {
    console.warn('[Navigation] External link could not be opened');
    return false;
  }
}

export function installNavigationPolicy(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => {
      console.warn('[Navigation] Refused window.open');
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event) => {
      if (isAppPage(event.url)) return;
      event.preventDefault();
      console.warn('[Navigation] Refused navigation away from the app page');
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}
