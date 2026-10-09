import React, { useEffect, useState } from 'react';
import type { CredentialLoadStatus } from '../../types/credentialSave';

// Shown while stored credentials could not be loaded at startup, which blocks every
// credential save (AG-22). A decrypt failure can be resolved by setting the file
// aside: it is kept as a backup in the app data folder, not deleted.
export const CredentialLoadBanner: React.FC = () => {
    const [status, setStatus] = useState<CredentialLoadStatus>({ ok: true });
    const [result, setResult] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        window.electronAPI?.getCredentialLoadStatus?.().then(setStatus).catch(() => {});
    }, []);

    const discard = async () => {
        if (!confirm('Set the unreadable credentials aside? They are kept as a backup file in the app data folder, and you will need to enter your API keys again. If you denied Keychain access, quit and reopen the app and allow it instead.')) return;
        setBusy(true);
        try {
            const outcome = await window.electronAPI.discardUnreadableCredentials();
            if (outcome.ok) {
                setStatus({ ok: true });
                setResult(`The unreadable credentials were backed up as ${outcome.backupName}. You can now enter your API keys again.`);
            } else {
                setResult(outcome.message);
            }
        } catch {
            setResult('The unreadable credentials could not be set aside, so they were kept.');
        } finally {
            setBusy(false);
        }
    };

    if (status.ok) return result ? <p role="status" className="mb-4 text-xs text-text-secondary">{result}</p> : null;
    return (
        <div role="alert" data-testid="credential-load-banner" className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-500 space-y-2">
            <p>{status.message}</p>
            {status.canDiscard && (
                <button type="button" onClick={discard} disabled={busy} className="rounded-md border border-amber-500/50 px-2 py-1 font-medium hover:bg-amber-500/20 disabled:opacity-50">
                    Back up and discard unreadable credentials
                </button>
            )}
            {result && <p>{result}</p>}
        </div>
    );
};
