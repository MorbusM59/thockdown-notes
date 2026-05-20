import type { EditorSelectionState, EditorViewportState } from './EditorContract';

export function validateTextInvariants(text: string): string[] {
  const issues: string[] = [];
  if (text.includes('\r')) {
    issues.push('Text contains carriage returns; expected normalized LF newlines only.');
  }
  return issues;
}

export function validateSelectionInvariants(text: string, selection: EditorSelectionState): string[] {
  const issues: string[] = [];
  const max = Math.max(0, text.length);

  if (selection.anchor < 0 || selection.anchor > max) {
    issues.push(`Selection anchor ${selection.anchor} out of bounds 0..${max}.`);
  }
  if (selection.focus < 0 || selection.focus > max) {
    issues.push(`Selection focus ${selection.focus} out of bounds 0..${max}.`);
  }
  if (selection.start < 0 || selection.start > max) {
    issues.push(`Selection start ${selection.start} out of bounds 0..${max}.`);
  }
  if (selection.end < 0 || selection.end > max) {
    issues.push(`Selection end ${selection.end} out of bounds 0..${max}.`);
  }
  if (selection.start > selection.end) {
    issues.push(`Selection start ${selection.start} is greater than end ${selection.end}.`);
  }
  if (selection.isCollapsed && selection.start !== selection.end) {
    issues.push('Selection marked collapsed but start/end differ.');
  }

  return issues;
}

export function validateViewportInvariants(viewport: EditorViewportState): string[] {
  const issues: string[] = [];
  const line = viewport.lineHeightPx;

  if (line <= 0) {
    issues.push(`Viewport lineHeightPx must be positive; got ${line}.`);
    return issues;
  }

  if (viewport.cellWidthPx <= 0) {
    issues.push(`Viewport cellWidthPx must be positive; got ${viewport.cellWidthPx}.`);
  }
  if (viewport.topBoundaryPx < 0) {
    issues.push(`Viewport topBoundaryPx must be >= 0; got ${viewport.topBoundaryPx}.`);
  }
  if (viewport.bottomBoundaryPx < 0) {
    issues.push(`Viewport bottomBoundaryPx must be >= 0; got ${viewport.bottomBoundaryPx}.`);
  }
  if (viewport.scrollTopPx < 0) {
    issues.push(`Viewport scrollTopPx must be >= 0; got ${viewport.scrollTopPx}.`);
  }

  if (viewport.topBoundaryPx % line !== 0) {
    issues.push(`topBoundaryPx ${viewport.topBoundaryPx} is not quantized to lineHeightPx ${line}.`);
  }
  if (viewport.bottomBoundaryPx % line !== 0) {
    issues.push(`bottomBoundaryPx ${viewport.bottomBoundaryPx} is not quantized to lineHeightPx ${line}.`);
  }

  return issues;
}
