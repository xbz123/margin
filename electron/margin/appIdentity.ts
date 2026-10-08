import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

declare const __MARGIN_APP_IDENTITY__: { variant: string; name: string; appId: string };
export const APP_IDENTITY = __MARGIN_APP_IDENTITY__;

export function initializeAppIdentity(): void {
  if (APP_IDENTITY.variant === 'release' && (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true')) {
    throw new Error('The release identity may only run in GitHub Actions (S15)');
  }
  app.setName(APP_IDENTITY.name);
  const userData = path.join(app.getPath('appData'), APP_IDENTITY.name);
  fs.mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  app.setPath('sessionData', userData);
  app.setAppLogsPath(userData);
  app.setAppUserModelId(APP_IDENTITY.appId);
}
