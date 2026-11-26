import { CredentialsManager } from '../services/CredentialsManager';
import { configureNetworkProxy } from '../services/proxy';
import type { CredentialSaveResult } from '../../src/types/credentialSave';
import type { NetworkProxyPublicConfig } from '../../src/types/networkProxy';

const INVALID: CredentialSaveResult = { ok: false, code: 'write_failed', message: 'Invalid proxy settings; nothing was saved.' };

// Input from the renderer is validated in CredentialsManager.setNetworkProxy; the runtime switches
// only after the encrypted save succeeded, so a failed save leaves connections unchanged.
export function registerNetworkProxyHandlers(
  handle: (channel: string, listener: (event: unknown, ...args: any[]) => any) => void,
) {
  handle('get-network-proxy', (): NetworkProxyPublicConfig => CredentialsManager.getInstance().getNetworkProxy());
  handle('save-network-proxy', (_event, input: unknown): CredentialSaveResult => {
    const manager = CredentialsManager.getInstance();
    let result: CredentialSaveResult;
    try { result = manager.setNetworkProxy(input as never); } catch { return INVALID; }
    if (!result.ok) return result;
    try { configureNetworkProxy(manager.getNetworkProxySettings()); return result; }
    catch { return { ok: true, warning: 'Saved; restart to apply the proxy settings.' }; }
  });
}
