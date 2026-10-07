// Development-only test hooks (Margin PLAN.md X4 / AG-09).
//
// The answer regression harness points the existing OpenAI client at a loopback mock
// server and replaces the system screenshot with a fixture image. Both hooks are
// inert unless ALL of these hold:
//   - the app is not packaged (a shipped .app ignores them);
//   - the base URL is plain http on 127.0.0.1, localhost or [::1];
//   - the screenshot fixture path names an existing file.
// The pure resolvers take their inputs explicitly so they can be unit-tested
// without Electron; the wrappers read app.isPackaged lazily.

import fs from 'fs';

const LOOPBACK_URL = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?(\/[^\s]*)?$/i;

export function resolveDevOpenAIBaseUrl(
  env: Record<string, string | undefined>,
  isPackaged: boolean,
): string | undefined {
  const value = env.MARGIN_DEV_OPENAI_BASE_URL?.trim();
  if (isPackaged || !value || !LOOPBACK_URL.test(value)) return undefined;
  return value;
}

export function resolveDevScreenshotFixture(
  env: Record<string, string | undefined>,
  isPackaged: boolean,
  exists: (p: string) => boolean = fs.existsSync,
): string | undefined {
  const value = env.MARGIN_DEV_SCREENSHOT_FIXTURE?.trim();
  if (isPackaged || !value || !exists(value)) return undefined;
  return value;
}

function isPackagedApp(): boolean {
  // Fail closed: outside an Electron main process (no `app`), treat the build as
  // packaged so no override is ever applied.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    if (!electron || typeof electron !== 'object' || !electron.app) return true;
    return electron.app.isPackaged !== false;
  } catch {
    return true;
  }
}

export function devOpenAIBaseUrl(): string | undefined {
  return resolveDevOpenAIBaseUrl(process.env, isPackagedApp());
}

export function devScreenshotFixture(): string | undefined {
  return resolveDevScreenshotFixture(process.env, isPackagedApp());
}
