import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

// Shared layout for every Settings page: a page header with an optional action on the right,
// titled cards whose rows are separated by hairlines, and one switch style.

export function SettingsHeading({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
                <h3 className="text-[17px] font-semibold text-text-primary mb-1">{title}</h3>
                {description != null && <p className="text-xs text-text-secondary leading-relaxed">{description}</p>}
            </div>
            {action != null && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </div>
    );
}

export function SettingsCard({ children }: { children: ReactNode }) {
    return <div className="bg-bg-card rounded-xl border border-border-subtle p-4">{children}</div>;
}

/** A titled card; its direct children are rows separated by hairlines. */
export function SettingsGroup({ title, description, children }: { title?: string; description?: ReactNode; children: ReactNode }) {
    return (
        <section className="space-y-2">
            {title && (
                <div className="px-1">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{title}</h4>
                    {description != null && <p className="text-xs text-text-secondary mt-1 leading-relaxed">{description}</p>}
                </div>
            )}
            <div className="bg-bg-card rounded-xl border border-border-subtle divide-y divide-border-muted">{children}</div>
        </section>
    );
}

/** One setting: icon, title and description on the left, its control on the right. */
export function SettingsRow({ icon: Icon, title, titleId, description, control, children, align = 'center' }: {
    icon?: LucideIcon;
    title: ReactNode;
    titleId?: string;
    description?: ReactNode;
    control?: ReactNode;
    /** Content under the row text, such as inputs or notices. */
    children?: ReactNode;
    align?: 'center' | 'start';
}) {
    return (
        <div className="px-4 py-3.5">
            <div className={`flex gap-3.5 ${align === 'center' ? 'items-center' : 'items-start'}`}>
                {Icon && (
                    <span className="w-8 h-8 shrink-0 rounded-lg border border-border-subtle bg-bg-item-surface flex items-center justify-center text-text-secondary" aria-hidden="true">
                        <Icon size={15} strokeWidth={1.75} />
                    </span>
                )}
                <div className="flex-1 min-w-0">
                    <h5 id={titleId} className="text-[13px] font-medium text-text-primary">{title}</h5>
                    {description != null && <div className="text-xs text-text-secondary mt-0.5 leading-relaxed">{description}</div>}
                </div>
                {control != null && <div className="shrink-0 flex items-center gap-2">{control}</div>}
            </div>
            {children != null && <div className={`mt-3 ${Icon ? 'pl-[46px]' : ''}`}>{children}</div>}
        </div>
    );
}

export function SettingsSwitch({ checked, onChange, label, disabled = false }: {
    checked: boolean;
    onChange: (next: boolean) => void;
    label: string;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`w-10 h-6 shrink-0 rounded-full relative transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary ${checked ? 'bg-accent-primary' : 'bg-bg-toggle-switch'}`}
        >
            <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
    );
}

/** Small bordered button used for page and row actions. */
export const settingsButtonClass = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-component text-xs font-medium text-text-primary hover:bg-bg-item-surface transition-colors disabled:opacity-50';
