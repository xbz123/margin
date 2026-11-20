export interface TextFlowTarget {
  text(line: string, x: number, y: number): unknown;
  addPage(): unknown;
}

export function flowLines(
  doc: TextFlowTarget,
  lines: string | readonly string[],
  layout: { x: number; y: number; lineHeight: number; top: number; bottom: number },
): number;
