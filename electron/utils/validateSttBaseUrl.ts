import { validateHttpEndpoint } from '../services/outbound';

export function validateSttBaseUrl(input: unknown): string {
  if (typeof input !== 'string') throw Error('Invalid STT base URL');
  const value = input.trim();
  if (!value) return '';
  const parsed = new URL(validateHttpEndpoint(value));
  if (parsed.search) throw Error('STT base URL cannot contain a query');
  return parsed.href.replace(/\/+$/, '');
}
