import { CredentialsManager } from '../services/CredentialsManager';
import { AliyunStreamingSTT } from '../audio/AliyunStreamingSTT';
import { DoubaoStreamingSTT } from '../audio/DoubaoStreamingSTT';
import type { CredentialSaveResult } from '../../src/types/credentialSave';

type Provider = 'aliyun' | 'doubao';
function providerId(value: unknown): Provider {
  if (value !== 'aliyun' && value !== 'doubao') throw Error('Invalid STT provider');
  return value;
}

function connectionFailure(failure: unknown): string {
  switch ((failure as { code?: string } | undefined)?.code) {
    case 'configuration': return 'Invalid STT configuration.';
    case 'authentication': return 'STT authentication failed. Check credentials and resource access.';
    case 'timeout': return 'STT connection test timed out.';
    case 'empty-audio': return 'STT connection test received empty audio.';
    default: return 'STT connection test failed. Check credentials and network.';
  }
}

export function registerDomesticSttHandlers(
  handle: (channel: string, listener: (event: unknown, ...args: any[]) => any) => void,
  apply: () => Promise<void>,
) {
  handle('get-domestic-stt', (_event, value: unknown) => {
    const config = CredentialsManager.getInstance().getDomesticStt(providerId(value));
    return { hasKey: !!config?.key, workspaceId: config?.workspaceId ?? '', appId: config?.appId ?? '' };
  });
  handle('save-domestic-stt', async (_event, value: unknown, input: { key: string; workspaceId: string; appId: string }): Promise<CredentialSaveResult> => {
    let result: CredentialSaveResult;
    try { result = CredentialsManager.getInstance().setDomesticStt(providerId(value), input); }
    catch { return { ok: false, code: 'write_failed', message: 'Invalid STT configuration; previous credentials kept.' }; }
    if (!result.ok) return result;
    try { await apply(); return result; }
    catch { return { ok: true, warning: 'Saved; restart to apply the STT configuration.' }; }
  });
  handle('test-domestic-stt', async (_event, value: unknown) => {
    try {
      const provider = providerId(value);
      const config = CredentialsManager.getInstance().getDomesticStt(provider);
      if (!config?.key) return { success: false, error: 'Save STT credentials first.' };
      const stream = provider === 'aliyun' ? new AliyunStreamingSTT(config.key, config) : new DoubaoStreamingSTT(config.key, config);
      let success = false;
      let error = '';
      stream.on('completed', () => { success = true; });
      stream.on('error', failure => { error = connectionFailure(failure); });
      try {
        stream.start();
        stream.write(Buffer.alloc(16000));
        await stream.finalize();
        return { success: success && !error, error: success && !error ? undefined : error || 'STT connection test timed out.' };
      } catch (failure) {
        return { success: false, error: error || connectionFailure(failure) };
      } finally { stream.stop(false); }
    } catch { return { success: false, error: 'Invalid STT configuration.' }; }
  });
}
