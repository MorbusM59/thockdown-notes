export type EditorStyleKey = 'syne' | 'redhat';
export type EditorFontSizeKey = 'xs' | 's' | 'm' | 'l' | 'xl';
export type EditorSpacingKey = 'tight' | 'compact' | 'cozy' | 'wide';

export type EditorRuntimeMetrics = {
  fontSizePx: number;
  lineHeightPx: number;
  glyphWidthPx: number;
  cellWidthPx: number;
};

export const DEFAULT_EDITOR_STYLE: EditorStyleKey = 'syne';
export const DEFAULT_EDITOR_FONT_SIZE: EditorFontSizeKey = 'm';
export const DEFAULT_EDITOR_SPACING: EditorSpacingKey = 'cozy';

export const EDITOR_STYLE_OPTIONS: Array<{ key: EditorStyleKey; label: string; family: string }> = [
  { key: 'syne', label: 'Syne', family: "'Syne Mono', 'Menlo', 'Monaco', monospace" },
  { key: 'redhat', label: 'Red Hat', family: "'Red Hat Mono', 'Menlo', 'Monaco', monospace" },
];

export const EDITOR_FONT_SIZE_OPTIONS: Array<{ key: EditorFontSizeKey; label: string; px: number }> = [
  { key: 'xs', label: 'XS', px: 12 },
  { key: 's', label: 'S', px: 14 },
  { key: 'm', label: 'M', px: 16 },
  { key: 'l', label: 'L', px: 18 },
  { key: 'xl', label: 'XL', px: 20 },
];

export const EDITOR_SPACING_OPTIONS: Array<{ key: EditorSpacingKey; label: string; multiplier: number }> = [
  { key: 'tight', label: 'Tight', multiplier: 1.2 },
  { key: 'compact', label: 'Compact', multiplier: 1.4 },
  { key: 'cozy', label: 'Cozy', multiplier: 1.6 },
  { key: 'wide', label: 'Wide', multiplier: 1.8 },
];

export const DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX = 1;
const MIN_EDITOR_GLYPH_SIDE_GAP_PX = 0;
const MAX_EDITOR_GLYPH_SIDE_GAP_PX = 1;

const FONT_SIZE_PX_BY_KEY: Record<EditorFontSizeKey, number> = {
  xs: 12,
  s: 14,
  m: 16,
  l: 18,
  xl: 20,
};

const SPACING_MULTIPLIER_BY_KEY: Record<EditorSpacingKey, number> = {
  tight: 1.2,
  compact: 1.4,
  cozy: 1.6,
  wide: 1.8,
};

const FALLBACK_CELL_WIDTH_PX_BY_SIZE: Record<EditorFontSizeKey, number> = {
  xs: 8,
  s: 9,
  m: 10,
  l: 11,
  xl: 13,
};

const FONT_FAMILY_BY_STYLE: Record<EditorStyleKey, string> = {
  syne: "'Syne Mono', 'Menlo', 'Monaco', monospace",
  redhat: "'Red Hat Mono', 'Menlo', 'Monaco', monospace",
};

export function resolveEditorFontFamily(style: EditorStyleKey): string {
  return FONT_FAMILY_BY_STYLE[style] ?? FONT_FAMILY_BY_STYLE[DEFAULT_EDITOR_STYLE];
}

let glyphMeasureContext: CanvasRenderingContext2D | null | undefined;

function getGlyphMeasureContext(): CanvasRenderingContext2D | null {
  if (glyphMeasureContext !== undefined) {
    return glyphMeasureContext;
  }

  if (typeof document === 'undefined') {
    glyphMeasureContext = null;
    return glyphMeasureContext;
  }

  const canvas = document.createElement('canvas');
  glyphMeasureContext = canvas.getContext('2d');
  return glyphMeasureContext;
}

function measureMonospaceGlyphWidthPx(fontFamily: string, fontSizePx: number): number | null {
  const context = getGlyphMeasureContext();
  if (!context) return null;

  context.font = `400 ${fontSizePx}px ${fontFamily}`;
  const width = context.measureText('0').width;
  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }

  return width;
}

export function resolveEditorRuntimeMetrics(
  style: EditorStyleKey,
  fontSize: EditorFontSizeKey,
  spacing: EditorSpacingKey,
  glyphSideGapPx: number = DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX,
): EditorRuntimeMetrics {
  const fontSizePx = FONT_SIZE_PX_BY_KEY[fontSize] ?? FONT_SIZE_PX_BY_KEY[DEFAULT_EDITOR_FONT_SIZE];
  const spacingMultiplier = SPACING_MULTIPLIER_BY_KEY[spacing] ?? SPACING_MULTIPLIER_BY_KEY[DEFAULT_EDITOR_SPACING];
  const lineHeightPx = Math.max(1, Math.round(fontSizePx * spacingMultiplier));
  const safeGlyphSideGapPx = Math.max(
    MIN_EDITOR_GLYPH_SIDE_GAP_PX,
    Math.min(MAX_EDITOR_GLYPH_SIDE_GAP_PX, Math.round(glyphSideGapPx)),
  );
  const fallbackCellWidthPx =
    FALLBACK_CELL_WIDTH_PX_BY_SIZE[fontSize] ?? FALLBACK_CELL_WIDTH_PX_BY_SIZE[DEFAULT_EDITOR_FONT_SIZE];
  const fallbackGlyphWidthPx = Math.max(1, fallbackCellWidthPx - (safeGlyphSideGapPx * 2));
  const fontFamily = resolveEditorFontFamily(style);
  const measuredGlyphWidthPx = measureMonospaceGlyphWidthPx(fontFamily, fontSizePx);
  const glyphWidthPx = Math.max(1, measuredGlyphWidthPx ?? fallbackGlyphWidthPx);
  const cellWidthPx = Math.max(1, glyphWidthPx + (safeGlyphSideGapPx * 2));

  return {
    fontSizePx,
    lineHeightPx,
    glyphWidthPx,
    cellWidthPx,
  };
}
