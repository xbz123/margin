import { app, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every window shows the app's own page next to the preload API. A renderer
// navigation elsewhere would load foreign content beside that API, and a child
// window would be an unconfigured Electron window. Both are refused for every
// webContents. A link the user follows opens in the default browser when
// isExternalLink accepts it; anything else is dropped.

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
    contents.setWindowOpenHandler(({ url }) => {
      void openExternalLink(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event) => {
      if (isAppPage(event.url)) return;
      event.preventDefault();
      void openExternalLink(event.url);
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}
