/** Call only after committing answer text, never from the token/IPC receipt itself. */
export function hasVisibleAnswer(node: HTMLElement | null): boolean {
  if (!node?.isConnected || !node.textContent?.trim() || !node.getClientRects().length) return false;
  for (let current: HTMLElement | null = node; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  }
  return true;
}
