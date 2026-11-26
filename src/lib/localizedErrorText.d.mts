export const PROXY_ERROR_MESSAGES: readonly string[];

export function localizeErrorText(error: unknown, translate: (english: string) => string): string;
