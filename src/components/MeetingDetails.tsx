import React, { useRef, useState } from 'react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { ArrowLeft, Search, Mail, Link, ChevronDown, Play, ArrowUp, Copy, Check, MoreHorizontal, Settings, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import EditableTextBlock from './EditableTextBlock';
import NativelyLogo from './icon.png';
import ReactMarkdown from './SafeMarkdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

const formatTime = (ms: number) => {
    const date = new Date(ms);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase();
};

const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;
};

const cleanMarkdown = (content: string) => {
    if (!content) return '';
    // Ensure code blocks are on new lines to fix rendering issues
    return content.replace(/([^\n])```/g, '$1\n\n```');
};

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    summary: string;
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
        generation?: import('../types/generationMetadata').GenerationMetadata;
    }>;
}

type EditField = 'title';

// Restores the edited title from `source` (the stored meeting, or the state before
// the edit), leaving every other field as it is.
const restoreField = (current: Meeting, source: Meeting, _field: EditField): Meeting => ({ ...current, title: source.title });

interface MeetingDetailsProps {
    meeting: Meeting;
    onBack: () => void;
    onOpenSettings: () => void;
}

const MeetingDetails: React.FC<MeetingDetailsProps> = ({ meeting: initialMeeting }) => {
    const isLight = useResolvedTheme() === 'light';
    // We need local state for the meeting object to reflect optimistic updates
    const [meeting, setMeeting] = useState<Meeting>(initialMeeting);
    const [activeTab, setActiveTab] = useState<'transcript' | 'usage'>('transcript');
    const [isCopied, setIsCopied] = useState(false);
    // The notice of the last failed save, with the field it belongs to.
    const [saveError, setSaveError] = useState<{ field: EditField; message: string } | null>(null);
    // The latest meeting state, for handlers called from older closures (a debounced
    // save fires with the closure of the render that started it).
    const meetingRef = useRef(meeting);
    meetingRef.current = meeting;
    // A version per field: only the response to the latest edit of a field acts.
    const editVersions = useRef(new Map<EditField, number>());

    const handleCopy = async () => {
        let textToCopy = '';

        if (activeTab === 'transcript' && meeting.transcript) {
            textToCopy = meeting.transcript.map(t => `[${formatTime(t.timestamp)}] ${t.speaker === 'user' ? 'Me' : 'Them'}: ${t.text}`).join('\n');
        } else if (activeTab === 'usage' && meeting.usage) {
            textToCopy = meeting.usage.map(u => `Q: ${u.question || ''}\nA: ${u.answer || ''}`).join('\n\n');
        }

        if (!textToCopy) return;

        try {
            await navigator.clipboard.writeText(textToCopy);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy content:', err);
        }
    };

    // UPDATE HANDLERS
    // Edits show at once and are saved in the background. A save that fails (the update
    // rejects or returns false) must not stay on screen as if it were stored (PLAN.md
    // AG-17 sixth and seventh reviews):
    // - only the response to the latest edit of a field acts; earlier ones are ignored;
    // - the failed field alone is restored, from the database, or, when the meeting
    //   cannot be read, to the value it had before the edit; other fields and drafts
    //   still being typed are left alone;
    // - the notice names the failure and is cleared only by a later successful save of
    //   the same field.
    const persistEdit = async (
        field: EditField,
        previous: Meeting,
        save: () => Promise<boolean> | undefined,
    ) => {
        const version = (editVersions.current.get(field) ?? 0) + 1;
        editVersions.current.set(field, version);
        const isLatest = () => editVersions.current.get(field) === version;

        let saved = false;
        try {
            saved = (await save()) === true;
        } catch (err) {
            console.error('[MeetingDetails] Failed to save the edit:', err);
        }
        if (!isLatest()) return;
        if (saved) {
            setSaveError(prev => (prev?.field === field ? null : prev));
            return;
        }

        let stored: Meeting | null = null;
        let reloadFailed = false;
        try {
            stored = (await window.electronAPI?.getMeetingDetails?.(meetingRef.current.id)) ?? null;
        } catch (err) {
            reloadFailed = true;
            console.error('[MeetingDetails] Failed to reload the meeting after a failed save:', err);
        }
        if (!isLatest()) return;
        const source = stored ?? previous;
        setMeeting(prev => restoreField(prev, source, field));
        setSaveError({ field, message: !stored && !reloadFailed
            ? 'This change could not be saved: the meeting no longer exists.'
            : 'This change could not be saved.' });
    };

    // Applies an edit to the latest state and saves it.
    const editField = (field: EditField, apply: (m: Meeting) => Meeting, save: (m: Meeting) => Promise<boolean> | undefined) => {
        const previous = meetingRef.current;
        const next = apply(previous);
        meetingRef.current = next;
        setMeeting(prev => apply(prev));
        return persistEdit(field, previous, () => save(next));
    };

    const handleTitleSave = (newTitle: string) => editField('title',
        (m) => ({ ...m, title: newTitle }),
        (m) => window.electronAPI?.updateMeetingTitle?.(m.id, newTitle));


    return (
        <div className="h-full w-full flex flex-col bg-bg-secondary text-text-secondary font-sans overflow-hidden">
            {/* Main Content */}
            <main className="flex-1 overflow-y-auto custom-scrollbar">
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.3 }}
                    className="max-w-4xl mx-auto px-8 py-8 pb-16"
                >
                    {/* Meta Info & Actions Row */}
                    <div className="flex items-start justify-between mb-6">
                        <div className="w-full pr-4">
                            {/* Date formatting could be improved to use meeting.date if it's an ISO string */}
                            <div className="text-xs text-text-tertiary font-medium mb-1">
                                {new Date(meeting.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                            </div>

                            {/* Editable Title */}
                            <EditableTextBlock
                                initialValue={meeting.title}
                                onSave={handleTitleSave}
                                tagName="h1"
                                className="text-3xl font-bold text-text-primary tracking-tight -ml-2 px-2 py-1 rounded-md transition-colors"
                                multiline={false}
                            />
                            {saveError && (
                                <div role="alert" className="mt-1 text-xs text-red-500">{saveError.message}</div>
                            )}
                        </div>

                        {/* Moved Actions: Follow-up & Share (REMOVED per user request) */}
                        {/* <div className="flex items-center gap-2 mt-1"> ... </div> */}
                    </div>

                    {/* Tabs */}
                    {/* Designing Tabs to match reference 1:1 (Dark Pill Container) */}
                    <div className="flex items-center justify-between mb-8">
                        <div className={`p-1 rounded-xl inline-flex items-center gap-0.5 ${isLight ? 'bg-[#E5E5EA] border border-black/[0.04]' : 'bg-[#121214] border border-white/[0.08]'}`}>
                            {['transcript', 'usage'].map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab as any)}
                                    className={`
                                        relative px-3 py-1 text-[13px] font-medium rounded-lg transition-all duration-200 z-10
                                        ${activeTab === tab ? (isLight ? 'text-black' : 'text-[#E9E9E9]') : `${isLight ? 'text-text-secondary' : 'text-text-tertiary'} hover:text-text-primary`}
                                    `}
                                >
                                    {activeTab === tab && (
                                        <motion.div
                                            layoutId="activeTabBackground"
                                            className={`absolute inset-0 rounded-lg -z-10 shadow-sm ${isLight ? 'bg-white' : 'bg-[#3A3A3C]'}`}
                                            initial={false}
                                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                                        />
                                    )}
                                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            ))}
                        </div>

                        {/* Copy Button - Inline with Tabs (Always visible) */}
                        <button
                            onClick={handleCopy}
                            className="flex items-center gap-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                        >
                            {isCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                            {isCopied ? 'Copied' : activeTab === 'transcript' ? 'Copy full transcript' : 'Copy usage'}
                        </button>
                    </div>

                    {/* Tab Content */}
                    <div className="space-y-8">
                        {/* Using standard divs for content, framer motion for layout */}
                        {activeTab === 'transcript' && (
                            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                <div className="space-y-6">
                                    {(() => {
                                        const filteredTranscript = meeting.transcript?.filter(entry => {
                                            const isHidden = ['system', 'ai', 'assistant', 'model'].includes(entry.speaker?.toLowerCase());
                                            return !isHidden;
                                        }) || [];

                                        if (filteredTranscript.length === 0) {
                                            return <p className="text-text-tertiary">No transcript available.</p>;
                                        }

                                        return filteredTranscript.map((entry, i) => (
                                            <div key={i} className="group">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-xs font-semibold text-text-secondary">
                                                        {entry.speaker === 'user' ? 'Me' : 'Them'}
                                                    </span>
                                                    <span className="text-xs text-text-tertiary font-mono">{entry.timestamp ? formatTime(entry.timestamp) : '0:00'}</span>
                                                </div>
                                                <p className="text-text-secondary text-[15px] leading-relaxed transition-colors select-text cursor-text">{entry.text}</p>
                                            </div>
                                        ));
                                    })()}
                                </div>
                            </motion.section>
                        )}

                        {activeTab === 'usage' && (
                            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8 pb-10">
                                {meeting.usage?.map((interaction, i) => (
                                    <div key={i} className="space-y-4">
                                        {/* User Question */}
                                        {interaction.question && (
                                            <div className="flex justify-end">
                                                <div className="bg-accent-primary text-white px-5 py-2.5 rounded-2xl rounded-tr-sm max-w-[80%] text-[15px] leading-relaxed shadow-sm">
                                                    {interaction.question}
                                                </div>
                                            </div>
                                        )}

                                        {/* AI Answer */}
                                        {interaction.generation && (
                                            <div className="text-xs text-text-tertiary" data-generation-status={interaction.generation.status}>
                                                {interaction.generation.provider} · {interaction.generation.model} · {interaction.generation.partial ? 'Incomplete · ' : ''}{interaction.generation.timeout ? `timeout:${interaction.generation.timeout}` : interaction.generation.status}
                                            </div>
                                        )}
                                        {interaction.answer && (
                                            <div className="flex items-start gap-4">
                                                <div className="mt-1 w-6 h-6 rounded-full bg-bg-input flex items-center justify-center border border-border-subtle shrink-0">
                                                    <img src={NativelyLogo} alt="AI" className="w-4 h-4 opacity-50 object-contain force-black-icon" />
                                                </div>
                                                <div>
                                                    <div className="text-[11px] text-text-tertiary mb-1.5 font-medium">{formatTime(interaction.timestamp)}</div>
                                                    <div className="text-text-secondary text-[15px] leading-relaxed max-w-none">
                                                        <ReactMarkdown
                                                            remarkPlugins={[remarkGfm]}
                                                            components={{
                                                                h1: ({ node, ...props }) => <p className="text-[15px] text-text-secondary font-normal leading-relaxed mb-2 whitespace-pre-wrap" {...props} />,
                                                                h2: ({ node, ...props }) => <p className="text-[15px] text-text-secondary font-normal leading-relaxed mb-2 whitespace-pre-wrap" {...props} />,
                                                                h3: ({ node, ...props }) => <p className="text-[15px] text-text-secondary font-normal leading-relaxed mb-2 whitespace-pre-wrap" {...props} />,
                                                                p: ({ node, ...props }) => <p className="text-[15px] text-text-secondary font-normal leading-relaxed mb-2 whitespace-pre-wrap" {...props} />,
                                                                ul: ({ node, ...props }) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                                                                ol: ({ node, ...props }) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                                                                li: ({ node, ...props }) => <li className="text-[15px] text-text-secondary font-normal" {...props} />,
                                                                strong: ({ node, ...props }) => <span className="font-normal text-text-secondary" {...props} />,
                                                                a: ({ node, ...props }: any) => <a className="text-blue-500 hover:underline" {...props} />,
                                                                pre: ({ children }: any) => <div className="not-prose mb-4">{children}</div>,
                                                                code: ({ node, inline, className, children, ...props }: any) => {
                                                                    const match = /language-(\w+)/.exec(className || '');
                                                                    const isInline = inline ?? false;
                                                                    const lang = match ? match[1] : '';

                                                                    return !isInline ? (
                                                                        <div className="my-3 rounded-xl overflow-hidden border border-white/[0.08] shadow-lg bg-zinc-800/60 backdrop-blur-md">
                                                                            <div className="bg-white/[0.04] px-3 py-1.5 border-b border-white/[0.08]">
                                                                                <span className="text-[10px] uppercase tracking-widest font-semibold text-white/40 font-mono">
                                                                                    {lang || 'CODE'}
                                                                                </span>
                                                                            </div>
                                                                            <div className="bg-transparent">
                                                                                <SyntaxHighlighter
                                                                                    language={lang || 'text'}
                                                                                    style={vscDarkPlus}
                                                                                    customStyle={{
                                                                                        margin: 0,
                                                                                        borderRadius: 0,
                                                                                        fontSize: '13px',
                                                                                        lineHeight: '1.6',
                                                                                        background: 'transparent',
                                                                                        padding: '16px',
                                                                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                                                                                    }}
                                                                                    wrapLongLines={true}
                                                                                    showLineNumbers={true}
                                                                                    lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: 'rgba(255,255,255,0.2)', textAlign: 'right', fontSize: '11px' }}
                                                                                    {...props}
                                                                                >
                                                                                    {String(children).replace(/\n$/, '')}
                                                                                </SyntaxHighlighter>
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <code className="bg-bg-tertiary px-1.5 py-0.5 rounded text-[13px] font-mono text-text-primary border border-border-subtle whitespace-pre-wrap" {...props}>
                                                                            {children}
                                                                        </code>
                                                                    );
                                                                }
                                                            }}
                                                        >
                                                            {cleanMarkdown(interaction.answer || '')}
                                                        </ReactMarkdown>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {!meeting.usage?.length && <p className="text-text-tertiary">No usage history.</p>}
                            </motion.section>
                        )}
                    </div>
                </motion.div>
            </main>
        </div>
    );
};

export default MeetingDetails;
