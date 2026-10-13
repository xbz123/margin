import { APP_NAME } from '../appIdentity';
import React, { useEffect, useRef } from 'react';
import {
    Github, Twitter, Shield, Cpu,
    Heart, Linkedin, Instagram, Mail, MicOff, Star, Bug, Sparkles, Camera, LayoutGrid, User, Volume2, MessageSquare, Link, Smartphone, Calendar, ListTodo, Users, WifiOff, Send
} from 'lucide-react';
import evinProfile from '../assets/evin.png';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { useI18n } from '../i18n';
import { getPlatformShortcut } from '../utils/platformUtils';

interface AboutSectionProps { }

export const AboutSection: React.FC<AboutSectionProps> = () => {
    const { t } = useI18n();
    const isLight = useResolvedTheme() === 'light';
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
                <h3 className="text-lg font-bold text-text-primary mb-1">{t('About {name}', { name: APP_NAME })}</h3>
                <p className="text-sm text-text-secondary">{t('A meeting assistant with manual answers and configurable privacy controls.')}</p>
            </div>

            {/* What's New Section */}
            <div>
                <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2 px-1">{t("What's New in v2.7")}</h4>
                <div className="bg-bg-item-surface rounded-xl border border-border-subtle overflow-hidden">
                    {/* 1. Two New Meeting UI Styles */}
                    <div className="p-3 border-b border-border-subtle bg-bg-card/50">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 shrink-0">
                                <LayoutGrid size={20} />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary mb-1">{t('Two New Meeting UI Styles')}</h5>
                                <p className="text-xs text-text-secondary leading-relaxed">
                                    {t('Introduced two gorgeous, immersive interface themes, Liquid Glass and Modern Dark, to completely redefine your real-time overlay experience.')}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* 2. DeepSeek AI Integrated */}
                    <div className="p-3 border-b border-border-subtle bg-bg-card/50">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0">
                                <Cpu size={20} />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary mb-1">{t('DeepSeek AI Integrated')}</h5>
                                <p className="text-xs text-text-secondary leading-relaxed">
                                    {t("Full support for DeepSeek's advanced reasoning models, delivering ultra-smart and cost-effective chat replies.")}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* 3. Audio & TCC Resolved */}
                    <div className="p-3 bg-bg-card/50">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 shrink-0">
                                <Volume2 size={20} />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary mb-1">{t('Audio & TCC Resolved')}</h5>
                                <p className="text-xs text-text-secondary leading-relaxed">
                                    {t('macOS system audio capture includes permission checks. Compatibility depends on your operating system and audio devices.')}
                                </p>
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {/* Architecture Section */}
            <div>
                <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2 px-1">{t('How {name} Works', { name: APP_NAME })}</h4>
                <div className="bg-bg-item-surface rounded-xl border border-border-subtle overflow-hidden">
                    <div className="p-3 border-b border-border-subtle bg-bg-card/50">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0">
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

            {/* Community Section */}
            <div>
                <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2 px-1">{t('Community')}</h4>
                <div className="space-y-4">
                    {/* 0.5. Telegram Community */}
                    <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-sky-500/10 flex items-center justify-center text-sky-500 shadow-sm shadow-sky-500/5">
                                <Send size={18} className="opacity-80" />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary">{t('Telegram Community')}</h5>
                            </div>
                        </div>
                        <a
                            href="https://t.me/nativelyaichat"
                            onClick={(e) => handleOpenLink(e, "https://t.me/nativelyaichat")}
                            className="whitespace-nowrap px-4 py-2 bg-text-primary hover:bg-white/90 text-bg-main text-xs font-bold rounded-lg transition-all shadow hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-2"
                        >
                            <Send size={14} />
                            {t('Join Chat')}
                        </a>
                    </div>

                    {/* 1. Founder Profile */}
                    <div className="bg-bg-item-surface rounded-xl p-5">
                        <div className="flex flex-col gap-4">
                            <div className="flex items-start gap-4">
                                <div className="w-12 h-12 rounded-full bg-bg-elevated border border-border-subtle flex items-center justify-center overflow-hidden shrink-0">
                                    <img src={evinProfile} alt="Evin John" className="w-full h-full object-cover" />
                                </div>
                                <div className="pt-0.5">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h5 className="text-sm font-bold text-text-primary">Evin John</h5>
                                        <span className={`text-[10px] font-medium px-1.5 py-[1px] rounded-full ${isLight ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-yellow-400/10 text-yellow-200 border border-yellow-400/5'}`}>{t('Natively creator')}</span>
                                    </div>
                                    <p className="text-xs text-text-secondary leading-relaxed max-w-lg">
                                        <span className="font-bold text-text-primary">{APP_NAME}</span> {t('is a modified version of Natively, originally created by Evin John.')}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 pl-[60px]">
                                <a
                                    href="https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant"
                                    onClick={(e) => handleOpenLink(e, "https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant")}
                                    className="text-text-tertiary hover:text-text-primary transition-colors"
                                    title="GitHub"
                                >
                                    <Github size={18} />
                                </a>
                                <a
                                    href="https://x.com/evinjohnn"
                                    onClick={(e) => handleOpenLink(e, "https://x.com/evinjohnn")}
                                    className="text-text-tertiary hover:text-text-primary transition-colors"
                                    title="Twitter"
                                >
                                    <Twitter size={18} />
                                </a>
                                <a
                                    href="https://www.linkedin.com/in/evinjohn"
                                    onClick={(e) => handleOpenLink(e, "https://www.linkedin.com/in/evinjohn")}
                                    className="text-text-tertiary hover:text-text-primary transition-colors"
                                    title="LinkedIn"
                                >
                                    <Linkedin size={18} />
                                </a>
                                <a
                                    href="https://www.instagram.com/evinjohnn/"
                                    onClick={(e) => handleOpenLink(e, "https://www.instagram.com/evinjohnn/")}
                                    className="text-text-tertiary hover:text-text-primary transition-colors"
                                    title="Instagram"
                                >
                                    <Instagram size={18} />
                                </a>
                            </div>
                        </div>
                    </div>

                    {/* 2. Star & Report */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <a
                            href="https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant"
                            onClick={(e) => handleOpenLink(e, "https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant")}
                            className="bg-bg-item-surface border border-border-subtle rounded-xl p-5 transition-all group flex items-center gap-4 h-full hover:bg-white/10"
                        >
                            <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center text-yellow-500 shrink-0 group-hover:scale-110 transition-transform">
                                <Star size={20} className="transition-all group-hover:fill-current" />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary">{t('Star on GitHub')}</h5>
                                <p className="text-xs text-text-secondary mt-0.5">{t('Love {name}? Support us by starring the repo.', { name: APP_NAME })}</p>
                            </div>
                        </a>

                        <a
                            href="https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/issues"
                            onClick={(e) => handleOpenLink(e, "https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/issues")}
                            className="bg-bg-item-surface border border-border-subtle rounded-xl p-5 transition-all group flex items-center gap-4 h-full hover:bg-white/10"
                        >
                            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500 shrink-0 group-hover:scale-110 transition-transform">
                                <Bug size={20} />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary">{t('Report an Issue')}</h5>
                                <p className="text-xs text-text-secondary mt-0.5">{t('Found a bug? Let us know so we can fix it.')}</p>
                            </div>
                        </a>
                    </div>

                    {/* 3. Get in Touch */}
                    <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 shadow-sm shadow-blue-500/5">
                                <Mail size={18} className="opacity-80" />
                            </div>
                            <div>
                                <h5 className="text-sm font-bold text-text-primary">{t('Get in Touch')}</h5>
                                <p className="text-xs text-text-secondary mt-0.5">{t('Open for professional collaborations and job offers.')}</p>
                            </div>
                        </div>
                        <a
                            href="mailto:evinjohnignatious@gmail.com"
                            onClick={(e) => handleOpenLink(e, "mailto:evinjohnignatious@gmail.com")}
                            className="whitespace-nowrap px-4 py-2 bg-text-primary hover:bg-white/90 text-bg-main text-xs font-bold rounded-lg transition-all shadow hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-2"
                        >
                            <Mail size={14} />
                            {t('Contact Me')}
                        </a>
                    </div>

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
