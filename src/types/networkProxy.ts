export type NetworkProxyMode = 'system' | 'manual' | 'off';
export type NetworkProxyProtocol = 'http' | 'https' | 'socks5';

/** Stored proxy configuration (main process only; the password never reaches the renderer). */
export interface NetworkProxySettings {
  mode: NetworkProxyMode;
  protocol: NetworkProxyProtocol;
  /** Host name or IP literal; IPv6 is stored without brackets. Empty unless configured. */
  host: string;
  /** 1–65535 when configured; 0 means not set (allowed only outside manual mode). */
  port: number;
  username?: string;
  password?: string;
  /** Host names, `*.domain` / `.domain` suffixes or IP literals that always connect directly. */
  bypass: string[];
}

/** What the renderer sees: everything except the password. */
export type NetworkProxyPublicConfig = Omit<NetworkProxySettings, 'password'> & { hasPassword: boolean };

/** Refusal when a saved password would be reused for a different proxy protocol, host, port or user name. */
export const PROXY_PASSWORD_REENTRY = 'The proxy address or user name changed. Enter the proxy password again, or clear it; nothing was saved.';

/** Save request: an omitted password keeps the saved one (same proxy only); clearPassword removes it. */
export type NetworkProxySaveInput = Omit<NetworkProxySettings, 'password'> & { password?: string; clearPassword?: boolean };
