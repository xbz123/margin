import { APP_NAME } from '../appIdentity';
import React from 'react';
import { Shield, Cpu, MicOff, Github } from 'lucide-react';
import { useI18n } from '../i18n';

interface AboutSectionProps { }

export const AboutSection: React.FC<AboutSectionProps> = () => {
    const { t } = useI18n();
    const handleOpenLink = (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
        e.preventDefault();

        // Use backend shell.openExternal
        if (window.electronAPI?.openExternal) {
            window.electronAPI.openExternal(url);
        } else {
            window.open(url, '_blank');
        }
    };

    return (
        <div className="space-y-6 animated fadeIn pb-10">
            {/* Header */}
            <div>
                <h3 className="text-[17px] font-semibold text-text-primary mb-1">{t('About {name}', { name: APP_NAME })}</h3>
                <p className="text-sm text-text-secondary">{t('A meeting assistant with manual answers and configurable privacy controls.')}</p>
            </div>

            {/* Architecture Section */}
            <div>
                <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2 px-1">{t('How {name} Works', { name: APP_NAME })}</h4>
                <div className="bg-bg-item-surface rounded-xl border border-border-subtle overflow-hidden">
                    <div className="p-3 border-b border-border-subtle bg-bg-card/50">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-accent-muted flex items-center justify-center text-accent-primary shrink-0">
                                <Cpu size={20} />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary mb-1">{t('Hybrid Intelligence')}</h5>
                                <p className="text-xs text-text-secondary leading-relaxed">
                                    {t('Manual answers use your selected model and allowed context. Speech recognition supports five providers: OpenAI, Soniox, Groq, Alibaba Cloud and Doubao.')}
                                </p>
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {/* Privacy Section */}
            <div>
                <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2 px-1">{t('Privacy & Data')}</h4>
                <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 space-y-4">
                    <div className="flex items-start gap-3">
                        <Shield size={16} className="text-green-400 mt-0.5" />
                        <div>
                            <h5 className="text-sm font-medium text-text-primary">{t('Stealth & Control')}</h5>
                            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                                {t('Configure window protection, disguise and allowed data scopes in Settings. Visibility during real screen sharing has not been verified.')}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3">
                        <MicOff size={16} className="text-red-500 mt-0.5" />
                        <div>
                            <h5 className="text-sm font-medium text-text-primary">{t('No Recording')}</h5>
                            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                                {t('{name} listens only when active. It does not record video, take arbitrary screenshots without command, or perform background surveillance.', { name: APP_NAME })}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Attribution (AGPL) */}
            <div>
                <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2 px-1">{t('Source & Attribution')}</h4>
                <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 flex flex-col md:flex-row items-center justify-between gap-4">
                    <p className="text-xs text-text-secondary leading-relaxed max-w-lg">
                        <span className="font-bold text-text-primary">{APP_NAME}</span> {t('is a modified version of Natively, originally created by Evin John.')}
                    </p>
                    <a
                        href="https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant"
                        onClick={(e) => handleOpenLink(e, "https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant")}
                        className="whitespace-nowrap text-xs font-medium text-text-tertiary hover:text-text-primary transition-colors flex items-center gap-2"
                    >
                        <Github size={14} />
                        {t('Natively source code')}
                    </a>
                </div>
            </div>

            {/* Credits */}
            <div className="pt-4 border-t border-border-subtle">
                <div>
                    <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-3">{t('Core Technology')}</h4>
                    <div className="flex flex-wrap gap-2">
                        {['Groq', 'Gemini', 'OpenAI', 'Electron', 'React', 'Rust', 'TypeScript', 'Tailwind CSS', 'Vite', 'SQLite'].map(tech => (
                            <span key={tech} className="px-2.5 py-1 rounded-md bg-bg-input border border-border-subtle text-[11px] font-medium text-text-secondary">
                                {tech}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div >
    );
};
