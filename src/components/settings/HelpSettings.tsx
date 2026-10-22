import { APP_NAME } from '../../appIdentity';
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Command, Monitor, Mic, Settings, Zap, Key, User, Play, Image, ArrowUp, FileText, Sparkles, Search, ChevronUp, Copy,
    FileJson, MessageSquare, Briefcase, Eye, EyeOff, Ghost, ChevronDown, ChevronRight, HelpCircle, Upload, CheckCircle2,
    RefreshCw, Trash2, Check, ExternalLink, Volume2, Globe, Brain, Cpu, Calendar, Star, CreditCard, X, Pencil, Lightbulb,
    SlidersHorizontal, PointerOff, ArrowRight, LayoutGrid, DollarSign, Building2
} from 'lucide-react';
import { SiOpenai, SiGoogle, SiAnthropic } from 'react-icons/si';
import { useShortcuts } from '../../hooks/useShortcuts';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { useI18n } from '../../i18n';
import { isMac, getModifierSymbol } from '../../utils/platformUtils';
import nativelyIcon from '../icon.png';

// ----------------------
// Animations & Mocks
// ----------------------

const CMD_SYMBOL = getModifierSymbol('cmd');
const MOCK_BUTTONS = [
    { icon: Pencil, label: 'What to answer?', kbd: `${CMD_SYMBOL}1`, color: 'blue' },
    { icon: MessageSquare, label: 'Clarify', kbd: `${CMD_SYMBOL}2`, color: 'indigo' },
    { icon: RefreshCw, label: 'Recap', kbd: `${CMD_SYMBOL}7`, color: 'amber' },
    { icon: HelpCircle, label: 'Follow Up Question', kbd: `${CMD_SYMBOL}4`, color: 'teal' },
    { icon: Zap, label: 'Answer', kbd: `${CMD_SYMBOL}5`, color: 'emerald' },
] as const;

const colorMap: Record<string, string> = {
    blue: 'bg-blue-500/10 text-blue-500 border-blue-500/25',
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/25',
    amber: 'bg-amber-500/10 text-amber-500 border-amber-500/25',
    teal: 'bg-teal-500/10 text-teal-500 border-teal-500/25',
    emerald: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/25',
};

// Fills {key} slots of a translated sentence with inline elements such as key chips and emphasis.
const withParts = (template: string, parts: Record<string, React.ReactNode>) =>
    template.split(/(\{\w+\})/).map((piece, i) => {
        const key = piece.match(/^\{(\w+)\}$/)?.[1];
        return key && Object.hasOwn(parts, key) ? <React.Fragment key={i}>{parts[key]}</React.Fragment> : piece;
    });

const MockAppInterface = () => {
    const { t } = useI18n();
    const [activeBtn, setActiveBtn] = useState(0);
    const isLight = useResolvedTheme() === 'light';

    useEffect(() => {
        const id = setInterval(() => setActiveBtn(i => (i + 1) % MOCK_BUTTONS.length), 1600);
        return () => clearInterval(id);
    }, []);

    return (
        <div className="flex flex-col items-center w-full max-w-[600px] mx-auto opacity-100 relative h-[380px] overflow-hidden">
            <div className="flex flex-col items-center w-[600px] transform scale-[0.8] origin-top absolute top-0 pt-2">
                {/* Top Pill Replica */}
                <div className="flex justify-center mb-2 select-none z-50">
                    <div className="flex items-center gap-2 rounded-full backdrop-blur-md pl-1.5 pr-1.5 py-1.5 bg-bg-item-surface border border-border-subtle shadow-sm">
                        {/* Logo Button */}
                        <div className="w-8 h-8 rounded-full bg-bg-item-active flex items-center justify-center border border-border-muted overflow-hidden">
                            <img
                                src={nativelyIcon}
                                alt={APP_NAME}
                                className="w-[20px] h-[20px] object-contain"
                                style={{ filter: isLight ? 'brightness(0)' : 'brightness(0) invert(1)', opacity: 0.9 }}
                            />
                        </div>
                        {/* Center Segment */}
                        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-bg-item-surface text-text-primary text-[12px] font-medium border border-border-muted">
                            <ChevronUp className="w-3.5 h-3.5 opacity-70" />
                            <span className="tracking-wide opacity-80">{t('Hide')}</span>
                        </div>
                        {/* Stop Button */}
                        <div className="w-8 h-8 rounded-full flex items-center justify-center bg-bg-item-active text-text-primary border border-border-muted">
                            <div className="w-3.5 h-3.5 rounded-[3px] bg-current opacity-80" />
                        </div>
                    </div>
                </div>

                {/* Main Window */}
                <div className="relative w-full backdrop-blur-[30px] border border-border-subtle rounded-[24px] overflow-hidden flex flex-col bg-bg-item-surface shadow-2xl">

                    {/* Rolling Transcript Bar — replica of RollingTranscript.tsx */}
                    <div className="relative w-[90%] mx-auto pt-2">
                        <div
                            className="overflow-hidden whitespace-nowrap text-right"
                            style={{ maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)' }}
                        >
                            <span className="text-text-secondary inline-flex items-center text-[13px] italic leading-7 opacity-60">
                                {t("...and I'd also consider a distributed cache layer for horizontal scaling")}
                                <span className="inline-flex items-center ml-2">
                                    <span className="w-1 h-1 bg-green-500/60 rounded-full animate-pulse" />
                                </span>
                            </span>
                        </div>
                    </div>

                    {/* Chat History */}
                    <div className="p-4 space-y-3 pb-2 flex-1 overflow-y-auto max-h-[220px]">
                        <div className="flex justify-start">
                            <div className="max-w-[85%] px-4 py-3 text-[14px] leading-relaxed font-normal text-text-primary">
                                <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium uppercase tracking-wider text-text-secondary opacity-70">
                                    {t('Interviewer')}
                                </div>
                                <span className="text-text-secondary italic">{t('So how would you optimize the current algorithm?')}</span>
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <div className="max-w-[72.25%] px-[13.6px] py-[10.2px] text-[14px] leading-relaxed whitespace-pre-wrap bg-blue-500/10 border border-blue-500/20 text-blue-500 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium">
                                <span className="font-semibold text-emerald-500 block mb-1 text-[12px]">🎯 {t('Answer')}</span>
                                {t('A good approach would be to use a hash map to cache intermediate results and reduce time complexity to O(N).')}
                            </div>
                        </div>
                    </div>

                    {/* Quick Actions — cycling highlight */}
                    <div className="flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 pt-3 overflow-x-hidden">
                        {MOCK_BUTTONS.map((btn, idx) => {
                            const Icon = btn.icon;
                            const isActive = activeBtn === idx;
                            return (
                                <button key={idx} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all duration-300 whitespace-nowrap shrink-0 ${isActive ? colorMap[btn.color] : 'bg-bg-item-surface text-text-primary border-border-subtle'}`}>
                                    <Icon className="w-3 h-3 opacity-70" /> {t(btn.label)}
                                </button>
                            );
                        })}
                    </div>

                    {/* Input Area */}
                    <div className="p-3 pt-0">
                        <div className="relative">
                            <div className="w-full border border-border-subtle rounded-xl pl-3 pr-10 py-2.5 text-[13px] leading-relaxed bg-bg-input shadow-inner flex items-center h-[46px]">
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none text-[13px] text-text-secondary opacity-60">
                                    <span className="hidden sm:inline">{t('Ask anything on screen or conversation, or')}</span>
                                    <div className="flex items-center gap-1 opacity-80 sm:ml-0.5">
                                        <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center bg-bg-item-surface border-border-subtle text-text-primary shadow-sm">{getModifierSymbol('cmd')}</kbd>
                                        <span className="text-[10px]">+</span>
                                        <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center bg-bg-item-surface border-border-subtle text-text-primary shadow-sm">{getModifierSymbol('shift')}</kbd>
                                        <span className="text-[10px]">+</span>
                                        <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center bg-bg-item-surface border-border-subtle text-text-primary shadow-sm">H</kbd>
                                    </div>
                                    <span className="hidden sm:inline">{t('for selective screenshot')}</span>
                                </div>
                            </div>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-20 text-text-primary">
                                <span className="text-[10px]">↵</span>
                            </div>
                        </div>
                        {/* Bottom Row */}
                        <div className="flex items-center justify-between mt-3 px-0.5">
                            <div className="flex items-center gap-1.5">
                                <button className="flex items-center gap-2 px-3 py-1.5 border border-border-subtle rounded-lg bg-bg-item-surface text-text-primary text-xs font-medium w-[140px] shadow-sm">
                                    <span className="truncate min-w-0 flex-1 text-left">Gemini 3.1 Flash</span>
                                    <ChevronDown size={14} className="shrink-0 opacity-70" />
                                </button>
                                <div className="h-3 w-px bg-border-subtle mx-1" />
                                <button className="w-8 h-8 flex items-center justify-center border border-border-subtle rounded-lg bg-bg-item-surface text-text-primary shadow-sm">
                                    <SlidersHorizontal size={14} className="opacity-70" />
                                </button>
                                <div className="h-3 w-px bg-border-subtle mx-1" />
                                <button className="w-8 h-8 flex items-center justify-center border border-border-subtle rounded-lg bg-bg-item-surface text-text-primary shadow-sm">
                                    <PointerOff size={14} className="opacity-70" />
                                </button>
                            </div>
                            <button className="w-7 h-7 rounded-full flex items-center justify-center bg-bg-item-surface border border-border-subtle shadow-sm text-text-secondary">
                                <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const MockMeetingInterfaceAnim = () => {
    const { t } = useI18n();
    const [tab, setTab] = useState('transcript');

    useEffect(() => {
        const tabs = ['transcript', 'usage'];
        let i = 0;
        const interval = setInterval(() => { i = (i + 1) % tabs.length; setTab(tabs[i]); }, 3500);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="w-full aspect-[3/2] bg-bg-secondary rounded-[20px] border border-border-subtle overflow-hidden flex flex-col relative shadow-lg select-none pointer-events-none">

            {/* Header */}
            <div className="px-6 pt-5 pb-0 shrink-0">
                <div className="text-xs text-text-tertiary font-medium mb-0.5">{t('Today · {minutes} min', { minutes: 47 })}</div>
                <h1 className="text-xl font-bold text-text-primary tracking-tight">{t('System Design Interview')}</h1>
            </div>

            {/* Tabs row */}
            <div className="flex items-center justify-between px-6 pt-4 pb-3 shrink-0">
                <div className="p-1 rounded-xl inline-flex items-center gap-0.5 bg-bg-input border border-border-subtle">
                    {['transcript', 'usage'].map((name) => (
                        <button key={name} className={`relative px-3 py-1 text-[12px] font-medium rounded-lg z-10 transition-colors ${tab === name ? 'text-text-primary bg-bg-elevated shadow-sm border border-border-subtle' : 'text-text-tertiary'}`}>
                            {t(name === 'transcript' ? 'Transcript' : 'Usage')}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary opacity-70">
                    <Copy size={12} /> {t(tab === 'transcript' ? 'Copy full transcript' : 'Copy usage')}
                </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden px-6 pb-14">
                <AnimatePresence mode="wait">
                    {tab === 'transcript' && (
                        <motion.div key="transcript" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-6">
                            {/* Matches MeetingDetails: speaker + timestamp inline, then text below — no card/border */}
                            {[
                                { speaker: 'Them', time: '10:32', text: 'Why did you use Redis over Memcached for the cart session?' },
                                { speaker: 'Me', time: '10:33', text: 'Because we needed sorted sets for rate limiting and automatic expiry without custom cron jobs.' },
                            ].map((entry, i) => (
                                <div key={i}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-semibold text-text-secondary">{t(entry.speaker)}</span>
                                        <span className="text-xs text-text-tertiary font-mono">{entry.time}</span>
                                    </div>
                                    <p className="text-text-secondary text-sm leading-relaxed">{t(entry.text)}</p>
                                </div>
                            ))}
                        </motion.div>
                    )}
                    {tab === 'usage' && (
                        <motion.div key="usage" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="space-y-4">
                            <div className="flex justify-end pt-2">
                                <div className="bg-accent-primary text-on-accent px-4 py-2 rounded-2xl rounded-tr-sm max-w-[75%] text-xs leading-relaxed shadow-sm">
                                    {t('Could you elaborate on the Redis rate limiting?')}
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 w-5 h-5 rounded-full bg-bg-input flex items-center justify-center border border-border-subtle shrink-0">
                                    <img src={nativelyIcon} alt="AI" className="w-3 h-3 opacity-50 object-contain force-black-icon" />
                                </div>
                                <div>
                                    <div className="text-[10px] text-text-tertiary mb-1 font-medium">{t('10:35 AM')}</div>
                                    <p className="text-xs text-text-secondary leading-relaxed">{t('You mentioned Redis Sorted Sets for the sliding rate window — efficient because it auto-expires stale records while keeping operations strictly O(log N).')}</p>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Floating ask bar */}
            <div className="absolute bottom-0 left-0 right-0 p-4 flex justify-center">
                <div className="w-full max-w-[440px] flex items-center relative">
                    <div className="w-full pl-4 pr-11 py-2.5 bg-bg-item-surface shadow-sm border border-border-subtle rounded-full text-xs text-text-tertiary/70">{t('Ask about this meeting...')}</div>
                    <div className="absolute right-2 p-1.5 rounded-full bg-bg-item-active text-text-primary border border-border-subtle shadow-sm">
                        <ArrowUp size={13} className="rotate-45" />
                    </div>
                </div>
            </div>
        </div>
    );
};

const MockSearchPillAnim = () => {
    const { t } = useI18n();
    const isLight = useResolvedTheme() === 'light';
    return (
        <div className="flex justify-center flex-col items-center py-10 rounded-[26px] border border-border-subtle relative overflow-hidden h-[340px] bg-bg-card">
            <div className="absolute inset-0 bg-black/5 backdrop-blur-[2px]" />
            <motion.div
                initial={{ y: -10, opacity: 0, scale: 0.95 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                className={`w-[480px] ${isLight ? 'bg-[#F2F2F7]/90' : 'bg-[#161618]/90'} backdrop-blur-xl backdrop-saturate-150 rounded-2xl shadow-md overflow-hidden z-10 transform-gpu relative border border-border-subtle`}
            >
                {/* Input Row */}
                <div className="relative flex items-center border-b border-border-muted">
                    <div className="absolute left-3 flex items-center pointer-events-none">
                        <Search size={14} className="text-text-tertiary" />
                    </div>
                    <div className="w-full bg-transparent pl-9 pr-4 py-2.5 text-[13px] text-text-primary outline-none flex items-center h-[38px]">
                        <span className="opacity-90">{t('System')}</span><motion.span animate={{ opacity: [1, 0, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-[1.5px] h-3.5 bg-blue-500 ml-[2px] inline-block" />
                    </div>
                </div>

                {/* Results Panel mock */}
                <div className="w-[480px]">
                    <div className="py-2">
                        {/* Explore Section */}
                        <div className="px-3 py-1">
                            <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                                {t('Explore')}
                            </div>

                            <div className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left bg-bg-item-active transition-colors">
                                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
                                    <Sparkles size={12} className="text-white" />
                                </div>
                                <span className="text-[13px] text-text-primary truncate">
                                    {t('System')}
                                </span>
                            </div>

                            <div className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-bg-item-hover transition-colors">
                                <div className="w-6 h-6 rounded-md bg-bg-item-surface flex items-center justify-center shrink-0 border border-border-subtle">
                                    <Search size={12} className="text-text-secondary" />
                                </div>
                                <span className="text-[13px] text-text-secondary">
                                    {t('Search for')} <span className="text-text-primary">"{t('System')}"</span>
                                </span>
                            </div>
                        </div>

                        {/* Sessions Section */}
                        <div className="px-3 py-1 mt-1">
                            <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                                {t('Sessions')}
                            </div>

                            <div className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-bg-item-hover transition-colors">
                                <div className="w-6 h-6 rounded-md bg-bg-item-surface flex items-center justify-center shrink-0 border border-border-subtle">
                                    <FileText size={12} className="text-text-secondary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] text-text-primary truncate">
                                        {t('System Design Interview')}
                                    </div>
                                    <div className="text-[11px] text-text-tertiary">
                                        {t('Jan 12')}
                                    </div>
                                </div>
                            </div>

                            <div className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left hover:bg-bg-item-hover transition-colors">
                                <div className="w-6 h-6 rounded-md bg-bg-item-surface flex items-center justify-center shrink-0 border border-border-subtle">
                                    <FileText size={12} className="text-text-secondary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] text-text-primary truncate">
                                        {t('System Architecture Sync')}
                                    </div>
                                    <div className="text-[11px] text-text-tertiary">
                                        {t('Jan 08')}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

const MockPermissionsAnim = () => {
    const { t } = useI18n();
    const [toggled, setToggled] = useState(false);
    useEffect(() => {
        const i = setInterval(() => setToggled(on => !on), 2500);
        return () => clearInterval(i);
    }, []);

    return (
        <div className="flex justify-center flex-col items-center gap-4 py-8 bg-bg-card rounded-xl border border-border-subtle relative overflow-hidden h-[240px]">
            <div className="w-[300px] bg-bg-elevated border border-border-subtle rounded-xl shadow-lg p-4 z-10">
                <div className="flex items-center gap-3 mb-4 border-b border-border-subtle pb-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-500 flex items-center justify-center">
                        <Monitor className="w-4 h-4" />
                    </div>
                    <div className="font-semibold text-sm text-text-primary">{t('Screen Recording')}</div>
                </div>
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <img src={nativelyIcon} alt={APP_NAME} className="w-6 h-6 object-contain rounded drop-shadow-sm opacity-90" />
                        <span className="text-text-primary text-sm font-medium">{APP_NAME}</span>
                    </div>

                    <motion.div
                        initial={false}
                        animate={{ backgroundColor: toggled ? 'var(--accent-primary)' : 'var(--bg-toggle-switch)' }}
                        className="w-10 h-6 rounded-full relative shadow-inner"
                    >
                        <motion.div
                            initial={false}
                            animate={{ x: toggled ? 18 : 2 }}
                            className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-md"
                        />
                    </motion.div>
                </div>
            </div>
            <div className="text-xs text-text-secondary text-center max-w-[280px]">
                {isMac
                    ? t('{name} requires Accessibility and Screen Recording permissions to analyze screen context.', { name: APP_NAME })
                    : t('{name} will ask for microphone access the first time you start a meeting.', { name: APP_NAME })}
            </div>
        </div>
    );
};

const MockPillControlsAnim = () => {
    const { t } = useI18n();
    const [windowShowing, setWindowShowing] = useState(true);

    useEffect(() => {
        const interval = setInterval(() => setWindowShowing(prev => !prev), 2400);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="mt-4 space-y-2.5">
            <div className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider px-1 mb-3">{t('Pill Controls')}</div>

            {/* Logo → Launcher */}
            <div className="flex items-center gap-3 p-3 bg-bg-elevated border border-border-subtle rounded-xl">
                <div className="w-8 h-8 rounded-full bg-bg-item-active flex items-center justify-center border border-border-muted shrink-0 shadow-sm">
                    <img src={nativelyIcon} alt={t('Logo')} className="w-[18px] h-[18px] object-contain force-black-icon opacity-90" />
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <motion.div
                        animate={{ opacity: [0.7, 1, 0.7] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 shrink-0"
                    >
                        <span className="relative flex h-[7px] w-[7px] shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                            <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-emerald-400" />
                        </span>
                        <span className="text-[11px] font-medium text-emerald-500">{t('Meeting ongoing')}</span>
                    </motion.div>
                    <span className="text-[11px] text-text-secondary leading-snug">{t('— clicking this brings you right back')}</span>
                </div>
            </div>

            {/* Hide / Show toggle */}
            <div className="flex items-center gap-3 p-3 bg-bg-elevated border border-border-subtle rounded-xl">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bg-item-active border border-border-muted shrink-0 w-[68px]">
                    <motion.div animate={{ rotate: windowShowing ? 0 : 180 }} transition={{ duration: 0.35, ease: 'easeInOut' }}>
                        <ChevronUp className="w-3 h-3 text-text-secondary" />
                    </motion.div>
                    <span className="text-[11px] text-text-secondary font-medium">{t(windowShowing ? 'Hide' : 'Show')}</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="relative w-14 h-9 shrink-0">
                        <motion.div
                            animate={{ opacity: windowShowing ? 1 : 0 }}
                            transition={{ duration: 0.35 }}
                            className="absolute inset-0 rounded-lg border border-border-subtle bg-bg-item-surface flex items-center justify-center"
                        >
                            <Eye className="w-3.5 h-3.5 text-text-tertiary" />
                        </motion.div>
                        <motion.div
                            animate={{ opacity: windowShowing ? 0 : 0.4 }}
                            transition={{ duration: 0.35 }}
                            className="absolute inset-0 rounded-lg border border-dashed border-border-subtle flex items-center justify-center"
                        >
                            <EyeOff className="w-3.5 h-3.5 text-text-tertiary" />
                        </motion.div>
                    </div>
                    <span className="text-[11px] text-text-secondary leading-snug">{t('Toggles entire window — keeps you')} <strong className="text-text-primary">{t('purely stealth')}</strong></span>
                </div>
            </div>

            {/* Stop → end session */}
            <div className="flex items-center gap-3 p-3 bg-bg-elevated border border-border-subtle rounded-xl">
                <div className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center shrink-0">
                    <div className="w-3 h-3 rounded-[2.5px] bg-red-400" />
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <motion.span
                        animate={{ opacity: [1, 0.25, 1] }}
                        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                        className="text-[11px] text-red-400 font-medium shrink-0"
                    >
                        {t('Session ends instantly')}
                    </motion.span>
                    <span className="text-[11px] text-text-tertiary">{t('— returns to launcher')}</span>
                </div>
            </div>

        </div>
    );
};

const MockFastModeAnim = () => {
    const { t } = useI18n();
    return (
        <div className="flex justify-center items-center py-8 bg-bg-card rounded-xl border border-border-subtle relative overflow-hidden h-[240px]">
            <div className="flex flex-col items-center gap-4 z-10">
                <motion.div
                    className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center shadow-[0_0_30px_rgba(249,115,22,0.4)]"
                    animate={{ rotate: 360 }}
                    transition={{ ease: "linear", duration: 8, repeat: Infinity }}
                >
                    <Zap className="w-8 h-8 text-white" />
                </motion.div>
                <div className="text-center">
                    <div className="font-bold text-lg text-text-primary">{t('Fast Mode Enabled')}</div>
                    <div className="text-xs text-text-secondary mt-1">{t('Uses the selected Groq model or configured Codex CLI Fast Model.')}</div>
                </div>
            </div>

            {/* Background pulses */}
            <motion.div
                className="absolute inset-0 border-[6px] border-orange-500/20 rounded-xl"
                animate={{ scale: [1, 1.05, 1], opacity: [0, 1, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
            />
        </div>
    );
};

// Audio Mock Animations

const getBadgeStyle = (color?: string) => {
    switch (color) {
        case 'blue': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
        case 'orange': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
        case 'purple': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
        case 'teal': return 'bg-teal-500/10 text-teal-500 border-teal-500/20';
        case 'cyan': return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20';
        case 'indigo': return 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20';
        case 'green': return 'bg-green-500/10 text-green-500 border-green-500/20';
        default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
    }
};

const getIconStyle = (color?: string, isSelectedItem: boolean = false) => {
    if (isSelectedItem) return 'bg-accent-primary text-on-accent shadow-sm';
    switch (color) {
        case 'blue': return 'bg-blue-500/10 text-blue-600';
        case 'orange': return 'bg-orange-500/10 text-orange-600';
        case 'purple': return 'bg-purple-500/10 text-purple-600';
        case 'teal': return 'bg-teal-500/10 text-teal-600';
        case 'cyan': return 'bg-cyan-500/10 text-cyan-600';
        case 'indigo': return 'bg-indigo-500/10 text-indigo-600';
        case 'green': return 'bg-green-500/10 text-green-600';
        default: return 'bg-gray-500/10 text-gray-600';
    }
};

const MockProviderSelectionAnim = () => {
    const { t } = useI18n();
    const isLight = useResolvedTheme() === 'light';
    const [isOpen, setIsOpen] = useState(false);
    useEffect(() => {
        const i = setInterval(() => setIsOpen(o => !o), 4000);
        return () => clearInterval(i);
    }, []);

    const options = [
        { id: 'groq', label: 'Groq Whisper', badge: '', recommended: true, desc: 'Fast LPU whisper transcription', color: 'orange', icon: <Mic size={14} /> },
        { id: 'soniox', label: 'Soniox', badge: '', recommended: false, desc: 'Streaming speech recognition', color: 'cyan', icon: <Mic size={14} /> },
    ];
    const selected = options[0];

    return (
        <div className="flex justify-center flex-col items-center py-6 bg-bg-card rounded-xl border border-border-subtle relative overflow-hidden h-[300px]">
            <div className="w-[340px] flex flex-col gap-2 relative z-10 font-sans">
                <label className="text-xs font-medium text-text-secondary">{t('Speech Provider')}</label>
                <div className="relative">
                    <button className={`w-full group bg-bg-input border border-border-subtle shadow-sm rounded-xl p-2.5 pr-3.5 flex items-center justify-between transition-all duration-200 outline-none ${isOpen ? 'ring-2 ring-accent-border border-accent-border' : 'hover:shadow-md'}`}>
                        <div className="flex items-center gap-3 overflow-hidden">
                            <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 transition-all duration-300 transform ${getIconStyle(selected.color, false)}`}>
                                {selected.icon}
                            </div>
                            <div className="min-w-0 flex-1 text-left">
                                <div className="flex items-center gap-2">
                                    <span className="text-[13px] font-semibold text-text-primary truncate leading-tight">{selected.label}</span>
                                    {selected.badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ml-2 ${getBadgeStyle('green')}`}>{selected.badge}</span>}
                                    {selected.recommended && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ml-2 ${getBadgeStyle(selected.color)}`}>{t('Recommended')}</span>}
                                </div>
                                <span className="text-[11px] text-text-tertiary truncate block leading-tight mt-0.5">{t(selected.desc)}</span>
                            </div>
                        </div>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-text-tertiary transition-transform duration-300 group-hover:bg-bg-input ${isOpen ? 'rotate-180 bg-bg-input text-text-primary' : ''}`}>
                            <ChevronDown size={14} strokeWidth={2.5} />
                        </div>
                    </button>

                    <AnimatePresence>
                        {isOpen && (
                            <motion.div
                                initial={{ opacity: 0, y: 4, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                                transition={{ duration: 0.15, ease: "easeOut" }}
                                className={"absolute top-full left-0 w-full mt-2 backdrop-blur-xl rounded-xl shadow-2xl overflow-hidden z-20 bg-bg-elevated border border-border-subtle"}
                            >
                                <div className="max-h-[170px] overflow-hidden relative" style={{ WebkitMaskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)' }}>
                                    <motion.div
                                        className="p-1.5 space-y-0.5"
                                        animate={{ y: [0, 0, -110, -110, 0, 0] }}
                                        transition={{ duration: 3.5, ease: "easeInOut", repeat: Infinity }}
                                    >
                                        {options.map((option) => {
                                            const isSelected = selected.id === option.id;
                                            return (
                                                <div key={option.id} className={`w-full rounded-[10px] p-2 flex items-center gap-3 transition-all duration-200 group relative cursor-pointer ${isSelected ? 'bg-bg-item-active shadow-inner' : 'hover:bg-bg-item-hover'}`}>
                                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 ${isSelected ? 'scale-100' : 'scale-95 group-hover:scale-100'} ${getIconStyle(option.color, false)}`}>
                                                        {option.icon}
                                                    </div>
                                                    <div className="flex-1 min-w-0 text-left">
                                                        <div className="flex items-center justify-between mb-0.5">
                                                            <div className="flex items-center gap-2">
                                                                <span className={"text-[13px] font-medium transition-colors text-text-primary"}>{option.label}</span>
                                                                {option.badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${getBadgeStyle('green')}`}>{option.badge}</span>}
                                                                {option.recommended && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${getBadgeStyle(option.color)}`}>{t('Recommended')}</span>}
                                                            </div>
                                                            {isSelected && <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}><Check size={14} className="text-accent-primary" strokeWidth={3} /></motion.div>}
                                                        </div>
                                                        <span className={"text-[11px] block truncate transition-colors text-text-secondary"}>{t(option.desc)}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </motion.div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* Animated Cursor */}
            <motion.div
                className="absolute w-5 h-5 z-30 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
                animate={{
                    x: isOpen ? 100 : 150,
                    y: isOpen ? 80 : 30
                }}
                transition={{ duration: 1.2, ease: 'easeInOut' }}
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="black" strokeWidth="1.5"><path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.42c.45 0 .67-.54.35-.85L6.35 3.35a.5.5 0 0 0-.85.35Z" /></svg>
            </motion.div>
        </div>
    );
};

const MockApiKeyFlowAnim = () => {
    const { t } = useI18n();
    const [stage, setStage] = useState(0); // 0: enter key, 1: saving, 2: test, 3: connected, 4: trash
    useEffect(() => {
        const i = setInterval(() => setStage(s => (s + 1) % 5), 2000);
        return () => clearInterval(i);
    }, []);

    return (
        <div className="flex justify-center flex-col items-center gap-2 py-8 bg-bg-card rounded-xl border border-border-subtle relative overflow-hidden h-[240px]">
            <div className="w-[380px] space-y-2 relative z-10">
                <label className="text-xs font-medium text-text-secondary block">{t('Groq API Key')}</label>
                <div className="flex gap-2">
                    <div className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary flex items-center shadow-inner">
                        <span className={stage > 0 ? "opacity-100" : "opacity-40"}>
                            {stage > 0 ? "gsk_a8B2c..." : t("Enter API key")}
                        </span>
                        {stage === 0 && <motion.div animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-0.5 h-4 bg-accent-primary ml-0.5" />}
                    </div>
                    <div className="px-5 py-2 rounded-lg text-xs font-medium bg-bg-elevated border border-border-subtle flex items-center justify-center transition-colors shadow-sm">
                        {stage === 1 ? <Check size={14} className="text-green-500" /> : t('Save')}
                    </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-3">
                        <div className="text-xs bg-bg-input px-3 py-1.5 rounded-md flex items-center gap-2 border border-border-subtle shadow-sm">
                            {stage === 2 ? <RefreshCw size={12} className="text-blue-500 animate-spin" /> : stage > 2 ? <Check size={12} className="text-green-500" /> : <Play size={12} className="text-text-tertiary" />}
                            <span className={stage > 2 ? "text-green-500" : "text-text-primary"}>
                                {t(stage === 2 ? 'Testing...' : stage > 2 ? 'Connected' : 'Test API Key')}
                            </span>
                        </div>
                    </div>
                    <div className={`p-2 rounded-lg ${stage === 4 ? 'bg-red-500/20 text-red-500' : 'text-text-tertiary'} border border-transparent`}>
                        <Trash2 size={16} />
                    </div>
                </div>
            </div>

            {/* Animated Cursor */}
            <motion.div
                className="absolute w-5 h-5 z-20 drop-shadow-lg"
                animate={{
                    x: stage === 0 ? 0 : stage === 1 ? 140 : stage === 2 ? -80 : stage === 4 ? 170 : 170,
                    y: stage === 0 ? 20 : stage === 1 ? 20 : stage === 2 ? 65 : stage === 4 ? 65 : 65
                }}
                transition={{ duration: 0.5, ease: 'easeInOut' }}
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="black" strokeWidth="1.5"><path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.42c.45 0 .67-.54.35-.85L6.35 3.35a.5.5 0 0 0-.85.35Z" /></svg>
            </motion.div>
        </div>
    );
};

// ----------------------
// Reusable Components
// ----------------------

interface AccordionSectionProps {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
}

const AccordionSection: React.FC<AccordionSectionProps> = ({ title, icon, children, defaultOpen = false }) => {
    const { t } = useI18n();
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className={`border border-border-subtle rounded-xl overflow-hidden bg-bg-surface mb-3`}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full py-4 px-5 flex items-center justify-between text-left hover:bg-bg-elevated/40 transition-colors duration-150`}
            >
                <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-lg bg-bg-elevated border border-border-subtle text-text-secondary">
                        {icon}
                    </div>
                    <span className={`font-semibold text-sm text-text-primary`}>{t(title, { name: APP_NAME })}</span>
                </div>
                {isOpen ? <ChevronDown className="w-5 h-5 text-text-tertiary" /> : <ChevronRight className="w-5 h-5 text-text-tertiary" />}
            </button>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                        <div className={`p-5 border-t border-border-subtle text-sm leading-relaxed text-text-secondary`}>
                            {children}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const SetupGuide = () => {
    const { t } = useI18n();
    const cmd = getModifierSymbol('cmd');
    const shift = getModifierSymbol('shift');
    const steps = [
        {
            title: 'Grant Permissions',
            desc: isMac
                ? t('Enable Screen Recording and Accessibility for {name} in macOS Privacy & Security.', { name: APP_NAME })
                : t('Approve the microphone prompt the first time you start a meeting (Settings → Privacy → Microphone).'),
        },
        {
            title: 'Set Up Audio',
            desc: t('Open Settings → Speech & Audio and paste a key for a cloud transcription provider such as Groq, Soniox or OpenAI.'),
        },
        {
            title: 'Connect an AI Model',
            desc: t('Open Settings → AI Providers, add a key for a cloud provider such as Gemini, Groq, OpenAI, Claude or DeepSeek, and choose the active model.'),
        },
        {
            title: 'Personalize (Optional)',
            desc: t('Add your own Skills in Settings → Context & Skills.'),
        },
        {
            title: "You're all set.",
            desc: null,
        },
    ];

    const hotkeys = [
        { label: 'Toggle', kbd: `${cmd}B` },
        { label: 'Screenshot', kbd: `${cmd}${shift}H` },
        { label: 'Chat', kbd: `${cmd}K` },
    ];

    return (
        <div className="mb-10">
            <div className="mb-7">
                <h3 className="text-[20px] font-bold text-text-primary tracking-tight leading-tight">{t('Quick Start')}</h3>
                <p className="text-[13px] text-text-tertiary mt-0.5">{t('Get {name} running in four steps.', { name: APP_NAME })}</p>
            </div>

            <div>
                {steps.map((step, i) => {
                    const isLast = i === steps.length - 1;
                    return (
                        <div key={i} className="flex gap-4">
                            {/* Step indicator column */}
                            <div className="flex flex-col items-center shrink-0" style={{ width: 28 }}>
                                <div className="w-7 h-7 rounded-full bg-accent-primary flex items-center justify-center shrink-0">
                                    <span className="text-[11px] font-bold text-on-accent leading-none">{i + 1}</span>
                                </div>
                                {!isLast && (
                                    <div className="w-px bg-border-subtle flex-1" style={{ minHeight: 32, marginTop: 5, marginBottom: 5 }} />
                                )}
                            </div>

                            {/* Content */}
                            <div className={`flex-1 min-w-0 ${isLast ? 'pb-0' : 'pb-6'}`} style={{ paddingTop: 3 }}>
                                <p className="text-[14px] font-semibold text-text-primary leading-snug">{t(step.title)}</p>
                                {step.desc && (
                                    <p className="text-[13px] text-text-secondary leading-relaxed mt-0.5">{step.desc}</p>
                                )}
                                {isLast && (
                                    <div className="flex items-center gap-4 mt-3 flex-wrap">
                                        {hotkeys.map((h, hi) => (
                                            <React.Fragment key={h.kbd}>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[12px] text-text-secondary">{t(h.label)}</span>
                                                    <kbd className="font-mono text-[11px] font-semibold text-text-primary bg-bg-item-surface border border-border-subtle rounded-md px-1.5 py-0.5 leading-none">{h.kbd}</kbd>
                                                </div>
                                                {hi < hotkeys.length - 1 && <span className="text-border-subtle text-[12px] select-none">·</span>}
                                            </React.Fragment>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
export const HelpSettings: React.FC = () => {
    const { t } = useI18n();
    const { shortcuts } = useShortcuts();
    const isLight = useResolvedTheme() === 'light';

    // Kbd class applying theme variables natively
    const kbdClass = `px-1.5 py-0.5 rounded text-[10px] font-mono border inline-block bg-bg-item-surface border-border-subtle text-text-secondary shadow-sm`;

    return (
        <div className="w-full h-full flex flex-col animated fadeIn pb-10">
            <div className="mb-6 shrink-0">
                <h2 className="text-[17px] font-semibold text-text-primary flex items-center gap-2 mb-1">
                    <HelpCircle className="w-[18px] h-[18px] text-accent-primary" />
                    {t('Help & Setup Guide')}
                </h2>
                <p className="text-xs text-text-secondary leading-relaxed max-w-2xl">
                    {t('Learn how to deeply configure {name}. Everything from providing the right API scopes to executing conversational interviews seamlessly is covered below.', { name: APP_NAME })}
                </p>
            </div>

            <div className="flex-1 space-y-2">


                <SetupGuide />

                <div className="h-10" />
                <div className="mb-4 flex items-center gap-2 border-b border-border-subtle pb-3">
                    <h3 className="text-[20px] font-bold text-text-primary tracking-tight leading-tight">{t('Help Guide')}</h3>
                </div>

                <AccordionSection title="1. App Permissions Setup" icon={<Monitor className="w-4 h-4" />}>
                    <div className="space-y-4">
                        <p>
                            {isMac
                                ? t('{name} needs OS permissions for screen context, microphone capture and global shortcuts. Transcription and answers use the providers you configure.', { name: APP_NAME })
                                : t('Windows prompts for microphone access when you start a meeting. Transcription and answers use the providers you configure.')}
                        </p>
                        {isMac && <MockPermissionsAnim />}
                        <div className="space-y-3 mt-4">
                            <h4 className="font-bold text-base text-text-primary border-b border-border-subtle pb-2">{t('Hardware & Engine Configurations')}</h4>

                            <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2`}>
                                <h5 className={`font-semibold text-[13px] text-text-primary flex items-center gap-2`}>
                                    <Mic size={14} className="text-blue-500" /> {t('Microphone & Speaker Loopback Selection')}
                                </h5>
                                <p className="text-[11px] opacity-90 leading-relaxed text-text-secondary">
                                    {withParts(t('{name} can capture both what you say and what you hear. At the top of Settings → Speech & Audio, use the dropdowns to select your hardware Input (e.g. your physical microphone) and Output capture (what the speakers play). By default, {name} uses the {systemDefault}, so audio routing follows your OS preferences.'), { name: APP_NAME, systemDefault: <strong>{t('System Default')}</strong> })}
                                </p>
                            </div>

                            {isMac && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2`}>
                                        <h5 className={`font-semibold text-[13px] text-text-primary flex items-center gap-2`}>
                                            <Monitor size={14} className="text-accent-primary" /> ScreenCaptureKit (SCK)
                                        </h5>
                                        <p className="text-[11px] opacity-90 leading-relaxed text-text-secondary">
                                            {t("Uses Apple's ScreenCaptureKit framework for system audio capture on supported macOS versions. Screen Recording permission is required.")}
                                        </p>
                                    </div>
                                    <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2`}>
                                        <h5 className={`font-semibold text-[13px] text-text-primary flex items-center gap-2`}>
                                            <Volume2 size={14} className="text-orange-500" /> {t('CoreAudio (Legacy)')}
                                        </h5>
                                        <p className="text-[11px] opacity-90 leading-relaxed text-text-secondary">
                                            {t('An alternative system audio capture backend. Choose the backend that works with your macOS version and audio devices.')}
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2`}>
                                <h5 className={`font-semibold text-[13px] text-text-primary flex items-center gap-2`}>
                                    <Globe size={14} className="text-green-500" /> {t('Language & Regional Accents')}
                                </h5>
                                <p className="text-[11px] opacity-90 leading-relaxed text-text-secondary">
                                    {withParts(t('Below the provider list, you must specify the {language} you will be speaking (e.g., English). Where offered, also select your regional {accent} (e.g., {examples}); speech providers use it to improve recognition of regional accents.'), {
                                        language: <strong>{t('Language')}</strong>,
                                        accent: <span className={kbdClass}>{t('Accent / Region')}</span>,
                                        examples: <><em>en-US</em> / <em>en-GB</em> / <em>en-IN</em></>,
                                    })}
                                </p>
                            </div>
                        </div>

                        {isMac ? (
                            <div className="flex flex-col gap-3 mt-6">
                                <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle`}>
                                    <h4 className={`font-semibold text-sm mb-2 text-text-primary flex items-center gap-2`}>
                                        <Monitor className="w-4 h-4 text-accent-primary" /> {t('Screen Recording')}
                                    </h4>
                                    <p className="text-xs opacity-90 mb-2">{t('Provides {name} the ability to read your screen temporarily when you capture context.', { name: APP_NAME })}</p>
                                    <p className="text-[11px] text-text-tertiary">{t('System Settings > Privacy & Security > Screen Recording')}</p>
                                </div>

                                <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle`}>
                                    <h4 className={`font-semibold text-sm mb-2 text-text-primary flex items-center gap-2`}>
                                        <Command className="w-4 h-4 text-purple-500" /> {t('Accessibility')}
                                    </h4>
                                    <p className="text-xs opacity-90 mb-2">{t('Required for {name} to detect the global keyboard shortcuts below, regardless of what window is focused.', { name: APP_NAME })}</p>
                                    <p className="text-[11px] text-text-tertiary">{t('System Settings > Privacy & Security > Accessibility')}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3 mt-6">
                                <div className={`p-4 rounded-xl border bg-bg-item-surface border-border-subtle`}>
                                    <h4 className={`font-semibold text-sm mb-2 text-text-primary flex items-center gap-2`}>
                                        <Mic className="w-4 h-4 text-blue-500" /> {t('Microphone')}
                                    </h4>
                                    <p className="text-xs opacity-90 mb-2">{t('Required to capture what you say during meetings. Windows prompts the first time you start a meeting.')}</p>
                                    <p className="text-[11px] text-text-tertiary">{t('Settings > Privacy > Microphone')}</p>
                                </div>
                            </div>
                        )}
                    </div>
                </AccordionSection>

                <AccordionSection title="2. Audio STT Providers Setup (Microphone)" icon={<Mic className="w-4 h-4" />}>
                    <div className="space-y-6">
                        <p>{t('{name} supports five speech recognition providers to transcribe what you hear and say: Groq, OpenAI, Soniox, Alibaba Cloud and Doubao. Choose the active provider from the dropdown in Settings → Speech & Audio.', { name: APP_NAME })}</p>

                        <MockProviderSelectionAnim />

                        <div className="space-y-4 pt-2">
                            <h4 className="font-bold text-lg text-text-primary border-b border-border-subtle pb-2">{t('API Keys & Testing')}</h4>
                            <p className="text-xs text-text-secondary">{t('Save credentials, then test the connection before a meeting. Connection tests send synthetic silence to the selected speech provider and may incur charges.')}</p>

                            <MockApiKeyFlowAnim />
                        </div>

                        <div className="space-y-3 pt-4">
                            <h4 className="font-bold text-lg text-text-primary border-b border-border-subtle pb-2">{t('Specific Provider Setup')}</h4>

                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2">
                                <h5 className="font-semibold text-sm text-text-primary flex justify-between items-center">
                                    <span>1. Groq</span>
                                    <button data-external-url="https://console.groq.com/keys" onClick={() => { (window as any).electronAPI?.openExternal('https://console.groq.com/keys') }} className="text-accent-primary hover:underline text-[10px] flex items-center gap-1"><ExternalLink size={10} /> {t('Link')}</button>
                                </h5>
                                <p className="text-xs opacity-90 leading-relaxed text-text-secondary">
                                    {withParts(t('Provides ultra-fast Whisper responses via LPUs. Starts with {prefix}. No special permissions required.'), { prefix: <span className={kbdClass}>gsk_</span> })}
                                </p>
                            </div>

                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2">
                                <h5 className="font-semibold text-sm text-text-primary flex justify-between items-center">
                                    <span>2. OpenAI</span>
                                    <button data-external-url="https://platform.openai.com/api-keys" onClick={() => { (window as any).electronAPI?.openExternal('https://platform.openai.com/api-keys') }} className="text-accent-primary hover:underline text-[10px] flex items-center gap-1"><ExternalLink size={10} /> {t('Link')}</button>
                                </h5>
                                <p className="text-xs opacity-90 leading-relaxed text-text-secondary">
                                    {withParts(t('Uses standard OpenAI keys ({prefix}). Remember: this speech key is separate from your answer-generation key under "AI Providers".'), { prefix: <span className={kbdClass}>sk-</span> })}
                                </p>
                            </div>

                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle space-y-2">
                                 <h5 className="font-semibold text-sm text-text-primary flex justify-between items-center">
                                     <span>3. Soniox</span>
                                     <button data-external-url="https://console.soniox.com/" onClick={() => { (window as any).electronAPI?.openExternal('https://console.soniox.com/') }} className="text-accent-primary hover:underline text-[10px] flex items-center gap-1"><ExternalLink size={10} /> {t('Link')}</button>
                                 </h5>
                                 <p className="text-xs opacity-90 leading-relaxed text-text-secondary">
                                     {t('Use an API key from the Soniox dashboard for speech recognition.')}
                                 </p>
                            </div>
                        </div>

                    </div>
                </AccordionSection>

                <AccordionSection title="3. AI Providers & Prompt Engine" icon={<Key className="w-4 h-4" />}>
                    <div className="space-y-4">
                        <p className="text-sm">{t('{name} uses Large Language Models (LLMs) to reason about your screen and audio context. Your question, and the screen and audio context you allow under AI Providers, is sent to the cloud provider you configure below.', { name: APP_NAME })}</p>

                        <div className="space-y-3 pt-2">
                            <h4 className="font-bold text-lg text-text-primary border-b border-border-subtle pb-2">{t('1. Standard Cloud Providers')}</h4>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="p-3 rounded-xl border bg-bg-item-surface border-border-subtle hover:border-border-muted transition-colors">
                                    <h5 className="font-semibold text-sm text-text-primary flex justify-between items-center mb-1">
                                        <span className="flex items-center gap-2">
                                            <Zap className="w-3.5 h-3.5 text-orange-500" /> Groq
                                        </span>
                                        <button data-external-url="https://console.groq.com/keys" onClick={() => { (window as any).electronAPI?.openExternal('https://console.groq.com/keys') }} className="text-accent-primary hover:underline text-[10px] flex items-center gap-1"><ExternalLink size={10} /> {t('Get Key')}</button>
                                    </h5>
                                    <p className="text-[11px] opacity-80 mb-2">{withParts(t('Ultra-fast inference using LPU hardware. Default model: {model}.'), { model: <strong>llama-3.3-70b-versatile</strong> })}</p>
                                    <span className={kbdClass}>gsk_...</span>
                                </div>
                                <div className="p-3 rounded-xl border bg-bg-item-surface border-border-subtle hover:border-border-muted transition-colors">
                                    <h5 className="font-semibold text-sm text-text-primary flex justify-between items-center mb-1">
                                        <span className="flex items-center gap-2">
                                            <SiOpenai className={`w-3.5 h-3.5 ${isLight ? 'text-black' : 'text-white'}`} /> OpenAI
                                        </span>
                                        <button data-external-url="https://platform.openai.com/api-keys" onClick={() => { (window as any).electronAPI?.openExternal('https://platform.openai.com/api-keys') }} className="text-accent-primary hover:underline text-[10px] flex items-center gap-1"><ExternalLink size={10} /> {t('Get Key')}</button>
                                    </h5>
                                    <p className="text-[11px] opacity-80 mb-2">{withParts(t('Industry standard pipeline. Default model: {model}.'), { model: <strong>gpt-5.4</strong> })}</p>
                                    <span className={kbdClass}>sk-proj-...</span>
                                </div>
                                <div className="p-3 rounded-xl border bg-bg-item-surface border-border-subtle hover:border-border-muted transition-colors">
                                    <h5 className="font-semibold text-sm text-text-primary flex justify-between items-center mb-1">
                                        <span className="flex items-center gap-2">
                                            <SiAnthropic className={`w-3.5 h-3.5 ${isLight ? 'text-black' : 'text-white'}`} /> Anthropic
                                        </span>
                                        <button data-external-url="https://console.anthropic.com/settings/keys" onClick={() => { (window as any).electronAPI?.openExternal('https://console.anthropic.com/settings/keys') }} className="text-accent-primary hover:underline text-[10px] flex items-center gap-1"><ExternalLink size={10} /> {t('Get Key')}</button>
                                    </h5>
                                    <p className="text-[11px] opacity-80 mb-2">{withParts(t('Superior coding baseline parameters. Default model: {model}.'), { model: <strong>claude-sonnet-4-6</strong> })}</p>
                                    <span className={kbdClass}>sk-ant-...</span>
                                </div>
                                <div className="p-3 rounded-xl border bg-bg-item-surface border-border-subtle hover:border-border-muted transition-colors">
                                    <h5 className="font-semibold text-sm text-text-primary flex justify-between items-center mb-1">
                                        <span className="flex items-center gap-2">
                                            <SiGoogle className="w-3.5 h-3.5 text-blue-500" /> Google Gemini
                                        </span>
                                        <button data-external-url="https://aistudio.google.com/app/apikey" onClick={() => { (window as any).electronAPI?.openExternal('https://aistudio.google.com/app/apikey') }} className="text-accent-primary hover:underline text-[10px] flex items-center gap-1"><ExternalLink size={10} /> {t('Get Key')}</button>
                                    </h5>
                                    <p className="text-[11px] opacity-80 mb-2">{withParts(t('Immense contextual window. Default model: {model}.'), { model: <strong>gemini-3.1-flash-lite-preview</strong> })}</p>
                                    <span className={kbdClass}>AIzaSy...</span>
                                </div>
                            </div>

                            <div className="p-4 mt-2 rounded-xl border border-border-subtle bg-bg-item-surface">
                                <h5 className="font-semibold text-[13px] text-text-primary mb-1">{t('Configuring the Active Model Engine')}</h5>
                                <p className="text-[11px] text-text-secondary leading-relaxed">
                                    {withParts(t('Choose your {activeModel} under Settings → AI Providers or from the model selector in the meeting overlay. New requests use that model; a backup model is used only if you select one explicitly. Screenshots you allow go directly to the selected model.'), { activeModel: <strong>{t('Active Model')}</strong> })}
                                </p>
                            </div>
                        </div>

                    </div>
                </AccordionSection>

                <AccordionSection title="4. {name} Interface Operations" icon={<Monitor className="w-4 h-4" />}>
                    <div className="space-y-6">
                        <p className="text-[13px]">{t('During a meeting, the {name} overlay provides transcript, manual answer controls and text input.', { name: APP_NAME })}</p>

                        <div className="relative w-full flex flex-col p-2 sm:p-5 bg-bg-main rounded-[26px] border border-border-subtle shadow-inner">
                            <MockAppInterface />
                            <MockPillControlsAnim />
                        </div>

                        {/* Quick Actions & Hotkeys */}
                        <div className="mt-4 mb-3 flex items-center gap-3">
                            <div className="flex-1 h-px bg-border-subtle" />
                            <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest">{t('Quick Actions & Hotkeys')}</span>
                            <div className="flex-1 h-px bg-border-subtle" />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {([
                                { Icon: Pencil, color: 'blue', title: 'What to Answer?', badge: null, bc: '', kbd: ['⌘', '1'], desc: 'Reads the active transcript and screen, then streams a precise response to read aloud.' },
                                { Icon: Lightbulb, color: 'violet', title: 'Brainstorm', badge: 'Interview ON', bc: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', kbd: ['⌘', '3'], desc: 'Recap becomes Brainstorm when Interview Mode is ON — deep multi-step strategies.' },
                                { Icon: HelpCircle, color: 'teal', title: 'Follow Up', badge: null, bc: '', kbd: ['⌘', '4'], desc: 'Suggests the next logical question to keep conversation flowing gracefully.' },
                                { Icon: Zap, color: 'emerald', title: 'Answer Now', badge: null, bc: '', kbd: ['⌘', '5'], desc: 'Records your mic + screen context and fires an immediate AI query.' },
                                { Icon: MessageSquare, color: 'indigo', title: 'Clarify', badge: null, bc: '', kbd: ['⌘', '2'], desc: 'Generates sharp probing questions from latent audio when a topic is unclear.' },
                                { Icon: RefreshCw, color: 'amber', title: 'Recap', badge: 'Interview OFF', bc: 'bg-red-500/10 text-red-400 border-red-500/30', kbd: ['⌘', '3'], desc: 'Condenses the last 5 minutes into bullet points when you lose the thread.' },
                                { Icon: Sparkles, color: 'sky', title: 'Code Hint', badge: null, bc: '', kbd: ['⌘', '6'], desc: 'Reads your screen and nudges you toward the correct code implementation.' },
                                { Icon: Monitor, color: 'rose', title: 'Screenshot & Ask', badge: null, bc: '', kbd: ['⌘', '⇧', '↵'], desc: 'Forces a full-screen capture and immediately processes it through the LLM.' },
                                { Icon: EyeOff, color: 'slate', title: 'Stealth Execute', badge: null, bc: '', kbd: ['⌘', '↵'], desc: 'Processes context in the background without ever revealing the interface.' },
                            ] as Array<{ Icon: React.ElementType; color: 'blue' | 'violet' | 'teal' | 'emerald' | 'indigo' | 'amber' | 'sky' | 'rose' | 'slate'; title: string; badge: string | null; bc: string; kbd: string[]; desc: string }>).map(({ Icon, color, title, badge, bc, kbd, desc }) => {
                                const resolvedKbd = kbd.map(k =>
                                    k === '⌘' ? getModifierSymbol('cmd')
                                  : k === '⇧' ? getModifierSymbol('shift')
                                  : k === '⌥' ? getModifierSymbol('option')
                                  : k
                                );
                                const tone = {
                                    blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(59,130,246,0.2),0_4px_12px_rgba(59,130,246,0.07)]' },
                                    violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(139,92,246,0.2),0_4px_12px_rgba(139,92,246,0.07)]' },
                                    teal: { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'border-teal-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(20,184,166,0.2),0_4px_12px_rgba(20,184,166,0.07)]' },
                                    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(16,185,129,0.2),0_4px_12px_rgba(16,185,129,0.07)]' },
                                    indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(99,102,241,0.2),0_4px_12px_rgba(99,102,241,0.07)]' },
                                    amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_4px_12px_rgba(245,158,11,0.07)]' },
                                    sky: { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(14,165,233,0.2),0_4px_12px_rgba(14,165,233,0.07)]' },
                                    rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(244,63,94,0.2),0_4px_12px_rgba(244,63,94,0.07)]' },
                                    slate: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20', glow: 'group-hover:shadow-[0_0_0_1px_rgba(100,116,139,0.2),0_4px_12px_rgba(100,116,139,0.07)]' },
                                }[color];

                                return (
                                    <div key={title} className={`group flex flex-col gap-1.5 p-3 rounded-xl border border-border-subtle bg-bg-item-surface hover:bg-bg-elevated transition-all duration-200 cursor-default ${tone.glow}`}>

                                        {/* Line 1 — Icon + Name */}
                                        <div className="flex items-center gap-2">
                                            <div className={`w-5 h-5 rounded-md ${tone.bg} border ${tone.border} flex items-center justify-center shrink-0`}>
                                                <Icon className={`w-3 h-3 ${tone.text}`} strokeWidth={2.5} />
                                            </div>
                                            <span className="text-[12px] font-bold text-text-primary tracking-tight leading-none truncate">{t(title)}</span>
                                        </div>

                                        {/* Line 2 — Interview mode badge */}
                                        <div className="flex items-center">
                                            {badge ? (
                                                <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-[2px] border rounded leading-none ${bc}`}>{t(badge)}</span>
                                            ) : (
                                                <span className="text-[9px] font-bold text-text-tertiary/50 uppercase tracking-wider leading-none">{t('Always active')}</span>
                                            )}
                                        </div>

                                        {/* Line 3 — Shortcut */}
                                        <div className="flex items-center gap-1">
                                            {resolvedKbd.map((key, i) => (
                                                <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-mono inline-block bg-bg-elevated text-text-secondary">{key}</span>
                                            ))}
                                        </div>

                                        {/* Divider */}
                                        <div className="h-px bg-gradient-to-r from-transparent via-border-subtle to-transparent" />

                                        {/* Description */}
                                        <p className="text-[11px] text-text-secondary leading-[1.5]">{t(desc)}</p>
                                    </div>
                                );
                            })}
                        </div>


                    </div>
                </AccordionSection>

                <AccordionSection title="5. Meeting Intelligence" icon={<Calendar className="w-4 h-4" />}>
                    <div className="space-y-6">
                        <p className="text-[13px]">{t('When an active session concludes, its transcript and the questions and answers of the session are saved on this computer. Nothing is sent to a model to title or summarize it.')}</p>

                        <MockMeetingInterfaceAnim />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl shadow-sm hover:border-border-muted transition-colors group">
                                <h4 className="text-[14px] font-bold text-text-primary flex items-center gap-2 mb-2">
                                    <Volume2 className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" /> {t('Raw Transcripts')}
                                </h4>
                                <p className="text-[12px] text-text-secondary leading-relaxed">
                                    {t('Dive into the exact dialogue timeline with timestamps. "Me" is what your microphone captured and "Them" is the system audio.')}
                                </p>
                            </div>

                            <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl shadow-sm hover:border-border-muted transition-colors group">
                                <h4 className="text-[14px] font-bold text-text-primary flex items-center gap-2 mb-2">
                                    <Cpu className="w-4 h-4 text-purple-500 group-hover:scale-110 transition-transform" /> {t('Usage & Storage')}
                                </h4>
                                <p className="text-[12px] text-text-secondary leading-relaxed">
                                    {t('Review the questions and answers of the session, with the provider and model behind each answer.')}
                                </p>
                            </div>
                        </div>
                    </div>
                </AccordionSection>

                <AccordionSection title="6. Global Search & Shortcuts" icon={<Search className="w-4 h-4" />}>
                    <div className="space-y-6">
                        <p className="text-[13px]">{withParts(t('In the launcher, press {shortcut} to open the {name} search palette for your saved meetings and quick questions.'), { shortcut: <span className={kbdClass}>{isMac ? 'Cmd+K' : 'Ctrl+K'}</span>, name: APP_NAME })}</p>

                        <MockSearchPillAnim />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 mb-4">
                            <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl shadow-sm hover:border-border-muted transition-colors group">
                                <h4 className="text-[14px] font-bold text-text-primary flex items-center gap-2 mb-2">
                                    <Briefcase className="w-4 h-4 text-sky-500 group-hover:scale-110 transition-transform" /> {t('Instant Meeting Traversal')}
                                </h4>
                                <p className="text-[12px] text-text-secondary leading-relaxed">
                                    {t('Search your saved meetings by title. Press Enter to open a matching meeting.')}
                                </p>
                            </div>

                            <div className="p-4 bg-bg-item-surface border border-border-subtle rounded-xl shadow-sm hover:border-border-muted transition-colors group">
                                <h4 className="text-[14px] font-bold text-text-primary flex items-center gap-2 mb-2">
                                    <Sparkles className="w-4 h-4 text-amber-500 group-hover:scale-110 transition-transform" /> {t('Conversational Fallback')}
                                </h4>
                                <p className="text-[12px] text-text-secondary leading-relaxed">
                                    {t("If your query doesn't match a saved meeting, the palette offers to start a chat with exactly what you typed.")}
                                </p>
                            </div>
                        </div>

                        <div className="border-t border-border-subtle pt-6">
                            <h4 className="font-bold text-sm text-text-primary border-b border-border-subtle pb-1">{t('Global System Shortcuts')}</h4>
                            <p className="text-[11px] text-text-secondary mt-1 mb-3">{withParts(t('These hotkeys work anywhere on your operating system, regardless of whether {name} is focused or completely hidden. Change them in {path}.'), { name: APP_NAME, path: <strong>{t('Settings → Keybinds')}</strong> })}</p>

                            <div className="grid gap-3">
                                <div className="flex items-center justify-between p-4 rounded-xl border bg-bg-item-surface border-border-subtle group">
                                    <div className="flex items-start gap-4">
                                        <div className="w-8 h-8 rounded shrink-0 bg-bg-input border border-border-subtle flex items-center justify-center mt-0.5">
                                            <Eye className="w-4 h-4 text-text-primary" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-sm text-text-primary">{t('Show / Hide Interface')}</div>
                                            <div className="text-xs text-text-secondary mt-1">{t('Quickly toggle the window visibility. Used as an immediate panic hide.')}</div>
                                        </div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        {(shortcuts.toggleVisibility || [getModifierSymbol('cmd'), 'B']).map((key: string, i: number) => <span key={i} className={kbdClass}>{key}</span>)}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between p-4 rounded-xl border bg-bg-item-surface border-border-subtle group">
                                    <div className="flex items-start gap-4">
                                        <div className="w-8 h-8 rounded shrink-0 bg-bg-input border border-border-subtle flex items-center justify-center mt-0.5">
                                            <Image className="w-4 h-4 text-text-primary" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-sm text-text-primary">{t('Capture Contextual Screenshot')}</div>
                                            <div className="text-xs text-text-secondary mt-1">{t('Takes a silent screenshot in the background, feeding the visual data to the LLM context flow.')}</div>
                                        </div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        {(shortcuts.takeScreenshot || [getModifierSymbol('cmd'), 'H']).map((key: string, i: number) => <span key={i} className={kbdClass}>{key}</span>)}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between p-4 rounded-xl border bg-bg-item-surface border-border-subtle group">
                                    <div className="flex items-start gap-4">
                                        <div className="w-8 h-8 rounded shrink-0 bg-bg-input border border-border-subtle flex items-center justify-center mt-0.5">
                                            <MessageSquare className="w-4 h-4 text-text-primary" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-sm text-text-primary">{t('Process Captured Context (Execute)')}</div>
                                            <div className="text-xs text-text-secondary mt-1">{t('Triggers {name} to analyze the captured screenshots and text from the rolling buffer.', { name: APP_NAME })}</div>
                                        </div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        {(shortcuts.processScreenshots || [getModifierSymbol('cmd'), 'Enter']).map((key: string, i: number) => <span key={i} className={kbdClass}>{key}</span>)}
                                    </div>
                                </div>

                                <div className="flex items-center justify-between p-4 rounded-xl border bg-bg-item-surface border-border-subtle group">
                                    <div className="flex items-start gap-4">
                                        <div className="w-8 h-8 rounded shrink-0 bg-bg-input border border-border-subtle flex items-center justify-center mt-0.5">
                                            <Zap className="w-4 h-4 text-text-primary" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-sm text-text-primary">{t('Capture + Execute Instantly')}</div>
                                            <div className="text-xs text-text-secondary mt-1">{t('Captures a screenshot AND processes it in one fluid action.')}</div>
                                        </div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        {(shortcuts.captureAndProcess || [getModifierSymbol('cmd'), getModifierSymbol('shift'), 'Enter']).map((key: string, i: number) => <span key={i} className={kbdClass}>{key}</span>)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </AccordionSection>





                <AccordionSection title="7. Miscellaneous" icon={<Settings className="w-4 h-4" />}>
                    <div className="space-y-6">
                        {/* Fast Mode */}
                        <div className="space-y-4">
                            <h4 className="font-bold text-sm text-text-primary flex items-center gap-2">
                                <Zap className="w-4 h-4 text-orange-500" /> {t('Fast Mode (Hardware LPU)')}
                            </h4>
                            <MockFastModeAnim />
                            <div className="p-4 rounded-xl border bg-orange-500/10 border-orange-500/20">
                                <h4 className="font-semibold text-sm mb-2 text-orange-500 flex items-center gap-2">
                                    <Zap className="w-4 h-4" /> {t('How Fast Mode Works')}
                                </h4>
                                <p className="text-xs text-orange-400/80 m-0">
                                    {withParts(t('Fast Response applies to selected Groq and Codex CLI models: Groq keeps your selected model, and Codex CLI uses its configured Fast Model. Turn it on with {popup} in the quick settings popup or {mode} under Settings → AI Providers.'), { popup: <strong>{t('Fast Response')}</strong>, mode: <strong>{t('Fast Response Mode')}</strong> })}
                                </p>
                            </div>
                        </div>
                    </div>
                </AccordionSection>

                <AccordionSection title="8. Stealth & Window Control" icon={<Ghost className="w-4 h-4" />}>
                    <div className="space-y-4">
                        <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl mb-4">
                            <h4 className="text-[13px] font-semibold text-indigo-400 flex items-center gap-2 mb-1">
                                <Ghost size={14} /> {t('Process Disguise & Undetectability')}
                            </h4>
                            <p className="text-[11px] text-text-secondary leading-relaxed mb-0">
                                {t('{name} offers window visibility, protection and disguise controls. Protection depends on the operating system and sharing application; invisibility during real screen sharing has not been verified.', { name: APP_NAME })}
                            </p>
                        </div>

                        <div className="grid gap-3">
                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle group">
                                <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                    <EyeOff className="w-4 h-4 text-text-secondary" /> {t('Dynamic UI Opacity')}
                                </h4>
                                <p className="text-xs text-text-secondary">
                                    {withParts(t('Decrease your visual footprint to near-zero. In Settings → General, drag {slider} down to make the interface translucent over your other applications.'), { slider: <strong>{t('Interface Opacity')}</strong> })}
                                </p>
                            </div>

                            <div className="p-4 rounded-xl border bg-bg-item-surface border-border-subtle group">
                                <h4 className="font-semibold text-sm mb-2 text-text-primary flex items-center gap-2">
                                    <Monitor className="w-4 h-4 text-text-secondary" /> {t('Mouse Pass-Through Mode')}
                                </h4>
                                <p className="text-[11px] text-text-secondary mb-2">
                                    {withParts(t('Do you want the overlay to stay on screen without blocking your clicks? Turn on {toggle} in Settings → Privacy & Data.'), { toggle: <strong>{t('Mouse Passthrough')}</strong> })}
                                </p>
                                <div className="p-2 border border-orange-500/20 bg-orange-500/5 rounded-lg">
                                    <p className="text-[10px] text-orange-400 m-0">
                                        {withParts(t('{warning} This renders the {name} overlay completely unclickable. You MUST memorize the Global Hotkeys (e.g. {move} to move, {hide} to hide, {actions} for actions) to control the application once this is active.'), {
                                            warning: <strong>⚠️ {t('Warning:')}</strong>,
                                            name: APP_NAME,
                                            move: <strong>{isMac ? 'Cmd' : 'Ctrl'}+Shift+{t('Arrows')}</strong>,
                                            hide: <strong>{isMac ? 'Cmd' : 'Ctrl'}+B</strong>,
                                            actions: <strong>{isMac ? 'Cmd' : 'Ctrl'}+1-7</strong>,
                                        })}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </AccordionSection>

            </div>
        </div>
    );
};
