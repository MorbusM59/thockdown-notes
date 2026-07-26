export type EditorStyleKey =
  | 'syne'
  | 'redhat'
  | 'vt323'
  | 'victormono'
  | 'bytesized'
  | 'iosevkacharon'
  | 'kodemono'
  | 'xanhmono'
  | 'lekton'
  | 'novamono'
  | 'sharetech'
  | 'courierprime';

export type EditorRuntimeMetrics = {
  fontSizePx: number;
  lineHeightPx: number;
  glyphWidthPx: number;
  cellWidthPx: number;
};

export const DEFAULT_EDITOR_STYLE: EditorStyleKey = 'sharetech';

export const EDITOR_STYLE_OPTIONS: Array<{ key: EditorStyleKey; label: string; family: string }> = [
  { key: 'syne', label: 'Syne', family: "'Syne Mono', 'Menlo', 'Monaco', monospace" },
  { key: 'redhat', label: 'Red Hat', family: "'Red Hat Mono', 'Menlo', 'Monaco', monospace" },
  { key: 'vt323', label: 'VT323', family: "'VT323', 'Menlo', 'Monaco', monospace" },
  { key: 'victormono', label: 'Victor Mono', family: "'Victor Mono', 'Menlo', 'Monaco', monospace" },
  { key: 'bytesized', label: 'Bytesized', family: "'Bytesized', 'Menlo', 'Monaco', monospace" },
  { key: 'iosevkacharon', label: 'Iosevka Charon', family: "'Iosevka Charon Mono', 'Menlo', 'Monaco', monospace" },
  { key: 'kodemono', label: 'Kode Mono', family: "'Kode Mono', 'Menlo', 'Monaco', monospace" },
  { key: 'xanhmono', label: 'Xanh Mono', family: "'Xanh Mono', 'Menlo', 'Monaco', monospace" },
  { key: 'lekton', label: 'Lekton', family: "'Lekton', 'Menlo', 'Monaco', monospace" },
  { key: 'novamono', label: 'Nova Mono', family: "'Nova Mono', 'Menlo', 'Monaco', monospace" },
  { key: 'sharetech', label: 'Share Tech', family: "'Share Tech Mono', 'Menlo', 'Monaco', monospace" },
  { key: 'courierprime', label: 'Courier Prime', family: "'Courier Prime', 'Menlo', 'Monaco', monospace" },
];

export const EDITOR_FONT_SIZE_MIN_PX = 6;
export const EDITOR_FONT_SIZE_MAX_PX = 24;
export const EDITOR_FONT_SIZE_STEP_PX = 0.5;
export const DEFAULT_EDITOR_FONT_SIZE_PX = 16;

export const EDITOR_LINE_HEIGHT_MULTIPLIER_MIN = 0.8;
export const EDITOR_LINE_HEIGHT_MULTIPLIER_MAX = 3;
export const EDITOR_LINE_HEIGHT_MULTIPLIER_STEP = 0.05;
export const DEFAULT_EDITOR_LINE_HEIGHT_MULTIPLIER = 1.6;

export function roundEditorFontSizePx(value: number): number {
  // *2/2 rather than dividing by the 0.5 step: both are exact powers of two
  // in IEEE754, but this mirrors roundLineHeightMultiplier's shape.
  return Math.round(value * 2) / 2;
}

export function roundLineHeightMultiplier(value: number): number {
  // 1/0.05 = 20: multiplying by the clean integer first (rather than
  // dividing by 0.05, which isn't exactly representable) keeps this from
  // accumulating float noise like 1.6000000000000001.
  return Math.round(value * 20) / 20;
}

export const DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX = 1;
export const EDITOR_GLYPH_PADDING_MIN_PX = 0;
export const EDITOR_GLYPH_PADDING_MAX_PX = 4;
export const EDITOR_GLYPH_PADDING_STEP_PX = 0.5;
const MIN_EDITOR_GLYPH_SIDE_GAP_PX = 0;
const MAX_EDITOR_GLYPH_SIDE_GAP_PX = 4;

// Padding steps in 0.5px increments: 0.5 widens the box by 1px total
// (0.5px added to each side of the glyph).
export function roundEditorGlyphPaddingPx(value: number): number {
  return Math.round(value * 2) / 2;
}

// View/preview mode only -- plain CSS letter-spacing, no box-grid concept
// involved (unlike the editor's x-box padding).
export const VIEW_LETTER_SPACING_MIN_EM = 0;
export const VIEW_LETTER_SPACING_MAX_EM = 0.5;
export const VIEW_LETTER_SPACING_STEP_EM = 0.01;
export const DEFAULT_VIEW_LETTER_SPACING_EM = 0;

export function roundViewLetterSpacingEm(value: number): number {
  // 1/0.01 = 100: see roundLineHeightMultiplier's comment on why the clean
  // integer multiply comes first.
  return Math.round(value * 100) / 100;
}

// Ratio of a monospace glyph's advance width to its font size, e.g. 10px
// glyph width at 16px font size. Only used as a fallback when the canvas
// measurement below is unavailable -- close enough across the font list
// that a single ratio (rather than a per-size table) is fine here.
const FALLBACK_GLYPH_WIDTH_RATIO = 0.625;

const FONT_FAMILY_BY_STYLE: Record<EditorStyleKey, string> = {
  syne: "'Syne Mono', 'Menlo', 'Monaco', monospace",
  redhat: "'Red Hat Mono', 'Menlo', 'Monaco', monospace",
  vt323: "'VT323', 'Menlo', 'Monaco', monospace",
  victormono: "'Victor Mono', 'Menlo', 'Monaco', monospace",
  bytesized: "'Bytesized', 'Menlo', 'Monaco', monospace",
  iosevkacharon: "'Iosevka Charon Mono', 'Menlo', 'Monaco', monospace",
  kodemono: "'Kode Mono', 'Menlo', 'Monaco', monospace",
  xanhmono: "'Xanh Mono', 'Menlo', 'Monaco', monospace",
  lekton: "'Lekton', 'Menlo', 'Monaco', monospace",
  novamono: "'Nova Mono', 'Menlo', 'Monaco', monospace",
  sharetech: "'Share Tech Mono', 'Menlo', 'Monaco', monospace",
  courierprime: "'Courier Prime', 'Menlo', 'Monaco', monospace",
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
  fontSizePxInput: number = DEFAULT_EDITOR_FONT_SIZE_PX,
  lineHeightMultiplierInput: number = DEFAULT_EDITOR_LINE_HEIGHT_MULTIPLIER,
  glyphSideGapPx: number = DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX,
): EditorRuntimeMetrics {
  const fontSizePx = Math.max(
    EDITOR_FONT_SIZE_MIN_PX,
    Math.min(EDITOR_FONT_SIZE_MAX_PX, roundEditorFontSizePx(fontSizePxInput)),
  );
  const spacingMultiplier = Math.max(
    EDITOR_LINE_HEIGHT_MULTIPLIER_MIN,
    Math.min(EDITOR_LINE_HEIGHT_MULTIPLIER_MAX, roundLineHeightMultiplier(lineHeightMultiplierInput)),
  );
  const lineHeightPx = Math.max(1, Math.round(fontSizePx * spacingMultiplier));
  const safeGlyphSideGapPx = Math.max(
    MIN_EDITOR_GLYPH_SIDE_GAP_PX,
    Math.min(MAX_EDITOR_GLYPH_SIDE_GAP_PX, roundEditorGlyphPaddingPx(glyphSideGapPx)),
  );
  const fallbackGlyphWidthPx = Math.max(1, fontSizePx * FALLBACK_GLYPH_WIDTH_RATIO);
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
