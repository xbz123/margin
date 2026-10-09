export type CredentialSaveResult =
    | { ok: true; warning?: string }
    | { ok: false; code: 'encryption_unavailable' | 'write_failed' | 'decrypt_failed'; message: string };

export type ServiceAccountSelectionResult =
    | { cancelled: true }
    | Extract<CredentialSaveResult, { ok: false }>
    | (Extract<CredentialSaveResult, { ok: true }> & { path: string });

export type CredentialLoadStatus =
    | { ok: true }
    | (Extract<CredentialSaveResult, { ok: false }> & { canDiscard: boolean });

export type CredentialDiscardResult =
    | { ok: true; backupName: string }
    | { ok: false; message: string };
