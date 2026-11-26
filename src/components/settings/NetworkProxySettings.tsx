import { useEffect, useState } from 'react';
import { Globe, Network, ShieldCheck } from 'lucide-react';
import { useI18n } from '../../i18n';
import { PROXY_PASSWORD_REENTRY, type NetworkProxyMode, type NetworkProxyProtocol, type NetworkProxySaveInput } from '../../types/networkProxy';
import { SettingsGroup, SettingsHeading, SettingsRow, settingsButtonClass } from './SettingsKit';

const MODES: { id: NetworkProxyMode; label: string; description: string }[] = [
    { id: 'system', label: 'Follow system (default)', description: 'Uses the operating system proxy, including PAC scripts. HTTPS_PROXY / HTTP_PROXY / ALL_PROXY environment variables take precedence when set.' },
    { id: 'manual', label: 'Manual', description: 'Uses the proxy server below for every request that is not direct.' },
    { id: 'off', label: 'No proxy', description: 'Connects directly to every service.' },
];

const PROTOCOLS: { id: NetworkProxyProtocol; label: string }[] = [
    { id: 'http', label: 'HTTP' },
    { id: 'https', label: 'HTTPS' },
    { id: 'socks5', label: 'SOCKS5' },
];

const inputClass = 'block w-full mt-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-accent-primary disabled:opacity-50';
const SAVE_FAILED = 'Proxy settings could not be saved. Check the values and try again.';
const LOAD_FAILED = 'Proxy settings could not be loaded.';

/** Splits the bypass text on commas and new lines. */
function bypassList(text: string): string[] {
    return text.split(/[\n,]+/).map(entry => entry.trim()).filter(Boolean);
}

export function NetworkProxySettings() {
    const { t } = useI18n();
    const [mode, setMode] = useState<NetworkProxyMode>('system');
    const [protocol, setProtocol] = useState<NetworkProxyProtocol>('http');
    const [host, setHost] = useState('');
    const [port, setPort] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [hasPassword, setHasPassword] = useState(false);
    const [clearPassword, setClearPassword] = useState(false);
    const [bypass, setBypass] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

    useEffect(() => {
        let current = true;
        window.electronAPI.getNetworkProxy().then(config => {
            if (!current) return;
            setMode(config.mode);
            setProtocol(config.protocol);
            setHost(config.host);
            setPort(config.port ? String(config.port) : '');
            setUsername(config.username ?? '');
            setHasPassword(config.hasPassword);
            setBypass(config.bypass.join('\n'));
            setLoaded(true);
        }).catch(() => { if (current) setMessage({ text: t(LOAD_FAILED), error: true }); });
        return () => { current = false; };
    }, []);

    const save = async () => {
        setBusy(true);
        setMessage(null);
        const portText = port.trim();
        const input: NetworkProxySaveInput = {
            mode, protocol, host: host.trim(), port: portText === '' ? 0 : Number(portText),
            ...(username.trim() ? { username: username.trim() } : {}),
            ...(password ? { password } : {}),
            ...(clearPassword ? { clearPassword: true } : {}),
            bypass: bypassList(bypass),
        };
        try {
            const result = await window.electronAPI.saveNetworkProxy(input);
            if (result.ok) {
                setPassword('');
                setClearPassword(false);
                setHasPassword(!!input.username && (!!input.password || (hasPassword && !clearPassword)));
                setMessage({ text: t(result.warning ?? 'Saved'), error: false });
            } else {
                setMessage({ text: t(result.message === PROXY_PASSWORD_REENTRY ? PROXY_PASSWORD_REENTRY : SAVE_FAILED), error: true });
            }
        } catch {
            setMessage({ text: t(SAVE_FAILED), error: true });
        } finally {
            setBusy(false);
        }
    };

    const disabled = busy || !loaded;
    const manual = mode === 'manual';

    return (
        <div className="space-y-6 animated fadeIn">
            <SettingsHeading
                title={t('Network & Proxy')}
                description={t('Choose how connections to AI and speech services outside China are made. The proxy applies to model, transcription and model-list requests.')}
                action={<button type="button" className={settingsButtonClass} disabled={disabled} onClick={() => void save()}>{t('Save')}</button>}
            />

            <SettingsGroup title={t('Proxy mode')}>
                <div className="p-4 space-y-3" role="radiogroup" aria-label={t('Proxy mode')}>
                    {MODES.map(option => (
                        <label key={option.id} className="flex items-start gap-3 cursor-pointer">
                            <input type="radio" name="network-proxy-mode" className="mt-0.5 accent-accent-primary" value={option.id}
                                checked={mode === option.id} disabled={disabled} onChange={() => setMode(option.id)} />
                            <span className="min-w-0">
                                <span className="block text-[13px] font-medium text-text-primary">{t(option.label)}</span>
                                <span className="block text-xs text-text-secondary mt-0.5 leading-relaxed">{t(option.description)}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </SettingsGroup>

            {manual && (
                <SettingsGroup title={t('Proxy server')}>
                    <div className="p-4 grid grid-cols-1 sm:grid-cols-[8rem_1fr_7rem] gap-3">
                        <label className="block text-xs text-text-secondary">{t('Protocol')}
                            <select value={protocol} disabled={disabled} onChange={event => setProtocol(event.target.value as NetworkProxyProtocol)} className={inputClass}>
                                {PROTOCOLS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                            </select>
                        </label>
                        <label className="block text-xs text-text-secondary">{t('Host')}
                            <input value={host} disabled={disabled} spellCheck={false} autoComplete="off" placeholder="127.0.0.1"
                                onChange={event => setHost(event.target.value)} className={inputClass} />
                        </label>
                        <label className="block text-xs text-text-secondary">{t('Port')}
                            <input value={port} disabled={disabled} inputMode="numeric" autoComplete="off" placeholder="7890"
                                onChange={event => setPort(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))} className={inputClass} />
                        </label>
                        <label className="block text-xs text-text-secondary sm:col-span-1">{t('Username (optional)')}
                            <input value={username} disabled={disabled} spellCheck={false} autoComplete="off"
                                onChange={event => setUsername(event.target.value)} className={inputClass} />
                        </label>
                        <div className="sm:col-span-2">
                            <label className="block text-xs text-text-secondary">{t('Password (optional)')}
                                <input type="password" value={password} disabled={disabled || clearPassword} autoComplete="off"
                                    placeholder={hasPassword && !clearPassword ? t('Saved') : ''}
                                    onChange={event => setPassword(event.target.value)} className={inputClass} />
                            </label>
                            <div className="mt-1.5 flex items-center gap-2">
                                <p className="text-[11px] text-text-tertiary flex-1">{t('Leave blank to keep the saved password.')}</p>
                                {hasPassword && (
                                    <button type="button" className={settingsButtonClass} disabled={disabled}
                                        onClick={() => { setClearPassword(!clearPassword); setPassword(''); }}>
                                        {clearPassword ? t('Keep password') : t('Clear')}
                                    </button>
                                )}
                            </div>
                            {clearPassword && <p className="text-[11px] text-amber-500 mt-1">{t('The saved password will be removed when you save.')}</p>}
                        </div>
                    </div>
                </SettingsGroup>
            )}

            <SettingsGroup title={t('Direct connections')}>
                <SettingsRow icon={ShieldCheck} title={t('Always direct')} align="start"
                    description={t('Built-in domestic services (Alibaba Cloud Bailian, Doubao) and local or LAN addresses (localhost, 127.x, 10.x, 172.16–31.x, 192.168.x) always connect directly, in every mode.')} />
                <SettingsRow icon={Network} title={t('Bypass list')} align="start"
                    description={t('Additional hosts that connect directly, separated by commas or new lines: example.com, *.example.com, .example.com or an IP address.')}>
                    <textarea value={bypass} disabled={disabled} rows={4} spellCheck={false} aria-label={t('Bypass list')}
                        onChange={event => setBypass(event.target.value)} className={`${inputClass} font-mono`} placeholder={'*.corp.example.com\n10.20.30.40'} />
                </SettingsRow>
                <SettingsRow icon={Globe} title={t('How it works')} align="start"
                    description={t('Encrypted (HTTPS/WSS) traffic stays end-to-end encrypted: the proxy only sees the destination host. Proxy credentials are sent only to the proxy. A failing proxy is reported as an error; requests never fall back to a direct connection.')} />
            </SettingsGroup>

            {message && <p role={message.error ? 'alert' : 'status'} className={`text-xs ${message.error ? 'text-red-500' : 'text-text-secondary'}`}>{message.text}</p>}
        </div>
    );
}
