/** Privacy boundary, not a credential-pattern detector. Free text is never logged.
 * Unknown objects stay opaque: inspecting their keys, getters or serializers can
 * disclose user content or execute application code while handling an error.
 */
export function redactValue(value: unknown): { type: string; length?: number } {
  if (value === null) return { type: 'null' };
  if (typeof value === 'string') return { type: 'string', length: value.length };
  if (typeof value !== 'object') return { type: typeof value };
  try {
    if (Array.isArray(value)) return { type: 'array' };
  } catch { /* Revoked proxies remain opaque. */ }
  return { type: 'object' };
}

export function redactForLog(args: unknown[]): string {
  return JSON.stringify(args.map(redactValue));
}
