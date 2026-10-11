import type { ReactNode } from 'react';

export function SettingsHeading({ title, description }: { title: string; description?: ReactNode }) {
    return (
        <div>
            <h3 className="text-lg font-bold text-text-primary mb-1">{title}</h3>
            {description != null && <p className="text-xs text-text-secondary">{description}</p>}
        </div>
    );
}

export function SettingsCard({ children }: { children: ReactNode }) {
    return <div className="bg-bg-card rounded-xl border border-border-subtle p-4">{children}</div>;
}
