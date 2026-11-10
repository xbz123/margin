import type { CredentialSaveResult } from '../../src/types/credentialSave';

// Groq, OpenAI and Soniox STT keys reach the settings window only as this preview.
export function sttKeyPreview(savedKey?: string): string {
  return savedKey ? `sk-...${savedKey.slice(-4)}` : '';
}

// The preview coming back from the settings box means "the saved key", never a new key.
// A real key never is the literal "sk-..." plus at most four characters.
export function isSttKeyPreview(input: unknown): boolean {
  return typeof input === 'string' && /^sk-\.\.\.[\s\S]{1,4}$/.test(input.trim());
}

// An empty box or the preview tests the saved key ('' when none is saved); a newly typed key is tested as typed.
export function sttKeyToTest(input: unknown, savedKey?: string): string {
  const typed = typeof input === 'string' ? input.trim() : '';
  if (typed && !isSttKeyPreview(typed)) return typed;
  return savedKey?.trim() ?? '';
}

// Saving the preview back keeps the saved key unchanged; with nothing saved there is no key to keep.
export function sttPreviewSaveResult(savedKey?: string): CredentialSaveResult {
  return savedKey?.trim() ? { ok: true } : { ok: false, code: 'write_failed', message: 'Please enter an API key first' };
}
