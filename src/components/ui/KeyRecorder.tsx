import React, { useState, useEffect, useRef } from 'react';
import { X, Check } from 'lucide-react';
import { useI18n } from '../../i18n';
import { eventToKeys } from '../../utils/keyboardUtils';

interface KeyRecorderProps {
    currentKeys: string[];
    onSave: (keys: string[]) => void;
    className?: string;
}

export const KeyRecorder: React.FC<KeyRecorderProps> = ({ currentKeys, onSave, className }) => {
    const { t } = useI18n();
    const [isRecording, setIsRecording] = useState(false);
    const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
    const [notice, setNotice] = useState('');
    const inputRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isRecording && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isRecording]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isRecording) return;
        e.preventDefault();
        e.stopPropagation();

        const recorded = eventToKeys(e);
        if ('rejected' in recorded) {
            setRecordedKeys([]);
            setIsRecording(false);
            setNotice(t('Windows key shortcuts are reserved by Windows'));
        } else if (recorded.complete) {
            setRecordedKeys(recorded.keys);
            setIsRecording(false);
            onSave(recorded.keys);
        } else {
            // Just modifiers pressed so far
            setRecordedKeys(recorded.keys);
        }
    };

    return (
        <div
            className={`relative flex items-center gap-1.5 group ${className || ''}`}
            onClick={() => { setNotice(''); setIsRecording(true); }}
        >
            {isRecording ? (
                <div
                    ref={inputRef}
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                    onBlur={() => setIsRecording(false)}
                    className="flex items-center gap-1 bg-bg-input border border-accent-primary text-accent-primary px-2 py-1 rounded-md text-xs font-sans shadow-sm outline-none min-w-[60px] justify-center"
                >
                    {recordedKeys.length > 0 ? recordedKeys.join(' + ') : t('Press keys...')}
                </div>
            ) : (
                <div className="flex items-center gap-1">
                    {currentKeys.map((k, i) => {
                        let displayKey = k;
                        if (k === 'ArrowUp') displayKey = '↑';
                        else if (k === 'ArrowDown') displayKey = '↓';
                        else if (k === 'ArrowLeft') displayKey = '←';
                        else if (k === 'ArrowRight') displayKey = '→';

                        return (
                            <span key={i} className="bg-bg-input text-text-secondary h-6 min-w-[26px] px-1.5 rounded-md text-xs font-sans flex items-center justify-center shadow-sm border border-border-subtle group-hover:border-text-tertiary transition-colors">
                                {displayKey}
                            </span>
                        );
                    })}
                    {notice && <span role="status" className="text-xs text-text-tertiary">{notice}</span>}
                </div>
            )}
        </div>
    );
};
