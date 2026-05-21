import { readSelectionRect } from './CaretRect';

export interface CaretGeometry {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function readCaretGeometry(): CaretGeometry | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const rect = readSelectionRect(selection, 24);
  if (!rect) return null;

  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
  };
}

export function logScenarioProbe(name: string, payload: Record<string, unknown>, enabled: boolean): void {
  if (!enabled) return;
  // Keep this machine-readable for quick grep in devtools output.
  console.log(`[scenario-probe:${name}]`, payload);
}
