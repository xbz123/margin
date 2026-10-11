/** A terminal answer is sealed even if a queued event still carries its matching ID. */
export function matchesDirectAssistAnswer(activeId: string | null, sealed: boolean, eventId: unknown): boolean {
  return !sealed && activeId !== null && eventId === activeId;
}
