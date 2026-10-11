type Events = {
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
};

interface OsEventDependencies {
  powerMonitor?: Events;
  screen?: Events;
  restartCapturesAfterResume(): Promise<unknown>;
  suspendCaptures(): Promise<unknown>;
  revalidateShortcuts(): void;
}

// Register only after Electron is ready; disposal removes exactly these listeners.
export function registerOsEventSubscriptions(deps: OsEventDependencies): () => void {
  const subscriptions: Array<[Events, string, () => void]> = [];
  const add = (source: Events | undefined, event: string, action: () => unknown) => {
    if (!source) return;
    const listener = () => {
      try {
        const result = action();
        void Promise.resolve(result).catch(() => console.error('[Audio] System event failed:', event));
      } catch { console.error('[Audio] System event failed:', event); }
    };
    source.on(event, listener);
    subscriptions.push([source, event, listener]);
  };
  add(deps.powerMonitor, 'suspend', () => deps.suspendCaptures());
  add(deps.powerMonitor, 'resume', () => deps.restartCapturesAfterResume());
  add(deps.powerMonitor, 'resume', () => deps.revalidateShortcuts());
  add(deps.powerMonitor, 'unlock-screen', () => deps.revalidateShortcuts());
  add(deps.screen, 'display-added', () => deps.revalidateShortcuts());
  add(deps.screen, 'display-removed', () => deps.revalidateShortcuts());
  add(deps.screen, 'display-metrics-changed', () => deps.revalidateShortcuts());
  return () => {
    for (const [source, event, listener] of subscriptions.splice(0)) source.removeListener(event, listener);
  };
}
