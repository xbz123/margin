import { useEffect, useRef, useState } from 'react';
import type { WrittenExamSettings, WrittenExamStatus } from '../types/writtenExam';

export function useWrittenExam() {
  const [status, setStatus] = useState<WrittenExamStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    let mounted = true;
    const at = revision.current;
    const unsubscribe = window.electronAPI.onWrittenExamStatus?.(next => {
      revision.current++;
      if (mounted) setStatus(next);
    });
    window.electronAPI.getWrittenExam?.().then(next => {
      if (mounted && revision.current === at) setStatus(next);
    }).catch(() => { if (mounted) setError('Written exam settings are unavailable.'); });
    return () => { mounted = false; unsubscribe?.(); };
  }, []);
  async function run(action: () => Promise<WrittenExamStatus>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    const at = revision.current;
    try {
      const next = await action();
      if (revision.current === at) setStatus(next);
    } catch (cause) {
      // Only these local settings methods return messages here, never provider bodies.
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Written exam settings are unavailable.');
    } finally { busyRef.current = false; setBusy(false); }
  }
  const save = (update: Partial<WrittenExamSettings>) => status && run(() => window.electronAPI.saveWrittenExam(update));
  return { status, error, busy, save, setRunning: (running: boolean) => run(() => window.electronAPI.setWrittenExamRunning(running)) };
}
