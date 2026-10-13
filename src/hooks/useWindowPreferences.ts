import { useCallback, useEffect, useRef, useState } from 'react';
import { isDisguiseMode, type DisguiseMode, type WindowPreferenceKind, type WindowPreferenceResult } from '../types/windowPreferences';

export function useWindowPreferences() {
    const [values, setValues] = useState({ protection: false, passthrough: false, disguise: 'none' as DisguiseMode });
    const [errors, setErrors] = useState<Partial<Record<WindowPreferenceKind, string>>>({});
    const authoritative = useRef(values);
    const epochs = useRef({ protection: 0, passthrough: 0, disguise: 0 });
    const revisions = useRef({ protection: -1, passthrough: -1, disguise: -1 });
    const active = useRef(true);
    const apply = useCallback((result: WindowPreferenceResult) => {
        if (!active.current || !result || !(result.kind in revisions.current) || result.code === 'superseded') return;
        const { kind, value, revision } = result;
        if (!Number.isSafeInteger(revision) || revision < revisions.current[kind] || (kind === 'disguise' ? !isDisguiseMode(value) : typeof value !== 'boolean')) return;
        revisions.current[kind] = revision;
        authoritative.current = { ...authoritative.current, [kind]: value };
        epochs.current[kind]++;
        setValues(previous => ({ ...previous, [kind]: value }));
        setErrors(previous => ({ ...previous, [kind]: result.success || result.pending ? undefined : result.error ?? 'The window preference could not be fully applied. Retry the setting.' }));
    }, []);
    useEffect(() => {
        active.current = true;
        const api = window.electronAPI;
        const before = { ...epochs.current };
        const unsubscribe = api?.onWindowPreferenceResult?.(apply);
        api?.getWindowPreferences?.().then(results => {
            for (const result of results) if (before[result.kind] === epochs.current[result.kind]) apply(result);
        }).catch(() => {});
        return () => { active.current = false; unsubscribe?.(); };
    }, [apply]);
    const request = useCallback(async (kind: WindowPreferenceKind, value: boolean | DisguiseMode) => {
        const epoch = ++epochs.current[kind];
        setValues(previous => ({ ...previous, [kind]: value }));
        setErrors(previous => ({ ...previous, [kind]: undefined }));
        try {
            const api = window.electronAPI;
            const result = kind === 'protection' ? await api.setUndetectable(value as boolean) : kind === 'passthrough' ? await api.setOverlayMousePassthrough(value as boolean) : await api.setDisguise(value as DisguiseMode);
            if (epoch === epochs.current[kind]) apply(result);
        } catch {
            if (active.current && epoch === epochs.current[kind]) {
                setValues(previous => ({ ...previous, [kind]: authoritative.current[kind] }));
                setErrors(previous => ({ ...previous, [kind]: 'The window preference could not be fully applied. Retry the setting.' }));
            }
        }
    }, [apply]);
    return { isUndetectable: values.protection, isMousePassthrough: values.passthrough, disguiseMode: values.disguise, preferenceErrors: errors,
        setProtection: (value: boolean) => request('protection', value), setPassthrough: (value: boolean) => request('passthrough', value), setDisguise: (value: DisguiseMode) => request('disguise', value) };
}
