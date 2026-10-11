export interface TranscriptDisplayPayload {
  speaker: string;
  text: string;
  timestamp: number;
  final: boolean;
  confidence?: number;
}

export class TranscriptDisplayThrottle {
  private readonly queued = new Map<string, TranscriptDisplayPayload>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private readonly emit: (payload: TranscriptDisplayPayload) => void) {}

  send(payload: TranscriptDisplayPayload): void {
    const speaker = payload.speaker;
    if (payload.final) {
      this.drop(speaker);
      this.emit(payload);
    } else {
      this.queued.set(speaker, payload);
      if (!this.timers.has(speaker)) {
        this.timers.set(speaker, setTimeout(() => {
          const latest = this.queued.get(speaker);
          this.drop(speaker);
          if (latest) this.emit(latest);
        }, 100));
      }
    }
  }

  private drop(speaker: string): void {
    const timer = this.timers.get(speaker);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(speaker);
    this.queued.delete(speaker);
  }

  clear(): void {
    for (const speaker of this.timers.keys()) this.drop(speaker);
  }
}
