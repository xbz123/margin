import React from 'react';
import type { ReasoningChoice, ReasoningControlState } from '../types/answerReasoning';
import { useI18n } from '../i18n';

const LABELS: Record<ReasoningChoice, string> = {
    default: 'Provider default', off: 'Reasoning off', none: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
};

interface ReasoningSelectProps {
    /** From the main process; undefined until it has answered. */
    state?: ReasoningControlState;
    label: string;
    onChange: (value: ReasoningChoice) => void;
    /** Overlay form: no visible label, notices in the tooltip and a marker. */
    compact?: boolean;
    className?: string;
    style?: React.CSSProperties;
}

/** One reasoning control for the settings default and the session; options are exactly what the model offers. */
export const ReasoningSelect: React.FC<ReasoningSelectProps> = ({ state, label, onChange, compact, className = '', style }) => {
    const { t } = useI18n();
    const notice = state?.notice ? t(state.notice) : undefined;
    const select = (
        <select aria-label={label} title={compact ? [label, notice].filter(Boolean).join(' — ') : undefined} value={state?.value ?? 'default'}
            disabled={!state || state.mode !== 'official'} className={className} style={style}
            onChange={event => { if (event.target.value !== 'legacy') onChange(event.target.value as ReasoningChoice); }}>
            {state?.value === 'legacy' && <option value="legacy">{t('Earlier setting (confirm): {setting}', { setting: state.pendingLegacy ?? '' })}</option>}
            {state?.mode === 'source' ? <option value="default">{t('Set in the gateway or Codex configuration')}</option>
                : state?.mode === 'unavailable' ? <option value="default">{t('Unavailable')}</option>
                    : (state?.options ?? ['default']).map(option => <option key={option} value={option}>{t(LABELS[option])}</option>)}
        </select>
    );
    if (compact) return (
        <span className="relative inline-flex items-center min-w-0">
            {select}
            {notice && <span role="status" className="ml-1 text-[10px] font-semibold text-amber-500" title={notice} aria-label={notice}>!</span>}
        </span>
    );
    return (
        <label className="block text-xs text-text-secondary">{label}
            {select}
            {state?.value === 'legacy' && <span className="block text-[10px] mt-1">{t('Your earlier per-model reasoning setting is still used for this model until you choose a level here.')}</span>}
            {notice && <span role="status" className="block text-[11px] mt-1 text-amber-500">{notice}</span>}
        </label>
    );
};
