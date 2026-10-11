export type MeetingLifecycleState = 'idle' | 'starting' | 'active' | 'stopping' | 'failed';

// Adjacent duplicate intents join; an intervening opposite intent keeps its place in the queue.
export class MeetingLifecycleQueue {
  private tail: Promise<void> = Promise.resolve();
  private last: { active: boolean; done: Promise<void> } | null = null;
  private active = false;
  private state: MeetingLifecycleState = 'idle';

  getState(): MeetingLifecycleState { return this.state; }
  start(run: () => Promise<void>): Promise<void> { return this.request(true, run); }
  stop(run: () => Promise<void>): Promise<void> { return this.request(false, run); }

  private request(active: boolean, run: () => Promise<void>): Promise<void> {
    if (this.last?.active === active) return this.last.done;
    const done = this.tail.then(async () => {
      if (this.active === active && this.state !== 'failed') return;
      this.state = active ? 'starting' : 'stopping';
      try {
        await run();
        this.active = active;
        this.state = active ? 'active' : 'idle';
      } catch (error) {
        this.state = 'failed';
        throw error;
      }
    });
    const intent = { active, done };
    this.last = intent;
    this.tail = done.catch(() => {});
    void this.tail.then(() => { if (this.last === intent) this.last = null; });
    return done;
  }
}
