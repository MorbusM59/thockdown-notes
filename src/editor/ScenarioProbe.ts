export interface CaretGeometry {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function readCaretGeometry(): CaretGeometry | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  if (rect.width === 0 && rect.height === 0) {
    const anchorNode = selection.anchorNode;
    const element = anchorNode?.nodeType === Node.ELEMENT_NODE
      ? (anchorNode as Element)
      : anchorNode?.parentElement;
    if (!element) return null;
    const fallback = element.getBoundingClientRect();
    return {
      top: fallback.top,
      bottom: fallback.bottom,
      left: fallback.left,
      right: fallback.right,
    };
  }

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
