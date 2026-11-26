/**
 * Error text for display in the selected UI language. The main process sends fixed English
 * messages (the English text is the i18n key); this translates a known message whether it is the
 * whole error or wrapped in other text, such as "Generation failed: <message>".
 */

// Mirrors the fixed messages in electron/services/proxy/tunnel.ts (a test keeps them in sync).
export const PROXY_ERROR_MESSAGES = Object.freeze([
  'The proxy server could not be reached.',
  'The proxy server requires authentication.',
  'The proxy server rejected the proxy credentials.',
  'The proxy server refused the connection to the destination.',
  'The proxy server returned an invalid response.',
]);

export function localizeErrorText(error, translate) {
  const text = error instanceof Error ? error.message : String(error ?? '');
  const whole = translate(text);
  if (whole !== text) return whole;
  return PROXY_ERROR_MESSAGES.reduce((out, message) => out.split(message).join(translate(message)), text);
}
