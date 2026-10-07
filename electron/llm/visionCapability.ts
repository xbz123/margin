// electron/llm/visionCapability.ts
//
// Pure, dependency-free helpers for deciding whether a custom cURL provider can
// actually accept an image. Kept free of fetch / fs / Electron so the decision
// logic is unit-testable.
//
// Why this exists: cloud providers (OpenAI/Claude/Gemini/Groq) have known,
// fixed vision support. A custom cURL endpoint can be any shape. Guessing wrong means either (a) skipping a capable provider, or worse
// (b) "committing" to a provider that silently drops the image and answers
// text-only. These helpers make the decision authoritative where possible and
// conservative otherwise.

// ── Custom cURL provider ──────────────────────────────────────────────────────

/**
 * Decide whether a custom cURL provider can carry an image.
 *
 * A custom provider supports vision when EITHER:
 *   1. The user explicitly wired the image into the template via the
 *      `{{IMAGE_BASE64}}` placeholder (they know their endpoint's image field), OR
 *   2. The request body is OpenAI-chat-compatible (`messages` array), in which
 *      case `injectImageIntoMessages` auto-upgrades the last user message to a
 *      multimodal `image_url` content array.
 *
 * An explicit `multimodal` flag, when present, overrides the auto-detection
 * (true forces on, false forces off) so users can correct a wrong guess.
 *
 * Conservative by design: a non-OpenAI body with no `{{IMAGE_BASE64}}` returns
 * false, so the chain SKIPS the provider for vision instead of committing to it
 * and silently dropping the screenshot.
 */
export function customProviderSupportsVision(
  provider: { curlCommand?: string; multimodal?: boolean } | null | undefined,
): boolean {
  if (!provider) return false;
  if (typeof provider.multimodal === 'boolean') return provider.multimodal;

  const curl = provider.curlCommand || '';
  if (!curl) return false;

  // (1) Explicit image placeholder anywhere in the template.
  if (/\{\{\s*IMAGE_BASE64\s*\}\}/i.test(curl)) return true;

  // (2) OpenAI-compatible body: look for a JSON `"messages"` array in the
  //     payload. We avoid a full JSON parse (the body contains {{TEXT}}-style
  //     placeholders that aren't valid JSON) and instead detect the canonical
  //     OpenAI shape: a `"messages"` array containing a `"role":"user"` message.
  //     We require the USER role specifically because injectImageIntoMessages
  //     only upgrades a user message — a system-only `messages` body would pass
  //     a looser check but then silently drop the image. Aligning detection
  //     with the injector's precondition prevents committing to a provider that
  //     can't actually carry the screenshot.
  const hasMessagesArray = /"messages"\s*:\s*\[/.test(curl);
  const hasUserRole = /"role"\s*:\s*"user"/.test(curl);
  return hasMessagesArray && hasUserRole;
}

/**
 * Heuristically decide whether a custom provider's endpoint is loopback/local,
 * so local-only mode keeps using it and the chain doesn't treat it as a cloud
 * provider. Inspects the first http(s) URL in the cURL template for a
 * loopback / link-local / RFC-1918 private host.
 *
 * An explicit `localOnly` flag, when present, wins over URL detection.
 */
export function customProviderIsLocal(
  provider: { curlCommand?: string; localOnly?: boolean } | null | undefined,
): boolean {
  if (!provider) return false;
  if (typeof provider.localOnly === 'boolean') return provider.localOnly;

  const curl = provider.curlCommand || '';
  const m = curl.match(/https?:\/\/[^\s'"`]+/i);
  if (!m) return false;
  let host: string;
  try {
    host = new URL(m[0]).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
  if (host.endsWith('.local')) return true;
  if (host.startsWith('169.254.')) return true;      // link-local
  if (host.startsWith('10.')) return true;            // RFC-1918
  if (host.startsWith('192.168.')) return true;       // RFC-1918
  if (host.startsWith('172.')) {                      // RFC-1918 172.16.0.0–172.31.255.255
    const second = parseInt(host.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}
