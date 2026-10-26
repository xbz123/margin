import { DEFAULT_WRITTEN_EXAM, validExamSettings, type WrittenExamSettings, type WrittenExamStatus } from '../../src/types/writtenExam';

/** Main-process timer: no renderer-background throttling, no overlapping capture,
 * no queued dispatch after pause. A delivered frame needs an acknowledgement. */
export class WrittenExamSession<T> {
  private settings: WrittenExamSettings;
  private running = false;
  private generation = 0;
  private error = '';
  private timer?: ReturnType<typeof setInterval>;
  private capturing = false;
  private pendingAt = 0;
  private pendingGeneration?: number;
  private pendingFrame?: T;
  private lastFingerprint = '';
  constructor(settings: WrittenExamSettings, private io: {
    capture: () => Promise<T>;
    fingerprint: (frame: T) => string;
    deliver: (frame: T, generation: number) => void;
    busy: () => boolean;
    changed: (status: WrittenExamStatus) => void;
    cancel: () => void;
    discard?: (frame: T) => void | Promise<void>;
    now?: () => number;
  }) { this.settings = validExamSettings(settings) ? { ...settings } : { ...DEFAULT_WRITTEN_EXAM }; }
  status(): WrittenExamStatus { return { ...this.settings, hideScreenshots: this.settings.hideScreenshots ?? true, running: this.running, generation: this.generation, error: this.error }; }
  configure(settings: WrittenExamSettings) { if (!validExamSettings(settings)) throw new Error('Invalid written exam settings'); this.stop(); this.settings = { ...settings, hideScreenshots: settings.hideScreenshots ?? this.settings.hideScreenshots ?? true }; this.io.changed(this.status()); }
  start() {
    if (!this.settings.enabled) throw new Error('Enable written exam mode first.');
    if (this.running) return;
    this.running = true; this.error = ''; this.generation++; this.lastFingerprint = '';
    this.timer = setInterval(() => void this.tick(), this.settings.intervalSeconds * 1000);
    this.timer.unref?.(); this.io.changed(this.status());
  }
  stop(error = '') {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined; this.running = false; this.generation++; this.pendingGeneration = undefined;
    const pendingFrame = this.pendingFrame;
    this.pendingFrame = undefined;
    if (pendingFrame) void this.discard(pendingFrame);
    this.error = error; this.io.cancel(); this.io.changed(this.status());
  }
  accept(generation: number) {
    if (!this.running || generation !== this.generation || this.pendingGeneration !== generation) return false;
    this.pendingGeneration = undefined; this.pendingFrame = undefined; return true;
  }
  skip(generation: number) {
    const frame = this.pendingFrame;
    if (!this.accept(generation)) return;
    this.lastFingerprint = '';
    if (frame) void this.discard(frame);
  }
  private async discard(frame: T) {
    try { await this.io.discard?.(frame); }
    catch { this.stop('Temporary screenshot cleanup failed. Automatic capture paused.'); }
  }
  async tick() {
    if (!this.running || this.capturing) return;
    const now = this.io.now?.() ?? Date.now();
    if (this.pendingGeneration !== undefined) {
      if (now - this.pendingAt >= 30000) this.stop('The answer window did not respond. Automatic capture paused.');
      return;
    }
    if (this.io.busy()) return;
    this.capturing = true;
    const generation = ++this.generation;
    let frame: T | undefined;
    let delivered = false;
    try {
      frame = await this.io.capture();
      if (!this.running || generation !== this.generation || this.io.busy()) return;
      const fingerprint = this.io.fingerprint(frame);
      if (fingerprint === this.lastFingerprint) return;
      this.lastFingerprint = fingerprint;
      this.pendingGeneration = generation; this.pendingAt = now;
      this.pendingFrame = frame;
      this.io.deliver(frame, generation);
      delivered = true;
    } catch {
      if (this.pendingFrame === frame) this.pendingFrame = undefined;
      if (this.running && generation === this.generation) this.stop('Screen capture failed. Automatic capture paused; try a manual screenshot to check capture access.');
    } finally {
      try {
        if (frame && !delivered) {
          if (this.pendingFrame === frame) this.pendingFrame = undefined;
          await this.discard(frame);
        }
      } finally { this.capturing = false; }
    }
  }
}
