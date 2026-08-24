import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { SidebarOptionsPanel } from './sidebar/SidebarOptionsPanel'
import { AudioControls } from './components/AudioControls'
import MouseCursorOverlay from './components/MouseCursorOverlay'
import { TooltipLayer } from './components/TooltipLayer'
import { useWindowDragRegion } from './window/useWindowDragRegion'
import './App.css'
import { buildExportCss, type ExportViewStyle } from './exportStyles'
import {
  DEFAULT_TYPING_SOUND_SET,
  typingSoundManager,
} from './sound/TypingSoundManager'
import type { PersistedMenuState, PersistedSidebarViewState, PersistedViewportState } from './shared/appState'
import {
  DEFAULT_GLAZE_SETTINGS,
  GLAZE_GLOOM_OPACITY_MAX,
  GLAZE_LINEAR_OPACITY_MAX,
  GLAZE_RADIAL_OPACITY_MAX,
  GLAZE_SHEEN_OPACITY_MAX,
  sanitizeGlazeSettings,
  type GlazeSettings,
} from './shared/glaze'
import type { UiLayoutLoadout, UiLoadoutEntry, UiLoadoutMode } from './shared/loadouts'
import {
  idKind,
  idMode,
  modeSign,
  LOADOUT_DEFAULT_CUSTOM_ID_ABS,
  LOADOUT_FACTORY_PRESET_COUNT,
} from './shared/loadouts'
import type { NoteSummary } from './shared/noteLifecycle'
import { isArchivedNote, isChapterOnlyNote, isDeletedNote, isExternalNote, isSameNoteSummary } from './shared/noteLifecycle'
import { getNoteListMetaKind } from './shared/noteListMeta'
import { resolveIdentityLabel } from './shared/tabLabels'
import { NOTE_DRAG_MIME_TYPE, serializeNoteDragPayload } from './shared/noteDrag'
import {
  type RgbaColor,
  type HsvaColor,
  parseCssColorToRgba,
  rgbaToCssColor,
  rgbaToHex,
  invertRgbaColor,
  rgbaToHsva,
  hsvaToRgba,
  scaleAlphaInCssValue,
} from './shared/colorMath'
import type { HighlightColorKey, HighlightColors } from './shared/highlightColors'
import {
  type CustomCursorSettings,
  DEFAULT_CUSTOM_CURSOR_SETTINGS,
  CURSOR_DOT_COUNT_MIN,
  CURSOR_DOT_COUNT_MAX,
  CURSOR_RADIUS_MIN_PX,
  CURSOR_RADIUS_MAX_PX,
  CURSOR_SPIN_HZ_MIN,
  CURSOR_SPIN_HZ_MAX,
  CURSOR_TRAIL_THICKNESS_MIN_PX,
  CURSOR_TRAIL_THICKNESS_MAX_PX,
  CURSOR_TRAIL_FADE_MIN_MS,
  CURSOR_TRAIL_FADE_MAX_MS,
  CURSOR_DOT_SIZE_MIN_PX,
  CURSOR_DOT_SIZE_MAX_PX,
  CURSOR_CENTER_SIZE_MIN_PX,
  CURSOR_CENTER_SIZE_MAX_PX,
  CURSOR_HALO_RADIUS_MIN_PX,
  CURSOR_HALO_RADIUS_MAX_PX,
  CURSOR_HALO_FALLOFF_MIN,
  CURSOR_HALO_FALLOFF_MAX,
  CURSOR_PULSE_MAGNITUDE_MIN,
  CURSOR_PULSE_MAGNITUDE_MAX,
  CURSOR_PULSE_HZ_MIN,
  CURSOR_PULSE_HZ_MAX,
  CURSOR_CLICK_RAMP_MIN,
  CURSOR_CLICK_RAMP_MAX,
  CURSOR_CLICK_SKEW_MIN,
  CURSOR_CLICK_SKEW_MAX,
  CURSOR_CLICK_SPEED_X_MIN,
  CURSOR_CLICK_SPEED_X_MAX,
  CURSOR_CLICK_MAX_SPEED_MIN,
  CURSOR_CLICK_MAX_SPEED_MAX,
  CURSOR_CLICK_MIN_HOLD_MIN_MS,
  CURSOR_CLICK_MIN_HOLD_MAX_MS,
  CURSOR_CLICK_BALANCE_MIN,
  CURSOR_CLICK_BALANCE_MAX,
} from './shared/cursorSettings'
import {
  BORDER_RADIUS_REGULAR_MIN_PX,
  BORDER_RADIUS_REGULAR_MAX_PX,
  SPACING_REGULAR_MIN_PX,
  SPACING_REGULAR_MAX_PX,
  BORDER_ALPHA_PERCENT_MIN,
  BORDER_ALPHA_PERCENT_MAX,
  BOX_SHADOW_ALPHA_PERCENT_MIN,
  BOX_SHADOW_ALPHA_PERCENT_MAX,
} from './shared/uiBounds'
import { BORDER_ALPHA_TOKENS, BOX_SHADOW_ALPHA_TOKENS } from './shared/borderShadowAlphaTokens'
import { DEBUG_TAG_NAME, PROTECTED_TAGS, normalizeTagName } from './shared/tags'
import { EditorSection } from './editorSection/EditorSection'
import { SAVE_DEBOUNCE_MS } from './editorSection/useNoteSaveQueue'
import { EditorToolbar } from './toolbar/EditorToolbar'
import { DEFAULT_EDITOR_SECTION_ID, type EditorSectionEntry } from './shared/sections'
import { computeSectionWidthsForCloseFlexAware, computeSectionWidthsForNewSectionFlexAware, computeSlotWidthsPx, type SectionWidthPx } from './shared/sectionWidths'
import type { TextureCacheRequest } from './shared/textures'
import {
  DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX,
  DEFAULT_EDITOR_FONT_SIZE_PX,
  DEFAULT_EDITOR_LINE_HEIGHT_MULTIPLIER,
  DEFAULT_EDITOR_STYLE,
  EDITOR_GLYPH_PADDING_MIN_PX,
  EDITOR_GLYPH_PADDING_MAX_PX,
  EDITOR_FONT_SIZE_MIN_PX,
  EDITOR_FONT_SIZE_MAX_PX,
  EDITOR_LINE_HEIGHT_MULTIPLIER_MIN,
  EDITOR_LINE_HEIGHT_MULTIPLIER_MAX,
  VIEW_LETTER_SPACING_MIN_EM,
  VIEW_LETTER_SPACING_MAX_EM,
  DEFAULT_VIEW_LETTER_SPACING_EM,
  roundEditorGlyphPaddingPx,
  roundEditorFontSizePx,
  roundLineHeightMultiplier,
  roundViewLetterSpacingEm,
  resolveEditorFontFamily,
  resolveEditorRuntimeMetrics,
  type EditorStyleKey,
} from './editor/EditorTypography'
import {
  DEFAULT_UI_FONT_KEY,
  DEFAULT_UI_FONT_SCALE,
  UI_FONT_SCALE_MIN,
  UI_FONT_SCALE_MAX,
  roundUiFontScale,
  resolveUiFontFamily,
  type UiFontKey,
} from './shared/UiTypography'
import { getActiveSectionHandle, type SectionHandle } from './editorSection/sectionRegistry'
import { type TextDecorationFormat } from './editorSection/useMarkdownFormattingToolbar'
import {
  createPreviewMarkdownComponents,
  PREVIEW_MARKDOWN_REMARK_PLUGINS,
  PREVIEW_MARKDOWN_NOOP_NAVIGATE,
} from './editor/PreviewMarkdown'
import { normalizeInternalText } from './editor/TextPolicy'
import { truncateTitle } from './shared/textSanitization'
import { deriveNoteTitleFromText, deriveNoteTitleIncremental, type NoteTitleCache } from './shared/noteTitle'
import { isNoteSearchQueryActive, matchesNoteSearchQuery } from './shared/noteSearch'
import { ESCAPE_HOLD_MS } from './shared/escapeHold'
import { HELP_GUIDE_NOTE_IDS, HELP_GUIDE_ROOT_ID } from './shared/helpGuide'
import {
  deriveRenderScrollDynamicFromResponsiveness,
  deriveRenderScrollResponsivenessFromDynamic,
  getRenderScrollDynamic,
  getRenderScrollResponsiveness,
  getRenderScrollTotalTimeSec,
  getRenderScrollMaxSpeedPxPerSec,
  getRenderScrollSkew,
  setRenderScrollDynamic as applyRenderScrollDynamic,
  setRenderScrollTotalTimeSec as applyRenderScrollTotalTimeSec,
  setRenderScrollMaxSpeedPxPerSec as applyRenderScrollMaxSpeedPxPerSec,
  setRenderScrollSkew as applyRenderScrollSkew,
  scrollToNonQuantizedSmooth,
} from './editor/NonQuantizedSmoothScroll'
import {
  FILTER_MONTHS,
  FILTER_YEARS,
  handleMultiSelect,
} from './shared/filterConstants'
import {
  DEFAULT_TEXTURE_MATERIALS,
  type TextureMaterialSettings,
  type TextureMaterialsBySurface,
  type TextureSurfaceKey,
  TEXTURE_GRANULARITY_MIN,
  TEXTURE_GRANULARITY_MAX,
  TEXTURE_VSTEPS_MIN,
  TEXTURE_VSTEPS_MAX,
} from './textures/types'
import { TEXTURE_ALGORITHM_VERSION, TEXTURE_REPEAT_TILE_SIZE, useTextureSurface } from './textures/useTextureSurface'

const NEW_NOTE_TEMPLATE = '# '
const FALLBACK_NEW_NOTE_TITLE = 'Untitled'
const GRID_DIVIDER_PX = 8
// Sidebar width is derived (see sidebarWidthPx below), not a flat constant --
// it has to fit the options panel's always-visible top section (font
// settings + preset buttons), which is a 6-column grid of
// --btn-square-regular-size buttons whose gaps scale with the user's spacing
// setting. These mirror the CSS tokens of the same shape
// (--btn-square-regular-size, --canonical-scroll-thickness feeding
// --sidebar-scrollbar-slot-width, and .sidebar-content's own border) so the
// two stay in sync.
const BTN_SQUARE_REGULAR_SIZE_PX = 32
const BTN_SQUARE_LARGE_SIZE_PX = 40
const CANONICAL_SCROLL_THICKNESS_PX = 16
const SIDEBAR_CONTENT_BORDER_PX = 1
// .toolbar-container / .display-modes each carry a 1px border on both sides
// (toolbar.css) -- part of the toolbar column's content floor below.
const TOOLBAR_CONTAINER_BORDER_PX = 2
const DISPLAY_MODES_BORDER_PX = 2
// Mirrors --note-list-row-content-height and --btn-square-mini-size
// (tokens.css), plus how many Date-view cards the window's minimum height is
// meant to leave room for -- see appShellMinHeightPx. The mini control height
// covers both the date-filter chips and the pagination bar's buttons.
const NOTE_LIST_ROW_CONTENT_HEIGHT_PX = BTN_SQUARE_REGULAR_SIZE_PX
const SIDEBAR_MINI_CONTROL_HEIGHT_PX = 20
const SIDEBAR_MIN_VISIBLE_NOTE_CARDS = 4
// Chrome lays out in 1/64px units and rounds to them, so a requirement derived
// to the exact pixel can still land a hair under what the layout wants. Every
// minimum built from measurements gets nudged past one such step before it's
// rounded up. The extra pixel is invisible; being one short isn't.
const SUB_PIXEL_QUANTUM_PX = 1 / 64
// Soft minimum, enforced only at section-creation time -- the "+" button
// disappearing when there isn't room for one more is the enforcement (see
// the handover doc's split-view design). Matches the same 300px figure the
// main-process window-minimum-size IPC (Phase 1) uses per extra section.
const SECTION_MIN_WIDTH_PX = 300
// Stable fallback for when no section has registered yet (e.g. the very first
// render, before <EditorSection> has mounted) -- a fresh Map() each render
// would break memo'd children comparing this prop by identity.
const EMPTY_MAP = new Map<string, NotePrimedAction>()
const DEFAULT_BORDER_RADIUS_REGULAR_PX = 6
const DEFAULT_SPACING_REGULAR_PX = 4
const DEFAULT_BORDER_ALPHA_PERCENT = 100
const DEFAULT_BOX_SHADOW_ALPHA_PERCENT = 100
const TEXTURE_PREVIEW_SURFACE: TextureSurfaceKey = 'appGrid'
const SCROLL_TRACK_MIN_THUMB_HEIGHT_PX = 28
const SCROLL_TRACK_EDGE_GAP_PX = 3
const COLOR_BUTTON_ARM_HOLD_MS = 300
const PENDING_UPDATE_DEBOUNCE_MS = 400
const DEFAULT_HIGHLIGHT_COLORS: HighlightColors = {
  caret: 'rgba(120, 115, 112, 0.8)',
  search: 'rgba(255, 221, 105, 0.55)',
  selectionEdit: 'rgba(199, 94, 0, 0.49)',
  selectionRender: 'rgba(199, 94, 0, 0.49)',
  textBase: '#000000DD',
  textEmbossEdit: '#ffffff',
  textEmbossRender: '#ffffff',
  textEmbossUi: '#ffffff',
  background: '#e9e6e3',
  topBackground: 'rgba(196, 187, 182, 0.49)',
  bottomBackground: 'rgba(196, 187, 182, 0.49)',
  gridOutline: '#00000022',
  grid: '#f9f6f3',
  gutterBackground: 'rgba(196, 187, 182, 0.49)',
  reviewLine: 'rgba(255, 221, 105, 0.35)',
  warningLine: 'rgba(199, 60, 0, 0.35)',
  lineNumber: 'rgba(0, 0, 0, 0.6)',
  base: '#f9f6f4',
  inputFields: '#ffffff',
  appButtons: '#FFFFFFBB',
  markdownHeadline: 'rgba(255, 0, 255, 1)',
  markdownList: 'rgba(0, 255, 255, 1)',
  markdownBlockquote: 'rgba(255, 255, 0, 1)',
  markdownCode: 'rgba(255, 0, 127, 1)',
  markdownChecked: 'rgba(0, 255, 0, 1)',
  markdownUnchecked: 'rgba(255, 0, 0, 1)',
}

const DEFAULT_BASE_PALETTE_COLOR = '#f9f6f4'
const DEFAULT_PALETTE_LIGHT = '#f5f3f2'
const DEFAULT_PALETTE_MID = '#e9e5e2'
const DEFAULT_PALETTE_DARK = '#ece8e4'
const DEFAULT_PALETTE_INPUT = '#ffffff'
const DEFAULT_PALETTE_SHADOW_LO = '#fcf9f677'
const DEFAULT_PALETTE_SHADOW_MID = '#fcf9f6bb'
const DEFAULT_PALETTE_SHADOW_HI = '#fcf9f6ee'

const DEFAULT_EDITOR_TEXT_COLORS: Record<EditorTextColorTargetKey, string> = {
  editorEditText: '#000000DD',
  editorRenderText: '#000000DD',
}

type SidebarMode = 'date' | 'category' | 'archive' | 'trash' | 'find' | 'options'
type NotePrimedAction = 'archive' | 'deletion'
type ViewStyleKey =
  | 'modern'
  | 'narrow'
  | 'cute'
  | 'xkcd'
  | 'print'
  | 'calibrilight'
  | 'opensans'
  | 'notoserif'
  | 'neuton'
  | 'faunaone'
  | 'fredericka'
  | 'bubblerone'
type EditorTextColorTargetKey = 'editorEditText' | 'editorRenderText'

type HsvaControlKey = 'h' | 's' | 'v' | 'a'
type CursorColorTargetKey = 'dot' | 'center' | 'trail' | 'halo'
const GLAZE_RADIAL_CORNERS = ['top left', 'top right', 'bottom right', 'bottom left'] as const

// Fallbacks for chrome reading through the section registry before any
// section has registered -- never actually hit in practice (registration
// happens earlier in the same render this is read in), but keeps the read
// side honest about what "no active section yet" looks like.
const noop = () => {}
const noopAsync = async () => {}
const EMPTY_DECORATION_FORMATS = new Set<TextDecorationFormat>()

type DarkModeKey = 'none' | 'mono' | 'red' | 'dusk' | 'neon' | 'matrix'

type DarkModePresetValues = {
  filterInvert: number
  filterSepia: number
  filterHueRotate: number
  filterBrightness: number
  filterContrast: number
  filterSaturate: number
  filterColorize: number
}

// Saturate slider: position x in [0,1] maps to CSS saturate value via
// s(x) = x / (1 - 4^(x-1)), capped at SATURATE_MAX.
// At x=0: s=0 (greyscale), x=0.5: s=1 (neutral), xâ†’1: sâ†’âˆž (capped).
const SATURATE_MAX = 64

function saturatePosToValue(x: number): number {
  const xClamped = Math.max(0, Math.min(0.9999, x))
  if (xClamped <= 0) return 0
  const denom = 1 - Math.pow(4, xClamped - 1)
  if (Math.abs(denom) < 1e-9) return SATURATE_MAX
  const s = xClamped / denom
  return Math.max(0, Math.min(SATURATE_MAX, s))
}

const DARK_MODE_PRESET_VALUES: Record<DarkModeKey, DarkModePresetValues> = {
  none:   { filterInvert: 0, filterSepia: 0, filterHueRotate: 0,   filterBrightness: 1,    filterContrast: 1,    filterSaturate: 0.5000, filterColorize: 0 },
  mono:   { filterInvert: 1, filterSepia: 1, filterHueRotate: 0,   filterBrightness: 0.6,  filterContrast: 0.96, filterSaturate: 0.0000, filterColorize: 0 },
  red:    { filterInvert: 1, filterSepia: 0, filterHueRotate: 0,   filterBrightness: 0.3,  filterContrast: 0.95, filterSaturate: 0.45,    filterColorize: 1 },
  dusk:   { filterInvert: 1, filterSepia: 1, filterHueRotate: 150, filterBrightness: 0.55, filterContrast: 0.95, filterSaturate: 0.4690, filterColorize: 0 },
  neon:   { filterInvert: 1, filterSepia: 1, filterHueRotate: 280, filterBrightness: 0.5,  filterContrast: 1.05, filterSaturate: 0.9126, filterColorize: 0 },
  matrix: { filterInvert: 1, filterSepia: 1, filterHueRotate: 70,  filterBrightness: 0.4,  filterContrast: 1.1,  filterSaturate: 0.8633, filterColorize: 0 },
}


type HsvaDragState = {
  control: HsvaControlKey
  pointerId: number
  startY: number
  baseValue: number
}

type TextureControlKey = 'granularity' | 'smoothness'

type TextureControlDragState = {
  control: TextureControlKey
  pointerId: number
  startY: number
  baseValue: number
}

type ColorArmSource =
  | { kind: 'hsva'; key: HsvaControlKey }
  | { kind: 'active-color' }
  | { kind: 'texture-preview' }

type ElementPreviewCopySource =
  | { kind: 'element'; key: HighlightColorKey }
  | { kind: 'texture'; key: TextureSurfaceKey }
  | { kind: 'text'; key: EditorTextColorTargetKey }

type SidebarViewState = {
  scrollTop: number
  page: number
  collapsedPrimary: string[]
  collapsedSecondary: string[]
}

type SidebarViewStateByMode = Record<SidebarMode, SidebarViewState>

const SIDEBAR_MODES: Array<{ mode: SidebarMode; label: string }> = [
  { mode: 'date', label: 'Date' },
  { mode: 'category', label: 'Category' },
  { mode: 'archive', label: 'Archive' },
  { mode: 'trash', label: 'Trash' },
  { mode: 'find', label: 'Find' },
  { mode: 'options', label: 'View options' },
]

function sanitizeCollapsedList(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return Array.from(new Set(input.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function sanitizeSidebarViewState(value: PersistedSidebarViewState | undefined): SidebarViewState {
  return {
    scrollTop:
      typeof value?.scrollTop === 'number' && Number.isFinite(value.scrollTop)
        ? Math.max(0, Math.round(value.scrollTop))
        : 0,
    page:
      typeof value?.page === 'number' && Number.isFinite(value.page)
        ? Math.max(1, Math.round(value.page))
        : 1,
    collapsedPrimary: sanitizeCollapsedList(value?.collapsedPrimary),
    collapsedSecondary: sanitizeCollapsedList(value?.collapsedSecondary),
  }
}

function createDefaultSidebarViewStateByMode(): SidebarViewStateByMode {
  return {
    date: sanitizeSidebarViewState(undefined),
    category: sanitizeSidebarViewState(undefined),
    archive: sanitizeSidebarViewState(undefined),
    trash: sanitizeSidebarViewState(undefined),
    find: sanitizeSidebarViewState(undefined),
    options: sanitizeSidebarViewState(undefined),
  }
}

type TertiaryGroup = {
  name: string
  notes: NoteSummary[]
}

type SecondaryGroup = {
  name: string
  tertiary: TertiaryGroup[]
}

type PrimaryGroup = {
  name: string
  secondary: SecondaryGroup[]
}

const GENERAL_SECONDARY_NAME = 'General'

function hierarchyFromTags(tags: string[]): { primary: string; secondary: string; tertiary: string } {
  const nonProtected = tags.filter((tag) => !PROTECTED_TAGS.has(tag))
  return {
    primary: nonProtected[0] ?? 'Uncategorized',
    secondary: nonProtected[1] ?? GENERAL_SECONDARY_NAME,
    tertiary: nonProtected[2] ?? 'Notes',
  }
}

function buildHierarchyGroups(notes: NoteSummary[]): PrimaryGroup[] {
  const primaryMap = new Map<string, Map<string, Map<string, NoteSummary[]>>>()

  for (const note of notes) {
    const { primary, secondary, tertiary } = hierarchyFromTags(note.tags)

    if (!primaryMap.has(primary)) {
      primaryMap.set(primary, new Map())
    }
    const secondaryMap = primaryMap.get(primary)!

    if (!secondaryMap.has(secondary)) {
      secondaryMap.set(secondary, new Map())
    }
    const tertiaryMap = secondaryMap.get(secondary)!

    if (!tertiaryMap.has(tertiary)) {
      tertiaryMap.set(tertiary, [])
    }
    tertiaryMap.get(tertiary)!.push(note)
  }

  const compareLabel = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })

  return [...primaryMap.entries()]
    .sort(([a], [b]) => compareLabel(a, b))
    .map(([primaryName, secondaryMap]) => ({
      name: primaryName,
      secondary: [...secondaryMap.entries()]
        .sort(([a], [b]) => compareLabel(a, b))
        .map(([secondaryName, tertiaryMap]) => ({
          name: secondaryName,
          tertiary: [...tertiaryMap.entries()]
            .sort(([a], [b]) => compareLabel(a, b))
            .map(([tertiaryName, groupedNotes]) => ({
              name: tertiaryName,
              notes: [...groupedNotes].sort((a, b) => compareLabel(a.title, b.title)),
            })),
        })),
    }))
}

function sanitizeClipboardTitle(raw: string): string {
  const normalized = normalizeInternalText(raw)
  const firstLine = normalized.split('\n').map((line) => line.trim()).find((line) => line.length > 0)
  if (!firstLine) return FALLBACK_NEW_NOTE_TITLE

  const withoutHeadingPrefix = firstLine.replace(/^#+\s*/, '').trim()
  return truncateTitle(withoutHeadingPrefix) || FALLBACK_NEW_NOTE_TITLE
}

type DerivedPaletteColors = {
  parchmentLightest: string
  parchmentLight: string
  parchmentMid: string
  parchmentDark: string
  parchmentInput: string
  shadowWhiteLo: string
  shadowWhiteMid: string
  shadowWhiteHi: string
}

function derivePaletteTokensFromBaseColor(baseColorCss: string): DerivedPaletteColors {
  const fallbackBase = parseCssColorToRgba(DEFAULT_BASE_PALETTE_COLOR) ?? { r: 249, g: 246, b: 244, a: 1 }
  const baseRgba = parseCssColorToRgba(baseColorCss) ?? fallbackBase
  const baseHsva = rgbaToHsva(baseRgba)
  const defaultBaseHsva = rgbaToHsva(fallbackBase)
  const safeBaseDefaultV = Math.max(0.0001, defaultBaseHsva.v)

  const defaultLightHsva = rgbaToHsva(parseCssColorToRgba(DEFAULT_PALETTE_LIGHT) ?? fallbackBase)
  const defaultMidHsva = rgbaToHsva(parseCssColorToRgba(DEFAULT_PALETTE_MID) ?? fallbackBase)
  const defaultDarkHsva = rgbaToHsva(parseCssColorToRgba(DEFAULT_PALETTE_DARK) ?? fallbackBase)
  const defaultInputHsva = rgbaToHsva(parseCssColorToRgba(DEFAULT_PALETTE_INPUT) ?? fallbackBase)

  const defaultShadowLo = parseCssColorToRgba(DEFAULT_PALETTE_SHADOW_LO) ?? { ...fallbackBase, a: 0.466 }
  const defaultShadowMid = parseCssColorToRgba(DEFAULT_PALETTE_SHADOW_MID) ?? { ...fallbackBase, a: 0.733 }
  const defaultShadowHi = parseCssColorToRgba(DEFAULT_PALETTE_SHADOW_HI) ?? { ...fallbackBase, a: 0.933 }
  const defaultShadowLoHsva = rgbaToHsva(defaultShadowLo)
  const defaultShadowMidHsva = rgbaToHsva(defaultShadowMid)
  const defaultShadowHiHsva = rgbaToHsva(defaultShadowHi)

  const withScaledValue = (valueScale: number, alpha = 1): string => {
    const nextHsva: HsvaColor = {
      h: baseHsva.h,
      s: baseHsva.s,
      v: clamp(baseHsva.v * valueScale, 0, 1),
      a: clamp(alpha, 0, 1),
    }
    return rgbaToCssColor(hsvaToRgba(nextHsva))
  }

  return {
    parchmentLightest: rgbaToCssColor({ ...baseRgba}),
    parchmentLight: withScaledValue(defaultLightHsva.v / safeBaseDefaultV, 1),
    parchmentMid: withScaledValue(defaultMidHsva.v / safeBaseDefaultV, 1),
    parchmentDark: withScaledValue(defaultDarkHsva.v / safeBaseDefaultV, 1),
    parchmentInput: withScaledValue(defaultInputHsva.v / safeBaseDefaultV, 1),
    shadowWhiteLo: withScaledValue(defaultShadowLoHsva.v / safeBaseDefaultV, defaultShadowLo.a),
    shadowWhiteMid: withScaledValue(defaultShadowMidHsva.v / safeBaseDefaultV, defaultShadowMid.a),
    shadowWhiteHi: withScaledValue(defaultShadowHiHsva.v / safeBaseDefaultV, defaultShadowHi.a),
  }
}


function titleFromFileBasename(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, '').trim()
  if (!withoutExtension) return FALLBACK_NEW_NOTE_TITLE

  const normalized = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized || FALLBACK_NEW_NOTE_TITLE
}

function mergeNoteSummaries(previous: NoteSummary[], next: NoteSummary[]): NoteSummary[] {
  const previousById = new Map(previous.map((note) => [note.id, note]))
  const merged: NoteSummary[] = []
  let changed = previous.length !== next.length

  for (let index = 0; index < next.length; index += 1) {
    const nextNote = next[index]
    const existing = previousById.get(nextNote.id)
    const nextCandidate = (existing && existing.hasUnsavedChanges && !nextNote.hasUnsavedChanges && isExternalNote(existing))
      ? { ...nextNote, hasUnsavedChanges: existing.hasUnsavedChanges }
      : nextNote

    if (existing && isSameNoteSummary(existing, nextCandidate)) {
      merged.push(existing)
      if (previous[index] !== existing) {
        changed = true
      }
      continue
    }

    merged.push(nextCandidate)
    changed = true
  }

  return changed ? merged : previous
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// Font size/line-height used to be discrete keys ('xs'..'xl',
// 'tight'..'wide'); persisted app-state files from before the continuous
// sliders may still have those strings. Map them to their old numeric
// equivalent so a settings file saved yesterday doesn't silently reset.
const LEGACY_FONT_SIZE_PX_BY_KEY: Record<string, number> = { xs: 12, s: 14, m: 16, l: 18, xl: 20 }
const LEGACY_LINE_HEIGHT_MULTIPLIER_BY_KEY: Record<string, number> = { tight: 1.2, compact: 1.4, cozy: 1.6, wide: 1.8 }

function resolvePersistedFontSizePx(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp(roundEditorFontSizePx(value), EDITOR_FONT_SIZE_MIN_PX, EDITOR_FONT_SIZE_MAX_PX)
  }
  if (typeof value === 'string' && value in LEGACY_FONT_SIZE_PX_BY_KEY) {
    return LEGACY_FONT_SIZE_PX_BY_KEY[value]!
  }
  return fallback
}

function resolvePersistedLineHeightMultiplier(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp(roundLineHeightMultiplier(value), EDITOR_LINE_HEIGHT_MULTIPLIER_MIN, EDITOR_LINE_HEIGHT_MULTIPLIER_MAX)
  }
  if (typeof value === 'string' && value in LEGACY_LINE_HEIGHT_MULTIPLIER_BY_KEY) {
    return LEGACY_LINE_HEIGHT_MULTIPLIER_BY_KEY[value]!
  }
  return fallback
}

function resolvePersistedViewLetterSpacingEm(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp(roundViewLetterSpacingEm(value), VIEW_LETTER_SPACING_MIN_EM, VIEW_LETTER_SPACING_MAX_EM)
  }
  return fallback
}

// Border/box-shadow tokens can reference other custom properties (e.g.
// `--btn-shadow-active` embeds `var(--color-shadow-white)`), and
// getComputedStyle().getPropertyValue() returns custom properties verbatim,
// unresolved. Inline every var() reference (recursively, since palette
// tokens can chain) so scaleAlphaInCssValue sees the literal colors.
function resolveCssVarValueDeep(rawValue: string, rootStyle: CSSStyleDeclaration, depth = 0): string {
  if (depth > 6) return rawValue
  let sawVar = false
  const resolved = rawValue.replace(/var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^)]+))?\)/g, (_match, name: string, fallback?: string) => {
    sawVar = true
    const resolvedValue = rootStyle.getPropertyValue(name).trim()
    return resolvedValue || (fallback ? fallback.trim() : '')
  })
  return sawVar ? resolveCssVarValueDeep(resolved, rootStyle, depth + 1) : resolved
}

function mulberry32(seed: number): () => number {
  let state = (seed >>> 0) + 0x6d2b79f5
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildLinearGlazeLayers(settings: GlazeSettings): string[] {
  if (settings.linearStackCount <= 0 || settings.linearOpacity <= 0) return []

  const rand = mulberry32(settings.linearSeed)
  const averageDistancePx = 28 + (rand() * 128)
  const lightRatio = 0.2 + (rand() * 0.65)
  const layers: string[] = []

  for (let layerIndex = 0; layerIndex < settings.linearStackCount; layerIndex += 1) {
    const angle = 45
    const phase = rand() * averageDistancePx
    const stops: string[] = []
    let cursor = 0

    for (let stripIndex = 0; stripIndex < 18; stripIndex += 1) {
      const distance = Math.max(12, averageDistancePx * (0.55 + (rand() * 1.05)))
      const litWidth = Math.max(3, distance * lightRatio * (0.7 + (rand() * 0.65)))
      const clearWidth = Math.max(4, distance - litWidth)
      const lightAlpha = clamp(settings.linearOpacity * (0.55 + (rand() * 0.9)), 0, GLAZE_LINEAR_OPACITY_MAX)
      const warmJitter = Math.round((rand() * 22) - 11)
      const red = clamp(245 + warmJitter, 0, 255)
      const green = clamp(245 + warmJitter, 0, 255)
      const blue = clamp(255 - Math.round(rand() * 18), 0, 255)
      const clearEnd = cursor + clearWidth
      const lightEnd = clearEnd + litWidth
      stops.push(`transparent ${Math.max(0, cursor - phase).toFixed(1)}px`)
      stops.push(`transparent ${Math.max(0, clearEnd - phase).toFixed(1)}px`)
      stops.push(`rgba(${red}, ${green}, ${blue}, ${lightAlpha.toFixed(3)}) ${Math.max(0, clearEnd - phase).toFixed(1)}px`)
      stops.push(`rgba(${red}, ${green}, ${blue}, ${lightAlpha.toFixed(3)}) ${Math.max(0, lightEnd - phase).toFixed(1)}px`)
      cursor += distance
    }

    layers.push(`repeating-linear-gradient(${angle}deg, ${stops.join(', ')})`)
  }

  return layers
}

function buildRadialGlazeLayers(settings: GlazeSettings): string[] {
  if (settings.radialCount <= 0 || settings.radialOpacity <= 0) return []

  const rand = mulberry32(settings.radialSeed)
  const layers: string[] = []

  const nextPrismaticRgb = (): [number, number, number] => {
    const channels: [number, number, number] = [0, 0, 0]
    const channelOrder: [number, number, number] = [0, 1, 2]

    for (let i = channelOrder.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1))
      const temp = channelOrder[i]
      channelOrder[i] = channelOrder[j]
      channelOrder[j] = temp
    }

    channels[channelOrder[0]] = 255
    channels[channelOrder[1]] = 127 + Math.round(rand() * 128)
    channels[channelOrder[2]] = 0
    return channels
  }

  for (let index = 0; index < settings.radialCount; index += 1) {
    const corner = GLAZE_RADIAL_CORNERS[index % GLAZE_RADIAL_CORNERS.length]
    const [innerR, innerG, innerB] = nextPrismaticRgb()
    const [midR, midG, midB] = nextPrismaticRgb()
    const [outerR, outerG, outerB] = nextPrismaticRgb()
    const radiusInner = Math.round(18 + (rand() * 14))
    const radiusMid = Math.round(46 + (rand() * 20))
    const radiusOuter = Math.round(74 + (rand() * 22))
    const alphaScale = clamp(settings.radialOpacity * (0.8 + (rand() * 0.7)), 0, GLAZE_RADIAL_OPACITY_MAX)
    const alphaInner = clamp(alphaScale * (1.0 + (rand() * 0.2)), 0, GLAZE_RADIAL_OPACITY_MAX)
    const alphaMid = clamp(alphaScale * (0.8 + (rand() * 0.2)), 0, GLAZE_RADIAL_OPACITY_MAX)
    const alphaOuter = clamp(alphaScale * (0.52 + (rand() * 0.2)), 0, GLAZE_RADIAL_OPACITY_MAX)
    layers.push(
      `radial-gradient(circle at ${corner}, rgba(${innerR}, ${innerG}, ${innerB}, ${alphaInner.toFixed(3)}) ${radiusInner}%, rgba(${midR}, ${midG}, ${midB}, ${alphaMid.toFixed(3)}) ${radiusMid}%, rgba(${outerR}, ${outerG}, ${outerB}, ${alphaOuter.toFixed(3)}) ${radiusOuter}%, transparent 100%)`,
    )
  }

  return layers
}

function buildGloomGlazeLayer(settings: GlazeSettings, useLightColor: boolean): string {
  if (settings.gloomOpacity <= 0) return 'none'
  const centerPct = clamp(settings.gloomPosition, -0.5, 1.5) * 100
  const edgeScale = clamp(settings.gloomShape, 0, 2)
  const edgeAlpha = clamp(settings.gloomOpacity * edgeScale, 0, GLAZE_GLOOM_OPACITY_MAX)
  const centerAlpha = clamp(settings.gloomOpacity, 0, GLAZE_GLOOM_OPACITY_MAX)
  const channel = useLightColor ? 255 : 0
  return `linear-gradient(180deg, rgba(${channel}, ${channel}, ${channel}, ${edgeAlpha.toFixed(3)}) -100%, rgba(${channel}, ${channel}, ${channel}, ${centerAlpha.toFixed(3)}) ${centerPct.toFixed(1)}%, rgba(${channel}, ${channel}, ${channel}, ${edgeAlpha.toFixed(3)}) 200%)`
}

function buildSheenGlazeLayer(settings: GlazeSettings, useDarkColor: boolean): string {
  if (settings.sheenOpacity <= 0) return 'none'
  const centerPct = clamp(settings.sheenPosition, -0.5, 1.5) * 100
  const edgeScale = clamp(settings.sheenShape, 0, 2)
  const edgeAlpha = clamp(settings.sheenOpacity * edgeScale, 0, GLAZE_SHEEN_OPACITY_MAX)
  const centerAlpha = clamp(settings.sheenOpacity, 0, GLAZE_SHEEN_OPACITY_MAX)
  const channel = useDarkColor ? 0 : 255
  return `linear-gradient(180deg, rgba(${channel}, ${channel}, ${channel}, ${edgeAlpha.toFixed(3)}) -100%, rgba(${channel}, ${channel}, ${channel}, ${centerAlpha.toFixed(3)}) ${centerPct.toFixed(1)}%, rgba(${channel}, ${channel}, ${channel}, ${edgeAlpha.toFixed(3)}) 200%)`
}

// Converts a pixel scroll position (e.g. from the legacy per-note SQLite
// scrollTop column) to an integer line count for storage in
// PersistedViewportState/EditRestoreSnapshot.viewport.
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>
  }
  return {}
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeTextureMaterial(source: unknown, fallback: TextureMaterialSettings): TextureMaterialSettings {
  const record = toRecord(source)
  const color = toRecord(record.color)

  return {
    enabled: record.enabled !== false,
    seed: Math.max(0, Math.round(toFiniteNumber(record.seed, fallback.seed))),
    granularity: clamp(
      Math.round(toFiniteNumber(record.granularity, fallback.granularity)),
      TEXTURE_GRANULARITY_MIN,
      TEXTURE_GRANULARITY_MAX,
    ),
    vSteps: clamp(
      Math.round(toFiniteNumber(record.vSteps, fallback.vSteps)),
      TEXTURE_VSTEPS_MIN,
      TEXTURE_VSTEPS_MAX,
    ),
    color: {
      h: clamp(Math.round(toFiniteNumber(color.h, fallback.color.h)), 0, 360),
      s: clamp(toFiniteNumber(color.s, fallback.color.s), 0, 1),
      v: clamp(toFiniteNumber(color.v, fallback.color.v), 0, 1),
      a: clamp(toFiniteNumber(color.a, fallback.color.a), 0, 1),
    },
  }
}

function cloneTextureMaterials(source: Partial<TextureMaterialsBySurface> | null | undefined): TextureMaterialsBySurface {
  const record = toRecord(source)
  return {
    appGrid: normalizeTextureMaterial(record.appGrid, DEFAULT_TEXTURE_MATERIALS.appGrid),
    sidebarContent: normalizeTextureMaterial(record.sidebarContent, DEFAULT_TEXTURE_MATERIALS.sidebarContent),
    editorEditText: normalizeTextureMaterial(record.editorEditText, DEFAULT_TEXTURE_MATERIALS.editorEditText),
    editorRenderText: normalizeTextureMaterial(record.editorRenderText, DEFAULT_TEXTURE_MATERIALS.editorRenderText),
  }
}

function cloneTextureMaterial(source: unknown, fallback: TextureMaterialSettings = DEFAULT_TEXTURE_MATERIALS[TEXTURE_PREVIEW_SURFACE]): TextureMaterialSettings {
  return normalizeTextureMaterial(source, fallback)
}

function toTexturePreviewMaterial(source: unknown): TextureMaterialSettings {
  return normalizeTextureMaterial(source, DEFAULT_TEXTURE_MATERIALS[TEXTURE_PREVIEW_SURFACE])
}

function normalizeLoadoutHighlightColors(source: unknown): HighlightColors {
  const record = toRecord(source)
  const legacySelection = typeof record.selection === 'string' ? record.selection : null
  const legacyTextEmboss = typeof record.textEmboss === 'string' ? record.textEmboss : null

  return {
    caret: typeof record.caret === 'string' ? record.caret : DEFAULT_HIGHLIGHT_COLORS.caret,
    search: typeof record.search === 'string' ? record.search : DEFAULT_HIGHLIGHT_COLORS.search,
    selectionEdit: typeof record.selectionEdit === 'string'
      ? record.selectionEdit
      : (legacySelection ?? DEFAULT_HIGHLIGHT_COLORS.selectionEdit),
    selectionRender: typeof record.selectionRender === 'string'
      ? record.selectionRender
      : (legacySelection ?? DEFAULT_HIGHLIGHT_COLORS.selectionRender),
    textBase: typeof record.textBase === 'string' ? record.textBase : DEFAULT_HIGHLIGHT_COLORS.textBase,
    textEmbossEdit: typeof record.textEmbossEdit === 'string'
      ? record.textEmbossEdit
      : (legacyTextEmboss ?? DEFAULT_HIGHLIGHT_COLORS.textEmbossEdit),
    textEmbossRender: typeof record.textEmbossRender === 'string'
      ? record.textEmbossRender
      : (legacyTextEmboss ?? DEFAULT_HIGHLIGHT_COLORS.textEmbossRender),
    textEmbossUi: typeof record.textEmbossUi === 'string'
      ? record.textEmbossUi
      : (legacyTextEmboss ?? DEFAULT_HIGHLIGHT_COLORS.textEmbossUi),
    background: typeof record.background === 'string' ? record.background : DEFAULT_HIGHLIGHT_COLORS.background,
    topBackground: typeof record.topBackground === 'string' ? record.topBackground : DEFAULT_HIGHLIGHT_COLORS.topBackground,
    bottomBackground: typeof record.bottomBackground === 'string' ? record.bottomBackground : DEFAULT_HIGHLIGHT_COLORS.bottomBackground,
    gridOutline: typeof record.gridOutline === 'string' ? record.gridOutline : DEFAULT_HIGHLIGHT_COLORS.gridOutline,
    grid: typeof record.grid === 'string' ? record.grid : DEFAULT_HIGHLIGHT_COLORS.grid,
    gutterBackground: typeof record.gutterBackground === 'string' ? record.gutterBackground : DEFAULT_HIGHLIGHT_COLORS.gutterBackground,
    reviewLine: typeof record.reviewLine === 'string' ? record.reviewLine : DEFAULT_HIGHLIGHT_COLORS.reviewLine,
    warningLine: typeof record.warningLine === 'string' ? record.warningLine : DEFAULT_HIGHLIGHT_COLORS.warningLine,
    lineNumber: typeof record.lineNumber === 'string' ? record.lineNumber : DEFAULT_HIGHLIGHT_COLORS.lineNumber,
    base: typeof record.base === 'string' ? record.base : DEFAULT_HIGHLIGHT_COLORS.base,
    inputFields: typeof record.inputFields === 'string' ? record.inputFields : DEFAULT_HIGHLIGHT_COLORS.inputFields,
    appButtons: typeof record.appButtons === 'string' ? record.appButtons : DEFAULT_HIGHLIGHT_COLORS.appButtons,
    markdownHeadline: typeof record.markdownHeadline === 'string' ? record.markdownHeadline : DEFAULT_HIGHLIGHT_COLORS.markdownHeadline,
    markdownList: typeof record.markdownList === 'string' ? record.markdownList : DEFAULT_HIGHLIGHT_COLORS.markdownList,
    markdownBlockquote: typeof record.markdownBlockquote === 'string' ? record.markdownBlockquote : DEFAULT_HIGHLIGHT_COLORS.markdownBlockquote,
    markdownCode: typeof record.markdownCode === 'string' ? record.markdownCode : DEFAULT_HIGHLIGHT_COLORS.markdownCode,
    markdownChecked: typeof record.markdownChecked === 'string' ? record.markdownChecked : DEFAULT_HIGHLIGHT_COLORS.markdownChecked,
    markdownUnchecked: typeof record.markdownUnchecked === 'string' ? record.markdownUnchecked : DEFAULT_HIGHLIGHT_COLORS.markdownUnchecked,
  }
}

function roundForSignature(value: number, decimals = 4): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
  return `{${entries.join(',')}}`
}

function normalizeTextureMaterialForLoadoutSignature(source: TextureMaterialSettings): TextureMaterialSettings {
  return {
    enabled: source.enabled,
    seed: Math.max(0, Math.round(source.seed)),
    granularity: clamp(Math.round(source.granularity), TEXTURE_GRANULARITY_MIN, TEXTURE_GRANULARITY_MAX),
    vSteps: clamp(Math.round(source.vSteps), TEXTURE_VSTEPS_MIN, TEXTURE_VSTEPS_MAX),
    color: {
      h: clamp(Math.round(source.color.h), 0, 360),
      s: roundForSignature(clamp(source.color.s, 0, 1)),
      v: roundForSignature(clamp(source.color.v, 0, 1)),
      a: roundForSignature(clamp(source.color.a, 0, 1)),
    },
  }
}

function normalizeUiLoadoutForSignature(loadout: unknown): UiLayoutLoadout {
  const source = toRecord(loadout)
  const normalizedTextureMaterials = cloneTextureMaterials(source.textureMaterials as Partial<TextureMaterialsBySurface> | null | undefined)
  const normalizedHighlightColors = normalizeLoadoutHighlightColors(source.highlightColors)

  const darkMode = source.darkMode === 'none' || source.darkMode === 'mono' || source.darkMode === 'red' || source.darkMode === 'dusk' || source.darkMode === 'neon' || source.darkMode === 'matrix'
    ? source.darkMode
    : 'none'

  return {
    borderRadiusRegularPx: clamp(
      Math.round(toFiniteNumber(source.borderRadiusRegularPx, DEFAULT_BORDER_RADIUS_REGULAR_PX)),
      BORDER_RADIUS_REGULAR_MIN_PX,
      BORDER_RADIUS_REGULAR_MAX_PX,
    ),
    spacingRegularPx: clamp(
      Math.round(toFiniteNumber(source.spacingRegularPx, DEFAULT_SPACING_REGULAR_PX)),
      SPACING_REGULAR_MIN_PX,
      SPACING_REGULAR_MAX_PX,
    ),
    borderAlphaPercent: clamp(
      Math.round(toFiniteNumber(source.borderAlphaPercent, DEFAULT_BORDER_ALPHA_PERCENT)),
      BORDER_ALPHA_PERCENT_MIN,
      BORDER_ALPHA_PERCENT_MAX,
    ),
    boxShadowAlphaPercent: clamp(
      Math.round(toFiniteNumber(source.boxShadowAlphaPercent, DEFAULT_BOX_SHADOW_ALPHA_PERCENT)),
      BOX_SHADOW_ALPHA_PERCENT_MIN,
      BOX_SHADOW_ALPHA_PERCENT_MAX,
    ),
    audioKeyVolume: clamp(toFiniteNumber(source.audioKeyVolume, 1), 0, 1),
    audioKeyVariance: clamp(toFiniteNumber(source.audioKeyVariance, 0), 0, 0.5),
    audioPitch: clamp(toFiniteNumber(source.audioPitch, 0), -100, 100),
    audioBassVolume: clamp(toFiniteNumber(source.audioBassVolume, 0), 0, 1),
    audioTrebleVolume: clamp(toFiniteNumber(source.audioTrebleVolume, 0), 0, 1),
    audioReverbStrength: clamp(toFiniteNumber(source.audioReverbStrength ?? source.audioReverbAmount, 0), 0, 1),
    audioReverbSpace: clamp(toFiniteNumber(source.audioReverbSpace, 0), 0, 1),
    pitchJitterAmount: clamp(toFiniteNumber(source.pitchJitterAmount, 0), 0, 0.5),
    audioSpatial: clamp(toFiniteNumber(source.audioSpatial, 0), -100, 100),
    typingSoundEnabled: source.typingSoundEnabled === true,
    typingSoundSet: source.typingSoundSet === 'A' || source.typingSoundSet === 'B' || source.typingSoundSet === 'C' || source.typingSoundSet === 'D'
      ? source.typingSoundSet
      : DEFAULT_TYPING_SOUND_SET,
    glaze: sanitizeGlazeSettings(source.glaze, DEFAULT_GLAZE_SETTINGS),
    darkMode,
    filterInvert: clamp(toFiniteNumber(source.filterInvert, 0), 0, 1),
    filterSepia: clamp(toFiniteNumber(source.filterSepia, 0), 0, 1),
    filterHueRotate: clamp(toFiniteNumber(source.filterHueRotate, 0), 0, 360),
    filterBrightness: clamp(toFiniteNumber(source.filterBrightness, 1), 0, 2),
    filterContrast: clamp(toFiniteNumber(source.filterContrast, 1), 0, 2),
    filterSaturate: clamp(toFiniteNumber(source.filterSaturate, 0.5), 0, 1),
    filterColorize: clamp(toFiniteNumber(source.filterColorize, 0), 0, 1),
    highlightColors: normalizedHighlightColors,
    editorTextColors: {
      editorEditText: typeof source.editorTextColors === 'object' && source.editorTextColors !== null && typeof (source.editorTextColors as Record<string, unknown>).editorEditText === 'string'
        ? String((source.editorTextColors as Record<string, unknown>).editorEditText)
        : DEFAULT_EDITOR_TEXT_COLORS.editorEditText,
      editorRenderText: typeof source.editorTextColors === 'object' && source.editorTextColors !== null && typeof (source.editorTextColors as Record<string, unknown>).editorRenderText === 'string'
        ? String((source.editorTextColors as Record<string, unknown>).editorRenderText)
        : DEFAULT_EDITOR_TEXT_COLORS.editorRenderText,
    },
    textureMaterials: {
      appGrid: normalizeTextureMaterialForLoadoutSignature(normalizedTextureMaterials.appGrid),
      sidebarContent: normalizeTextureMaterialForLoadoutSignature(normalizedTextureMaterials.sidebarContent),
      editorEditText: normalizeTextureMaterialForLoadoutSignature(normalizedTextureMaterials.editorEditText),
      editorRenderText: normalizeTextureMaterialForLoadoutSignature(normalizedTextureMaterials.editorRenderText),
    },
    cursorDotColor: typeof source.cursorDotColor === 'string' ? source.cursorDotColor : DEFAULT_CUSTOM_CURSOR_SETTINGS.dotColor,
    cursorCenterColor: typeof source.cursorCenterColor === 'string' ? source.cursorCenterColor : DEFAULT_CUSTOM_CURSOR_SETTINGS.centerColor,
    cursorTrailColor: typeof source.cursorTrailColor === 'string' ? source.cursorTrailColor : DEFAULT_CUSTOM_CURSOR_SETTINGS.trailColor,
    cursorDotCount: clamp(toFiniteNumber(source.cursorDotCount, DEFAULT_CUSTOM_CURSOR_SETTINGS.dotCount), CURSOR_DOT_COUNT_MIN, CURSOR_DOT_COUNT_MAX),
    cursorRadiusPx: clamp(toFiniteNumber(source.cursorRadiusPx, DEFAULT_CUSTOM_CURSOR_SETTINGS.radiusPx), CURSOR_RADIUS_MIN_PX, CURSOR_RADIUS_MAX_PX),
    cursorSpinHz: roundForSignature(clamp(toFiniteNumber(source.cursorSpinHz, DEFAULT_CUSTOM_CURSOR_SETTINGS.spinHz), CURSOR_SPIN_HZ_MIN, CURSOR_SPIN_HZ_MAX)),
    cursorTrailThicknessPx: clamp(toFiniteNumber(source.cursorTrailThicknessPx, DEFAULT_CUSTOM_CURSOR_SETTINGS.trailThicknessPx), CURSOR_TRAIL_THICKNESS_MIN_PX, CURSOR_TRAIL_THICKNESS_MAX_PX),
    cursorTrailFadeMs: clamp(toFiniteNumber(source.cursorTrailFadeMs, DEFAULT_CUSTOM_CURSOR_SETTINGS.trailFadeMs), CURSOR_TRAIL_FADE_MIN_MS, CURSOR_TRAIL_FADE_MAX_MS),
    cursorDotSizePx: clamp(toFiniteNumber(source.cursorDotSizePx, DEFAULT_CUSTOM_CURSOR_SETTINGS.dotSizePx), CURSOR_DOT_SIZE_MIN_PX, CURSOR_DOT_SIZE_MAX_PX),
    cursorCenterSizePx: clamp(toFiniteNumber(source.cursorCenterSizePx, DEFAULT_CUSTOM_CURSOR_SETTINGS.centerSizePx), CURSOR_CENTER_SIZE_MIN_PX, CURSOR_CENTER_SIZE_MAX_PX),
    cursorHaloColor: typeof source.cursorHaloColor === 'string' ? source.cursorHaloColor : DEFAULT_CUSTOM_CURSOR_SETTINGS.haloColor,
    cursorHaloRadiusPx: clamp(toFiniteNumber(source.cursorHaloRadiusPx, DEFAULT_CUSTOM_CURSOR_SETTINGS.haloRadiusPx), CURSOR_HALO_RADIUS_MIN_PX, CURSOR_HALO_RADIUS_MAX_PX),
    cursorHaloFalloff: clamp(toFiniteNumber(source.cursorHaloFalloff, DEFAULT_CUSTOM_CURSOR_SETTINGS.haloFalloff), CURSOR_HALO_FALLOFF_MIN, CURSOR_HALO_FALLOFF_MAX),
    cursorPulseMagnitude: roundForSignature(clamp(toFiniteNumber(source.cursorPulseMagnitude, DEFAULT_CUSTOM_CURSOR_SETTINGS.pulseMagnitude), CURSOR_PULSE_MAGNITUDE_MIN, CURSOR_PULSE_MAGNITUDE_MAX)),
    cursorPulseHz: roundForSignature(clamp(toFiniteNumber(source.cursorPulseHz, DEFAULT_CUSTOM_CURSOR_SETTINGS.pulseHz), CURSOR_PULSE_HZ_MIN, CURSOR_PULSE_HZ_MAX)),
    cursorClickRamp: roundForSignature(clamp(toFiniteNumber(source.cursorClickRamp, DEFAULT_CUSTOM_CURSOR_SETTINGS.clickRamp), CURSOR_CLICK_RAMP_MIN, CURSOR_CLICK_RAMP_MAX)),
    cursorClickSkew: roundForSignature(clamp(toFiniteNumber(source.cursorClickSkew, DEFAULT_CUSTOM_CURSOR_SETTINGS.clickSkew), CURSOR_CLICK_SKEW_MIN, CURSOR_CLICK_SKEW_MAX)),
    cursorClickSpeedX: roundForSignature(clamp(toFiniteNumber(source.cursorClickSpeedX, DEFAULT_CUSTOM_CURSOR_SETTINGS.clickSpeedX), CURSOR_CLICK_SPEED_X_MIN, CURSOR_CLICK_SPEED_X_MAX)),
    cursorClickMaxSpeed: roundForSignature(clamp(toFiniteNumber(source.cursorClickMaxSpeed, DEFAULT_CUSTOM_CURSOR_SETTINGS.clickMaxSpeed), CURSOR_CLICK_MAX_SPEED_MIN, CURSOR_CLICK_MAX_SPEED_MAX)),
    cursorClickMinHoldMs: roundForSignature(clamp(toFiniteNumber(source.cursorClickMinHoldMs, DEFAULT_CUSTOM_CURSOR_SETTINGS.clickMinHoldMs), CURSOR_CLICK_MIN_HOLD_MIN_MS, CURSOR_CLICK_MIN_HOLD_MAX_MS)),
    cursorClickBalance: roundForSignature(clamp(toFiniteNumber(source.cursorClickBalance, DEFAULT_CUSTOM_CURSOR_SETTINGS.clickBalance), CURSOR_CLICK_BALANCE_MIN, CURSOR_CLICK_BALANCE_MAX)),
  }
}

function buildUiLoadoutSignature(loadout: UiLayoutLoadout): string {
  return stableStringify(normalizeUiLoadoutForSignature(loadout))
}

function areHsvaEqual(a: HsvaColor, b: HsvaColor): boolean {
  return a.h === b.h && a.s === b.s && a.v === b.v && a.a === b.a
}

function areTextureMaterialsEqual(a: TextureMaterialSettings, b: TextureMaterialSettings): boolean {
  return (
    a.enabled === b.enabled
    && a.seed === b.seed
    && a.granularity === b.granularity
    && a.vSteps === b.vSteps
    && areHsvaEqual(a.color, b.color)
  )
}

function quantizeTextureSize(value: number): number {
  return Math.max(128, Math.ceil(Math.max(0, value) / 64) * 64)
}

const syncTextureToScroll = (scrollTop: number, maskEl: HTMLElement) => {
  maskEl.style.maskPosition = `0 ${-scrollTop}px`;
  maskEl.style.webkitMaskPosition = `0 ${-scrollTop}px`;
};

function formatCreatedDate(timestampMs: number): string {
  const date = new Date(timestampMs)
  const day = pad2(date.getDate())
  const month = date.toLocaleString(undefined, { month: 'long' })
  const year2 = String(date.getFullYear()).slice(-2)
  return `${day} ${month} ${year2}`
}

function monthsBetween(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  if (to.getDate() < from.getDate()) {
    months -= 1
  }
  return Math.max(0, months)
}

type ModifiedDateInfo =
  | { kind: 'time'; text: string }
  | { kind: 'relative'; text: string }
  | { kind: 'year'; text: string }

function getModifiedDateInfo(timestampMs: number, nowMs: number = Date.now()): ModifiedDateInfo {
  const date = new Date(timestampMs)
  const now = new Date(nowMs)

  const isSameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()

  if (isSameDay) {
    const hours = pad2(date.getHours())
    const minutes = pad2(date.getMinutes())
    return { kind: 'time', text: `${hours}:${minutes}` }
  }

  const diffMs = now.getTime() - date.getTime()
  const hoursPassed = diffMs / (60 * 60 * 1000)
  if (hoursPassed <= 48) {
    return { kind: 'relative', text: `${Math.floor(hoursPassed)}h` }
  }

  const daysPassed = diffMs / (24 * 60 * 60 * 1000)
  if (daysPassed <= 45) {
    return { kind: 'relative', text: `${Math.floor(daysPassed)}d` }
  }

  const monthsPassed = monthsBetween(date, now)
  const isSameYear = date.getFullYear() === now.getFullYear()
  if (monthsPassed > 6 && !isSameYear) {
    return { kind: 'year', text: `${date.getFullYear()}` }
  }

  return { kind: 'relative', text: `${monthsPassed}m` }
}

function ModifiedDateLabel({ timestampMs }: { timestampMs: number }) {
  const info = getModifiedDateInfo(timestampMs)
  return (
    <span className="note-list-modified">
      <span className="fa-solid fa-pen-to-square note-list-modified-icon" aria-hidden="true" />
      {info.kind === 'year' ? <span className="note-list-modified-suffix">in</span> : null}
      <span className="note-list-modified-value">{info.text}</span>
      {info.kind === 'relative' ? <span className="note-list-modified-suffix">ago</span> : null}
    </span>
  )
}

async function waitForNotesBridge(shouldStop: () => boolean): Promise<boolean> {
  while (!shouldStop()) {
    if (window.thockdownNotes) {
      return true
    }
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }
  return false
}

type NoteListItemProps = {
  note: NoteSummary
  isActive: boolean
  isModified?: boolean
  onSelect: (noteId: string) => void
  onPrimedLeftClick: (noteId: string) => void
  onSaveClick?: (noteId: string) => void
  onCloseClick?: (noteId: string) => void
  onArchiveClick?: (noteId: string) => void
  onTrashClick?: (noteId: string) => void
  primedAction?: NotePrimedAction | null
  onRightPressStart: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onRightPressEnd: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onMouseLeave?: (noteId: string) => void
  isTrashMode?: boolean
  variant?: 'default' | 'tree'
  /** Set for a chapter (surfaced via search, or -- now that a chapter can carry its own 'archived'/'deleted' protected tag -- via trash/archive): the parent's own title, shown in the meta-left slot as "$ <parent title>" in place of the created-date/assignedId a regular note shows there, since a bare date is far less useful than knowing which note this chapter belongs to. */
  chapterParentTitle?: string
  /** Archive tree only: an archived chapter row nested under its non-self-archived parent's fold-out (see CategoryTreeView) -- indented an extra 2*var(--spacing-large) so it visibly reads as a child of the row above it. */
  isArchiveFoldOutChapter?: boolean
  /** Set only for a chapter row: true when this chapter's parent is itself gone or in Trash, so archiving the chapter would file it under a parent the Archive tree can't show (archivedChaptersByParentId only ever renders under an archive-eligible parent). Disables the archive button for that row -- see isArchiveButtonDisabled. */
  isChapterParentUnavailable?: boolean
}

const NoteListItem = memo(function NoteListItem({
  note,
  isActive,
  isModified = false,
  onSelect,
  onPrimedLeftClick,
  onSaveClick,
  onCloseClick,
  onArchiveClick,
  onTrashClick,
  primedAction = null,
  onRightPressStart,
  onRightPressEnd,
  onMouseLeave,
  isTrashMode = false,
  variant = 'default',
  chapterParentTitle,
  isArchiveFoldOutChapter = false,
  isChapterParentUnavailable = false,
}: NoteListItemProps) {
  const isTreeVariant = variant === 'tree'
  const createdDate = isTreeVariant ? '' : formatCreatedDate(note.createdAtMs)

  const handleSelect = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (primedAction) {
      event.preventDefault()
      event.stopPropagation()
      onPrimedLeftClick(note.id)
      return
    }

    onSelect(note.id)
  }, [primedAction, note.id, onPrimedLeftClick, onSelect])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(note.id)
    }
  }, [note.id, onSelect])

  const handleSaveClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onSaveClick?.(note.id)
  }, [note.id, onSaveClick])

  const handleCloseClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onCloseClick?.(note.id)
  }, [note.id, onCloseClick])

  const handleArchiveClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onArchiveClick?.(note.id)
  }, [note.id, onArchiveClick])

  const handleTrashClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onTrashClick?.(note.id)
  }, [note.id, onTrashClick])

  const isExternal = isExternalNote(note)
  const isChapter = note.chapterOnly
  // A chapter's own title is never useful on its own out of its parent's
  // context, so it's always prefixed to read as "a chapter, not a note" --
  // resolveIdentityLabel is the same rule the chapter bar's own pill uses
  // (assigned chapterId, or a live-derived snippet from its own content),
  // so a chapter reads identically here and there. note.title itself is
  // useless for this: titleFromText (noteLifecycleService.ts) only ever
  // recognizes a level-1 `# ` heading, while chapters use `## `, so a
  // chapter's own note.title is always literally "Missing title".
  const displayTitle = isExternal
    ? note.fileName
    : isChapter
      ? `§ ${resolveIdentityLabel(note.chapterId, note.contentText, 'chapter').text}`
      : note.title
  const noteListMetaKind = getNoteListMetaKind(note)
  // The meta-left slot shows which note this chapter belongs to instead of
  // its created date (see chapterParentTitle's own doc comment for why) --
  // falls back to the date only in the unexpected case its parent's own
  // title couldn't be resolved (e.g. the parent itself no longer exists).
  const chapterMetadataText = isChapter
    ? `$ ${chapterParentTitle ?? createdDate}`
    : null

  const handleMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 2) return

    event.preventDefault()
    event.stopPropagation()
    if (isExternal) return

    onRightPressStart(note.id, event)
  }, [note.id, onRightPressStart, isExternal])

  const handleMouseUp = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 2) return

    event.preventDefault()
    event.stopPropagation()
    if (isExternal) return

    onRightPressEnd(note.id, event)
  }, [note.id, onRightPressEnd, isExternal])

  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleMouseLeave = useCallback(() => {
    onMouseLeave?.(note.id)
  }, [note.id, onMouseLeave])

  const handleDragStart = useCallback((event: DragEvent<HTMLDivElement>) => {
    // Section drop targets always set dropEffect = 'move' (shared with the
    // cross-section tab-drag path) -- effectAllowed has to permit 'move' or
    // the browser shows a no-drop cursor and silently blocks the drop.
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData(NOTE_DRAG_MIME_TYPE, serializeNoteDragPayload({ noteId: note.id, sourceSectionId: null }))
  }, [note.id])

  const hasActionColumns = !isTreeVariant
  const isArchived = isArchivedNote(note)
  const isDeleted = isDeletedNote(note)
  // A chapter can now carry its own 'archived'/'deleted' protected tag (see
  // ChapterBar.tsx's archive/delete split pill -- the actual archive/delete
  // *mechanics*, not yet wired here), but that's a deliberately different
  // gesture from these per-row sidebar buttons/hold-gestures, which stay
  // disabled/blocked for a chapter row wherever it's merely surfaced
  // (search, archive) until that wiring exists. Trash mode is the one
  // exception, so both chapter clauses below are scoped to !isTrashMode: a
  // detached chapter sitting in Trash otherwise had no way out of its own
  // row at all. There these two buttons mean 'permanently delete' and
  // 'move to Archive' respectively, and both underlying paths already handle a
  // detached chapter -- deleteNote sweeps it via detachedChapterParentId (see
  // databaseService.ts), and applyProtectedTagDestination is explicitly shared
  // with chapters, which keep detachedChapterParentId across the tag swap and
  // so surface in the parent's Archive fold-out (archivedChaptersByParentId).
  // The extra archive-side clause: a chapter can only be archived into its
  // parent's Archive fold-out, so a chapter whose parent is gone or itself in
  // Trash has nowhere to land and would vanish from every view until the
  // parent came back. Purging it (the trash button) stays available.
  const isArchiveButtonDisabled = !onArchiveClick || isArchived
    || (!isTrashMode && (isDeleted || isChapter))
    || (isChapter && isChapterParentUnavailable)
  const isTrashButtonDisabled = !onTrashClick || (!isTrashMode && (isDeleted || isChapter))

  return (
    <div
      className={`note-list-item${isActive ? ' is-active' : ''}${isTreeVariant ? ' is-tree-card' : ''}${isModified ? ' is-modified' : ''}${isExternal ? ' is-external' : ''}${primedAction === 'archive' ? ' is-primed-for-archiving' : ''}${primedAction === 'deletion' ? ' is-primed-for-deletion' : ''}${isArchiveFoldOutChapter ? ' is-archive-fold-out-chapter' : ''}`}
      data-note-id={note.id}
      role="option"
      aria-selected={isActive}
      draggable
      onDragStart={handleDragStart}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
      tabIndex={0}
    >
      {hasActionColumns ? (
        <div className="note-list-columns">
          <div className="note-list-column note-list-column-primary">
            <div className="note-list-content">
              <div className="note-list-title">{displayTitle || 'Untitled'}</div>
              <div className="note-list-meta-row">
                <span className="note-list-meta-left">
                  {chapterMetadataText ?? (noteListMetaKind === 'id' ? `$${note.assignedId}` : createdDate)}
                </span>
                <span className="note-list-meta-right"><ModifiedDateLabel timestampMs={note.updatedAtMs} /></span>
              </div>
            </div>
          </div>

          {isExternal ? (
            <>
              <div className={`note-list-column note-list-column-action note-list-column-save${!isModified ? ' is-disabled' : ' is-modified'}`}>
                <button
                  type="button"
                  className="note-list-action-button note-list-action-button-save"
                  disabled={!isModified}
                  aria-label={isModified ? 'Save external note' : 'Save disabled'}
                  data-tooltip={isModified ? 'Save external note' : 'Save disabled'}
                  onClick={handleSaveClick}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseUp={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.stopPropagation()}
                >
                  <span className="fa-solid fa-floppy-disk" aria-hidden="true" />
                </button>
              </div>

              <div className={`note-list-column note-list-column-action note-list-column-close${isModified ? ' is-modified' : ''}`}>
                <button
                  type="button"
                  className="note-list-action-button note-list-action-button-close"
                  disabled={!isExternal}
                  aria-label="Close external note"
                  data-tooltip="Close external note"
                  onClick={handleCloseClick}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseUp={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.stopPropagation()}
                >
                  <span className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={`note-list-column note-list-column-action note-list-column-archive${isArchiveButtonDisabled ? ' is-disabled' : ''}`}>
                <button
                  type="button"
                  className="note-list-action-button note-list-action-button-archive"
                  disabled={isArchiveButtonDisabled}
                  aria-label={isArchiveButtonDisabled ? 'Archive disabled' : 'Archive note'}
                  data-tooltip={isArchiveButtonDisabled ? 'Archive disabled' : 'Archive note'}
                  onClick={handleArchiveClick}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseUp={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.stopPropagation()}/>
              </div>

              <div className={`note-list-column note-list-column-action note-list-column-trash${isTrashButtonDisabled ? ' is-disabled' : ''}`}>
                <button
                  type="button"
                  className="note-list-action-button note-list-action-button-trash"
                  disabled={isTrashButtonDisabled}
                  aria-label={isTrashButtonDisabled ? 'Trash disabled' : isTrashMode && isDeleted ? 'Permanently delete note' : 'Trash note'}
                  data-tooltip={isTrashButtonDisabled ? 'Trash disabled' : isTrashMode && isDeleted ? 'Permanently delete note' : 'Trash note'}
                  onClick={handleTrashClick}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseUp={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.stopPropagation()}/>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="note-list-content">
          <div className="note-list-title">{displayTitle || 'Untitled'}</div>
          {isTreeVariant ? null : (
            <div className="note-list-meta-row">
              <span className="note-list-meta-left">
                {chapterMetadataText ?? (noteListMetaKind === 'id' ? `$${note.assignedId}` : createdDate)}
              </span>
              <span className="note-list-meta-right"><ModifiedDateLabel timestampMs={note.updatedAtMs} /></span>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

type CategoryTreeViewProps = {
  groups: PrimaryGroup[]
  activeNoteId: string | null
  persistedCollapsedPrimary: string[]
  persistedCollapsedSecondary: string[]
  focusNoteRequestKey: number
  onCollapseChange: (next: { collapsedPrimary: string[]; collapsedSecondary: string[] }) => void
  onSelect: (noteId: string) => void
  onPrimedLeftClick: (noteId: string) => void
  primedNoteActionById: Map<string, NotePrimedAction>
  onNoteRightPressStart: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onNoteRightPressEnd: (noteId: string, event: MouseEvent<HTMLDivElement>) => void
  onNoteMouseLeave?: (noteId: string) => void
  /** Archive mode only: a non-self-archived parent's own archived chapters, keyed by parent note id -- see App.tsx's own doc comment on the memo that builds this. Undefined in Category mode, where chapters never appear at all. */
  archivedChaptersByParentId?: Map<string, NoteSummary[]>
}

const CategoryTreeView = memo(function CategoryTreeView({
  groups,
  activeNoteId,
  persistedCollapsedPrimary,
  persistedCollapsedSecondary,
  focusNoteRequestKey,
  onCollapseChange,
  onSelect,
  onPrimedLeftClick,
  primedNoteActionById,
  onNoteRightPressStart,
  onNoteRightPressEnd,
  onNoteMouseLeave,
  archivedChaptersByParentId,
}: CategoryTreeViewProps) {
  // Which non-self-archived parent rows currently have their own archived
  // chapters folded open -- purely transient UI state (see the "pure
  // fold-out" rule in the doc comment on the tertiary.notes.map below),
  // deliberately not persisted app state: it resets to fully collapsed on
  // every fresh visit to the Archive tree, same as it would if this were
  // simply never remembered.
  const [expandedArchiveParentIds, setExpandedArchiveParentIds] = useState<Set<string>>(() => new Set())
  const toggleArchivedChaptersFold = useCallback((parentNoteId: string) => {
    setExpandedArchiveParentIds((previous) => {
      const next = new Set(previous)
      if (next.has(parentNoteId)) {
        next.delete(parentNoteId)
      } else {
        next.add(parentNoteId)
      }
      return next
    })
  }, [])

  const collapsedPrimary = useMemo(() => new Set(persistedCollapsedPrimary), [persistedCollapsedPrimary])
  const collapsedSecondary = useMemo(() => new Set(persistedCollapsedSecondary), [persistedCollapsedSecondary])
  const lastHandledFocusRequestKeyRef = useRef(focusNoteRequestKey)

  const unfoldPathForActiveNote = useCallback(() => {
    if (!activeNoteId || groups.length === 0) {
      return false
    }

    let targetPrimaryName: string | null = null
    let targetSecondaryName: string | null = null

    for (const primary of groups) {
      for (const secondary of primary.secondary) {
        for (const tertiary of secondary.tertiary) {
          if (tertiary.notes.some((note) => note.id === activeNoteId)) {
            targetPrimaryName = primary.name
            targetSecondaryName = secondary.name
            break
          }
        }

        if (targetPrimaryName) {
          break
        }
      }

      if (targetPrimaryName) {
        break
      }
    }

    if (!targetPrimaryName || !targetSecondaryName) {
      return false
    }

    const nextCollapsedPrimary = new Set(
      groups
        .map((primary) => primary.name)
        .filter((primaryName) => primaryName !== targetPrimaryName),
    )

    const nextCollapsedSecondary = new Set<string>()
    for (const primary of groups) {
      for (const secondary of primary.secondary) {
        const secondaryKey = `${primary.name}:${secondary.name}`
        const keepOpen = primary.name === targetPrimaryName && secondary.name === targetSecondaryName
        if (!keepOpen) {
          nextCollapsedSecondary.add(secondaryKey)
        }
      }
    }

    const nextCollapsedPrimaryList = [...nextCollapsedPrimary]
    const nextCollapsedSecondaryList = [...nextCollapsedSecondary]

    if (
      areStringArraysEqual(nextCollapsedPrimaryList, persistedCollapsedPrimary)
      && areStringArraysEqual(nextCollapsedSecondaryList, persistedCollapsedSecondary)
    ) {
      return false
    }

    onCollapseChange({
      collapsedPrimary: nextCollapsedPrimaryList,
      collapsedSecondary: nextCollapsedSecondaryList,
    })
    return true
  }, [activeNoteId, groups, onCollapseChange, persistedCollapsedPrimary, persistedCollapsedSecondary])

  const ensureActiveNoteVisible = useCallback(() => {
    if (!activeNoteId) {
      return
    }

    const selector = `.note-list-item.is-tree-card[data-note-id="${escapeAttributeSelectorValue(activeNoteId)}"]`
    const activeNoteElement = document.querySelector<HTMLElement>(selector)
    if (!activeNoteElement) {
      return
    }

    const scrollContainer =
      activeNoteElement.closest<HTMLElement>('.notes-list.tree-view')
      ?? activeNoteElement.closest<HTMLElement>('.sidebar-content')

    if (!scrollContainer) {
      return
    }

    const containerRect = scrollContainer.getBoundingClientRect()
    const noteRect = activeNoteElement.getBoundingClientRect()
    const visibilityPaddingPx = 8
    const visibleTop = containerRect.top + visibilityPaddingPx
    const visibleBottom = containerRect.bottom - visibilityPaddingPx

    if (noteRect.top < visibleTop) {
      scrollContainer.scrollTop -= (visibleTop - noteRect.top)
      return
    }

    if (noteRect.bottom > visibleBottom) {
      scrollContainer.scrollTop += (noteRect.bottom - visibleBottom)
    }
  }, [activeNoteId])

  useEffect(() => {
    if (focusNoteRequestKey <= 0) {
      return
    }

    if (focusNoteRequestKey === lastHandledFocusRequestKeyRef.current) {
      return
    }

    lastHandledFocusRequestKeyRef.current = focusNoteRequestKey

    unfoldPathForActiveNote()

    let cancelled = false
    const firstFrame = requestAnimationFrame(() => {
      const secondFrame = requestAnimationFrame(() => {
        if (cancelled) {
          return
        }
        ensureActiveNoteVisible()
      })

      if (cancelled) {
        cancelAnimationFrame(secondFrame)
      }
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(firstFrame)
    }
  }, [ensureActiveNoteVisible, focusNoteRequestKey, unfoldPathForActiveNote])

  const togglePrimaryCategory = useCallback((categoryName: string) => {
    const allPrimary = groups.map((group) => group.name)
    const selectedPrimary = groups.find((group) => group.name === categoryName)
    const secondaryKeys = (selectedPrimary?.secondary ?? []).map((secondary) => `${categoryName}:${secondary.name}`)
    const generalSecondaryKey = `${categoryName}:${GENERAL_SECONDARY_NAME}`

    const nextCollapsedPrimary = new Set<string>()
    const nextCollapsedSecondary = new Set(collapsedSecondary)

    if (collapsedPrimary.has(categoryName)) {
      allPrimary
        .filter((primaryName) => primaryName !== categoryName)
        .forEach((primaryName) => nextCollapsedPrimary.add(primaryName))

      // Keep the fallback/general bucket visible whenever a primary is expanded.
      nextCollapsedSecondary.delete(generalSecondaryKey)

      secondaryKeys.forEach((secondaryKey) => {
        if (secondaryKey !== generalSecondaryKey) {
          nextCollapsedSecondary.add(secondaryKey)
        }
      })
    } else {
      allPrimary
        .filter((primaryName) => primaryName !== categoryName)
        .forEach((primaryName) => nextCollapsedPrimary.add(primaryName))

      if (secondaryKeys.length > 0) {
        const allExpanded = secondaryKeys.every((secondaryKey) => !collapsedSecondary.has(secondaryKey))
        if (allExpanded) {
          secondaryKeys.forEach((secondaryKey) => nextCollapsedSecondary.add(secondaryKey))
        } else {
          secondaryKeys.forEach((secondaryKey) => nextCollapsedSecondary.delete(secondaryKey))
        }

        nextCollapsedSecondary.delete(generalSecondaryKey)
      }
    }

    const nextCollapsedPrimaryList = [...nextCollapsedPrimary]
    const nextCollapsedSecondaryList = [...nextCollapsedSecondary]
    if (
      areStringArraysEqual(nextCollapsedPrimaryList, persistedCollapsedPrimary)
      && areStringArraysEqual(nextCollapsedSecondaryList, persistedCollapsedSecondary)
    ) {
      return
    }

    onCollapseChange({
      collapsedPrimary: nextCollapsedPrimaryList,
      collapsedSecondary: nextCollapsedSecondaryList,
    })
  }, [collapsedPrimary, collapsedSecondary, groups, onCollapseChange, persistedCollapsedPrimary, persistedCollapsedSecondary])

  const toggleSecondaryCategory = useCallback((primaryName: string, secondaryName: string) => {
    const key = `${primaryName}:${secondaryName}`
    const allPrimary = groups.map((group) => group.name)
    const selectedPrimary = groups.find((group) => group.name === primaryName)
    const secondaryKeys = (selectedPrimary?.secondary ?? []).map((secondary) => `${primaryName}:${secondary.name}`)
    const nextCollapsedPrimary = new Set(allPrimary.filter((primary) => primary !== primaryName))
    const nextCollapsedSecondary = new Set(collapsedSecondary)

    if (nextCollapsedSecondary.has(key)) {
      secondaryKeys.forEach((secondaryKey) => {
        if (secondaryKey !== key) {
          nextCollapsedSecondary.add(secondaryKey)
        }
      })
      nextCollapsedSecondary.delete(key)
    } else {
      nextCollapsedSecondary.add(key)
    }

    const nextCollapsedPrimaryList = [...nextCollapsedPrimary]
    const nextCollapsedSecondaryList = [...nextCollapsedSecondary]
    if (
      areStringArraysEqual(nextCollapsedPrimaryList, persistedCollapsedPrimary)
      && areStringArraysEqual(nextCollapsedSecondaryList, persistedCollapsedSecondary)
    ) {
      return
    }

    onCollapseChange({
      collapsedPrimary: nextCollapsedPrimaryList,
      collapsedSecondary: nextCollapsedSecondaryList,
    })
  }, [collapsedSecondary, groups, onCollapseChange, persistedCollapsedPrimary, persistedCollapsedSecondary])

  if (groups.length === 0) {
    return <div className="notes-empty-state">No notes available for this category view.</div>
  }

  return (
    <div className="category-tree-root" aria-label="Category tree">
      {groups.map((primary) => (
        <details key={primary.name} className="category-primary" open={!collapsedPrimary.has(primary.name)}>
          <summary
            className="category-primary-summary"
            onClick={(event) => {
              event.preventDefault()
              togglePrimaryCategory(primary.name)
            }}
          >
            {primary.name}
          </summary>
          {primary.secondary.map((secondary) => (
            <details
              key={`${primary.name}:${secondary.name}`}
              className="category-secondary"
              open={!collapsedSecondary.has(`${primary.name}:${secondary.name}`)}
            >
              <summary
                className={`category-secondary-summary${secondary.name === GENERAL_SECONDARY_NAME ? ' is-general-secondary' : ''}`}
                aria-label={secondary.name === GENERAL_SECONDARY_NAME ? 'General' : undefined}
                onClick={(event) => {
                  event.preventDefault()
                  toggleSecondaryCategory(primary.name, secondary.name)
                }}
              >
                {secondary.name === GENERAL_SECONDARY_NAME ? <span className="sr-only-mode-label">General</span> : secondary.name}
              </summary>
              {secondary.tertiary.map((tertiary) => (
                <div key={`${primary.name}:${secondary.name}:${tertiary.name}`} className="category-tertiary-block">
                  <div className="category-tertiary-heading">{tertiary.name}</div>
                  {tertiary.notes.map((note) => {
                    // A parent that's here purely because of its own
                    // archived chapters (not itself archived) is a pure
                    // fold-out toggle -- clicking it never opens the
                    // editor, only shows/hides its own archived chapters
                    // indented beneath it. A self-archived parent behaves
                    // exactly like any other note row: click opens it (its
                    // chapter bar shows every chapter regardless of
                    // archived status -- see useNoteChapters.ts's virtual
                    // merge), and it never gets a fold-out of its own here.
                    const archivedChapters = archivedChaptersByParentId?.get(note.id)
                    const isFoldOutParent = Boolean(archivedChapters?.length) && !isArchivedNote(note)
                    const isExpanded = isFoldOutParent && expandedArchiveParentIds.has(note.id)
                    return (
                      <Fragment key={note.id}>
                        <NoteListItem
                          note={note}
                          isActive={note.id === activeNoteId}
                          onSelect={isFoldOutParent ? () => toggleArchivedChaptersFold(note.id) : onSelect}
                          onPrimedLeftClick={onPrimedLeftClick}
                          primedAction={primedNoteActionById.get(note.id) ?? null}
                          onRightPressStart={onNoteRightPressStart}
                          onRightPressEnd={onNoteRightPressEnd}
                          onMouseLeave={onNoteMouseLeave}
                          variant="tree"
                        />
                        {isExpanded ? archivedChapters!.map((chapter) => (
                          <NoteListItem
                            key={chapter.id}
                            note={chapter}
                            isActive={chapter.id === activeNoteId}
                            onSelect={onSelect}
                            onPrimedLeftClick={onPrimedLeftClick}
                            primedAction={primedNoteActionById.get(chapter.id) ?? null}
                            onRightPressStart={onNoteRightPressStart}
                            onRightPressEnd={onNoteRightPressEnd}
                            onMouseLeave={onNoteMouseLeave}
                            variant="tree"
                            chapterParentTitle={note.title}
                            isArchiveFoldOutChapter
                          />
                        )) : null}
                      </Fragment>
                    )
                  })}
                </div>
              ))}
            </details>
          ))}
        </details>
      ))}
    </div>
  )
})

function compareExternalNotesFirst(a: NoteSummary, b: NoteSummary): number {
  const aIsExternal = isExternalNote(a)
  const bIsExternal = isExternalNote(b)
  if (aIsExternal !== bIsExternal) {
    return aIsExternal ? -1 : 1
  }
  return b.updatedAtMs - a.updatedAtMs
}

function escapeAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function hashNormalizedText(text: string): Promise<string> {
  const normalized = normalizeInternalText(text)
  const encoder = new TextEncoder()
  const data = encoder.encode(normalized)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function App() {
  useWindowDragRegion()

  const appShellRef = useRef<HTMLDivElement | null>(null)
  const windowControlsGridRef = useRef<HTMLElement | null>(null)
  const sidebarContentRef = useRef<HTMLDivElement | null>(null)
  const optionsContentRef = useRef<HTMLDivElement | null>(null)
  const editorStageRef = useRef<HTMLDivElement | null>(null)
  const sidebarSearchInputRef = useRef<HTMLInputElement | null>(null)
  const documentReplaceInputRef = useRef<HTMLInputElement | null>(null)
  const pageJumpInputRef = useRef<HTMLInputElement | null>(null)
  const textureSeedInputRef = useRef<HTMLInputElement | null>(null)
  const glazeLinearSeedInputRef = useRef<HTMLInputElement | null>(null)
  const glazeRadialSeedInputRef = useRef<HTMLInputElement | null>(null)
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const notesRef = useRef<NoteSummary[]>([])

  useEffect(() => {
    notesRef.current = notes
  }, [notes])
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchQueryCaseSensitive, setIsSearchQueryCaseSensitive] = useState(false)
  // Mirrors useDocumentFind's isDocumentFindCaseSensitive so
  // buildMenuStateSnapshot (defined earlier than the hook call can be) can
  // read the latest value without a definition-order cycle -- same pattern
  // as tabBarModeRef.
  const documentFindCaseSensitiveRef = useRef(false)
  const [restoredDocumentFindCaseSensitive, setRestoredDocumentFindCaseSensitive] = useState<boolean | null>(null)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [isExportingMd, setIsExportingMd] = useState(false)
  const [exportFolder, setExportFolder] = useState<string | null>(null)
  const [debuggingEnabled, setDebuggingEnabled] = useState(false)
  const [spellCheckEnabled, setSpellCheckEnabled] = useState(false)
  const [customCursorEnabled, setCustomCursorEnabled] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.enabled)
  const [customCursorDotColor, setCustomCursorDotColor] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.dotColor)
  const [customCursorCenterColor, setCustomCursorCenterColor] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.centerColor)
  const [customCursorTrailColor, setCustomCursorTrailColor] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.trailColor)
  const [customCursorDotCount, setCustomCursorDotCount] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.dotCount)
  const [customCursorRadiusPx, setCustomCursorRadiusPx] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.radiusPx)
  const [customCursorSpinHz, setCustomCursorSpinHz] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.spinHz)
  const [customCursorTrailThicknessPx, setCustomCursorTrailThicknessPx] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.trailThicknessPx)
  const [customCursorTrailFadeMs, setCustomCursorTrailFadeMs] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.trailFadeMs)
  const [customCursorDotSizePx, setCustomCursorDotSizePx] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.dotSizePx)
  const [customCursorCenterSizePx, setCustomCursorCenterSizePx] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.centerSizePx)
  const [customCursorHaloColor, setCustomCursorHaloColor] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.haloColor)
  const [customCursorHaloRadiusPx, setCustomCursorHaloRadiusPx] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.haloRadiusPx)
  const [customCursorHaloFalloff, setCustomCursorHaloFalloff] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.haloFalloff)
  const [customCursorPulseMagnitude, setCustomCursorPulseMagnitude] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.pulseMagnitude)
  const [customCursorPulseHz, setCustomCursorPulseHz] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.pulseHz)
  const [customCursorClickRamp, setCustomCursorClickRamp] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.clickRamp)
  const [customCursorClickSkew, setCustomCursorClickSkew] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.clickSkew)
  const [customCursorClickSpeedX, setCustomCursorClickSpeedX] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.clickSpeedX)
  const [customCursorClickMaxSpeed, setCustomCursorClickMaxSpeed] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.clickMaxSpeed)
  const [customCursorClickMinHoldMs, setCustomCursorClickMinHoldMs] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.clickMinHoldMs)
  const [customCursorClickBalance, setCustomCursorClickBalance] = useState(DEFAULT_CUSTOM_CURSOR_SETTINGS.clickBalance)
  // Local "staged" HSVA color for the Mouse options row-1 H/S/V/A drag
  // controls -- deliberately not tied to the app-wide activeColorHsva/
  // primedColorSource rig (that system arms a swatch anywhere in the app;
  // this one is a closed loop scoped to the 3 row-2 targets below it).
  // Seeded from a real color, same as activeColorHsva below -- HSV is
  // degenerate at v=0 (pure black regardless of h/s), so starting there
  // like a naive {h:0,s:0,v:0,a:1} would make the saturation control look
  // broken (dragging it produces no visible change until v is raised).
  const [cursorColorHsva, setCursorColorHsva] = useState<HsvaColor>(() => {
    const seed = parseCssColorToRgba(DEFAULT_HIGHLIGHT_COLORS.caret) ?? { r: 120, g: 115, b: 112, a: 1 }
    return rgbaToHsva(seed)
  })
  const [cursorHsvaDragState, setCursorHsvaDragState] = useState<HsvaDragState | null>(null)
  const cursorColorArmTimerRef = useRef<number | null>(null)
  const debugNoteIdRef = useRef<string | null>(null)
  const [windowIsMaximized, setWindowIsMaximized] = useState(false)
  const [windowIsCollapsed, setWindowIsCollapsed] = useState(false)
  const [windowModeTransitionOverlayNonce, setWindowModeTransitionOverlayNonce] = useState(0)
  const [viewStyle, setViewStyle] = useState<ViewStyleKey>('calibrilight')
  const [viewFontSize, setViewFontSize] = useState<number>(DEFAULT_EDITOR_FONT_SIZE_PX)
  const [viewSpacing, setViewSpacing] = useState<number>(DEFAULT_EDITOR_LINE_HEIGHT_MULTIPLIER)
  const [viewLetterSpacingEm, setViewLetterSpacingEm] = useState<number>(DEFAULT_VIEW_LETTER_SPACING_EM)
  const [editorStyle, setEditorStyle] = useState<EditorStyleKey>(DEFAULT_EDITOR_STYLE)
  const [editorFontSize, setEditorFontSize] = useState<number>(DEFAULT_EDITOR_FONT_SIZE_PX)
  const [editorSpacing, setEditorSpacing] = useState<number>(DEFAULT_EDITOR_LINE_HEIGHT_MULTIPLIER)
  const [editorGlyphPaddingPx, setEditorGlyphPaddingPx] = useState<number>(DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX)
  const [uiFontStyle, setUiFontStyle] = useState<UiFontKey>(DEFAULT_UI_FONT_KEY)
  const [uiFontScale, setUiFontScale] = useState<number>(DEFAULT_UI_FONT_SCALE)
  const [borderRadiusRegularPx, setBorderRadiusRegularPx] = useState<number>(DEFAULT_BORDER_RADIUS_REGULAR_PX)
  const [spacingRegularPx, setSpacingRegularPx] = useState<number>(DEFAULT_SPACING_REGULAR_PX)
  const [borderAlphaPercent, setBorderAlphaPercent] = useState<number>(DEFAULT_BORDER_ALPHA_PERCENT)
  const [boxShadowAlphaPercent, setBoxShadowAlphaPercent] = useState<number>(DEFAULT_BOX_SHADOW_ALPHA_PERCENT)
  const borderShadowAlphaBaseValuesRef = useRef<Map<string, string>>(new Map())

  // The window-controls column is sized to exactly what's in it -- the audio
  // player on the left, the window buttons on the right, one spacing-regular
  // between them -- rather than to a round number with slack left over. Mirrors
  // audio.css and controls.css: the audio grid is 5 square buttons whose side
  // is half a large button box (--audio-btn-size), the window cluster is 3
  // large buttons with spacing-small between them, and only the panel's two
  // outer edges carry padding (the inner ones are 0 so the gap below is the
  // whole separation). Ceil'd because a fractional spacing setting makes these
  // sub-pixel and the column must never be narrower than its content.
  const windowControlsMetrics = useMemo(() => {
    const smallGapPx = spacingRegularPx / 2 // mirrors --spacing-small
    const audioBtnSizePx = (BTN_SQUARE_LARGE_SIZE_PX - smallGapPx) / 2 // mirrors --audio-btn-size
    const audioWidthPx = spacingRegularPx + 5 * audioBtnSizePx + 4 * smallGapPx
    const windowButtonWidthPx = BTN_SQUARE_LARGE_SIZE_PX + smallGapPx
    return { audioWidthPx, windowButtonWidthPx, smallGapPx }
  }, [spacingRegularPx])

  const windowControlsWidthPx = useMemo(() => {
    const { audioWidthPx, windowButtonWidthPx, smallGapPx } = windowControlsMetrics
    // minimize split + maximize split + close, then the panel's right padding
    const buttonsWidthPx = 3 * windowButtonWidthPx - smallGapPx + spacingRegularPx
    return Math.ceil(audioWidthPx + spacingRegularPx + buttonsWidthPx)
  }, [spacingRegularPx, windowControlsMetrics])

  // Mini mode hides the maximize split and the close button (controls.css), so
  // only the minimize split is left beside the audio player.
  const windowControlsCollapsedWidthPx = useMemo(() => {
    const { audioWidthPx, windowButtonWidthPx, smallGapPx } = windowControlsMetrics
    const buttonsWidthPx = windowButtonWidthPx - smallGapPx + spacingRegularPx
    return Math.ceil(audioWidthPx + spacingRegularPx + buttonsWidthPx)
  }, [spacingRegularPx, windowControlsMetrics])

  // Mirrors --sidebar-min-width in tokens.css: the sidebar has to be wide
  // enough for the options panel's always-visible top section (font
  // settings + preset buttons, a 6-column grid of square buttons) plus a
  // spacing-large gutter on each side inside .sidebar-content, its own
  // border, the custom scrollbar slot beside it, and the sidebar's own
  // right-hand padding (--sidebar-padding-right, i.e. spacing-large). Kept
  // in JS too because this value also drives the app-grid's inline
  // gridTemplateColumns below, which overrides the CSS column width.
  const sidebarWidthPx = useMemo(() => {
    const sidebarOptionsContentWidthPx = BTN_SQUARE_REGULAR_SIZE_PX * 6 + 7 * spacingRegularPx + 2
    const sidebarPaddingRightPx = spacingRegularPx * 2 // mirrors --spacing-large
    const sidebarScrollbarSlotWidthPx = spacingRegularPx + CANONICAL_SCROLL_THICKNESS_PX // mirrors --sidebar-scrollbar-slot-width
    return Math.round(
      sidebarOptionsContentWidthPx
      + spacingRegularPx * 4 // mirrors --spacing-large * 2
      + SIDEBAR_CONTENT_BORDER_PX
      + sidebarScrollbarSlotWidthPx
      + sidebarPaddingRightPx,
    )
  }, [spacingRegularPx])

  // The narrowest the toolbar column is allowed to get: exactly enough for the
  // formatting toolbar's compact layout to show three groups of three side by
  // side (two rows of them, so all six groups still fit), plus the display-modes
  // panel beside it. Mirrors toolbar.css -- .toolbar-grid's own left margin, the
  // display-modes panel, .toolbar-container's margins and border, and inside it
  // the markdown toolbar's padding, three groups of three --btn-square-half-size
  // buttons with spacing-small between them, and spacing-large between groups.
  // Was a flat number derived from a hardcoded window minimum; it's the other
  // way round now, since this is the thing with an actual content floor.
  const toolbarMinWidthPx = useMemo(() => {
    const smallGapPx = spacingRegularPx / 2 // mirrors --spacing-small
    const largeGapPx = spacingRegularPx * 2 // mirrors --spacing-large
    const compactButtonPx = (BTN_SQUARE_LARGE_SIZE_PX - smallGapPx) / 2 // mirrors --btn-square-half-size
    const groupWidthPx = 3 * compactButtonPx + 2 * smallGapPx
    const formattingWidthPx = 2 * spacingRegularPx + 3 * groupWidthPx + 2 * largeGapPx
    const toolbarContainerWidthPx = formattingWidthPx + TOOLBAR_CONTAINER_BORDER_PX + 2 * largeGapPx
    const displayModesWidthPx = 2 * spacingRegularPx + BTN_SQUARE_LARGE_SIZE_PX + DISPLAY_MODES_BORDER_PX
    return Math.ceil(largeGapPx + displayModesWidthPx + toolbarContainerWidthPx)
  }, [spacingRegularPx])

  const appShellMinWidthPx = useMemo(
    () => sidebarWidthPx + GRID_DIVIDER_PX + toolbarMinWidthPx + windowControlsWidthPx,
    [sidebarWidthPx, toolbarMinWidthPx, windowControlsWidthPx],
  )

  // The window height the Date-view sidebar needs to actually show four note
  // cards, measured off the rendered sidebar (see the effect that sets this,
  // near the itemsPerPage computation it inverts). Null until the first
  // measurement lands, and while the sidebar is hidden or in a view this floor
  // isn't about -- the arithmetic below stands in for those.
  const [measuredMinHeightPx, setMeasuredMinHeightPx] = useState<number | null>(null)

  // The shortest the window may get. The measurement above is the authority;
  // what follows is the stand-in until it arrives, mirroring sidebar.css top to
  // bottom -- the sidebar's own vertical padding and the gaps between its
  // children, the search box (its padding-top plus the input's fixed height),
  // the view-toggle row (its padding plus the mode buttons, which are square
  // and so take their height from how wide six of them plus their gaps come out
  // in the sidebar's width), the two-line date-filter rail, the pagination bar,
  // and inside the scroll frame the note list's own padding, four cards and the
  // three spacing-large gaps between them. Everything below the sidebar's floor
  // -- tab bar, chapter bar, stats row -- adds up to less than this, so the
  // sidebar is what sets it.
  //
  // It is deliberately NOT the value used once a measurement exists: this is a
  // model of the stylesheet, and a model of a layout is exactly what kept being
  // a pixel short (it can't see .sidebar-content's borders, or that the card
  // count comes from a rounded clientHeight rather than from what fits).
  const appShellMinHeightPx = useMemo(() => {
    if (measuredMinHeightPx !== null) return Math.ceil(measuredMinHeightPx)

    const smallGapPx = spacingRegularPx / 2 // mirrors --spacing-small
    const largeGapPx = spacingRegularPx * 2 // mirrors --spacing-large

    const searchBoxPx = spacingRegularPx + (BTN_SQUARE_REGULAR_SIZE_PX + 2 * spacingRegularPx)
    // .view-toggle's buttons are `flex: 1 1 0` with `aspect-ratio: 1 / 1`, so
    // their height is however wide a sixth of the row turns out to be.
    const viewToggleRowWidthPx = sidebarWidthPx - largeGapPx /* --sidebar-padding-right */ - largeGapPx /* --sidebar-view-padding-left */
    const modeButtonPx = (viewToggleRowWidthPx - 5 * smallGapPx) / 6
    const viewTogglePx = 2 * spacingRegularPx + modeButtonPx
    // Two rows of chips (months, years), the first with a spacing-regular
    // margin under it, and the rail's own padding-bottom.
    const dateFilterRailPx = 2 * SIDEBAR_MINI_CONTROL_HEIGHT_PX + 2 * spacingRegularPx
    // Always reserved, even though the pagination bar only appears once the
    // list runs to more than one page: at this height it always does (that's
    // the whole point of the floor), and the bar showing up is exactly when
    // its row would otherwise be taken out of the four cards. The bar itself
    // has no padding -- it's as tall as its 20px buttons -- and being a fifth
    // child of the sidebar it also adds one more gap.
    const paginationPx = SIDEBAR_MINI_CONTROL_HEIGHT_PX + spacingRegularPx

    const computedChromePx = 2 * spacingRegularPx // .notes-sidebar padding
      + 3 * spacingRegularPx // gaps between its four always-present children
      + searchBoxPx
      + viewTogglePx
      + dateFilterRailPx
      + paginationPx

    const noteCardPx = NOTE_LIST_ROW_CONTENT_HEIGHT_PX + 2 * largeGapPx
    const fourCardsPx = 2 * largeGapPx /* .notes-list padding */
      + SIDEBAR_MIN_VISIBLE_NOTE_CARDS * noteCardPx
      + (SIDEBAR_MIN_VISIBLE_NOTE_CARDS - 1) * largeGapPx

    return Math.ceil(computedChromePx + fourCardsPx + SUB_PIXEL_QUANTUM_PX)
  }, [measuredMinHeightPx, sidebarWidthPx, spacingRegularPx])
  const [editorFontLoadVersion, setEditorFontLoadVersion] = useState(0)
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('date')
  const [lastSidebarModeBeforeOptions, setLastSidebarModeBeforeOptions] = useState<Exclude<SidebarMode, 'options'>>('date')
  const [sidebarViewStateByMode, setSidebarViewStateByMode] = useState<SidebarViewStateByMode>(() => createDefaultSidebarViewStateByMode())
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(new Set())
  const [selectedYears, setSelectedYears] = useState<Set<number | 'older'>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)
  const [pageJumpInput, setPageJumpInput] = useState('1')
  const [isPageJumpEditing, setIsPageJumpEditing] = useState(false)
  const [categoryCollapsedPrimary, setCategoryCollapsedPrimary] = useState<string[]>([])
  const [categoryCollapsedSecondary, setCategoryCollapsedSecondary] = useState<string[]>([])
  const [archiveCollapsedPrimary, setArchiveCollapsedPrimary] = useState<string[]>([])
  const [archiveCollapsedSecondary, setArchiveCollapsedSecondary] = useState<string[]>([])
  const [categoryFocusRequestKey, setCategoryFocusRequestKey] = useState(0)
  const [archiveFocusRequestKey, setArchiveFocusRequestKey] = useState(0)
  const [itemsPerPage, setItemsPerPage] = useState(20)
  const [showPagination, setShowPagination] = useState(false)
  const [sidebarTreeScrollerEl, setSidebarTreeScrollerEl] = useState<HTMLDivElement | null>(null)
  // Set when the startup bootstrap (loading the note list / database) fails
  // repeatedly. Surfaced as a visible banner -- previously a failure here
  // just retried silently forever with only a console.error, leaving the
  // app looking "half broken" (no active note, so word count/timeline/tag
  // input all stayed empty) with no indication anything was wrong.
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const activeNoteExternalPathRef = useRef<string | null>(null)
  const [currentExternalNoteHash, setCurrentExternalNoteHash] = useState<string | null>(null)
  const externalNoteHashDebounceRef = useRef<number | null>(null)
  const [persistenceReady, setPersistenceReady] = useState(false)
  // Seeded at the shell's own minimum; the real width lands on the first
  // ResizeObserver callback (see appShellMinWidthPx).
  const [appShellWidthPx, setAppShellWidthPx] = useState(appShellMinWidthPx)
  const [isSidebarVisible, setIsSidebarVisible] = useState(true)
  const [isEscapeHoldPanelOpen, setIsEscapeHoldPanelOpen] = useState(false)
  const escapeHoldTimerRef = useRef<number | null>(null)
  const escapeHoldTriggeredRef = useRef(false)
  const escapeFreshCycleWhilePanelOpenRef = useRef(false)
  const clearEscapeHoldTimer = useCallback(() => {
    if (escapeHoldTimerRef.current !== null) {
      window.clearTimeout(escapeHoldTimerRef.current)
      escapeHoldTimerRef.current = null
    }
  }, [])
  const handleEscapeHoldPanelClose = useCallback(() => {
    setIsEscapeHoldPanelOpen(false)
    clearEscapeHoldTimer()
    escapeHoldTriggeredRef.current = false
    escapeFreshCycleWhilePanelOpenRef.current = false
  }, [clearEscapeHoldTimer])
  // "Double size" mode: 2x page zoom paired with a doubled window minimum --
  // see the window-control:double-size-mode handler in electron/main.ts.
  const [isDoubleSizeMode, setIsDoubleSizeMode] = useState(false)
  // Line-number gutter visibility, keyed per editor slot (sectionId) -- not
  // per note/chapter, so switching which note a slot shows leaves the toggle
  // alone. Absent key = off (a freshly created slot starts with the gutter
  // off). Entries are pruned whenever a slot closes (handleCloseSection/the
  // swap-close path below) -- the toggle is a property of "this occupied
  // slot," not of any section identity that might outlive it, so there is
  // nothing to restore once the slot is gone, even for a named section later
  // recalled via swapIntoSlot.
  const [reviewGutterVisibleBySection, setReviewGutterVisibleBySection] = useState<Record<string, boolean>>({})
  // Review-flag gutter column visibility, keyed the same way, but toggled
  // independently of the line-number column (right-click on the toggle
  // button -- see handleToggleReviewFlags). Left-click
  // (handleToggleReviewGutter) drives both columns together, based on the
  // CURRENT line-number state, ignoring whatever this was set to -- so a
  // user who right-clicked flags off/on separately still gets predictable
  // "both on" / "both off" behavior from a left click.
  const [reviewFlagsVisibleBySection, setReviewFlagsVisibleBySection] = useState<Record<string, boolean>>({})
  // The sections actually occupying a slot right now, sorted left-to-right --
  // resolved from window.thockdownSections.listSections() during bootstrap
  // (see the bootstrap effect below), filtered to position !== null. Starts
  // as a single unnamed default section so there's always something to
  // render before that async round-trip completes.
  const [editorSections, setEditorSections] = useState<EditorSectionEntry[]>(() => [
    { id: DEFAULT_EDITOR_SECTION_ID, name: null, position: 0, widthFraction: null, fixedWidthPx: null, lastActiveNoteId: null, noteSlotInitialized: false },
  ])
  // Which note each section should activate once it first mounts and
  // registers -- populated by bootstrap, drained by the effect below as
  // each section's registry entry appears. Not app state: this is one-shot
  // bootstrap wiring, not something that should trigger a re-render itself.
  // Per-note incremental cache for deriveNoteTitleIncremental, so
  // updateActiveNoteTitlePreview's per-keystroke title re-derivation stays
  // O(edit size) instead of O(document length) -- see shared/noteTitle.ts.
  const noteTitleCacheByNoteIdRef = useRef<Map<string, NoteTitleCache>>(new Map())
  const initialNoteIdBySectionIdRef = useRef<Map<string, string>>(new Map())
  // Same one-shot hand-off pattern, for forcing a section's bar mode right
  // after it mounts -- used so a section swapped in via the tab-bar-mode
  // picker doesn't revert to its own fresh default of 'tags'. Drained by
  // the effect below once each named section has registered.
  const pendingTabBarModeBySectionIdRef = useRef<Map<string, 'tags' | 'tabs'>>(new Map())
  // Which section last received a caret placement, click, or keystroke.
  // Interactions that target "the current note" without a section of their
  // own -- Find & Replace today, drag-a-note-onto-a-section later -- read
  // this rather than assuming there's only one section. With a single
  // section it's always DEFAULT_EDITOR_SECTION_ID; the split-view work is
  // what gives it real values to switch between.
  const [activeSectionId, setActiveSectionId] = useState<string>(DEFAULT_EDITOR_SECTION_ID)
  const markSectionActive = useCallback((sectionId: string) => {
    setActiveSectionId((previous) => (previous === sectionId ? previous : sectionId))
  }, [])
  // Section registry (Phase 4b) -- see src/editorSection/sectionRegistry.ts.
  // The section-scoped hooks still all live inside <EditorSection> today,
  // hardcoded to one section, but that single instance publishes its results
  // here (see the registerSectionHandle call inside EditorSection) so chrome
  // (tag handlers, export, sidebar actions, the global toolbar, etc.) can
  // read through the registry instead of closing over section-owned state
  // directly.
  const sectionRegistryRef = useRef<Map<string, SectionHandle>>(new Map())
  const registerSectionHandle = useCallback((sectionId: string, handle: SectionHandle) => {
    sectionRegistryRef.current.set(sectionId, handle)
  }, [])
  const getActiveSection = useCallback((): SectionHandle | undefined => (
    getActiveSectionHandle(sectionRegistryRef, activeSectionId)
  ), [activeSectionId])
  // Lets one section's drop handler (a tab dragged in from elsewhere) reach
  // into a *different* section's own handle to unpin it there -- each
  // section's pinnedTabs state is local to its own useSectionTabs instance,
  // not broadcast, so the section that's losing the tab has to be the one
  // to update its own state (via its own registered handle), not the IPC
  // layer directly.
  const unpinNoteFromSection = useCallback((sectionId: string, noteId: string) => {
    void sectionRegistryRef.current.get(sectionId)?.unpinNoteTab(noteId)
  }, [])

  // Whether some section *other* than `sectionId` currently has `noteId`
  // open -- used by useSnapshotFreeze to skip freezing an inactive section
  // when nothing could actually change its note out from under it.
  const isNoteOpenInOtherSection = useCallback((sectionId: string, noteId: string): boolean => {
    for (const [otherSectionId, handle] of sectionRegistryRef.current) {
      if (otherSectionId === sectionId) continue
      if (handle.activeNoteId === noteId) return true
    }
    return false
  }, [])

  // Purely cosmetic: while dragging a tab or a sidebar note, the browser
  // shows its native no-drop cursor over any area that hasn't had
  // preventDefault called on its dragover -- which is most of the app's
  // chrome (toolbar, sidebar padding, dividers between sections, etc.),
  // since only section columns actually handle a drop. That's an accurate
  // cursor, but an ugly one: nowhere the user might pass over mid-drag
  // needs to look "rejected" when only the eventual drop target matters.
  // A single window-level capture listener -- capture so it runs before
  // any nested handler could stopPropagation and before target-phase
  // handling -- accepts the dragover unconditionally for this drag type,
  // everywhere, regardless of whether that specific spot would do
  // anything on an actual drop. The real drop handlers are untouched and
  // still only act where they always did.
  useEffect(() => {
    const handleWindowDragOver = (event: globalThis.DragEvent) => {
      if (!event.dataTransfer?.types.includes(NOTE_DRAG_MIME_TYPE)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }
    window.addEventListener('dragover', handleWindowDragOver, true)
    return () => window.removeEventListener('dragover', handleWindowDragOver, true)
  }, [])
  // Reactive counterpart to the plain registry above: each <EditorSection>
  // instance calls this from its own effect every render (see its
  // reportSectionHandle prop). A plain Map read during the parent's render
  // body only works when the hooks producing the data live in the same
  // component; once they live in a child, the parent can only learn about a
  // change via an effect -- a shallow-equality guard here (not a dependency
  // array) is what keeps that from looping forever.
  const [activeSectionSnapshot, setActiveSectionSnapshot] = useState<SectionHandle | undefined>(undefined)
  const lastReportedSectionHandleRef = useRef<SectionHandle | undefined>(undefined)
  const reportSectionHandle = useCallback((sectionId: string, handle: SectionHandle) => {
    if (sectionId !== activeSectionId) return
    const previous = lastReportedSectionHandleRef.current
    const changed = !previous || (Object.keys(handle) as (keyof SectionHandle)[])
      .some((key) => previous[key] !== handle[key])
    if (!changed) return
    lastReportedSectionHandleRef.current = handle
    setActiveSectionSnapshot(handle)
  }, [activeSectionId])
  useEffect(() => {
    window.windowControls?.setSectionCount?.(editorSections.length)
  }, [editorSections.length])

  // Hand the main process the chrome minimum we just derived, so the native
  // window minimum tracks the spacing setting instead of being pinned to the
  // default-spacing constants mirrored over there. Both width variants go
  // across because main picks between them on sidebar visibility.
  useEffect(() => {
    window.windowControls?.setChromeMinSize?.({
      width: appShellMinWidthPx,
      widthWithoutSidebar: appShellMinWidthPx - (sidebarWidthPx + GRID_DIVIDER_PX),
      height: appShellMinHeightPx,
    })
  }, [appShellMinWidthPx, appShellMinHeightPx, sidebarWidthPx])

  const toggleSidebarVisible = useCallback(() => {
    setIsSidebarVisible((previous) => {
      const next = !previous
      // If we're hiding the sidebar while the options panel is selected,
      // restore the last non-options sidebar mode so the gear icon isn't
      // left highlighted when the sidebar is not visible.
        if (!next && sidebarMode === 'options') {
          // Defer restoring the previous menu so we don't reference
          // `runSidebarMenuTransition` during module initialization
          // (avoids TDZ errors). The function will exist by the time
          // this callback runs.
          setTimeout(() => {
            try {
              // prefer the remembered previous mode, fallback to 'date'
              runSidebarMenuTransition(lastSidebarModeBeforeOptions ?? 'date')
            } catch (e) {
              // ignore
            }
          }, 0)
        }
      // Notify main process so it can adjust native window constraints immediately
      try {
        window.windowControls?.setSidebarVisible?.(next)
      } catch (e) {
        // ignore
      }

      // Persist app state menu snapshot with updated sidebar visibility --
      // always through persistMenuStateNow (via its ref proxy, since this
      // handler is declared before persistMenuStateNow -- see
      // persistMenuStateNowRef's own doc comment for why a plain call
      // wouldn't stay fresh here). Never a hand-rolled build+save: see
      // persistMenuStateNow's own doc comment for why that's caused this
      // exact bug multiple times before.
      persistMenuStateNowRef.current({ isSidebarVisible: next })

      return next
    })
    // buildMenuStateSnapshot, persistMenuStateNow, and runSidebarMenuTransition
    // are declared later in this component (all via useCallback further
    // down), so listing them here would throw a TDZ ReferenceError the
    // moment this dependency array is evaluated during render --
    // referencing them inside the callback *body* is fine (that only runs
    // on click/timeout, well after the component has finished its render
    // pass and both are initialized), but the array itself is evaluated
    // eagerly, before those consts exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getActiveSection, persistenceReady, sidebarMode, lastSidebarModeBeforeOptions])

  const handleToggleDoubleSizeMode = useCallback(() => {
    setIsDoubleSizeMode((previous) => {
      const next = !previous
      // Notify main process so it can apply page zoom + the doubled window minimum immediately
      try {
        window.windowControls?.setDoubleSizeMode?.(next)
      } catch (e) {
        // ignore
      }

      // Persist app state menu snapshot with updated double-size mode --
      // always through persistMenuStateNow, via its ref proxy (see
      // persistMenuStateNowRef's own doc comment for why -- this handler is
      // declared before persistMenuStateNow, same TDZ/staleness situation as
      // toggleSidebarVisible above). An earlier hand-rolled build+save here,
      // without updating persistedMenuStateRef, was the actual cause of
      // double-size mode not surviving an AppImage restart on Linux.
      persistMenuStateNowRef.current({ isDoubleSizeMode: next })

      return next
    })
    // buildMenuStateSnapshot/persistMenuStateNow are declared later in this
    // component (via useCallback further down), so listing them here would
    // throw a TDZ ReferenceError the moment this dependency array is
    // evaluated during render -- referencing them inside the callback
    // *body* is fine (see the identical note on toggleSidebarVisible above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [renderScrollDynamic, setRenderScrollDynamic] = useState(() => getRenderScrollDynamic())
  const renderScrollResponsiveness = deriveRenderScrollResponsivenessFromDynamic(renderScrollDynamic)
  const [renderScrollTotalTimeSec, setRenderScrollTotalTimeSec] = useState(() => getRenderScrollTotalTimeSec())
  const [renderScrollMaxSpeedPxPerSec, setRenderScrollMaxSpeedPxPerSec] = useState(() => getRenderScrollMaxSpeedPxPerSec())
  const [renderScrollSkew, setRenderScrollSkew] = useState(() => getRenderScrollSkew())
  const [uiMode, setUiMode] = useState<UiLoadoutMode>('light')
  const [uiLoadoutEntries, setUiLoadoutEntries] = useState<UiLoadoutEntry[]>([])
  const [lastCustomIdByMode, setLastCustomIdByMode] = useState<{ light: number; dark: number }>({
    light: LOADOUT_DEFAULT_CUSTOM_ID_ABS,
    dark: -LOADOUT_DEFAULT_CUSTOM_ID_ABS,
  })
  const [highlightColors, setHighlightColors] = useState<HighlightColors>(DEFAULT_HIGHLIGHT_COLORS)
  const [editorTextColors, setEditorTextColors] = useState<Record<EditorTextColorTargetKey, string>>(() => ({
    editorEditText: DEFAULT_EDITOR_TEXT_COLORS.editorEditText,
    editorRenderText: DEFAULT_EDITOR_TEXT_COLORS.editorRenderText,
  }))
  const [textureEnabled] = useState(true)
  const [textureMaterials, setTextureMaterials] = useState<TextureMaterialsBySurface>(() => cloneTextureMaterials(DEFAULT_TEXTURE_MATERIALS))
  const [texturePreviewMaterial, setTexturePreviewMaterial] = useState<TextureMaterialSettings>(() => toTexturePreviewMaterial(DEFAULT_TEXTURE_MATERIALS.appGrid))
  const [textureSeedInput, setTextureSeedInput] = useState(() => String(DEFAULT_TEXTURE_MATERIALS.appGrid.seed))
  const [isTextureSeedEditing, setIsTextureSeedEditing] = useState(false)
  const [glazeSettings, setGlazeSettings] = useState<GlazeSettings>(() => DEFAULT_GLAZE_SETTINGS)
  const [glazeLinearSeedInput, setGlazeLinearSeedInput] = useState(() => String(DEFAULT_GLAZE_SETTINGS.linearSeed))
  const [isGlazeLinearSeedEditing, setIsGlazeLinearSeedEditing] = useState(false)
  const [glazeRadialSeedInput, setGlazeRadialSeedInput] = useState(() => String(DEFAULT_GLAZE_SETTINGS.radialSeed))
  const [isGlazeRadialSeedEditing, setIsGlazeRadialSeedEditing] = useState(false)
  const [darkMode, setDarkMode] = useState<DarkModeKey>('none')
  const [filterInvert, setFilterInvert] = useState(0)
  const [filterSepia, setFilterSepia] = useState(0)
  const [filterHueRotate, setFilterHueRotate] = useState(0)
  const [filterBrightness, setFilterBrightness] = useState(1)
  const [filterContrast, setFilterContrast] = useState(1)
  const [filterSaturate, setFilterSaturate] = useState(1)
  const [filterColorize, setFilterColorize] = useState(0)
  const [audioKeyVolume, setAudioKeyVolume] = useState(0.5)
  const [audioKeyVariance, setAudioKeyVariance] = useState(0)
  const [audioPitch, setAudioPitch] = useState(0)
  const [audioBassVolume, setAudioBassVolume] = useState(0)
  const [audioTrebleVolume, setAudioTrebleVolume] = useState(0)
  const [audioReverbStrength, setAudioReverbStrength] = useState(0)
  const [audioReverbSpace, setAudioReverbSpace] = useState(0)
  const [pitchJitterAmount, setPitchJitterAmount] = useState(0)
  const [audioSpatial, setAudioSpatial] = useState(0)
  const [reduceVisualEffects, setReduceVisualEffects] = useState(false)
  const [reducedCaretAnimation, setReducedCaretAnimation] = useState(false)
  const [deferPreviewOnRapidInput, setDeferPreviewOnRapidInput] = useState(false)
  const [typingSoundEnabled, setTypingSoundEnabled] = useState(false)
  const [typingSoundSet, setTypingSoundSet] = useState<'A' | 'B' | 'C' | 'D'>(DEFAULT_TYPING_SOUND_SET)
  const [musicVolume, setMusicVolume] = useState(0.8)
  const [musicReverbAmount, setMusicReverbAmount] = useState(0)
  const [musicReverbRoom, setMusicReverbRoom] = useState(0.3)
  const [musicActiveSlots, setMusicActiveSlots] = useState<import('./shared/audioPlayer').PlaylistSlot[]>([])
  const [musicAccordionNonce, setMusicAccordionNonce] = useState(0)
  // Last-played song/position/playing-state restored from the previous session,
  // handed to AudioControls once as its "initial*" props (see below).
  const [musicRestoreSongId, setMusicRestoreSongId] = useState<number | null>(null)
  const [musicRestorePositionSec, setMusicRestorePositionSec] = useState(0)
  const [musicRestoreWasPlaying, setMusicRestoreWasPlaying] = useState(false)
  // Kept fresh by AudioControls; read by buildMenuStateSnapshot so the latest
  // song/position/playing-state is captured whenever app state is saved.
  const musicPlaybackRef = useRef<import('./components/AudioControls').MusicPlaybackSnapshot>({
    songId: null,
    positionSec: 0,
    wasPlaying: false,
  })
  const [appGridTextureSize, setAppGridTextureSize] = useState({ width: 1280, height: 720 })
  const [sidebarTextureSize, setSidebarTextureSize] = useState({ width: 512, height: 720 })
  const [editorStageTextureSize, setEditorStageTextureSize] = useState({ width: 1280, height: 720 })
  const [primedColorSource, setPrimedColorSource] = useState<ColorArmSource>({ kind: 'active-color' })
  const [activeColorHsva, setActiveColorHsva] = useState<HsvaColor>(() => {
    const seed = parseCssColorToRgba(DEFAULT_HIGHLIGHT_COLORS.caret) ?? { r: 120, g: 115, b: 112, a: 0.8 }
    return rgbaToHsva(seed)
  })
  const [hsvaDragState, setHsvaDragState] = useState<HsvaDragState | null>(null)
  const [textureControlDragState, setTextureControlDragState] = useState<TextureControlDragState | null>(null)
  const colorArmTimerRef = useRef<number | null>(null)
  const pendingUpdateDebounceRef = useRef<number | null>(null)
  type ConsoleMethodName = 'log' | 'info' | 'warn' | 'error' | 'debug'
  const appStateSaveTimerRef = useRef<number | null>(null)
  const noteTransitionLockRef = useRef(false)
  // Mirrors useSectionTabs' tabBarMode so buildMenuStateSnapshot (defined
  // earlier than the hook call, since it depends on things the hook itself
  // depends on) can read the latest value without a definition-order cycle.
  const tabBarModeRef = useRef<'tags' | 'tabs'>('tabs')
  const [restoredTabBarMode, setRestoredTabBarMode] = useState<'tags' | 'tabs' | null>(null)

  const originalConsoleMethodsRef = useRef<Partial<Record<ConsoleMethodName, (...args: unknown[]) => void>>>({})
  const isWritingDebugEntryRef = useRef(false)
  const debugNoteCreationPromiseRef = useRef<Promise<string | null> | null>(null)
  const externalNoteOriginalTextByIdRef = useRef<Map<string, string>>(new Map())
  const externalNoteOriginalHashByIdRef = useRef<Map<string, string>>(new Map())
  const pendingSidebarScrollRestoreRef = useRef<{ mode: SidebarMode; scrollTop: number } | null>(null)
  // Stay here rather than move into useEditorSectionMount: activateNote and
  // queueAppStateSave (both still in App.tsx) also read/write these, and
  // the hook receives them as injected refs, same as latestEditorTextRef.
  const pendingViewportRestoreRef = useRef<PersistedViewportState | null>(null)
  const isApplyingInitialViewportRef = useRef(false)

  const dateFilteredNotesRef = useRef<NoteSummary[]>([])
  const trashFilteredNotesRef = useRef<NoteSummary[]>([])
  const categoryTreeRef = useRef<PrimaryGroup[]>([])
  const archiveTreeRef = useRef<PrimaryGroup[]>([])
  const externalOpenQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingExternalImportPathsRef = useRef<Set<string>>(new Set())
  const sidebarScrollbarTrackRef = useRef<HTMLDivElement | null>(null)
  const sidebarScrollbarRafRef = useRef<number | null>(null)
  const sidebarScrollbarDragOriginRef = useRef<{ pointerY: number; thumbTopPx: number } | null>(null)
  const sidebarScrollbarThumbRef = useRef<HTMLDivElement | null>(null)
  const sidebarScrollThumbTopRef = useRef(0)
  const sidebarScrollThumbHeightRef = useRef(0)
  const [isSidebarScrollThumbActive, setIsSidebarScrollThumbActive] = useState(false)
  const [isDraggingSidebarScrollThumb, setIsDraggingSidebarScrollThumb] = useState(false)
  const sidebarTextureRef = useRef<HTMLDivElement | null>(null)

  const editorRuntimeMetrics = useMemo(
    () => resolveEditorRuntimeMetrics(editorStyle, editorFontSize, editorSpacing, editorGlyphPaddingPx),
    // editorFontLoadVersion isn't read here -- it's a counter bumped once a
    // custom font finishes loading, the only signal that font metrics may
    // have changed even though the style/size/spacing inputs above haven't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editorStyle, editorFontSize, editorSpacing, editorGlyphPaddingPx, editorFontLoadVersion],
  )

  const editorFontFamily = useMemo(() => resolveEditorFontFamily(editorStyle), [editorStyle])
  const appGridTextureCss = useTextureSurface({
    enabled: textureEnabled && textureMaterials.appGrid.enabled,
    surface: 'appGrid',
    width: appGridTextureSize.width,
    height: appGridTextureSize.height,
    material: textureMaterials.appGrid,
  })
  const sidebarTextureCss = useTextureSurface({
    enabled: textureEnabled && textureMaterials.sidebarContent.enabled,
    surface: 'sidebarContent',
    width: sidebarTextureSize.width,
    height: sidebarTextureSize.height,
    material: textureMaterials.sidebarContent,
  })
  const editorEditTextTextureCss = useTextureSurface({
    enabled: textureEnabled && textureMaterials.editorEditText.enabled,
    surface: 'editorEditText',
    width: editorStageTextureSize.width,
    height: editorStageTextureSize.height,
    material: textureMaterials.editorEditText,
  })
  const editorRenderTextTextureCss = useTextureSurface({
    enabled: textureEnabled && textureMaterials.editorRenderText.enabled,
    surface: 'editorRenderText',
    width: editorStageTextureSize.width,
    height: editorStageTextureSize.height,
    material: textureMaterials.editorRenderText,
  })
  const texturePreviewCss = useTextureSurface({
    enabled: true,
    surface: TEXTURE_PREVIEW_SURFACE,
    width: 96,
    height: 32,
    material: texturePreviewMaterial,
    usePersistentCache: false,
    useFixedTile: true,
  })
  const activeColorRgba = useMemo(() => hsvaToRgba(activeColorHsva), [activeColorHsva])
  const activeColorCss = useMemo(() => rgbaToCssColor(activeColorRgba), [activeColorRgba])
  const activeColorHex = useMemo(() => rgbaToHex(activeColorRgba), [activeColorRgba])
  const texturePreviewRgba = useMemo(() => hsvaToRgba(texturePreviewMaterial.color), [texturePreviewMaterial.color])
  const texturePreviewHex = useMemo(() => rgbaToHex(texturePreviewRgba), [texturePreviewRgba])
  const appGridTextureTintCss = useMemo(() => rgbaToCssColor(hsvaToRgba(textureMaterials.appGrid.color)), [textureMaterials.appGrid.color])
  const sidebarTextureTintCss = useMemo(() => rgbaToCssColor(hsvaToRgba(textureMaterials.sidebarContent.color)), [textureMaterials.sidebarContent.color])
  const editorEditTextureTintCss = useMemo(() => rgbaToCssColor(hsvaToRgba(textureMaterials.editorEditText.color)), [textureMaterials.editorEditText.color])
  const editorRenderTextureTintCss = useMemo(() => rgbaToCssColor(hsvaToRgba(textureMaterials.editorRenderText.color)), [textureMaterials.editorRenderText.color])
  const editorEditTextColorCss = useMemo(() => editorTextColors.editorEditText, [editorTextColors.editorEditText])
  const editorRenderTextColorCss = useMemo(() => editorTextColors.editorRenderText, [editorTextColors.editorRenderText])
  const texturePreviewTintCss = useMemo(() => rgbaToCssColor(hsvaToRgba(texturePreviewMaterial.color)), [texturePreviewMaterial.color])
  const derivedPaletteColors = useMemo(
    () => derivePaletteTokensFromBaseColor(highlightColors.base),
    [highlightColors.base],
  )
  // Opaque #RRGGBB form of the app's current root background (same color
  // driving .window-mode-transition-overlay's fill). Reported to the main
  // process so the native BrowserWindow's own paint fallback matches the
  // active theme instead of defaulting to white during native bounds changes.
  const rootBackgroundColorHex = useMemo(() => {
    const rgba = parseCssColorToRgba(derivedPaletteColors.parchmentLightest)
      ?? { r: 249, g: 246, b: 244, a: 1 }
    return rgbaToHex({ ...rgba, a: 1 }).slice(0, 7)
  }, [derivedPaletteColors.parchmentLightest])
  const textEmbossUiPrimaryRgba = useMemo(
    () => parseCssColorToRgba(highlightColors.textEmbossUi) ?? { r: 255, g: 255, b: 255, a: 1 },
    [highlightColors.textEmbossUi],
  )
  const textEmbossUiSecondaryCss = useMemo(
    () => rgbaToCssColor(invertRgbaColor(textEmbossUiPrimaryRgba, 0.22)),
    [textEmbossUiPrimaryRgba],
  )
  // Line-number gutter color: rendered as an opaque color (its shadow stays
  // the same emboss shadow as the rest of the editor text, unaffected by
  // this color's own alpha) with the chosen color's alpha applied as
  // `opacity` on the whole glyph+shadow element instead -- so a translucent
  // pick fades the number and its shadow uniformly as one composited unit,
  // rather than tinting each independently which read as muddy/inconsistent
  // (per direct user testing).
  const lineNumberRgba = useMemo(
    () => parseCssColorToRgba(highlightColors.lineNumber) ?? { r: 0, g: 0, b: 0, a: 0.6 },
    [highlightColors.lineNumber],
  )
  const lineNumberOpaqueCss = useMemo(
    () => rgbaToCssColor({ ...lineNumberRgba, a: 1 }),
    [lineNumberRgba],
  )
  const textEmbossEditPrimaryRgba = useMemo(
    () => parseCssColorToRgba(highlightColors.textEmbossEdit) ?? { r: 255, g: 255, b: 255, a: 1 },
    [highlightColors.textEmbossEdit],
  )
  const textEmbossEditSecondaryCss = useMemo(
    () => rgbaToCssColor(invertRgbaColor(textEmbossEditPrimaryRgba, 0.22)),
    [textEmbossEditPrimaryRgba],
  )
  const textEmbossRenderPrimaryRgba = useMemo(
    () => parseCssColorToRgba(highlightColors.textEmbossRender) ?? { r: 255, g: 255, b: 255, a: 1 },
    [highlightColors.textEmbossRender],
  )
  const textEmbossRenderSecondaryCss = useMemo(
    () => rgbaToCssColor(invertRgbaColor(textEmbossRenderPrimaryRgba, 0.22)),
    [textEmbossRenderPrimaryRgba],
  )
  const textBaseRgba = useMemo(
    () => parseCssColorToRgba(highlightColors.textBase) ?? { r: 0, g: 0, b: 0, a: 0.867 },
    [highlightColors.textBase],
  )
  const textColorWithAlphaScale = useCallback((alphaScale: number) => rgbaToCssColor({
    ...textBaseRgba,
    a: clamp(textBaseRgba.a * alphaScale, 0, 1),
  }), [textBaseRgba])
  const textColor90 = useMemo(() => textColorWithAlphaScale(0.9), [textColorWithAlphaScale])
  const textColor80 = useMemo(() => textColorWithAlphaScale(0.8), [textColorWithAlphaScale])
  const textColor70 = useMemo(() => textColorWithAlphaScale(0.7), [textColorWithAlphaScale])
  const textColor60 = useMemo(() => textColorWithAlphaScale(0.6), [textColorWithAlphaScale])
  const textColor50 = useMemo(() => textColorWithAlphaScale(0.5), [textColorWithAlphaScale])
  const textColor40 = useMemo(() => textColorWithAlphaScale(0.4), [textColorWithAlphaScale])
  const textColor30 = useMemo(() => textColorWithAlphaScale(0.3), [textColorWithAlphaScale])
  const textColor20 = useMemo(() => textColorWithAlphaScale(0.2), [textColorWithAlphaScale])
  const textColor10 = useMemo(() => textColorWithAlphaScale(0.1), [textColorWithAlphaScale])

  useEffect(() => {
    const textureApi = window.thockdownTextures
    if (!textureApi) return

    const keep: TextureCacheRequest[] = [
      {
        surface: 'appGrid',
        width: TEXTURE_REPEAT_TILE_SIZE,
        height: TEXTURE_REPEAT_TILE_SIZE,
        seed: textureMaterials.appGrid.seed,
        granularity: textureMaterials.appGrid.granularity,
        vSteps: textureMaterials.appGrid.vSteps,
        algorithmVersion: TEXTURE_ALGORITHM_VERSION,
      },
      {
        surface: 'sidebarContent',
        width: TEXTURE_REPEAT_TILE_SIZE,
        height: TEXTURE_REPEAT_TILE_SIZE,
        seed: textureMaterials.sidebarContent.seed,
        granularity: textureMaterials.sidebarContent.granularity,
        vSteps: textureMaterials.sidebarContent.vSteps,
        algorithmVersion: TEXTURE_ALGORITHM_VERSION,
      },
      {
        surface: 'editorEditText',
        width: TEXTURE_REPEAT_TILE_SIZE,
        height: TEXTURE_REPEAT_TILE_SIZE,
        seed: textureMaterials.editorEditText.seed,
        granularity: textureMaterials.editorEditText.granularity,
        vSteps: textureMaterials.editorEditText.vSteps,
        algorithmVersion: TEXTURE_ALGORITHM_VERSION,
      },
      {
        surface: 'editorRenderText',
        width: TEXTURE_REPEAT_TILE_SIZE,
        height: TEXTURE_REPEAT_TILE_SIZE,
        seed: textureMaterials.editorRenderText.seed,
        granularity: textureMaterials.editorRenderText.granularity,
        vSteps: textureMaterials.editorRenderText.vSteps,
        algorithmVersion: TEXTURE_ALGORITHM_VERSION,
      },
    ]

    void textureApi.purgeCachedTextures({ keep, maxEntries: 96, maxAgeMs: 1000 * 60 * 60 * 24 * 14 })
  }, [
    textureMaterials,
  ])

  const hsvaDisplayColors = useMemo(() => {
    const hColor = rgbaToCssColor(hsvaToRgba({ h: activeColorHsva.h, s: 1, v: 1, a: 1 }))
    const sColor = rgbaToCssColor(hsvaToRgba({ h: activeColorHsva.h, s: activeColorHsva.s, v: 1, a: 1 }))
    const vColor = rgbaToCssColor(hsvaToRgba({ h: activeColorHsva.h, s: 0, v: activeColorHsva.v, a: 1 }))
    const aGhostColor = rgbaToCssColor(hsvaToRgba({ h: activeColorHsva.h, s: 0, v: 0, a: activeColorHsva.a }))
    return { hColor, sColor, vColor, aGhostColor }
  }, [activeColorHsva])

  const cursorHsvaDisplayColors = useMemo(() => {
    const hColor = rgbaToCssColor(hsvaToRgba({ h: cursorColorHsva.h, s: 1, v: 1, a: 1 }))
    const sColor = rgbaToCssColor(hsvaToRgba({ h: cursorColorHsva.h, s: cursorColorHsva.s, v: 1, a: 1 }))
    const vColor = rgbaToCssColor(hsvaToRgba({ h: cursorColorHsva.h, s: 0, v: cursorColorHsva.v, a: 1 }))
    const aGhostColor = rgbaToCssColor(hsvaToRgba({ h: cursorColorHsva.h, s: 0, v: 0, a: cursorColorHsva.a }))
    return { hColor, sColor, vColor, aGhostColor }
  }, [cursorColorHsva])

  const customCursorSettings: CustomCursorSettings = useMemo(() => ({
    enabled: customCursorEnabled,
    dotColor: customCursorDotColor,
    centerColor: customCursorCenterColor,
    trailColor: customCursorTrailColor,
    dotCount: customCursorDotCount,
    radiusPx: customCursorRadiusPx,
    spinHz: customCursorSpinHz,
    trailThicknessPx: customCursorTrailThicknessPx,
    trailFadeMs: customCursorTrailFadeMs,
    dotSizePx: customCursorDotSizePx,
    centerSizePx: customCursorCenterSizePx,
    haloColor: customCursorHaloColor,
    haloRadiusPx: customCursorHaloRadiusPx,
    haloFalloff: customCursorHaloFalloff,
    pulseMagnitude: customCursorPulseMagnitude,
    pulseHz: customCursorPulseHz,
    clickRamp: customCursorClickRamp,
    clickSkew: customCursorClickSkew,
    clickSpeedX: customCursorClickSpeedX,
    clickMaxSpeed: customCursorClickMaxSpeed,
    clickMinHoldMs: customCursorClickMinHoldMs,
    clickBalance: customCursorClickBalance,
  }), [
    customCursorEnabled,
    customCursorDotColor,
    customCursorCenterColor,
    customCursorTrailColor,
    customCursorDotCount,
    customCursorRadiusPx,
    customCursorSpinHz,
    customCursorTrailThicknessPx,
    customCursorTrailFadeMs,
    customCursorDotSizePx,
    customCursorCenterSizePx,
    customCursorHaloColor,
    customCursorHaloRadiusPx,
    customCursorHaloFalloff,
    customCursorPulseMagnitude,
    customCursorPulseHz,
    customCursorClickRamp,
    customCursorClickSkew,
    customCursorClickSpeedX,
    customCursorClickMaxSpeed,
    customCursorClickMinHoldMs,
    customCursorClickBalance,
  ])

  const updateTextureMaterial = useCallback((surface: TextureSurfaceKey, updater: (current: TextureMaterialSettings) => TextureMaterialSettings) => {
    setTextureMaterials((previous) => {
      const next = cloneTextureMaterials(previous)
      next[surface] = updater(next[surface])
      return next
    })
  }, [])

  const applyTexturePreviewToSurface = useCallback((surface: TextureSurfaceKey) => {
    const preview = cloneTextureMaterial(texturePreviewMaterial)
    setTextureMaterials((previous) => {
      const next = cloneTextureMaterials(previous)
      next[surface] = {
        ...preview,
        enabled: true,
      }
      return next
    })
  }, [texturePreviewMaterial])

  const updateHighlightColor = useCallback((key: HighlightColorKey, color: RgbaColor) => {
    setHighlightColors((previous) => ({
      ...previous,
      [key]: rgbaToCssColor(color),
    }))
  }, [])

  const resolveEditorTextColor = useCallback((source: Record<EditorTextColorTargetKey, string>, key: EditorTextColorTargetKey): RgbaColor => {
    return parseCssColorToRgba(source[key])
      ?? parseCssColorToRgba(DEFAULT_EDITOR_TEXT_COLORS[key])
      ?? { r: 0, g: 0, b: 0, a: 1 }
  }, [])

  const updateEditorTextColor = useCallback((target: EditorTextColorTargetKey, color: RgbaColor) => {
    setEditorTextColors((previous) => ({
      ...previous,
      [target]: rgbaToCssColor(color),
    }))
  }, [])

  const applyHsvaValueToEditorText = useCallback((sourceKey: HsvaControlKey, targetKey: EditorTextColorTargetKey) => {
    setEditorTextColors((previous) => {
      const target = resolveEditorTextColor(previous, targetKey)
      const targetHsva = rgbaToHsva(target)
      const sourceValue = activeColorHsva[sourceKey]

      const nextHsva: HsvaColor = {
        ...targetHsva,
        [sourceKey]: sourceKey === 'h'
          ? Math.max(0, Math.min(360, sourceValue))
          : Math.max(0, Math.min(1, sourceValue)),
      }

      return {
        ...previous,
        [targetKey]: rgbaToCssColor(hsvaToRgba(nextHsva)),
      }
    })
  }, [activeColorHsva, resolveEditorTextColor])

  const applyActiveColorToEditorText = useCallback((targetKey: EditorTextColorTargetKey) => {
    setEditorTextColors((previous) => ({
      ...previous,
      [targetKey]: activeColorCss,
    }))
  }, [activeColorCss])

  const updateTextureColor = useCallback((surface: TextureSurfaceKey, color: RgbaColor, enabled = true) => {
    const nextHsva = rgbaToHsva(color)
    updateTextureMaterial(surface, (current) => ({
      ...current,
      enabled: enabled,
      color: {
        h: nextHsva.h,
        s: nextHsva.s,
        v: nextHsva.v,
        a: nextHsva.a,
      },
    }))
  }, [updateTextureMaterial])

  const applyDarkModePreset = useCallback((key: DarkModeKey) => {
    setDarkMode(key)
    const v = DARK_MODE_PRESET_VALUES[key]
    setFilterInvert(v.filterInvert)
    setFilterSepia(v.filterSepia)
    setFilterHueRotate(v.filterHueRotate)
    setFilterBrightness(v.filterBrightness)
    setFilterContrast(v.filterContrast)
    setFilterSaturate(v.filterSaturate)
    setFilterColorize(v.filterColorize)
  }, [])

  const captureUiLayoutLoadout = useCallback((): UiLayoutLoadout => {
    return {
      borderRadiusRegularPx,
      spacingRegularPx,
      borderAlphaPercent,
      boxShadowAlphaPercent,
      audioKeyVolume,
      audioKeyVariance,
      audioPitch,
      audioBassVolume,
      audioTrebleVolume,
      audioReverbStrength,
      audioReverbSpace,
      pitchJitterAmount,
      audioSpatial,
      typingSoundEnabled,
      typingSoundSet,
      glaze: glazeSettings,
      darkMode,
      filterInvert,
      filterSepia,
      filterHueRotate,
      filterBrightness,
      filterContrast,
      filterSaturate,
      filterColorize,
      highlightColors: {
        caret: highlightColors.caret,
        search: highlightColors.search,
        selectionEdit: highlightColors.selectionEdit,
        selectionRender: highlightColors.selectionRender,
        textBase: highlightColors.textBase,
        textEmbossEdit: highlightColors.textEmbossEdit,
        textEmbossRender: highlightColors.textEmbossRender,
        textEmbossUi: highlightColors.textEmbossUi,
        background: highlightColors.background,
        topBackground: highlightColors.topBackground,
        bottomBackground: highlightColors.bottomBackground,
        gridOutline: highlightColors.gridOutline,
        grid: highlightColors.grid,
        gutterBackground: highlightColors.gutterBackground,
        reviewLine: highlightColors.reviewLine,
        warningLine: highlightColors.warningLine,
        lineNumber: highlightColors.lineNumber,
        base: highlightColors.base,
        inputFields: highlightColors.inputFields,
        appButtons: highlightColors.appButtons,
        markdownHeadline: highlightColors.markdownHeadline,
        markdownList: highlightColors.markdownList,
        markdownBlockquote: highlightColors.markdownBlockquote,
        markdownCode: highlightColors.markdownCode,
        markdownChecked: highlightColors.markdownChecked,
        markdownUnchecked: highlightColors.markdownUnchecked,
      },
      editorTextColors: {
        editorEditText: editorTextColors.editorEditText,
        editorRenderText: editorTextColors.editorRenderText,
      },
      textureMaterials: cloneTextureMaterials(textureMaterials),
      cursorDotColor: customCursorDotColor,
      cursorCenterColor: customCursorCenterColor,
      cursorTrailColor: customCursorTrailColor,
      cursorDotCount: customCursorDotCount,
      cursorRadiusPx: customCursorRadiusPx,
      cursorSpinHz: customCursorSpinHz,
      cursorTrailThicknessPx: customCursorTrailThicknessPx,
      cursorTrailFadeMs: customCursorTrailFadeMs,
      cursorDotSizePx: customCursorDotSizePx,
      cursorCenterSizePx: customCursorCenterSizePx,
      cursorHaloColor: customCursorHaloColor,
      cursorHaloRadiusPx: customCursorHaloRadiusPx,
      cursorHaloFalloff: customCursorHaloFalloff,
      cursorPulseMagnitude: customCursorPulseMagnitude,
      cursorPulseHz: customCursorPulseHz,
      cursorClickRamp: customCursorClickRamp,
      cursorClickSkew: customCursorClickSkew,
      cursorClickSpeedX: customCursorClickSpeedX,
      cursorClickMaxSpeed: customCursorClickMaxSpeed,
      cursorClickMinHoldMs: customCursorClickMinHoldMs,
      cursorClickBalance: customCursorClickBalance,
    }
  }, [
    borderRadiusRegularPx,
    spacingRegularPx,
    borderAlphaPercent,
    boxShadowAlphaPercent,
    glazeSettings,
    darkMode,
    filterInvert,
    filterSepia,
    filterHueRotate,
    filterBrightness,
    filterContrast,
    filterSaturate,
    filterColorize,
    audioKeyVolume,
    audioKeyVariance,
    audioPitch,
    audioBassVolume,
    audioTrebleVolume,
    audioReverbStrength,
    audioReverbSpace,
    pitchJitterAmount,
    audioSpatial,
    typingSoundEnabled,
    typingSoundSet,
    textureMaterials,
    highlightColors,
    editorTextColors,
    customCursorDotColor,
    customCursorCenterColor,
    customCursorTrailColor,
    customCursorDotCount,
    customCursorRadiusPx,
    customCursorSpinHz,
    customCursorTrailThicknessPx,
    customCursorTrailFadeMs,
    customCursorDotSizePx,
    customCursorCenterSizePx,
    customCursorHaloColor,
    customCursorHaloRadiusPx,
    customCursorHaloFalloff,
    customCursorPulseMagnitude,
    customCursorPulseHz,
    customCursorClickRamp,
    customCursorClickSkew,
    customCursorClickSpeedX,
    customCursorClickMaxSpeed,
    customCursorClickMinHoldMs,
    customCursorClickBalance,
  ])

  const applyUiLayoutLoadout = useCallback((loadoutInput: unknown) => {
    const loadout = normalizeUiLoadoutForSignature(loadoutInput)
    setBorderRadiusRegularPx(
      clamp(
        Math.round(loadout.borderRadiusRegularPx),
        BORDER_RADIUS_REGULAR_MIN_PX,
        BORDER_RADIUS_REGULAR_MAX_PX,
      ),
    )
    setSpacingRegularPx(
      clamp(
        Math.round(loadout.spacingRegularPx),
        SPACING_REGULAR_MIN_PX,
        SPACING_REGULAR_MAX_PX,
      ),
    )
    setBorderAlphaPercent(
      clamp(
        Math.round(loadout.borderAlphaPercent),
        BORDER_ALPHA_PERCENT_MIN,
        BORDER_ALPHA_PERCENT_MAX,
      ),
    )
    setBoxShadowAlphaPercent(
      clamp(
        Math.round(loadout.boxShadowAlphaPercent),
        BOX_SHADOW_ALPHA_PERCENT_MIN,
        BOX_SHADOW_ALPHA_PERCENT_MAX,
      ),
    )
    setAudioKeyVolume(clamp(loadout.audioKeyVolume, 0, 1))
    setAudioKeyVariance(clamp(loadout.audioKeyVariance, 0, 0.5))
    setAudioPitch(clamp(loadout.audioPitch, -100, 100))
    setAudioBassVolume(clamp(loadout.audioBassVolume, 0, 1))
    setAudioTrebleVolume(clamp(loadout.audioTrebleVolume, 0, 1))
    setAudioReverbStrength(clamp(loadout.audioReverbStrength, 0, 1))
    setAudioReverbSpace(clamp(loadout.audioReverbSpace, 0, 1))
    setPitchJitterAmount(clamp(loadout.pitchJitterAmount, 0, 0.5))
    setAudioSpatial(clamp(loadout.audioSpatial, -100, 100))
    setTypingSoundEnabled(loadout.typingSoundEnabled)
    setTypingSoundSet(loadout.typingSoundSet ?? DEFAULT_TYPING_SOUND_SET)
    setGlazeSettings(sanitizeGlazeSettings(loadout.glaze, DEFAULT_GLAZE_SETTINGS))
    // Apply darkMode preset to sliders; individual filter values from the
    // loadout then override preset values if they were customised further.
    applyDarkModePreset(loadout.darkMode ?? 'none')
    setFilterInvert(loadout.filterInvert ?? 0)
    setFilterSepia(loadout.filterSepia ?? 0)
    setFilterHueRotate(loadout.filterHueRotate ?? 0)
    setFilterBrightness(loadout.filterBrightness ?? 1)
    setFilterContrast(loadout.filterContrast ?? 1)
    setFilterSaturate(loadout.filterSaturate ?? 0.5)
    setFilterColorize(loadout.filterColorize ?? 0)
    setHighlightColors({
      caret: loadout.highlightColors.caret,
      search: loadout.highlightColors.search,
      selectionEdit: loadout.highlightColors.selectionEdit,
      selectionRender: loadout.highlightColors.selectionRender,
      textBase: loadout.highlightColors.textBase,
      textEmbossEdit: loadout.highlightColors.textEmbossEdit,
      textEmbossRender: loadout.highlightColors.textEmbossRender,
      textEmbossUi: loadout.highlightColors.textEmbossUi,
      background: loadout.highlightColors.background,
      topBackground: loadout.highlightColors.topBackground,
      bottomBackground: loadout.highlightColors.bottomBackground,
      gridOutline: loadout.highlightColors.gridOutline,
      grid: loadout.highlightColors.grid,
      gutterBackground: loadout.highlightColors.gutterBackground,
      reviewLine: loadout.highlightColors.reviewLine,
      warningLine: loadout.highlightColors.warningLine,
      lineNumber: loadout.highlightColors.lineNumber,
      base: loadout.highlightColors.base,
      inputFields: loadout.highlightColors.inputFields,
      appButtons: loadout.highlightColors.appButtons,
      markdownHeadline: loadout.highlightColors.markdownHeadline,
      markdownList: loadout.highlightColors.markdownList,
      markdownBlockquote: loadout.highlightColors.markdownBlockquote,
      markdownCode: loadout.highlightColors.markdownCode,
      markdownChecked: loadout.highlightColors.markdownChecked,
      markdownUnchecked: loadout.highlightColors.markdownUnchecked,
    })
    setEditorTextColors({
      editorEditText: loadout.editorTextColors.editorEditText,
      editorRenderText: loadout.editorTextColors.editorRenderText,
    })
    setEditorTextColors({
      editorEditText: loadout.editorTextColors.editorEditText,
      editorRenderText: loadout.editorTextColors.editorRenderText,
    })
    setTextureMaterials(cloneTextureMaterials(loadout.textureMaterials))
    setCustomCursorDotColor(loadout.cursorDotColor ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.dotColor)
    setCustomCursorCenterColor(loadout.cursorCenterColor ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.centerColor)
    setCustomCursorTrailColor(loadout.cursorTrailColor ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.trailColor)
    setCustomCursorDotCount(clamp(
      loadout.cursorDotCount ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.dotCount,
      CURSOR_DOT_COUNT_MIN, CURSOR_DOT_COUNT_MAX,
    ))
    setCustomCursorRadiusPx(clamp(
      loadout.cursorRadiusPx ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.radiusPx,
      CURSOR_RADIUS_MIN_PX, CURSOR_RADIUS_MAX_PX,
    ))
    setCustomCursorSpinHz(clamp(
      loadout.cursorSpinHz ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.spinHz,
      CURSOR_SPIN_HZ_MIN, CURSOR_SPIN_HZ_MAX,
    ))
    setCustomCursorTrailThicknessPx(clamp(
      loadout.cursorTrailThicknessPx ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.trailThicknessPx,
      CURSOR_TRAIL_THICKNESS_MIN_PX, CURSOR_TRAIL_THICKNESS_MAX_PX,
    ))
    setCustomCursorTrailFadeMs(clamp(
      loadout.cursorTrailFadeMs ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.trailFadeMs,
      CURSOR_TRAIL_FADE_MIN_MS, CURSOR_TRAIL_FADE_MAX_MS,
    ))
    setCustomCursorDotSizePx(clamp(
      loadout.cursorDotSizePx ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.dotSizePx,
      CURSOR_DOT_SIZE_MIN_PX, CURSOR_DOT_SIZE_MAX_PX,
    ))
    setCustomCursorCenterSizePx(clamp(
      loadout.cursorCenterSizePx ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.centerSizePx,
      CURSOR_CENTER_SIZE_MIN_PX, CURSOR_CENTER_SIZE_MAX_PX,
    ))
    setCustomCursorHaloColor(loadout.cursorHaloColor ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.haloColor)
    setCustomCursorHaloRadiusPx(clamp(
      loadout.cursorHaloRadiusPx ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.haloRadiusPx,
      CURSOR_HALO_RADIUS_MIN_PX, CURSOR_HALO_RADIUS_MAX_PX,
    ))
    setCustomCursorHaloFalloff(clamp(
      loadout.cursorHaloFalloff ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.haloFalloff,
      CURSOR_HALO_FALLOFF_MIN, CURSOR_HALO_FALLOFF_MAX,
    ))
    setCustomCursorPulseMagnitude(clamp(
      loadout.cursorPulseMagnitude ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.pulseMagnitude,
      CURSOR_PULSE_MAGNITUDE_MIN, CURSOR_PULSE_MAGNITUDE_MAX,
    ))
    setCustomCursorPulseHz(clamp(
      loadout.cursorPulseHz ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.pulseHz,
      CURSOR_PULSE_HZ_MIN, CURSOR_PULSE_HZ_MAX,
    ))
    setCustomCursorClickRamp(clamp(
      loadout.cursorClickRamp ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.clickRamp,
      CURSOR_CLICK_RAMP_MIN, CURSOR_CLICK_RAMP_MAX,
    ))
    setCustomCursorClickSkew(clamp(
      loadout.cursorClickSkew ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.clickSkew,
      CURSOR_CLICK_SKEW_MIN, CURSOR_CLICK_SKEW_MAX,
    ))
    setCustomCursorClickSpeedX(clamp(
      loadout.cursorClickSpeedX ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.clickSpeedX,
      CURSOR_CLICK_SPEED_X_MIN, CURSOR_CLICK_SPEED_X_MAX,
    ))
    setCustomCursorClickMaxSpeed(clamp(
      loadout.cursorClickMaxSpeed ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.clickMaxSpeed,
      CURSOR_CLICK_MAX_SPEED_MIN, CURSOR_CLICK_MAX_SPEED_MAX,
    ))
    setCustomCursorClickMinHoldMs(clamp(
      loadout.cursorClickMinHoldMs ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.clickMinHoldMs,
      CURSOR_CLICK_MIN_HOLD_MIN_MS, CURSOR_CLICK_MIN_HOLD_MAX_MS,
    ))
    setCustomCursorClickBalance(clamp(
      loadout.cursorClickBalance ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.clickBalance,
      CURSOR_CLICK_BALANCE_MIN, CURSOR_CLICK_BALANCE_MAX,
    ))
  }, [applyDarkModePreset])

  const capturedUiLayoutLoadout = useMemo(
    () => captureUiLayoutLoadout(),
    [captureUiLayoutLoadout],
  )

  const currentUiLoadoutSignature = useMemo(
    () => buildUiLoadoutSignature(capturedUiLayoutLoadout),
    [capturedUiLayoutLoadout],
  )

  // --- Loadout entry derivations (per current uiMode) -----------------------

  const entriesForCurrentMode = useMemo(() => {
    const sign = modeSign(uiMode)
    return uiLoadoutEntries.filter((entry) => entry.id * sign > 0)
  }, [uiLoadoutEntries, uiMode])

  const activeEntryForCurrentMode = useMemo(
    () => entriesForCurrentMode.find((entry) => entry.isActive) ?? null,
    [entriesForCurrentMode],
  )

  // True once the live captured state has drifted from whatever entry is
  // marked active for this mode â€” i.e. there are unsaved pending changes.
  const hasUnsavedUiLoadoutChanges = useMemo(() => {
    if (!activeEntryForCurrentMode) return false
    if (idKind(activeEntryForCurrentMode.id) === 'pending') return true
    return activeEntryForCurrentMode.signature !== currentUiLoadoutSignature
  }, [activeEntryForCurrentMode, currentUiLoadoutSignature])

  const factoryPresetEntriesForCurrentMode = useMemo(() => {
    const byAbsId = new Map<number, UiLoadoutEntry>(
      entriesForCurrentMode.map((entry) => [Math.abs(entry.id), entry]),
    )
    const ordered: UiLoadoutEntry[] = []
    for (let abs = 1; abs <= LOADOUT_FACTORY_PRESET_COUNT; abs += 1) {
      const entry = byAbsId.get(abs)
      if (entry) ordered.push(entry)
    }
    return ordered
  }, [entriesForCurrentMode])

  const customSlotEntriesForCurrentMode = useMemo(
    () => entriesForCurrentMode
      .filter((entry) => idKind(entry.id) === 'custom')
      .sort((a, b) => Math.abs(a.id) - Math.abs(b.id)),
    [entriesForCurrentMode],
  )

  // The id the dynamic "Custom" preset button targets: whichever custom-ish
  // id (abs >= 6) was last activated for this mode, defaulting to the
  // default-custom id.
  const dynamicCustomPresetId = lastCustomIdByMode[uiMode]

  const isDynamicCustomPresetActive = useMemo(() => {
    if (!activeEntryForCurrentMode) return false
    const kind = idKind(activeEntryForCurrentMode.id)
    if (kind === 'pending') return true
    return activeEntryForCurrentMode.id === dynamicCustomPresetId
  }, [activeEntryForCurrentMode, dynamicCustomPresetId])

  // --- Loadout actions --------------------------------------------------

  const applyEntryToLiveState = useCallback((entry: UiLoadoutEntry) => {
    applyUiLayoutLoadout(entry.payload)
    const caretColorRgba = parseCssColorToRgba(entry.payload.highlightColors.caret) ?? { r: 120, g: 115, b: 112, a: 0.8 }
    setActiveColorHsva(rgbaToHsva(caretColorRgba))
  }, [applyUiLayoutLoadout])

  const selectLoadoutPreset = useCallback(async (id: number) => {
    if (!window.thockdownLoadouts) return
    try {
      const result = await window.thockdownLoadouts.setActive(id)
      setUiLoadoutEntries(result.entries)
      setLastCustomIdByMode(result.lastCustomIdByMode)
      const sign = modeSign(idMode(id))
      const active = result.entries.find((entry) => entry.id * sign > 0 && entry.isActive)
      if (active) applyEntryToLiveState(active)
    } catch (error) {
      console.error('Failed to select UI loadout preset', error)
    }
  }, [applyEntryToLiveState])

  const selectDynamicCustomPreset = useCallback(() => {
    void selectLoadoutPreset(dynamicCustomPresetId)
  }, [selectLoadoutPreset, dynamicCustomPresetId])

  const saveCustomLoadout = useCallback(async () => {
    if (!window.thockdownLoadouts) return
    try {
      const result = await window.thockdownLoadouts.saveCustom(uiMode)
      setUiLoadoutEntries(result.entries)
      setLastCustomIdByMode(result.lastCustomIdByMode)
    } catch (error) {
      console.error('Failed to save custom UI loadout', error)
    }
  }, [uiMode])

  const resetCustomLoadout = useCallback(async () => {
    if (!window.thockdownLoadouts) return
    try {
      const result = await window.thockdownLoadouts.resetCustom(uiMode)
      setUiLoadoutEntries(result.entries)
      setLastCustomIdByMode(result.lastCustomIdByMode)
      const sign = modeSign(uiMode)
      const active = result.entries.find((entry) => entry.id * sign > 0 && entry.isActive)
      if (active) applyEntryToLiveState(active)
    } catch (error) {
      console.error('Failed to reset custom UI loadout', error)
    }
  }, [uiMode, applyEntryToLiveState])

  const [primedCustomLayoutId, setPrimedCustomLayoutId] = useState<number | null>(null)
  const customLoadoutRightClickHoldTimerRef = useRef<number | null>(null)
  const customLoadoutHoldExportEntryIdRef = useRef<number | null>(null)

  const clearCustomLoadoutRightClickHoldTimer = useCallback(() => {
    if (customLoadoutRightClickHoldTimerRef.current !== null) {
      window.clearTimeout(customLoadoutRightClickHoldTimerRef.current)
      customLoadoutRightClickHoldTimerRef.current = null
    }
  }, [])

  const triggerCustomLoadoutExport = useCallback(async (entryId: number) => {
    if (!window.thockdownLoadouts) return
    setPrimedCustomLayoutId(null)
    try {
      await window.thockdownLoadouts.exportTdlEntry(entryId)
    } catch (error) {
      console.error('Failed to export custom UI loadout', error)
    }
  }, [])

  const handleDeleteCustomLoadout = useCallback(async (entryId: number) => {
    if (!window.thockdownLoadouts) return
    try {
      const result = await window.thockdownLoadouts.deleteCustom(entryId)
      setUiLoadoutEntries(result.entries)
      setLastCustomIdByMode(result.lastCustomIdByMode)
      setPrimedCustomLayoutId(null)
    } catch (error) {
      console.error('Failed to delete custom UI loadout', error)
    }
  }, [])

  const handleCustomLoadoutSlotClick = useCallback((entryId: number) => {
    if (primedCustomLayoutId === entryId) {
      void handleDeleteCustomLoadout(entryId)
      return
    }

    setPrimedCustomLayoutId(null)
    void selectLoadoutPreset(entryId)
  }, [primedCustomLayoutId, handleDeleteCustomLoadout, selectLoadoutPreset])

  const handleCustomLoadoutSlotRightMouseDown = useCallback((event: MouseEvent<HTMLButtonElement>, entryId: number) => {
    if (event.button !== 2) return

    setPrimedCustomLayoutId(null)
    clearCustomLoadoutRightClickHoldTimer()
    customLoadoutHoldExportEntryIdRef.current = null
    customLoadoutRightClickHoldTimerRef.current = window.setTimeout(() => {
      customLoadoutRightClickHoldTimerRef.current = null
      customLoadoutHoldExportEntryIdRef.current = entryId
      void triggerCustomLoadoutExport(entryId)
    }, 500)
  }, [clearCustomLoadoutRightClickHoldTimer, triggerCustomLoadoutExport])

  const handleCustomLoadoutSlotRightMouseUp = useCallback((event: MouseEvent<HTMLButtonElement>, entryId: number) => {
    if (event.button !== 2) return

    if (customLoadoutRightClickHoldTimerRef.current !== null) {
      clearCustomLoadoutRightClickHoldTimer()
      setPrimedCustomLayoutId(entryId)
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (customLoadoutHoldExportEntryIdRef.current === entryId) {
      event.preventDefault()
      event.stopPropagation()
      customLoadoutHoldExportEntryIdRef.current = null
    }
  }, [clearCustomLoadoutRightClickHoldTimer])

  const handleCustomLoadoutSlotMouseLeave = useCallback(() => {
    clearCustomLoadoutRightClickHoldTimer()
    setPrimedCustomLayoutId(null)
  }, [clearCustomLoadoutRightClickHoldTimer])

  const handleCustomLoadoutSlotContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>, entryId: number) => {
    if (customLoadoutHoldExportEntryIdRef.current === entryId || primedCustomLayoutId === entryId) {
      event.preventDefault()
      event.stopPropagation()
      if (customLoadoutHoldExportEntryIdRef.current === entryId) {
        customLoadoutHoldExportEntryIdRef.current = null
      }
      return
    }
  }, [primedCustomLayoutId])

  const exportLayoutsTdl = useCallback(async () => {
    if (!window.thockdownLoadouts) return
    try {
      await window.thockdownLoadouts.exportTdl()
    } catch (error) {
      console.error('Failed to export layouts', error)
    }
  }, [])

  const importLayoutsTdl = useCallback(async () => {
    if (!window.thockdownLoadouts) return
    try {
      const result = await window.thockdownLoadouts.importTdl()
      if (result) {
        setUiLoadoutEntries(result.entries)
        setLastCustomIdByMode(result.lastCustomIdByMode)
      }
    } catch (error) {
      console.error('Failed to import layouts', error)
    }
  }, [])

  useEffect(() => {
    const handleGlobalMouseUp = (event: globalThis.MouseEvent) => {
      if (event.button !== 2) return
      if (customLoadoutHoldExportEntryIdRef.current === null) return
      event.preventDefault()
      event.stopPropagation()
      customLoadoutHoldExportEntryIdRef.current = null
    }

    window.addEventListener('mouseup', handleGlobalMouseUp, true)
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp, true)
    }
  }, [])

  const toggleUiMode = useCallback(() => {
    setUiMode((previousMode) => {
      const nextMode: UiLoadoutMode = previousMode === 'light' ? 'dark' : 'light'
      const sign = modeSign(nextMode)
      const active = uiLoadoutEntries.find((entry) => entry.id * sign > 0 && entry.isActive)
      if (active) applyEntryToLiveState(active)
      return nextMode
    })
  }, [uiLoadoutEntries, applyEntryToLiveState])

  const clearColorArmTimer = useCallback(() => {
    if (colorArmTimerRef.current === null) return
    window.clearTimeout(colorArmTimerRef.current)
    colorArmTimerRef.current = null
  }, [])

  const resolveHighlightColor = useCallback((source: HighlightColors, key: HighlightColorKey): RgbaColor => {
    return parseCssColorToRgba(source[key])
      ?? parseCssColorToRgba(DEFAULT_HIGHLIGHT_COLORS[key])
      ?? { r: 233, g: 230, b: 227, a: 1 }
  }, [])

  const resolveTextureColor = useCallback((source: TextureMaterialsBySurface, surface: TextureSurfaceKey): RgbaColor => {
    return hsvaToRgba(source[surface].color)
  }, [])

  const applyHsvaValueToElement = useCallback((sourceKey: HsvaControlKey, targetKey: HighlightColorKey) => {
    setHighlightColors((previous) => {
      const target = resolveHighlightColor(previous, targetKey)
      const targetHsva = rgbaToHsva(target)
      const sourceValue = activeColorHsva[sourceKey]

      const nextHsva: HsvaColor = {
        ...targetHsva,
        [sourceKey]: sourceKey === 'h'
          ? Math.max(0, Math.min(360, sourceValue))
          : Math.max(0, Math.min(1, sourceValue)),
      }

      return {
        ...previous,
        [targetKey]: rgbaToCssColor(hsvaToRgba(nextHsva)),
      }
    })
  }, [activeColorHsva, resolveHighlightColor])

  const applyHsvaValueToTexture = useCallback((sourceKey: HsvaControlKey, targetSurface: TextureSurfaceKey) => {
    const target = resolveTextureColor(textureMaterials, targetSurface)
    const targetHsva = rgbaToHsva(target)
    const sourceValue = activeColorHsva[sourceKey]

    const nextHsva: HsvaColor = {
      ...targetHsva,
      [sourceKey]: sourceKey === 'h'
        ? Math.max(0, Math.min(360, sourceValue))
        : Math.max(0, Math.min(1, sourceValue)),
    }

    updateTextureColor(targetSurface, hsvaToRgba(nextHsva))
  }, [activeColorHsva, resolveTextureColor, textureMaterials, updateTextureColor])

  const applyActiveColorToElement = useCallback((targetKey: HighlightColorKey) => {
    setHighlightColors((previous) => ({
      ...previous,
      [targetKey]: activeColorCss,
    }))
  }, [activeColorCss])

  const applyActiveColorToTexture = useCallback((targetSurface: TextureSurfaceKey) => {
    updateTextureColor(targetSurface, activeColorRgba, false)
  }, [activeColorRgba, updateTextureColor])

  useEffect(() => {
    setTexturePreviewMaterial((current) => ({
      ...current,
      color: areHsvaEqual(current.color, activeColorHsva)
        ? current.color
        : {
            h: activeColorHsva.h,
            s: activeColorHsva.s,
            v: activeColorHsva.v,
            a: activeColorHsva.a,
          },
    }))
  }, [activeColorHsva])

  const copyElementValuesToPreviews = useCallback((source: ElementPreviewCopySource) => {
    if (source.kind === 'element') {
      const rgba = resolveHighlightColor(highlightColors, source.key)
      const hsva = rgbaToHsva(rgba)
      setActiveColorHsva((previous) => (areHsvaEqual(previous, hsva) ? previous : hsva))
      return
    }

    if (source.kind === 'text') {
      const rgba = resolveEditorTextColor(editorTextColors, source.key)
      const hsva = rgbaToHsva(rgba)
      setActiveColorHsva((previous) => (areHsvaEqual(previous, hsva) ? previous : hsva))
      return
    }

    const material = cloneTextureMaterial(textureMaterials[source.key])
    setTexturePreviewMaterial((previous) => (areTextureMaterialsEqual(previous, material) ? previous : material))
    setActiveColorHsva((previous) => (areHsvaEqual(previous, material.color) ? previous : {
      h: material.color.h,
      s: material.color.s,
      v: material.color.v,
      a: material.color.a,
    }))
  }, [editorTextColors, highlightColors, resolveEditorTextColor, resolveHighlightColor, textureMaterials])

  const startColorArmHold = useCallback((source: ColorArmSource, event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()
    clearColorArmTimer()

    colorArmTimerRef.current = window.setTimeout(() => {
      setPrimedColorSource(source)
      colorArmTimerRef.current = null
    }, COLOR_BUTTON_ARM_HOLD_MS)
  }, [clearColorArmTimer])

  const startElementPreviewCopyHold = useCallback((source: ElementPreviewCopySource, event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()
    clearColorArmTimer()

    colorArmTimerRef.current = window.setTimeout(() => {
      copyElementValuesToPreviews(source)
      colorArmTimerRef.current = null
    }, COLOR_BUTTON_ARM_HOLD_MS)
  }, [clearColorArmTimer, copyElementValuesToPreviews])

  const updateHsvaControlValue = useCallback((control: HsvaControlKey, rawValue: number) => {
    setActiveColorHsva((previous) => {
      if (control === 'h') {
        const nextHue = Math.max(0, Math.min(360, rawValue))
        return {
          ...previous,
          h: nextHue,
        }
      }

      const normalized = Math.max(0, Math.min(1, rawValue / 255))
      return {
        ...previous,
        [control]: normalized,
      }
    })
  }, [])

  const getWheelStepDirection = useCallback((event: React.WheelEvent<HTMLElement>) => {
    const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (dominantDelta === 0) return 0
    return dominantDelta > 0 ? -1 : 1
  }, [])

  const wheelAdjustHsvaControl = useCallback((control: HsvaControlKey, event: React.WheelEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const stepDirection = getWheelStepDirection(event)
    if (stepDirection === 0) return

    const baseValue = control === 'h'
      ? activeColorHsva.h
      : activeColorHsva[control] * 255

    updateHsvaControlValue(control, baseValue + stepDirection)
  }, [activeColorHsva, getWheelStepDirection, updateHsvaControlValue])

  const startHsvaDrag = useCallback((control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return

    event.preventDefault()

    const baseValue = control === 'h'
      ? activeColorHsva.h
      : activeColorHsva[control] * 255

    event.currentTarget.setPointerCapture(event.pointerId)

    setHsvaDragState({
      control,
      pointerId: event.pointerId,
      startY: event.clientY,
      baseValue,
    })

    updateHsvaControlValue(control, baseValue)
  }, [activeColorHsva, updateHsvaControlValue])

  const handleHsvaDragMove = useCallback((control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => {
    const currentDrag = hsvaDragState
    if (!currentDrag) return
    if (currentDrag.control !== control) return
    if (currentDrag.pointerId !== event.pointerId) return

    event.preventDefault()
    const delta = currentDrag.startY - event.clientY
    updateHsvaControlValue(control, currentDrag.baseValue + delta)
  }, [hsvaDragState, updateHsvaControlValue])

  const stopHsvaDrag = useCallback((control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => {
    const currentDrag = hsvaDragState
    if (!currentDrag) return
    if (currentDrag.control !== control) return
    if (currentDrag.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    setHsvaDragState(null)
  }, [hsvaDragState])

  // Mouse-cursor-overlay color widget (Options > Mouse options): a local
  // closed loop, not tied to primedColorSource/colorArmTimerRef above -- see
  // cursorColorHsva's declaration for why. Left-click on a row-2 swatch
  // applies the staged H/S/V/A; holding right-click on one copies its color
  // back into the staged H/S/V/A, mirroring startElementPreviewCopyHold.
  const clearCursorColorArmTimer = useCallback(() => {
    if (cursorColorArmTimerRef.current === null) return
    window.clearTimeout(cursorColorArmTimerRef.current)
    cursorColorArmTimerRef.current = null
  }, [])

  const applyCursorColorToTarget = useCallback((target: CursorColorTargetKey) => {
    const css = rgbaToCssColor(hsvaToRgba(cursorColorHsva))
    if (target === 'dot') setCustomCursorDotColor(css)
    else if (target === 'center') setCustomCursorCenterColor(css)
    else if (target === 'halo') setCustomCursorHaloColor(css)
    else setCustomCursorTrailColor(css)
  }, [cursorColorHsva])

  const copyCursorTargetColorToHsva = useCallback((target: CursorColorTargetKey) => {
    const css = target === 'dot' ? customCursorDotColor
      : target === 'center' ? customCursorCenterColor
      : target === 'halo' ? customCursorHaloColor
      : customCursorTrailColor
    const rgba = parseCssColorToRgba(css)
    if (!rgba) return
    setCursorColorHsva(rgbaToHsva(rgba))
  }, [customCursorDotColor, customCursorCenterColor, customCursorHaloColor, customCursorTrailColor])

  const startCursorColorCopyHold = useCallback((target: CursorColorTargetKey, event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()
    clearCursorColorArmTimer()

    cursorColorArmTimerRef.current = window.setTimeout(() => {
      copyCursorTargetColorToHsva(target)
      cursorColorArmTimerRef.current = null
    }, COLOR_BUTTON_ARM_HOLD_MS)
  }, [clearCursorColorArmTimer, copyCursorTargetColorToHsva])

  const updateCursorHsvaControlValue = useCallback((control: HsvaControlKey, rawValue: number) => {
    setCursorColorHsva((previous) => {
      if (control === 'h') {
        const nextHue = Math.max(0, Math.min(360, rawValue))
        return { ...previous, h: nextHue }
      }

      const normalized = Math.max(0, Math.min(1, rawValue / 255))
      return { ...previous, [control]: normalized }
    })
  }, [])

  const wheelAdjustCursorHsvaControl = useCallback((control: HsvaControlKey, event: React.WheelEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const stepDirection = getWheelStepDirection(event)
    if (stepDirection === 0) return

    const baseValue = control === 'h'
      ? cursorColorHsva.h
      : cursorColorHsva[control] * 255

    updateCursorHsvaControlValue(control, baseValue + stepDirection)
  }, [cursorColorHsva, getWheelStepDirection, updateCursorHsvaControlValue])

  const startCursorHsvaDrag = useCallback((control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return

    event.preventDefault()

    const baseValue = control === 'h'
      ? cursorColorHsva.h
      : cursorColorHsva[control] * 255

    event.currentTarget.setPointerCapture(event.pointerId)

    setCursorHsvaDragState({
      control,
      pointerId: event.pointerId,
      startY: event.clientY,
      baseValue,
    })

    updateCursorHsvaControlValue(control, baseValue)
  }, [cursorColorHsva, updateCursorHsvaControlValue])

  const handleCursorHsvaDragMove = useCallback((control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => {
    const currentDrag = cursorHsvaDragState
    if (!currentDrag) return
    if (currentDrag.control !== control) return
    if (currentDrag.pointerId !== event.pointerId) return

    event.preventDefault()
    const delta = currentDrag.startY - event.clientY
    updateCursorHsvaControlValue(control, currentDrag.baseValue + delta)
  }, [cursorHsvaDragState, updateCursorHsvaControlValue])

  const stopCursorHsvaDrag = useCallback((control: HsvaControlKey, event: PointerEvent<HTMLButtonElement>) => {
    const currentDrag = cursorHsvaDragState
    if (!currentDrag) return
    if (currentDrag.control !== control) return
    if (currentDrag.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    setCursorHsvaDragState(null)
  }, [cursorHsvaDragState])

  const getTextureControlBounds = useCallback((control: TextureControlKey) => {
    if (control === 'granularity') {
      return {
        min: TEXTURE_GRANULARITY_MIN,
        max: TEXTURE_GRANULARITY_MAX,
      }
    }

    return {
      min: TEXTURE_VSTEPS_MIN,
      max: TEXTURE_VSTEPS_MAX,
    }
  }, [])

  const getTextureControlValue = useCallback((control: TextureControlKey) => {
    if (control === 'granularity') {
      return texturePreviewMaterial.granularity
    }

    return texturePreviewMaterial.vSteps
  }, [texturePreviewMaterial.granularity, texturePreviewMaterial.vSteps])

  const updateTextureControlValue = useCallback((control: TextureControlKey, rawValue: number) => {
    const bounds = getTextureControlBounds(control)
    const nextValue = clamp(Math.round(rawValue), bounds.min, bounds.max)

    setTexturePreviewMaterial((current) => {
      if (control === 'granularity') {
        if (current.granularity === nextValue) return current
        return {
          ...current,
          granularity: nextValue,
        }
      }

      if (current.vSteps === nextValue) return current
      return {
        ...current,
        vSteps: nextValue,
      }
    })
  }, [getTextureControlBounds])

  const wheelAdjustTextureControl = useCallback((control: TextureControlKey, event: React.WheelEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const stepDirection = getWheelStepDirection(event)
    if (stepDirection === 0) return

    updateTextureControlValue(control, getTextureControlValue(control) + stepDirection)
  }, [getTextureControlValue, getWheelStepDirection, updateTextureControlValue])

  const startTextureControlDrag = useCallback((control: TextureControlKey, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()

    const baseValue = getTextureControlValue(control)
    event.currentTarget.setPointerCapture(event.pointerId)

    setTextureControlDragState({
      control,
      pointerId: event.pointerId,
      startY: event.clientY,
      baseValue,
    })

    updateTextureControlValue(control, baseValue)
  }, [getTextureControlValue, updateTextureControlValue])

  const handleTextureControlDragMove = useCallback((control: TextureControlKey, event: PointerEvent<HTMLButtonElement>) => {
    const currentDrag = textureControlDragState
    if (!currentDrag) return
    if (currentDrag.control !== control) return
    if (currentDrag.pointerId !== event.pointerId) return

    event.preventDefault()
    const delta = currentDrag.startY - event.clientY
    updateTextureControlValue(control, currentDrag.baseValue + delta)
  }, [textureControlDragState, updateTextureControlValue])

  const stopTextureControlDrag = useCallback((control: TextureControlKey, event: PointerEvent<HTMLButtonElement>) => {
    const currentDrag = textureControlDragState
    if (!currentDrag) return
    if (currentDrag.control !== control) return
    if (currentDrag.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    setTextureControlDragState(null)
  }, [textureControlDragState])

  useEffect(() => {
    if (!hsvaDragState && !textureControlDragState) {
      document.body.classList.remove('hsva-dragging')
      return
    }

    document.body.classList.add('hsva-dragging')
    return () => {
      document.body.classList.remove('hsva-dragging')
    }
  }, [hsvaDragState, textureControlDragState])

  useEffect(() => {
    if (sidebarMode !== 'options') return

    const optionsContentEl = optionsContentRef.current
    if (!optionsContentEl) return

    const handleOptionsWheelCapture = (event: WheelEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return

      if (!target.closest('.options-hsva-control, .options-texture-control-btn')) {
        return
      }

      event.preventDefault()
    }

    optionsContentEl.addEventListener('wheel', handleOptionsWheelCapture, { capture: true, passive: false })
    return () => {
      optionsContentEl.removeEventListener('wheel', handleOptionsWheelCapture, true)
    }
  }, [sidebarMode])

  useEffect(() => {
    return () => {
      clearColorArmTimer()
    }
  }, [clearColorArmTimer])

  // Runs once persistence has fully restored appState (including uiMode,
  // set deep inside the bootstrap effect further below). Firing this on
  // plain mount (`[]`) instead of `[persistenceReady]` was the bug: uiMode
  // is a state value closed over at the time this effect was created, and
  // with an empty dependency array that's permanently the initial 'light'
  // default â€” no matter what the bootstrap effect later restores it to.
  // That meant every launch re-applied the light-mode loadout's payload
  // (colors, filters, glaze, audio, everything â€” see applyEntryToLiveState)
  // over whatever appState had just correctly restored, even when the app
  // was last closed in dark mode. Gating on persistenceReady means this
  // effect's closure is freshly created on the render where uiMode already
  // holds its final restored value.
  useEffect(() => {
    if (!persistenceReady) return
    if (!window.thockdownLoadouts) return
    let cancelled = false

    void window.thockdownLoadouts.list()
      .then((result) => {
        if (cancelled) return
        setUiLoadoutEntries(result.entries)
        setLastCustomIdByMode(result.lastCustomIdByMode)
        const sign = modeSign(uiMode)
        const active = result.entries.find((entry) => entry.id * sign > 0 && entry.isActive)
        if (active) applyEntryToLiveState(active)
      })
      .catch((error) => {
        console.error('Failed to load UI loadouts', error)
      })

    return () => {
      cancelled = true
    }
    // uiMode is intentionally excluded: manual light/dark toggling already
    // applies the target mode's loadout itself (see toggleUiMode) â€” this
    // effect's job is only the one-time apply-on-launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistenceReady])

  useEffect(() => {
    const handleGlobalMouseDown = (event: globalThis.MouseEvent) => {
      if (event.button !== 2) return
      clearColorArmTimer()
    }

    window.addEventListener('mousedown', handleGlobalMouseDown, true)
    return () => {
      window.removeEventListener('mousedown', handleGlobalMouseDown, true)
    }
  }, [clearColorArmTimer])

  // Debounced: whenever the live captured state drifts from the active entry
  // for the current mode, push it to the pending row (+/-7) on the backend.
  useEffect(() => {
    if (!window.thockdownLoadouts) return
    if (!activeEntryForCurrentMode) return
    if (activeEntryForCurrentMode.signature === currentUiLoadoutSignature) return

    if (pendingUpdateDebounceRef.current !== null) {
      window.clearTimeout(pendingUpdateDebounceRef.current)
    }

    pendingUpdateDebounceRef.current = window.setTimeout(() => {
      pendingUpdateDebounceRef.current = null
      void window.thockdownLoadouts?.updatePending(uiMode, capturedUiLayoutLoadout)
        .then((result) => {
          if (!result) return
          setUiLoadoutEntries(result.entries)
          setLastCustomIdByMode(result.lastCustomIdByMode)
        })
        .catch((error) => {
          console.error('Failed to update pending UI loadout', error)
        })
    }, PENDING_UPDATE_DEBOUNCE_MS)

    return () => {
      if (pendingUpdateDebounceRef.current !== null) {
        window.clearTimeout(pendingUpdateDebounceRef.current)
        pendingUpdateDebounceRef.current = null
      }
    }
  }, [activeEntryForCurrentMode, currentUiLoadoutSignature, uiMode, capturedUiLayoutLoadout])

  // The following are all defined later in this component than
  // <EditorSection> is rendered, so it receives stable ref-wrapped proxies
  // instead of the live values directly (EditorSection forwards them into
  // its own internal useEditorSectionMount call). Each ref is synced with a
  // plain assignment right after the real function's own definition,
  // further down -- not a useEffect, since refs don't need one and this
  // keeps them current within the same render rather than one render behind.
  const queueAppStateSaveRef = useRef<(selectedNoteId: string | null) => void>(() => {})
  const updateActiveNoteTitlePreviewRef = useRef<(nextText: string) => void>(() => {})
  const revealNoteInMenuRef = useRef<() => void>(() => {})
  const writeDebugEntryRef = useRef<(functionName: string, lines: string[]) => Promise<void>>(async () => {})
  const activeNoteHasDebugTagRef = useRef(false)
  // Same ref-proxy technique as the four above, for the same TDZ reason --
  // persistMenuStateNow is declared later than handleToggleDoubleSizeMode/
  // toggleSidebarVisible, which both need to call it. Unlike those four,
  // nothing needs a *stable-identity* wrapper around this one (it's only
  // ever called directly, never handed to a prop or another hook's deps
  // array), so there's no xStable counterpart -- callers just use
  // persistMenuStateNowRef.current(...) directly. Critically, a plain ref
  // reassigned unconditionally every render (see the assignment right after
  // persistMenuStateNow's own definition) is what keeps this from going
  // stale -- confirmed live: an earlier version of this fix instead put
  // persistMenuStateNow itself in a `useCallback` and had the two early
  // handlers call it directly with an empty deps array, which pinned them
  // to the *first* render's persistMenuStateNow forever -- captured while
  // persistenceReady was still false, so the toggle silently stopped
  // persisting anything at all. A dependency array can't fix this without
  // also being able to list persistMenuStateNow itself, which is exactly
  // what TDZ forbids here -- a ref sidesteps the whole problem instead of
  // fighting it.
  const persistMenuStateNowRef = useRef<(overrides?: Parameters<typeof buildMenuStateSnapshot>[0]) => Promise<void> | undefined>(() => undefined)

  const queueAppStateSaveStable = useCallback((selectedNoteId: string | null) => queueAppStateSaveRef.current(selectedNoteId), [])
  const updateActiveNoteTitlePreviewStable = useCallback((nextText: string) => updateActiveNoteTitlePreviewRef.current(nextText), [])
  const revealNoteInMenuStable = useCallback(() => revealNoteInMenuRef.current(), [])
  const writeDebugEntryStable = useCallback((functionName: string, lines: string[]) => writeDebugEntryRef.current(functionName, lines), [])

  const persistedMenuStateRef = useRef<PersistedMenuState | null>(null)

  const buildMenuStateSnapshot = useCallback((overrides?: {
    sidebarMode?: SidebarMode
    sidebarViewStateByMode?: SidebarViewStateByMode
    isSidebarVisible?: boolean
    isDoubleSizeMode?: boolean
    reviewGutterVisibleBySection?: Record<string, boolean>
    reviewFlagsVisibleBySection?: Record<string, boolean>
  }): PersistedMenuState => {
    const effectiveViewStateByMode = overrides?.sidebarViewStateByMode ?? sidebarViewStateByMode

    return {
      sidebarMode: overrides?.sidebarMode ?? sidebarMode,
      selectedMonths: [...selectedMonths],
      selectedYears: [...selectedYears],
      searchQuery,
      searchQueryCaseSensitive: isSearchQueryCaseSensitive,
      documentFindCaseSensitive: documentFindCaseSensitiveRef.current,
      isPreviewMode: getActiveSection()?.isPreviewMode,
      viewStyle,
      viewFontSize,
      viewSpacing,
      viewLetterSpacingEm,
      editorStyle,
      editorFontSize,
      editorSpacing,
      editorGlyphPaddingPx,
      uiFontStyle,
      uiFontScale,
      borderRadiusRegularPx,
      spacingRegularPx,
      borderAlphaPercent,
      boxShadowAlphaPercent,

      exportFolder: exportFolder ?? undefined,
      renderScrollDynamic,
      renderScrollResponsiveness,
      renderScrollTotalTimeSec,
      renderScrollMaxSpeedPxPerSec,
      renderScrollSkew,
      glaze: glazeSettings,
      darkMode,
      uiMode,
      filterInvert,
      filterSepia,
      filterHueRotate,
      filterBrightness,
      filterContrast,
      filterSaturate,
      filterColorize,
      audioKeyVolume,
      audioKeyVariance,
      audioPitch,
      audioBassVolume,
      audioTrebleVolume,
      typingSoundSet,
      musicVolume,
      musicReverbAmount,
      musicReverbRoom,
      musicActiveSlots,
      musicLastSongId: musicPlaybackRef.current.songId ?? undefined,
      musicLastPositionSec: musicPlaybackRef.current.positionSec,
      musicWasPlaying: musicPlaybackRef.current.wasPlaying,
      highlightCaretColor: highlightColors.caret,
      highlightSearchColor: highlightColors.search,
      highlightSelectionColor: highlightColors.selectionEdit,
      highlightSelectionEditColor: highlightColors.selectionEdit,
      highlightSelectionRenderColor: highlightColors.selectionRender,
      highlightTextBaseColor: highlightColors.textBase,
      highlightTextEmbossColor: highlightColors.textEmbossUi,
      highlightTextEmbossEditColor: highlightColors.textEmbossEdit,
      highlightTextEmbossRenderColor: highlightColors.textEmbossRender,
      highlightTextEmbossUiColor: highlightColors.textEmbossUi,
      highlightBackgroundColor: highlightColors.background,
      highlightTopBackgroundColor: highlightColors.topBackground,
      highlightBottomBackgroundColor: highlightColors.bottomBackground,
      highlightGridOutlineColor: highlightColors.gridOutline,
      highlightGridColor: highlightColors.grid,
      highlightGutterBackgroundColor: highlightColors.gutterBackground,
      highlightReviewColor: highlightColors.reviewLine,
      highlightWarningColor: highlightColors.warningLine,
      highlightLineNumberColor: highlightColors.lineNumber,
      highlightBaseColor: highlightColors.base,
      highlightInputFieldsColor: highlightColors.inputFields,
      highlightAppButtonsColor: highlightColors.appButtons,
      highlightMarkdownHeadlineColor: highlightColors.markdownHeadline,
      highlightMarkdownListColor: highlightColors.markdownList,
      highlightMarkdownBlockquoteColor: highlightColors.markdownBlockquote,
      highlightMarkdownCodeColor: highlightColors.markdownCode,
      highlightMarkdownCheckedColor: highlightColors.markdownChecked,
      highlightMarkdownUncheckedColor: highlightColors.markdownUnchecked,
      textureEnabled,
      editorEditTextColor: editorTextColors.editorEditText,
      editorRenderTextColor: editorTextColors.editorRenderText,
      textureMaterials,
      sidebarViewState: {
        ...effectiveViewStateByMode,
        category: {
          ...effectiveViewStateByMode.category,
          collapsedPrimary: categoryCollapsedPrimary,
          collapsedSecondary: categoryCollapsedSecondary,
        },
        archive: {
          ...effectiveViewStateByMode.archive,
          collapsedPrimary: archiveCollapsedPrimary,
          collapsedSecondary: archiveCollapsedSecondary,
        },
      },
      debuggingEnabled,
      spellCheckEnabled,
      tabBarMode: tabBarModeRef.current,
      isSidebarVisible: overrides?.isSidebarVisible ?? isSidebarVisible,
      isDoubleSizeMode: overrides?.isDoubleSizeMode ?? isDoubleSizeMode,
      reviewGutterVisibleBySection: overrides?.reviewGutterVisibleBySection ?? reviewGutterVisibleBySection,
      reviewFlagsVisibleBySection: overrides?.reviewFlagsVisibleBySection ?? reviewFlagsVisibleBySection,
      // Machine-level performance prefs, deliberately NOT part of
      // UiLayoutLoadout -- these must survive switching between layouts
      // rather than being reset to whatever each layout last had stored.
      reduceVisualEffects,
      reducedCaretAnimation,
      deferPreviewOnRapidInput,
      customCursorEnabled,
    }
  }, [
    archiveCollapsedPrimary,
    archiveCollapsedSecondary,
    customCursorEnabled,
    categoryCollapsedPrimary,
    categoryCollapsedSecondary,
    debuggingEnabled,
    spellCheckEnabled,
    reduceVisualEffects,
    reducedCaretAnimation,
    deferPreviewOnRapidInput,
    editorFontSize,
    editorGlyphPaddingPx,
    uiFontStyle,
    uiFontScale,
    borderRadiusRegularPx,
    spacingRegularPx,
    borderAlphaPercent,
    boxShadowAlphaPercent,
    editorSpacing,
    editorStyle,
    exportFolder,
    getActiveSection,
    renderScrollDynamic,
    renderScrollResponsiveness,
    renderScrollMaxSpeedPxPerSec,
    renderScrollSkew,
    renderScrollTotalTimeSec,
    audioKeyVolume,
    audioKeyVariance,
    audioPitch,
    audioBassVolume,
    audioTrebleVolume,
    textureEnabled,
    glazeSettings,
    musicVolume,
    musicReverbAmount,
    musicReverbRoom,
    musicActiveSlots,
    darkMode,
    uiMode,
    filterInvert,
    filterSepia,
    filterHueRotate,
    filterBrightness,
    filterContrast,
    filterSaturate,
    filterColorize,
    typingSoundSet,
    textureMaterials,
    highlightColors,
    editorTextColors,
    isSearchQueryCaseSensitive,
    searchQuery,
    selectedMonths,
    selectedYears,
    sidebarMode,
    sidebarViewStateByMode,
    isSidebarVisible,
    isDoubleSizeMode,
    reviewGutterVisibleBySection,
    reviewFlagsVisibleBySection,
    viewFontSize,
    viewSpacing,
    viewLetterSpacingEm,
    viewStyle,
  ])

  /**
   * The one correct way to persist an app-state menu change *right now*
   * (as opposed to the debounced queueAppStateSave path further down, meant
   * for high-frequency changes like scrolling). Builds a fresh snapshot via
   * buildMenuStateSnapshot, updates persistedMenuStateRef, then saves it.
   *
   * That ref update is load-bearing, not tidiness: queueAppStateSave's own
   * debounced flush prefers persistedMenuStateRef.current over building a
   * fresh snapshot itself, so if some *other* immediate-persist call site
   * skips updating the ref, its correctly-saved value gets silently
   * overwritten by the very next debounced flush -- triggered by anything
   * at all (switching notes, scrolling), or even just idling for about a
   * second while some unrelated background save was already pending.
   *
   * This is not a hypothetical: hand-rolling buildMenuStateSnapshot +
   * saveAppState without this ref update independently caused the exact
   * same silent-persistence-loss bug at least four separate times --
   * double-size mode, sidebar visibility, the options-menu auto-show-
   * sidebar path, and review-gutter visibility, the last of which even had
   * its own doc comment describing the hand-rolled pattern as the norm
   * other toggles should copy. If you're adding a new instant (non-
   * debounced) menu-state toggle, call this -- do not hand-roll
   * buildMenuStateSnapshot+saveAppState again.
   */
  const persistMenuStateNow = useCallback((overrides?: Parameters<typeof buildMenuStateSnapshot>[0]) => {
    if (!window.thockdownState || !persistenceReady) return undefined
    const snapshot = buildMenuStateSnapshot(overrides)
    persistedMenuStateRef.current = snapshot
    const section = getActiveSection()
    return window.thockdownState.saveAppState({
      selectedNoteId: section?.activeNoteId ?? null,
      viewport: section?.latestViewportRef.current ?? undefined,
      menu: snapshot,
    })
  }, [buildMenuStateSnapshot, getActiveSection, persistenceReady])
  // Unconditional plain assignment, every render -- see persistMenuStateNowRef's
  // own doc comment above for why this (not a dependency array) is what
  // keeps handleToggleDoubleSizeMode/toggleSidebarVisible's calls fresh.
  persistMenuStateNowRef.current = persistMenuStateNow

  const getSidebarScrollerForMode = useCallback((mode: SidebarMode): HTMLDivElement | null => {
    if (mode === 'category' || mode === 'archive' || mode === 'find') {
      return sidebarTreeScrollerEl
    }

    return sidebarContentRef.current
  }, [sidebarTreeScrollerEl])

  const captureSidebarModeState = useCallback((mode: SidebarMode): SidebarViewState => {
    const baseline = sidebarViewStateByMode[mode] ?? sanitizeSidebarViewState(undefined)
    const scroller = getSidebarScrollerForMode(mode)
    const scrollTop = scroller
      ? Math.max(0, Math.round(scroller.scrollTop))
      : baseline.scrollTop

    const base: SidebarViewState = {
      scrollTop,
      page: baseline.page,
      collapsedPrimary: baseline.collapsedPrimary,
      collapsedSecondary: baseline.collapsedSecondary,
    }

    if (mode === 'date' || mode === 'trash') {
      base.page = Math.max(1, currentPage)
    }

    if (mode === 'category') {
      base.collapsedPrimary = categoryCollapsedPrimary
      base.collapsedSecondary = categoryCollapsedSecondary
    }

    if (mode === 'archive') {
      base.collapsedPrimary = archiveCollapsedPrimary
      base.collapsedSecondary = archiveCollapsedSecondary
    }

    return base
  }, [
    archiveCollapsedPrimary,
    archiveCollapsedSecondary,
    categoryCollapsedPrimary,
    categoryCollapsedSecondary,
    currentPage,
    getSidebarScrollerForMode,
    sidebarViewStateByMode,
  ])

  const restoreSidebarModeStateFrom = useCallback((
    mode: SidebarMode,
    viewStateByMode: SidebarViewStateByMode,
  ) => {
    const snapshot = viewStateByMode[mode] ?? sanitizeSidebarViewState(undefined)
    pendingSidebarScrollRestoreRef.current = {
      mode,
      scrollTop: snapshot.scrollTop,
    }

    if (mode === 'date' || mode === 'trash') {
      setCurrentPage(Math.max(1, snapshot.page || 1))
    }

    if (mode === 'category') {
      setCategoryCollapsedPrimary(snapshot.collapsedPrimary)
      setCategoryCollapsedSecondary(snapshot.collapsedSecondary)
    }

    if (mode === 'archive') {
      setArchiveCollapsedPrimary(snapshot.collapsedPrimary)
      setArchiveCollapsedSecondary(snapshot.collapsedSecondary)
    }
  }, [])

  // extraOverrides exists for callers that changed some OTHER menu field
  // (e.g. isSidebarVisible) in the same synchronous handler just before
  // triggering this transition -- see toggleSidebarOptionsMenu, the reason
  // this parameter exists. Passing it through here (merged into the same
  // snapshot as sidebarMode/sidebarViewStateByMode) is load-bearing, not a
  // convenience: buildMenuStateSnapshot falls back to reading isSidebarVisible
  // off live React state for anything not explicitly overridden, and that
  // state hasn't re-rendered yet this tick -- a caller that persisted its
  // own change first, via a *separate* persistMenuStateNow call, would just
  // get it silently clobbered back to the pre-change value by this call
  // (confirmed live: exactly what toggleSidebarOptionsMenu was doing).
  const persistMenuStateOnce = useCallback(async (
    nextSidebarMode: SidebarMode,
    nextSidebarViewStateByMode: SidebarViewStateByMode,
    extraOverrides?: Parameters<typeof buildMenuStateSnapshot>[0],
  ) => {
    await persistMenuStateNow({
      ...extraOverrides,
      sidebarMode: nextSidebarMode,
      sidebarViewStateByMode: nextSidebarViewStateByMode,
    })
  }, [persistMenuStateNow])

  const persistMenuStateOnUnload = useCallback(() => {
    const currentModeSnapshot = captureSidebarModeState(sidebarMode)
    const nextSidebarViewStateByMode: SidebarViewStateByMode = {
      ...sidebarViewStateByMode,
      [sidebarMode]: currentModeSnapshot,
    }

    persistMenuStateNow({
      sidebarMode,
      sidebarViewStateByMode: nextSidebarViewStateByMode,
    })
  }, [
    captureSidebarModeState,
    persistMenuStateNow,
    sidebarMode,
    sidebarViewStateByMode,
  ])

  const focusActiveNoteInSidebarMode = useCallback((mode: SidebarMode): boolean => {
    // menuIdentityNoteId, not activeNoteId directly -- a chapter is never in
    // any of these menu-derived sources, so locating "the note this section
    // is showing" here means its parent when a chapter is loaded.
    const activeNoteId = getActiveSection()?.menuIdentityNoteId
    if (!activeNoteId) {
      return false
    }

    if (mode === 'date' || mode === 'trash') {
      const source = mode === 'date' ? dateFilteredNotesRef.current : trashFilteredNotesRef.current
      const noteIndex = source.findIndex((note) => note.id === activeNoteId)
      if (noteIndex < 0) {
        return false
      }

      // Measure itemsPerPage from the DOM directly â€” same calculation as the
      // useLayoutEffect compute() â€” so the target page always agrees with
      // the clamp that compute() applies. Using the itemsPerPage state value
      // risks a frame where state and DOM measurement disagree.
      const container = sidebarContentRef.current
      const list = container?.querySelector('.notes-list') as HTMLElement | null
      const firstItem = list?.querySelector('.note-list-item') as HTMLElement | null
      const listStyles = list ? window.getComputedStyle(list) : null
      const rowHeight = firstItem ? Math.round(firstItem.getBoundingClientRect().height) : 48
      const rowGap = listStyles ? Math.round(parseFloat(listStyles.rowGap || listStyles.gap || '8')) : 8
      const paddingTop = listStyles ? Math.round(parseFloat(listStyles.paddingTop || '10')) : 10
      const paddingBottom = listStyles ? Math.round(parseFloat(listStyles.paddingBottom || '10')) : 10
      const contentHeight = container ? container.clientHeight - paddingTop - paddingBottom : 0
      const measuredItemsPerPage = Math.max(1, Math.floor((contentHeight + rowGap) / (rowHeight + rowGap)))

      const targetPage = Math.floor(noteIndex / measuredItemsPerPage) + 1
      setCurrentPage(targetPage)
      return true
    }

    if (mode === 'category' || mode === 'archive') {
      const source = mode === 'category' ? categoryTreeRef.current : archiveTreeRef.current
      const noteExists = source.some((primary) =>
        primary.secondary.some((secondary) => secondary.tertiary.some((tertiary) => tertiary.notes.some((note) => note.id === activeNoteId))),
      )

      if (!noteExists) {
        return false
      }

      if (mode === 'category') {
        setCategoryFocusRequestKey((previous) => previous + 1)
      } else {
        setArchiveFocusRequestKey((previous) => previous + 1)
      }

      return true
    }

    return false
  }, [getActiveSection])

  const runSidebarMenuTransition = useCallback((
    nextMode: SidebarMode,
    // Passed straight through to persistMenuStateOnce -- see its own doc
    // comment for why a caller that just changed some other menu field
    // (e.g. isSidebarVisible) needs to hand it over here rather than
    // persisting it separately beforehand.
    extraOverrides?: Parameters<typeof buildMenuStateSnapshot>[0],
  ) => {
    if (nextMode === sidebarMode) {
      return
    }

    const leavingSnapshot = captureSidebarModeState(sidebarMode)
    const nextSidebarViewStateByMode: SidebarViewStateByMode = {
      ...sidebarViewStateByMode,
      [sidebarMode]: leavingSnapshot,
    }

    if (sidebarMode === 'options' && nextMode !== 'options') {
      setLastSidebarModeBeforeOptions(nextMode)
      // Clear one-shot music force-open intent when leaving options mode.
      setMusicAccordionNonce(0)
    }

    setSidebarViewStateByMode(nextSidebarViewStateByMode)
    setSidebarMode(nextMode)
    restoreSidebarModeStateFrom(nextMode, nextSidebarViewStateByMode)
    void persistMenuStateOnce(nextMode, nextSidebarViewStateByMode, extraOverrides)
    // Defer focus so the new mode's render (with updated filtered notes / tree
    // state) has committed before we attempt to jump page or unfold the tree.
    requestAnimationFrame(() => {
      focusActiveNoteInSidebarMode(nextMode)
    })
  }, [
    sidebarMode,
    captureSidebarModeState,
    sidebarViewStateByMode,
    restoreSidebarModeStateFrom,
    persistMenuStateOnce,
    focusActiveNoteInSidebarMode,
  ])

  const toggleSidebarOptionsMenu = useCallback(() => {
    if (sidebarMode === 'options') {
      runSidebarMenuTransition(lastSidebarModeBeforeOptions)
      return
    }

    // Ensure the sidebar is visible when opening the options panel so the
    // options content is accessible.
    setIsSidebarVisible(true)
    try {
      window.windowControls?.setSidebarVisible?.(true)
    } catch (e) {
      // ignore
    }

    // Persist the sidebar-visible change together with the mode transition
    // below, in the SAME snapshot -- not as a separate persistMenuStateNow
    // call first. isSidebarVisible's React state (setIsSidebarVisible just
    // above) hasn't re-rendered yet this tick, so runSidebarMenuTransition's
    // own persist would otherwise read the *old* value straight out of
    // buildMenuStateSnapshot's fallback and silently overwrite a correct
    // separate write with it a moment later (confirmed live: that's exactly
    // what happened when this used to persist isSidebarVisible on its own
    // first). See persistMenuStateOnce's own doc comment for the general
    // rule this is an instance of.
    setLastSidebarModeBeforeOptions(sidebarMode)
    runSidebarMenuTransition('options', { isSidebarVisible: true })
  }, [lastSidebarModeBeforeOptions, runSidebarMenuTransition, sidebarMode])

  const handleWindowMinimize = useCallback(() => {
    window.windowControls?.minimize?.()
  }, [])

  const handleWindowUtilityCollapseToggle = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()

    const windowControlsEl = windowControlsGridRef.current
    if (!windowControlsEl) return

    const probe = windowControlsEl.cloneNode(true) as HTMLElement
    probe.classList.add('is-collapsed', 'is-measure-probe')
    document.body.appendChild(probe)

    const probeRect = probe.getBoundingClientRect()
    probe.remove()

    // windowControlsCollapsedWidthPx/probeRect are both measured in CSS px,
    // which page zoom leaves untouched (zoom shrinks the viewport, not fixed
    // CSS lengths) -- but win.setBounds() sizes the *native* window, which
    // does need to be 2x bigger to still contain content that's rendering at
    // 2x its CSS size on screen. Same reasoning as computeEffectiveMinSize()
    // in electron/main.ts for the normal (non-collapsed) window minimum.
    const doubleSizeMultiplier = isDoubleSizeMode ? 2 : 1
    const targetWidth = Math.max(96, windowControlsCollapsedWidthPx) * doubleSizeMultiplier
    const targetHeight = Math.max(40, Math.ceil(probeRect.height || 160)) * doubleSizeMultiplier

    // Ensure overlay is committed in the same event turn before native resize.
    flushSync(() => {
      setWindowModeTransitionOverlayNonce((previous) => previous + 1)
    })

    const toggleAfterOverlayFrame = async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve())
        })
      })
      await window.windowControls?.toggleUtilityCollapse?.({ width: targetWidth, height: targetHeight })
    }

    void toggleAfterOverlayFrame()
  }, [windowControlsCollapsedWidthPx, isDoubleSizeMode])

  const handleWindowToggleMaximize = useCallback(() => {
    window.windowControls?.toggleMaximize?.()
  }, [])

  const handleWindowClose = useCallback(() => {
    window.windowControls?.close?.()
  }, [])

  useEffect(() => {
    const unsubscribe = window.windowControls?.onMaximizeStateChange?.((isMaximized) => {
      setWindowIsMaximized(isMaximized)
    })
    return () => unsubscribe?.()
  }, [])

  useEffect(() => {
    const unsubscribe = window.windowControls?.onCollapsedStateChange?.((isCollapsed) => {
      setWindowIsCollapsed(isCollapsed)
      if (isCollapsed && sidebarMode === 'options') {
        runSidebarMenuTransition(lastSidebarModeBeforeOptions)
      }
    })
    return () => unsubscribe?.()
  }, [runSidebarMenuTransition, sidebarMode, lastSidebarModeBeforeOptions])

  useEffect(() => {
    window.windowControls?.reportBackgroundColor?.(rootBackgroundColorHex)
  }, [rootBackgroundColorHex])

  useEffect(() => {
    applyRenderScrollDynamic(renderScrollDynamic)
  }, [renderScrollDynamic])

  useEffect(() => {
    applyRenderScrollTotalTimeSec(renderScrollTotalTimeSec)
  }, [renderScrollTotalTimeSec])

  useEffect(() => {
    applyRenderScrollMaxSpeedPxPerSec(renderScrollMaxSpeedPxPerSec)
  }, [renderScrollMaxSpeedPxPerSec])

  useEffect(() => {
    applyRenderScrollSkew(renderScrollSkew)
  }, [renderScrollSkew])

  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) return

    let cancelled = false
    const fontSpec = `400 ${editorRuntimeMetrics.fontSizePx}px ${resolveEditorFontFamily(editorStyle)}`

    const ensureEditorFontLoaded = async () => {
      try {
        await document.fonts.load(fontSpec)
      } catch {
        return
      }

      if (!cancelled) {
        setEditorFontLoadVersion((previous) => previous + 1)
      }
    }

    void ensureEditorFontLoaded()

    return () => {
      cancelled = true
    }
  }, [editorStyle, editorRuntimeMetrics.fontSizePx])

  useLayoutEffect(() => {
    const appGridEl = appShellRef.current
    const sidebarEl = sidebarContentRef.current
    const stageEl = editorStageRef.current
    if (!appGridEl || !sidebarEl || !stageEl) return

    const updateAppGrid = () => {
      const rect = appGridEl.getBoundingClientRect()
      setAppGridTextureSize({
        width: quantizeTextureSize(rect.width),
        height: quantizeTextureSize(rect.height),
      })
    }
    const updateSidebar = () => {
      const rect = sidebarEl.getBoundingClientRect()
      setSidebarTextureSize({
        width: quantizeTextureSize(rect.width),
        height: quantizeTextureSize(rect.height),
      })
    }
    const updateEditorStage = () => {
      const rect = stageEl.getBoundingClientRect()
      setEditorStageTextureSize({
        width: quantizeTextureSize(rect.width),
        height: quantizeTextureSize(rect.height),
      })
    }

    updateAppGrid()
    updateSidebar()
    updateEditorStage()

    const observer = new ResizeObserver(() => {
      updateAppGrid()
      updateSidebar()
      updateEditorStage()
    })
    observer.observe(appGridEl)
    observer.observe(sidebarEl)
    observer.observe(stageEl)

    return () => {
      observer.disconnect()
    }
  }, [activeSectionSnapshot?.isPreviewMode])

  const layout = useMemo(() => {
    const toolbarWidthPx = Math.max(
      toolbarMinWidthPx,
      appShellWidthPx - (isSidebarVisible ? (sidebarWidthPx + GRID_DIVIDER_PX) : 0) - windowControlsWidthPx,
    )

    return {
      toolbarWidthPx,
      gridTemplateColumns: `${isSidebarVisible ? `${sidebarWidthPx}px ${GRID_DIVIDER_PX}px` : '0px 0px'} ${Math.round(toolbarWidthPx)}px ${windowControlsWidthPx}px`,
    }
  }, [appShellWidthPx, isSidebarVisible, sidebarWidthPx, toolbarMinWidthPx, windowControlsWidthPx])

  // The combined 'editor' grid area (tab bar + viewer) spans the same two
  // columns the old 'toolbar'/'window_control' areas did -- its actual
  // pixel width is toolbarWidthPx's column plus the window-controls column.
  const editorSectionsRowWidthPx = Math.round(layout.toolbarWidthPx) + windowControlsWidthPx
  const canCreateSection = editorSectionsRowWidthPx >= (
    (editorSections.length + 1) * SECTION_MIN_WIDTH_PX + editorSections.length * GRID_DIVIDER_PX
  )

  const appShellStyle = useMemo(() => {
    const borderRadiusRegularPxCss = `${borderRadiusRegularPx}px`
    const borderRadiusSmallPxCss = `${Math.max(0, borderRadiusRegularPx / 2)}px`
    const spacingRegularPxCss = `${spacingRegularPx}px`
    const style: CSSProperties & Record<string, string> = {
      gridTemplateColumns: layout.gridTemplateColumns,
      '--border-radius-regular': borderRadiusRegularPxCss,
      '--border-radius-small': borderRadiusSmallPxCss,
      '--spacing-regular': spacingRegularPxCss,
      '--color-bg-regular': highlightColors.background,
      '--color-bg-leading': highlightColors.topBackground,
      '--color-bg-trailing': highlightColors.bottomBackground,
      '--color-grid-outline': highlightColors.gridOutline,
      '--color-grid-bg': highlightColors.grid,
      '--color-gutter-bg': highlightColors.gutterBackground,
      '--color-review-line': highlightColors.reviewLine,
      '--color-warning-line': highlightColors.warningLine,
      '--color-line-number': lineNumberOpaqueCss,
      '--line-number-opacity': String(lineNumberRgba.a),
      '--color-caret': highlightColors.caret,
      '--color-selection': activeSectionSnapshot?.isPreviewMode ? highlightColors.selectionRender : highlightColors.selectionEdit,
      '--color-input-backdrop': highlightColors.inputFields,
      '--canonical-scroll-track-bg': highlightColors.inputFields,
      '--btn-bg-default': highlightColors.appButtons,
      '--canonical-handle-bg': highlightColors.appButtons,
      '--text-shadow-emboss-main': highlightColors.textEmbossUi,
      '--text-shadow-emboss-secondary': textEmbossUiSecondaryCss,
      '--text-shadow-emboss-ui-main': highlightColors.textEmbossUi,
      '--text-shadow-emboss-ui-secondary': textEmbossUiSecondaryCss,
      '--text-shadow-emboss-edit-main': highlightColors.textEmbossEdit,
      '--text-shadow-emboss-edit-secondary': textEmbossEditSecondaryCss,
      '--text-shadow-emboss-render-main': highlightColors.textEmbossRender,
      '--text-shadow-emboss-render-secondary': textEmbossRenderSecondaryCss,
      '--color-text-base': highlightColors.textBase,
      '--color-text-90': textColor90,
      '--color-text-80': textColor80,
      '--color-text-70': textColor70,
      '--color-text-60': textColor60,
      '--color-text-50': textColor50,
      '--color-text-40': textColor40,
      '--color-text-30': textColor30,
      '--color-text-20': textColor20,
      '--color-text-10': textColor10,
      '--color-editor-edit-text': editorEditTextColorCss,
      '--color-editor-render-text': editorRenderTextColorCss,
      '--texture-app-grid': appGridTextureCss,
      '--texture-sidebar-content': sidebarTextureCss,
      '--texture-editor-edit': editorEditTextTextureCss,
      '--texture-editor-render': editorRenderTextTextureCss,
      '--texture-app-grid-tint': appGridTextureTintCss,
      '--texture-sidebar-content-tint': sidebarTextureTintCss,
      '--texture-editor-edit-tint': editorEditTextureTintCss,
      '--texture-editor-render-tint': editorRenderTextureTintCss,
      '--markdown-headline-color': highlightColors.markdownHeadline,
      '--markdown-list-color': highlightColors.markdownList,
      '--markdown-blockquote-color': highlightColors.markdownBlockquote,
      '--markdown-code-color': highlightColors.markdownCode,
      '--markdown-checked-color': highlightColors.markdownChecked,
      '--markdown-unchecked-color': highlightColors.markdownUnchecked,
    }
    return style
  }, [
    appGridTextureCss,
    appGridTextureTintCss,
    borderRadiusRegularPx,
    spacingRegularPx,
    editorEditTextTextureCss,
    editorEditTextureTintCss,
    editorRenderTextTextureCss,
    editorRenderTextureTintCss,
    highlightColors,
    activeSectionSnapshot?.isPreviewMode,
    editorEditTextColorCss,
    editorRenderTextColorCss,
    layout.gridTemplateColumns,
    sidebarTextureCss,
    sidebarTextureTintCss,
    textEmbossUiSecondaryCss,
    textEmbossEditSecondaryCss,
    textEmbossRenderSecondaryCss,
    lineNumberOpaqueCss,
    lineNumberRgba,
    textColor90,
    textColor80,
    textColor70,
    textColor60,
    textColor50,
    textColor40,
    textColor30,
    textColor20,
    textColor10,
  ])

  // Apply all filter sliders at one wrapper level so the full composited scene
  // (base backdrop + glaze + sheen + app-shell + colorize) is filtered as one.
  //
  // Invert is treated as a real binary (filterInvert > 0.5, same threshold
  // already used elsewhere -- gloom/sheen color choice, shadow-flip) rather
  // than folded into the same continuous filter chain as the purely
  // decorative sliders: it's the app's core dark/light theming primitive
  // (every dark preset sets it), not an optional tint. When it's the ONLY
  // active visual effect -- which is exactly what "reduce visual effects +
  // dark mode" is -- it skips `filter` entirely and applies via a
  // mix-blend-mode overlay instead (see the invertViaBlendMode render
  // below), which is materially cheaper: filter forces re-rasterization of
  // this whole subtree on every repaint underneath it (see C2), while a
  // blend-mode overlay just changes how an already-current frame composites,
  // at the cost every frame pays anyway.
  //
  // This can ONLY be done risk-free when nothing else in the chain is
  // active: invert doesn't commute with sepia/brightness/contrast (unlike
  // hue-rotate, which is a pure hue-domain rotation and does commute with
  // invert) -- reordering invert relative to those would visibly change
  // every existing dark preset's tuned appearance (mono/dusk/neon/matrix all
  // pair invert with sepia/brightness/contrast). So whenever any of those
  // are also active, invert stays in the filter chain, in its original
  // first position, exactly as before -- zero behavior change for the
  // shipped presets.
  const { appOuterStyle, invertViaBlendMode } = useMemo(() => {
    const nonInvertFilterParts: string[] = []
    // Low-power toggle: a `filter` on this wrapper forces re-rasterization
    // of everything under it on every repaint (see C2) -- force the
    // decorative sliders off here rather than making the user reset every
    // one to get that back. Invert is handled separately below since it's
    // functional, not decorative.
    if (!reduceVisualEffects) {
      if (filterSepia > 0) nonInvertFilterParts.push(`sepia(${filterSepia})`)
      if (filterHueRotate !== 0) nonInvertFilterParts.push(`hue-rotate(${filterHueRotate}deg)`)
      if (filterBrightness !== 1) nonInvertFilterParts.push(`brightness(${filterBrightness})`)
      if (filterContrast !== 1) nonInvertFilterParts.push(`contrast(${filterContrast})`)

      const saturateCssValue = saturatePosToValue(filterSaturate)
      if (Math.abs(saturateCssValue - 1) > 0.001) {
        nonInvertFilterParts.push(`saturate(${saturateCssValue.toFixed(4)})`)
      }
    }

    const invertActive = filterInvert > 0.5
    const cheapInvert = invertActive && nonInvertFilterParts.length === 0

    const style: CSSProperties = {
      backgroundColor: 'var(--palette-parchment-lightest)',
    }
    const filterParts = cheapInvert
      ? nonInvertFilterParts
      : (filterInvert > 0 ? [`invert(${filterInvert})`, ...nonInvertFilterParts] : nonInvertFilterParts)
    if (filterParts.length > 0) {
      style.filter = filterParts.join(' ')
    }
    return { appOuterStyle: style, invertViaBlendMode: cheapInvert }
  }, [
    filterBrightness,
    filterContrast,
    filterHueRotate,
    filterInvert,
    filterSepia,
    filterSaturate,
    reduceVisualEffects,
  ])

  // Low-power toggle: forces every glaze layer's background-image to 'none'
  // regardless of individual slider positions -- combined with C1's
  // conditional mounting, this means the glaze-overlay-layer divs (and
  // their per-repaint mix-blend-mode cost) simply don't mount at all.
  const glazeLinearBackgroundImage = useMemo(() => {
    if (reduceVisualEffects) return 'none'
    const linearLayers = buildLinearGlazeLayers(glazeSettings)
    return linearLayers.length > 0 ? linearLayers.join(', ') : 'none'
  }, [glazeSettings, reduceVisualEffects])

  const glazeRadialBackgroundImage = useMemo(() => {
    if (reduceVisualEffects) return 'none'
    const radialLayers = buildRadialGlazeLayers(glazeSettings)
    return radialLayers.length > 0 ? radialLayers.join(', ') : 'none'
  }, [glazeSettings, reduceVisualEffects])

  const glazeGloomBackgroundImage = useMemo(() => {
    if (reduceVisualEffects) return 'none'
    return buildGloomGlazeLayer(glazeSettings, filterInvert > 0.5)
  }, [glazeSettings, filterInvert, reduceVisualEffects])

  const glazeSheenBackgroundImage = useMemo(() => {
    if (reduceVisualEffects) return 'none'
    return buildSheenGlazeLayer(glazeSettings, filterInvert > 0.5)
  }, [glazeSettings, filterInvert, reduceVisualEffects])

  const appRootStyle = useMemo(() => {
    const borderRadiusRegularPxCss = `${borderRadiusRegularPx}px`
    const borderRadiusSmallPxCss = `${Math.max(0, borderRadiusRegularPx / 2)}px`
    const spacingRegularPxCss = `${spacingRegularPx}px`
    return {
      '--border-radius-regular': borderRadiusRegularPxCss,
      '--border-radius-small': borderRadiusSmallPxCss,
      '--spacing-regular': spacingRegularPxCss,
      '--glaze-linear-background-image': glazeLinearBackgroundImage,
      '--glaze-radial-background-image': glazeRadialBackgroundImage,
      '--glaze-gloom-background-image': glazeGloomBackgroundImage,
      '--glaze-sheen-background-image': glazeSheenBackgroundImage,
      '--text-shadow-emboss-main': highlightColors.textEmbossUi,
      '--text-shadow-emboss-secondary': textEmbossUiSecondaryCss,
      '--text-shadow-emboss-ui-main': highlightColors.textEmbossUi,
      '--text-shadow-emboss-ui-secondary': textEmbossUiSecondaryCss,
      '--text-shadow-emboss-edit-main': highlightColors.textEmbossEdit,
      '--text-shadow-emboss-edit-secondary': textEmbossEditSecondaryCss,
      '--text-shadow-emboss-render-main': highlightColors.textEmbossRender,
      '--text-shadow-emboss-render-secondary': textEmbossRenderSecondaryCss,
      '--color-text-base': highlightColors.textBase,
      '--color-text-90': textColor90,
      '--color-text-80': textColor80,
      '--color-text-70': textColor70,
      '--color-text-60': textColor60,
      '--color-text-50': textColor50,
      '--color-text-40': textColor40,
      '--color-text-30': textColor30,
      '--color-text-20': textColor20,
      '--color-text-10': textColor10,
      '--palette-parchment-lightest': derivedPaletteColors.parchmentLightest,
      '--palette-parchment-light': derivedPaletteColors.parchmentLight,
      '--palette-parchment-mid': derivedPaletteColors.parchmentMid,
      '--palette-parchment-dark': derivedPaletteColors.parchmentDark,
      '--palette-parchment-input': derivedPaletteColors.parchmentInput,
      '--palette-shadow-white-lo': derivedPaletteColors.shadowWhiteLo,
      '--palette-shadow-white-mid': derivedPaletteColors.shadowWhiteMid,
      '--palette-shadow-white-hi': derivedPaletteColors.shadowWhiteHi,
    } as CSSProperties & Record<string, string>
  }, [
    derivedPaletteColors,
    borderRadiusRegularPx,
    spacingRegularPx,
    glazeLinearBackgroundImage,
    glazeRadialBackgroundImage,
    glazeGloomBackgroundImage,
    glazeSheenBackgroundImage,
    highlightColors.textEmbossUi,
    highlightColors.textEmbossEdit,
    highlightColors.textEmbossRender,
    highlightColors.textBase,
    textEmbossUiSecondaryCss,
    textEmbossEditSecondaryCss,
    textEmbossRenderSecondaryCss,
    textColor90,
    textColor80,
    textColor70,
    textColor60,
    textColor50,
    textColor40,
    textColor30,
    textColor20,
    textColor10,
  ])

  useEffect(() => {
    const rootStyle = document.documentElement.style
    rootStyle.setProperty('--border-radius-regular', `${borderRadiusRegularPx}px`)
    rootStyle.setProperty('--border-radius-small', `${Math.max(0, borderRadiusRegularPx / 2)}px`)
  }, [borderRadiusRegularPx])

  useEffect(() => {
    document.documentElement.style.setProperty('--spacing-regular', `${spacingRegularPx}px`)
  }, [spacingRegularPx])

  useEffect(() => {
    const rootStyle = document.documentElement.style
    rootStyle.setProperty('--ui-font-family', resolveUiFontFamily(uiFontStyle))
    rootStyle.setProperty('--ui-font-scale', String(uiFontScale))
    document.documentElement.dataset.uiFont = uiFontStyle
  }, [uiFontStyle, uiFontScale])

  // Base (un-scaled) value of each border/box-shadow token, captured the
  // first time it's read -- i.e. from tokens.css, before this effect ever
  // overrides it -- so repeated slider moves always scale from the original
  // design value instead of compounding on the previous override.
  useEffect(() => {
    const root = document.documentElement
    const computed = getComputedStyle(root)
    const factor = borderAlphaPercent / 100
    BORDER_ALPHA_TOKENS.forEach((token) => {
      let base = borderShadowAlphaBaseValuesRef.current.get(token)
      if (base === undefined) {
        base = resolveCssVarValueDeep(computed.getPropertyValue(token).trim(), computed)
        borderShadowAlphaBaseValuesRef.current.set(token, base)
      }
      root.style.setProperty(token, scaleAlphaInCssValue(base, factor))
    })
  }, [borderAlphaPercent])

  useEffect(() => {
    const root = document.documentElement
    const computed = getComputedStyle(root)
    const factor = boxShadowAlphaPercent / 100
    BOX_SHADOW_ALPHA_TOKENS.forEach((token) => {
      let base = borderShadowAlphaBaseValuesRef.current.get(token)
      if (base === undefined) {
        base = resolveCssVarValueDeep(computed.getPropertyValue(token).trim(), computed)
        borderShadowAlphaBaseValuesRef.current.set(token, base)
      }
      root.style.setProperty(token, scaleAlphaInCssValue(base, factor))
    })
  }, [boxShadowAlphaPercent])

  // Writes a structured debug entry to a session-scoped debug note (tagged
  // "debug"). No-ops when debuggingEnabled is false. Safe to call from any
  // async or sync context â€” creation and tagging are fire-and-forget.
  const createDebugNote = useCallback(async (): Promise<string | null> => {
    if (!window.thockdownNotes) return null

    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const title = `# Debug: ${dateStr} / ${pad(now.getHours())}:${pad(now.getMinutes())}`

    try {
      const created = await window.thockdownNotes.createNote({ initialText: `${title}\n` })
      debugNoteIdRef.current = created.id
      setNotes((previous) => {
        const index = previous.findIndex(n => n.id === created.id)
        if (index >= 0) return previous
        return [created, ...previous]
      })
      await window.thockdownNotes.addTagToNote({ id: created.id, tagName: DEBUG_TAG_NAME, position: 0 }).catch(() => {})
      return created.id
    } catch (error) {
      console.error('Failed to create debug note', error)
      return null
    }
  }, [])

  const findExistingDebugNoteId = useCallback(async (): Promise<string | null> => {
    if (!window.thockdownNotes) return null

    try {
      const listed = await window.thockdownNotes.listNotes()
      const existing = listed.find((note) => {
        const normalizedTags = new Set(note.tags.map((tag) => normalizeTagName(tag)))
        return normalizedTags.has(DEBUG_TAG_NAME) && !normalizedTags.has('deleted') && !normalizedTags.has('archived')
      })

      if (!existing) return null

      debugNoteIdRef.current = existing.id
      setNotes((previous) => {
        const index = previous.findIndex((note) => note.id === existing.id)
        if (index >= 0) return previous
        return [existing, ...previous]
      })
      return existing.id
    } catch {
      return null
    }
  }, [])

  const ensureDebugNoteExists = useCallback(async (): Promise<string | null> => {
    if (!debuggingEnabled || !window.thockdownNotes) return null

    if (debugNoteIdRef.current) {
      try {
        const loaded = await window.thockdownNotes.loadNote({ id: debugNoteIdRef.current })
        const normalizedTags = new Set(loaded.tags.map((tag) => normalizeTagName(tag)))
        const isDeletedOrArchived = normalizedTags.has('deleted') || normalizedTags.has('archived')
        const isDebugTagged = normalizedTags.has(DEBUG_TAG_NAME)

        if (isDebugTagged && !isDeletedOrArchived) {
          return debugNoteIdRef.current
        }
      } catch {
        // stale or deleted note id; fall through and create a fresh debug note.
      }

      debugNoteIdRef.current = null
    }

    if (debugNoteCreationPromiseRef.current) {
      return debugNoteCreationPromiseRef.current
    }

    const promise = (async (): Promise<string | null> => {
      const existingId = await findExistingDebugNoteId()
      if (existingId) {
        return existingId
      }

      return createDebugNote()
    })()

    debugNoteCreationPromiseRef.current = promise
    const result = await promise
    debugNoteCreationPromiseRef.current = null
    return result
  }, [createDebugNote, debuggingEnabled, findExistingDebugNoteId])

  useEffect(() => {
    if (!debuggingEnabled) return
    if (!persistenceReady) return

    void ensureDebugNoteExists()
  }, [ensureDebugNoteExists, debuggingEnabled, persistenceReady])

  const writeDebugEntry = useCallback(async (functionName: string, lines: string[]) => {
    if (!debuggingEnabled) return
    if (!window.thockdownNotes) return
    if (isWritingDebugEntryRef.current) return

    const noteId = await ensureDebugNoteExists()
    if (!noteId) return

    isWritingDebugEntryRef.current = true
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    const section = `\n## ${timeStr} / ${functionName}\n${lines.map(l => `- ${l}`).join('\n')}`

    try {
      const loaded = await window.thockdownNotes.loadNote({ id: noteId })
      const updated = await window.thockdownNotes.saveNote({
        id: noteId,
        text: `${loaded.text}${section}`,
      })
      setNotes((previous) => {
        const index = previous.findIndex(n => n.id === updated.id)
        if (index < 0) return previous
        const next = [...previous]
        next[index] = updated
        return next
      })
    } catch (error) {
      const originalError = originalConsoleMethodsRef.current.error ?? console.error
      originalError.call(console, 'Failed to write debug entry', error)
    } finally {
      isWritingDebugEntryRef.current = false
    }
  }, [debuggingEnabled, ensureDebugNoteExists])
  writeDebugEntryRef.current = writeDebugEntry

  useEffect(() => {
    const consoleMethods: ConsoleMethodName[] = ['log', 'info', 'warn', 'error', 'debug']

    if (!debuggingEnabled) {
      if (originalConsoleMethodsRef.current.log) {
        consoleMethods.forEach((method) => {
          const original = originalConsoleMethodsRef.current[method]
          if (original) {
            console[method] = original
          }
        })
        originalConsoleMethodsRef.current = {}
      }
      return
    }

    consoleMethods.forEach((method) => {
      if (!originalConsoleMethodsRef.current[method]) {
        originalConsoleMethodsRef.current[method] = console[method].bind(console)
      }
      console[method] = (...args: unknown[]) => {
        const original = originalConsoleMethodsRef.current[method]
        if (original) {
          original(...args)
        }
        if (isWritingDebugEntryRef.current) {
          return
        }
        const stringified = args.map((arg) => {
          try {
            if (typeof arg === 'string') return arg
            if (arg instanceof Error) return arg.stack || arg.message
            return JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        })
        void writeDebugEntry(`console.${method}`, stringified)
      }
    })

    return () => {
      consoleMethods.forEach((method) => {
        const original = originalConsoleMethodsRef.current[method]
        if (original) {
          console[method] = original
        }
      })
      originalConsoleMethodsRef.current = {}
    }
  }, [debuggingEnabled, writeDebugEntry])

  const queueAppStateSave = useCallback((selectedNoteId: string | null) => {
    if (!window.thockdownState) return
    if (!persistenceReady) return
    if (isApplyingInitialViewportRef.current || pendingViewportRestoreRef.current) return

    if (appStateSaveTimerRef.current !== null) {
      window.clearTimeout(appStateSaveTimerRef.current)
    }

    appStateSaveTimerRef.current = window.setTimeout(() => {
      appStateSaveTimerRef.current = null
      const viewport = getActiveSection()?.latestViewportRef.current
      void window.thockdownState?.saveAppState({
        selectedNoteId,
        viewport: viewport ?? undefined,
        menu: persistedMenuStateRef.current ?? buildMenuStateSnapshot(),
      })
    }, 150)
  }, [buildMenuStateSnapshot, getActiveSection, persistenceReady])
  queueAppStateSaveRef.current = queueAppStateSave

  const chooseExportFolder = useCallback(async () => {
    const exportApi = window.thockdownExport
    const selectExportFolder = exportApi
      ? exportApi.selectExportFolder
      : () => window.ipcRenderer?.invoke<string | null>('select-export-folder')

    const folderPath = await selectExportFolder()
    if (!folderPath) return null

    setExportFolder(folderPath)

    const nextMenuState = {
      ...(persistedMenuStateRef.current ?? buildMenuStateSnapshot()),
      exportFolder: folderPath,
    }
    persistedMenuStateRef.current = nextMenuState
    queueAppStateSave(getActiveSection()?.activeNoteId ?? null)
    return folderPath
  }, [buildMenuStateSnapshot, getActiveSection, queueAppStateSave])

  const buildExportHtmlContent = useCallback(async () => {
    const section = getActiveSection()
    const currentEditorText = normalizeInternalText(section?.latestEditorTextRef.current || section?.activeNoteText || '')
    const exportCss = await buildExportCss(viewStyle as ExportViewStyle, viewFontSize, viewSpacing, viewLetterSpacingEm)

    const markdownHtml = renderToStaticMarkup(
      <div className="pdf-exporter-page">
        <div className={`pdf-exporter-markdown-preview markdown-preview style-${viewStyle}`}>
          <ReactMarkdown
            remarkPlugins={PREVIEW_MARKDOWN_REMARK_PLUGINS}
            components={createPreviewMarkdownComponents(PREVIEW_MARKDOWN_NOOP_NAVIGATE, PREVIEW_MARKDOWN_NOOP_NAVIGATE)}
          >
            {currentEditorText}
          </ReactMarkdown>
        </div>
      </div>,
    )

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${deriveNoteTitleFromText(section?.activeNoteText || '')}</title>
<base href="${document.location.href}">
<style>${exportCss}</style>
</head>
<body>
${markdownHtml}
</body>
</html>`
  }, [getActiveSection, viewFontSize, viewSpacing, viewLetterSpacingEm, viewStyle])

  const saveSelectedNoteState = useCallback(async (selectedNoteId: string | null) => {
    if (!window.thockdownState) return
    await window.thockdownState.saveAppState({
      selectedNoteId,
      viewport: getActiveSection()?.latestViewportRef.current ?? undefined,
      menu: persistedMenuStateRef.current ?? buildMenuStateSnapshot(),
    })
  }, [buildMenuStateSnapshot, getActiveSection])

  const refreshNotes = useCallback(async (preferredId?: string | null) => {
    if (!window.thockdownNotes) return null

    const listed = await window.thockdownNotes.listNotes()
    setNotes((previous) => mergeNoteSummaries(previous, listed))
    if (listed.length === 0) {
      return null
    }

    if (preferredId) {
      const preferred = listed.find((note) => note.id === preferredId)
      if (preferred) {
        return preferred.id
      }
    }

    // The User Guide's own family must never become the fallback "open
    // this by default" note just because its fixed seed timestamp (or the
    // auto-TOC chapter's own regenerate-on-seed timestamp) happens to sort
    // first -- confirmed live: on a genuinely fresh install (no persisted
    // preferredId yet), it otherwise wins this fallback and opens as a
    // normal, editable note, defeating the whole "only reachable via the
    // help button or a $HELP link" design. listNotes() doesn't filter this
    // family out itself (unlike the sidebar's own dateEligibleNotes etc.,
    // in App.tsx) since $HELP cross-link resolution elsewhere needs it
    // present in the full notes array -- only this fallback selection
    // needs it excluded.
    const selectable = listed.filter((note) => !HELP_GUIDE_NOTE_IDS.has(note.id))
    return selectable[0]?.id ?? null
  }, [])

  const [, setFileSyncStatus] = useState<string | null>(null)

  const syncExistingNotes = useCallback(async () => {
    const fileSyncApi = window.thockdownFileSync
    if (!fileSyncApi || !persistenceReady) return

    setFileSyncStatus('Syncing notes from storage...')
    try {
      const result = await fileSyncApi.syncExistingNotes()
      await refreshNotes()
      setFileSyncStatus(`Synced ${result.createdNoteIds.length} files.`)
    } catch (error) {
      setFileSyncStatus(`Sync failed: ${String(error)}`)
    }
  }, [persistenceReady, refreshNotes])

  const importNotes = useCallback(async () => {
    const fileSyncApi = window.thockdownFileSync
    if (!fileSyncApi || !persistenceReady) return

    setFileSyncStatus('Importing selected note files or folders...')
    try {
      const result = await fileSyncApi.importNotes()
      await refreshNotes()
      if (result.errors && result.errors.length > 0) {
        setFileSyncStatus(`Imported ${result.imported} files with ${result.errors.length} errors.`)
      } else {
        setFileSyncStatus(`Imported ${result.imported} files.`)
      }
    } catch (error) {
      setFileSyncStatus(`Import failed: ${String(error)}`)
    }
  }, [persistenceReady, refreshNotes])

  const openNotesFolder = useCallback(async () => {
    const fileSyncApi = window.thockdownFileSync
    if (!fileSyncApi) return
    await fileSyncApi.openNotesFolder()
  }, [])

  const selectNote = useCallback(async (noteId: string, options?: { forceReload?: boolean }) => {
    if (!window.thockdownNotes) return
    if (!persistenceReady) return
    const section = getActiveSection()
    const activeNoteId = section?.activeNoteId ?? null
    if (noteId === activeNoteId && !options?.forceReload) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    try {
      if (section && !section.isPreviewMode && activeNoteId && noteId !== activeNoteId) {
        section.captureEditModeSnapshotFromEditor(activeNoteId)
      }
      await section?.flushPendingSaveNow()
      await section?.activateNote(noteId)
    } catch (error) {
      console.error('Failed to select note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [
    getActiveSection,
    persistenceReady,
  ])

  const handleSelectNote = useCallback((noteId: string) => {
    // Force a reload even for the active card to recover from any stale editor state.
    void selectNote(noteId, { forceReload: true })
  }, [selectNote])

  // The User Guide -- entered from the escape-hold quick-actions panel's
  // Help button, per HelpModeOverlay.tsx's removal now just an ordinary
  // (timeless) note loaded through the exact same selectNote path a
  // sidebar click uses, not a dedicated overlay component. No dedicated
  // close action any more either -- leaving it works exactly like leaving
  // any other note (pick another one from the sidebar, switch tabs, ...).
  const handleHelpModeOpen = useCallback(() => {
    void selectNote(HELP_GUIDE_ROOT_ID, { forceReload: true })
  }, [selectNote])

  const isAllowedNonEditorFocusTarget = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false

    if (target instanceof HTMLSelectElement) {
      return true
    }

    if (
      target === sidebarSearchInputRef.current ||
      target === documentReplaceInputRef.current ||
      target === getActiveSection()?.tagInputRef.current ||
      target === pageJumpInputRef.current ||
      target === textureSeedInputRef.current ||
      target === glazeLinearSeedInputRef.current ||
      target === glazeRadialSeedInputRef.current
    ) {
      return true
    }

    if (target.closest('.sidebar-pagination')) {
      return true
    }

    if (target.closest('.options-seed-editor')) {
      return true
    }

    if (target.closest('.tag-pill, .tabbar-tags-display, .tabbar-suggested-tags, .tab-mode-shell')) {
      return true
    }

    if (target.closest('[draggable="true"]')) {
      return true
    }

    return false
  }, [getActiveSection])

  const updateActiveNoteTitlePreview = useCallback((nextText: string) => {
    const activeNoteId = getActiveSection()?.activeNoteId
    if (!activeNoteId) return

    // Keyed by note id (not a single flat cache) so switching the active
    // note -- or two split-view sections editing different notes and both
    // calling this via the shared ref -- never diffs one note's lines
    // against an unrelated note's; each note keeps its own incremental
    // state across calls, and a note this ref hasn't seen yet just starts
    // fresh (same cost as before, never worse).
    const { title: nextTitle, cache: nextCache } = deriveNoteTitleIncremental(
      nextText,
      noteTitleCacheByNoteIdRef.current.get(activeNoteId) ?? null,
    )
    noteTitleCacheByNoteIdRef.current.set(activeNoteId, nextCache)

    setNotes((previous) => {
      const index = previous.findIndex((note) => note.id === activeNoteId)
      if (index < 0) return previous

      const existing = previous[index]
      if (existing.title === nextTitle) {
        return previous
      }

      const next = [...previous]
      next[index] = {
        ...existing,
        title: nextTitle,
      }
      return next
    })
  }, [getActiveSection])
  updateActiveNoteTitlePreviewRef.current = updateActiveNoteTitlePreview

  const createNote = useCallback(async (initialText = NEW_NOTE_TEMPLATE) => {
    if (!window.thockdownNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    const section = getActiveSection()
    if (section?.isPreviewMode && !section.isForcedPreviewNote) {
      section.toggleRenderViewMode()
    }

    noteTransitionLockRef.current = true
    try {
      await section?.flushPendingSaveNow()
      const created = await window.thockdownNotes.createNote({ initialText })
      await refreshNotes(created.id)
      await getActiveSection()?.activateNote(created.id, initialText.length)
      setSidebarMode('date')
    } catch (error) {
      console.error('Failed to create note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [getActiveSection, persistenceReady, refreshNotes])

  const createNoteFromClipboardTitle = useCallback(async () => {
    let title = FALLBACK_NEW_NOTE_TITLE

    try {
      const clipboardText = await navigator.clipboard.readText()
      title = sanitizeClipboardTitle(clipboardText)
    } catch {
      title = FALLBACK_NEW_NOTE_TITLE
    }

    await createNote(`# ${title}\n\n`)
  }, [createNote])

  const importExternalFileAsTempNote = useCallback(async (filePath: string, targetSectionId?: string) => {
    const externalApi = window.thockdownExternalFiles
    const notesApi = window.thockdownNotes
    if (!externalApi || !notesApi) return
    if (!persistenceReady) return

    if (noteTransitionLockRef.current) {
      return
    }

    noteTransitionLockRef.current = true
    try {
      // Falls back to the active section when the caller has no specific
      // drop target (opening via OS "Open With" / pending-files-at-launch,
      // neither of which has a section to target).
      const targetSection = targetSectionId
        ? getActiveSectionHandle(sectionRegistryRef, targetSectionId)
        : getActiveSection()
      if (targetSectionId) {
        markSectionActive(targetSectionId)
      }
      await targetSection?.flushPendingSaveNow()

      const existingTempId = await notesApi.getNoteIdByExternalPath({ externalPath: filePath })
      if (existingTempId) {
        console.debug('[external-note] external file already tracked, activating existing temp note', { filePath, noteId: existingTempId })
        await refreshNotes(existingTempId)
        await targetSection?.activateNote(existingTempId)
        setSidebarMode('date')
        return
      }

      const [fileName, content] = await Promise.all([
        externalApi.getFileBasename(filePath),
        externalApi.readFileContent(filePath),
      ])

      if (content === null) {
        return
      }

      const initialTitle = titleFromFileBasename(fileName)
      const created = await notesApi.createNote({ initialText: content, externalPath: filePath, title: initialTitle })
      const noteId = created.id
      console.debug('[external-note] created temp note for external file', { noteId, filePath })

      const normalizedContent = normalizeInternalText(content)
      await notesApi.saveNote({ id: noteId, text: normalizedContent })
      console.debug('[external-note] saved imported external content into temp note', { noteId, filePath, contentLength: normalizedContent.length })
      await notesApi.saveNoteSnapshot({ id: noteId, content: normalizedContent, isManual: false })
      console.debug('[external-note] saved original external snapshot', { noteId, filePath, contentLength: normalizedContent.length })
      await notesApi.updateExternalNoteState({ id: noteId, hasUnsavedChanges: false, syncMode: true })
      console.debug('[external-note] updated temp note sync state for imported external file', { noteId, hasUnsavedChanges: false, syncMode: true })
      await refreshNotes(noteId)
      await targetSection?.activateNote(noteId)
      setSidebarMode('date')
    } catch (error) {
      console.error('Failed to import external file', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [getActiveSection, markSectionActive, persistenceReady, refreshNotes])

  const enqueueExternalFileImport = useCallback((filePath: string, targetSectionId?: string) => {
    const normalizedPath = filePath.trim()
    if (!normalizedPath) return
    const pending = pendingExternalImportPathsRef.current
    if (pending.has(normalizedPath)) return
    pending.add(normalizedPath)

    const queue = externalOpenQueueRef.current
    externalOpenQueueRef.current = queue
      .then(async () => {
        try {
          await importExternalFileAsTempNote(normalizedPath, targetSectionId)
        } finally {
          pendingExternalImportPathsRef.current.delete(normalizedPath)
        }
      })
      .catch((error) => {
        console.error('External file import queue error', error)
        pendingExternalImportPathsRef.current.delete(normalizedPath)
      })
  }, [importExternalFileAsTempNote])

  const handleAppDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    const types = Array.from(event.dataTransfer?.types ?? [])
    const isFileDrag = types.includes('Files')
    if (!isFileDrag) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleAppDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    const types = Array.from(event.dataTransfer?.types ?? [])
    const isFileDrop = types.includes('Files')
    if (!isFileDrop) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const file = event.dataTransfer.files?.[0]
    if (!file || !file.path) {
      return
    }

    // Which section's slot the file was actually dropped over -- this
    // handler is bound once on the app root (so it still fires when
    // dropped between/outside slots), so the target has to be resolved
    // from the DOM rather than assumed to be the active section.
    const targetSlot = (event.target as HTMLElement | null)?.closest<HTMLElement>('.editor-section-slot[data-section-id]')
    const targetSectionId = targetSlot?.dataset.sectionId

    enqueueExternalFileImport(file.path, targetSectionId)
  }, [enqueueExternalFileImport])

  const getCurrentExternalNoteModifiedState = useCallback((note: NoteSummary, currentHash: string | null = currentExternalNoteHash): boolean => {
    if (!isExternalNote(note)) return false
    if (note.id !== activeSectionSnapshot?.activeNoteId) {
      return Boolean(note.hasUnsavedChanges)
    }

    if (note.hasUnsavedChanges) {
      return true
    }

    return (
      currentHash !== null
      && currentHash !== externalNoteOriginalHashByIdRef.current.get(note.id)
    )
  }, [activeSectionSnapshot?.activeNoteId, currentExternalNoteHash])

  useEffect(() => {
    if (externalNoteHashDebounceRef.current !== null) {
      window.clearTimeout(externalNoteHashDebounceRef.current)
      externalNoteHashDebounceRef.current = null
    }

    const activeNoteId = activeSectionSnapshot?.activeNoteId
    const activeNoteSummary = activeSectionSnapshot?.activeNoteSummary
    if (!activeNoteId || !activeNoteSummary || !isExternalNote(activeNoteSummary)) {
      setCurrentExternalNoteHash(null)
      return
    }

    let disposed = false
    const computeHash = async () => {
      const currentText = normalizeInternalText(activeSectionSnapshot?.latestEditorTextRef.current || activeSectionSnapshot?.activeNoteText || '')
      const hash = await hashNormalizedText(currentText)
      if (disposed) return

      setCurrentExternalNoteHash(hash)

      const updatedState = getCurrentExternalNoteModifiedState(activeNoteSummary, hash)
      setNotes((previous) => {
        const index = previous.findIndex((note) => note.id === activeNoteId)
        if (index < 0) return previous
        const existing = previous[index]
        if (existing.hasUnsavedChanges === updatedState) return previous
        const next = [...previous]
        next[index] = { ...existing, hasUnsavedChanges: updatedState }
        return next
      })
    }

    // Debounced on the same cadence as the save queue itself
    // (SAVE_DEBOUNCE_MS): this hash only drives the "unsaved changes"
    // indicator, not anything needing per-keystroke freshness. Previously
    // ran a full-document SHA-256 on every keystroke, because
    // activeSectionSnapshot (activeNoteText/currentEditorText are both
    // fields on it) gets a new object identity every keystroke.
    externalNoteHashDebounceRef.current = window.setTimeout(() => {
      externalNoteHashDebounceRef.current = null
      void computeHash()
    }, SAVE_DEBOUNCE_MS)

    return () => {
      disposed = true
      if (externalNoteHashDebounceRef.current !== null) {
        window.clearTimeout(externalNoteHashDebounceRef.current)
        externalNoteHashDebounceRef.current = null
      }
    }
  }, [activeSectionSnapshot, getCurrentExternalNoteModifiedState])

  const updateNoteAssignedId = useCallback((noteId: string, assignedId: string) => {
    setNotes((previous) => previous.map((note) => (note.id === noteId ? { ...note, assignedId } : note)))
  }, [])

  // Session-only memory (never persisted) of the last anchor set via the
  // toolbar button or Shift+Ctrl+L, anywhere in the app -- not scoped to any
  // one section or note, since the whole point is linking to it later from
  // wherever. A plain ref, not state: only ever read imperatively at
  // link-insertion time, never rendered.
  const lastAnchorRef = useRef<{ noteId: string; chapterId: string; anchorId: string }>({ noteId: '', chapterId: '', anchorId: '' })

  const recordLastAnchor = useCallback((payload: { noteId: string; chapterId: string; anchorId: string }) => {
    lastAnchorRef.current = payload
  }, [])

  const getLinkTargetPrefill = useCallback(() => {
    const { noteId, chapterId, anchorId } = lastAnchorRef.current
    return `$${noteId}§${chapterId}#${anchorId}`
  }, [])

  const handleViewModeButtonClick = useCallback((mode: SidebarMode) => {
    const section = getActiveSection()
    if (mode === 'trash' && section?.isTrashViewDeletePrimed) {
      section.setIsTrashViewDeletePrimed(false)
      void section.purgeDeletedNotesPermanently()
      runSidebarMenuTransition('trash')
      return
    }

    if (mode === sidebarMode) {
      void focusActiveNoteInSidebarMode(mode)
      return
    }

    if (mode === 'trash') {
      runSidebarMenuTransition('trash')
      return
    }

    if (mode === 'find') {
      section?.setIsTrashViewDeletePrimed(false)
      section?.clearTrashButtonArmTimer()
      runSidebarMenuTransition('find')
      requestAnimationFrame(() => {
        sidebarSearchInputRef.current?.focus()
        sidebarSearchInputRef.current?.select()
      })
      return
    }

    section?.setIsTrashViewDeletePrimed(false)
    section?.clearTrashButtonArmTimer()
    runSidebarMenuTransition(mode)
  }, [
    focusActiveNoteInSidebarMode,
    getActiveSection,
    runSidebarMenuTransition,
    sidebarMode,
  ])

  useEffect(() => {
    let disposed = false

    const bootstrap = async () => {
      const hasBridge = await waitForNotesBridge(() => disposed)
      if (!hasBridge) {
        return
      }
      const thockdownNotes = window.thockdownNotes
      if (!thockdownNotes) {
        return
      }

      setPersistenceReady(false)

      let attempt = 0
      while (!disposed) {
        try {
          let listed = await thockdownNotes.listNotes()
          if (disposed) return

          if (listed.length === 0) {
            await thockdownNotes.createNote({ initialText: NEW_NOTE_TEMPLATE })
            listed = await thockdownNotes.listNotes()
            if (listed.length === 0) {
              throw new Error('Notes list remained empty after creating bootstrap note')
            }
          }

          const appState = window.thockdownState ? await window.thockdownState.loadAppState() : { selectedNoteId: null }
          if (disposed) return

          if (appState.menu) {
            const loadedSidebarViewState: SidebarViewStateByMode = {
              date: sanitizeSidebarViewState(appState.menu.sidebarViewState?.date),
              category: sanitizeSidebarViewState(appState.menu.sidebarViewState?.category),
              archive: sanitizeSidebarViewState(appState.menu.sidebarViewState?.archive),
              trash: sanitizeSidebarViewState(appState.menu.sidebarViewState?.trash),
              find: sanitizeSidebarViewState(appState.menu.sidebarViewState?.find),
              options: sanitizeSidebarViewState(appState.menu.sidebarViewState?.options),
            }

            setSidebarViewStateByMode(loadedSidebarViewState)
            setSidebarMode(appState.menu.sidebarMode)
            setSelectedMonths(new Set(appState.menu.selectedMonths))
            setSelectedYears(new Set(appState.menu.selectedYears))
            setSearchQuery(appState.menu.searchQuery)
            setIsSearchQueryCaseSensitive(appState.menu.searchQueryCaseSensitive ?? false)
            setRestoredDocumentFindCaseSensitive(appState.menu.documentFindCaseSensitive ?? false)
            getActiveSection()?.setIsPreviewMode(appState.menu.isPreviewMode ?? false)
            setViewStyle(appState.menu.viewStyle ?? 'calibrilight')
            setViewFontSize(resolvePersistedFontSizePx(appState.menu.viewFontSize, DEFAULT_EDITOR_FONT_SIZE_PX))
            setViewSpacing(resolvePersistedLineHeightMultiplier(appState.menu.viewSpacing, DEFAULT_EDITOR_LINE_HEIGHT_MULTIPLIER))
            setViewLetterSpacingEm(resolvePersistedViewLetterSpacingEm(appState.menu.viewLetterSpacingEm, DEFAULT_VIEW_LETTER_SPACING_EM))
            setEditorStyle(appState.menu.editorStyle ?? DEFAULT_EDITOR_STYLE)
            setEditorFontSize(resolvePersistedFontSizePx(appState.menu.editorFontSize, DEFAULT_EDITOR_FONT_SIZE_PX))
            setEditorSpacing(resolvePersistedLineHeightMultiplier(appState.menu.editorSpacing, DEFAULT_EDITOR_LINE_HEIGHT_MULTIPLIER))
            setEditorGlyphPaddingPx(
              clamp(
                roundEditorGlyphPaddingPx(appState.menu.editorGlyphPaddingPx ?? DEFAULT_EDITOR_GLYPH_SIDE_GAP_PX),
                EDITOR_GLYPH_PADDING_MIN_PX,
                EDITOR_GLYPH_PADDING_MAX_PX,
              ),
            )
            setUiFontStyle(appState.menu.uiFontStyle ?? DEFAULT_UI_FONT_KEY)
            setUiFontScale(
              clamp(
                roundUiFontScale(appState.menu.uiFontScale ?? DEFAULT_UI_FONT_SCALE),
                UI_FONT_SCALE_MIN,
                UI_FONT_SCALE_MAX,
              ),
            )
            setBorderRadiusRegularPx(
              clamp(
                Math.round(appState.menu.borderRadiusRegularPx ?? DEFAULT_BORDER_RADIUS_REGULAR_PX),
                BORDER_RADIUS_REGULAR_MIN_PX,
                BORDER_RADIUS_REGULAR_MAX_PX,
              ),
            )
            setSpacingRegularPx(
              clamp(
                Math.round(appState.menu.spacingRegularPx ?? DEFAULT_SPACING_REGULAR_PX),
                SPACING_REGULAR_MIN_PX,
                SPACING_REGULAR_MAX_PX,
              ),
            )
            setBorderAlphaPercent(
              clamp(
                Math.round(appState.menu.borderAlphaPercent ?? DEFAULT_BORDER_ALPHA_PERCENT),
                BORDER_ALPHA_PERCENT_MIN,
                BORDER_ALPHA_PERCENT_MAX,
              ),
            )
            setBoxShadowAlphaPercent(
              clamp(
                Math.round(appState.menu.boxShadowAlphaPercent ?? DEFAULT_BOX_SHADOW_ALPHA_PERCENT),
                BOX_SHADOW_ALPHA_PERCENT_MIN,
                BOX_SHADOW_ALPHA_PERCENT_MAX,
              ),
            )
            setRenderScrollDynamic(
              clamp(
                appState.menu.renderScrollDynamic
                  ?? appState.menu.renderScrollEaseMultiplier
                  ?? deriveRenderScrollDynamicFromResponsiveness(
                    appState.menu.renderScrollResponsiveness
                    ?? appState.menu.renderScrollDistanceTimeInfluence
                    ?? getRenderScrollResponsiveness(),
                  ),
                0.1,
                5,
              ),
            )
            setRenderScrollTotalTimeSec(appState.menu.renderScrollTotalTimeSec ?? getRenderScrollTotalTimeSec())
                  setRenderScrollMaxSpeedPxPerSec(appState.menu.renderScrollMaxSpeedPxPerSec ?? getRenderScrollMaxSpeedPxPerSec())
            setRenderScrollSkew(appState.menu.renderScrollSkew ?? getRenderScrollSkew())
            setGlazeSettings(sanitizeGlazeSettings(appState.menu.glaze, DEFAULT_GLAZE_SETTINGS))
            setUiMode(appState.menu.uiMode === 'dark' ? 'dark' : 'light')
            applyDarkModePreset(appState.menu.darkMode ?? 'none')
            setFilterInvert(appState.menu.filterInvert ?? 0)
            setFilterSepia(appState.menu.filterSepia ?? 0)
            setFilterHueRotate(appState.menu.filterHueRotate ?? 0)
            setFilterBrightness(appState.menu.filterBrightness ?? 1)
            setFilterContrast(appState.menu.filterContrast ?? 1)
            setFilterSaturate(appState.menu.filterSaturate ?? 0.5)
            setFilterColorize(appState.menu.filterColorize ?? 0)
            setAudioKeyVolume(appState.menu.audioKeyVolume ?? 0.5)
            setAudioKeyVariance(appState.menu.audioKeyVariance ?? 0)
            setAudioPitch(appState.menu.audioPitch ?? 0)
            setAudioBassVolume(appState.menu.audioBassVolume ?? 0)
            setAudioTrebleVolume(appState.menu.audioTrebleVolume ?? 0)
            setAudioReverbStrength(appState.menu.audioReverbStrength ?? appState.menu.audioReverbAmount ?? 0)
            setAudioReverbSpace(appState.menu.audioReverbSpace ?? 0)
            setPitchJitterAmount(appState.menu.pitchJitterAmount ?? 0)
            setAudioSpatial(appState.menu.audioSpatial ?? 0)
            setReduceVisualEffects(appState.menu.reduceVisualEffects ?? false)
            setReducedCaretAnimation(appState.menu.reducedCaretAnimation ?? false)
            setDeferPreviewOnRapidInput(appState.menu.deferPreviewOnRapidInput ?? false)
            setTypingSoundEnabled(appState.menu.typingSoundEnabled ?? false)
            setTypingSoundSet(appState.menu.typingSoundSet ?? DEFAULT_TYPING_SOUND_SET)
            if (typeof appState.menu.musicVolume === 'number') setMusicVolume(appState.menu.musicVolume)
            if (typeof appState.menu.musicReverbAmount === 'number') setMusicReverbAmount(appState.menu.musicReverbAmount)
            if (typeof appState.menu.musicReverbRoom === 'number') setMusicReverbRoom(appState.menu.musicReverbRoom)
            if (Array.isArray(appState.menu.musicActiveSlots)) {
              setMusicActiveSlots(
                (appState.menu.musicActiveSlots as number[]).filter((s) => s >= 1 && s <= 5) as import('./shared/audioPlayer').PlaylistSlot[]
              )
            }
            if (typeof appState.menu.musicLastSongId === 'number') {
              const positionSec = appState.menu.musicLastPositionSec ?? 0
              const wasPlaying = appState.menu.musicWasPlaying ?? false
              setMusicRestoreSongId(appState.menu.musicLastSongId)
              setMusicRestorePositionSec(positionSec)
              setMusicRestoreWasPlaying(wasPlaying)
              // Prime the ref immediately so a save triggered before AudioControls
              // mounts/restores doesn't clobber the persisted values with defaults.
              musicPlaybackRef.current = { songId: appState.menu.musicLastSongId, positionSec, wasPlaying }
            }
            setHighlightColors({
              caret: appState.menu.highlightCaretColor ?? DEFAULT_HIGHLIGHT_COLORS.caret,
              search: appState.menu.highlightSearchColor ?? DEFAULT_HIGHLIGHT_COLORS.search,
              selectionEdit:
                appState.menu.highlightSelectionEditColor
                ?? appState.menu.highlightSelectionColor
                ?? DEFAULT_HIGHLIGHT_COLORS.selectionEdit,
              selectionRender:
                appState.menu.highlightSelectionRenderColor
                ?? appState.menu.highlightSelectionColor
                ?? DEFAULT_HIGHLIGHT_COLORS.selectionRender,
              textBase: appState.menu.highlightTextBaseColor ?? DEFAULT_HIGHLIGHT_COLORS.textBase,
              textEmbossEdit:
                appState.menu.highlightTextEmbossEditColor
                ?? appState.menu.highlightTextEmbossColor
                ?? DEFAULT_HIGHLIGHT_COLORS.textEmbossEdit,
              textEmbossRender:
                appState.menu.highlightTextEmbossRenderColor
                ?? appState.menu.highlightTextEmbossColor
                ?? DEFAULT_HIGHLIGHT_COLORS.textEmbossRender,
              textEmbossUi:
                appState.menu.highlightTextEmbossUiColor
                ?? appState.menu.highlightTextEmbossColor
                ?? DEFAULT_HIGHLIGHT_COLORS.textEmbossUi,
              background: appState.menu.highlightBackgroundColor ?? DEFAULT_HIGHLIGHT_COLORS.background,
              topBackground: appState.menu.highlightTopBackgroundColor ?? DEFAULT_HIGHLIGHT_COLORS.topBackground,
              bottomBackground: appState.menu.highlightBottomBackgroundColor ?? DEFAULT_HIGHLIGHT_COLORS.bottomBackground,
              gridOutline: appState.menu.highlightGridOutlineColor ?? DEFAULT_HIGHLIGHT_COLORS.gridOutline,
              grid: appState.menu.highlightGridColor ?? DEFAULT_HIGHLIGHT_COLORS.grid,
              gutterBackground: appState.menu.highlightGutterBackgroundColor ?? DEFAULT_HIGHLIGHT_COLORS.gutterBackground,
              reviewLine: appState.menu.highlightReviewColor ?? DEFAULT_HIGHLIGHT_COLORS.reviewLine,
              warningLine: appState.menu.highlightWarningColor ?? DEFAULT_HIGHLIGHT_COLORS.warningLine,
              lineNumber: appState.menu.highlightLineNumberColor ?? DEFAULT_HIGHLIGHT_COLORS.lineNumber,
              base: appState.menu.highlightBaseColor ?? DEFAULT_HIGHLIGHT_COLORS.base,
              inputFields: appState.menu.highlightInputFieldsColor ?? DEFAULT_HIGHLIGHT_COLORS.inputFields,
              appButtons: appState.menu.highlightAppButtonsColor ?? DEFAULT_HIGHLIGHT_COLORS.appButtons,
              markdownHeadline: appState.menu.highlightMarkdownHeadlineColor ?? DEFAULT_HIGHLIGHT_COLORS.markdownHeadline,
              markdownList: appState.menu.highlightMarkdownListColor ?? DEFAULT_HIGHLIGHT_COLORS.markdownList,
              markdownBlockquote: appState.menu.highlightMarkdownBlockquoteColor ?? DEFAULT_HIGHLIGHT_COLORS.markdownBlockquote,
              markdownCode: appState.menu.highlightMarkdownCodeColor ?? DEFAULT_HIGHLIGHT_COLORS.markdownCode,
              markdownChecked: appState.menu.highlightMarkdownCheckedColor ?? DEFAULT_HIGHLIGHT_COLORS.markdownChecked,
              markdownUnchecked: appState.menu.highlightMarkdownUncheckedColor ?? DEFAULT_HIGHLIGHT_COLORS.markdownUnchecked,
            })
            setEditorTextColors({
              editorEditText: appState.menu.editorEditTextColor ?? DEFAULT_EDITOR_TEXT_COLORS.editorEditText,
              editorRenderText: appState.menu.editorRenderTextColor ?? DEFAULT_EDITOR_TEXT_COLORS.editorRenderText,
            })
            // Global texture enable is intentionally fixed on; per-surface alpha controls visibility.
            setTextureMaterials(cloneTextureMaterials(appState.menu.textureMaterials ?? DEFAULT_TEXTURE_MATERIALS))
            setDebuggingEnabled(appState.menu.debuggingEnabled ?? false)
            setSpellCheckEnabled(appState.menu.spellCheckEnabled ?? false)
            setRestoredTabBarMode(appState.menu.tabBarMode ?? 'tabs')

            // Restore persisted sidebar visibility
            setIsSidebarVisible(appState.menu.isSidebarVisible ?? true)
            // Restore persisted double-size mode. Main process already applied
            // the zoom/minimum-size at boot from its own copy of this same
            // saved state (see electron/main.ts's createWindow) -- this just
            // syncs the renderer's own toggle/button state to match.
            setIsDoubleSizeMode(appState.menu.isDoubleSizeMode ?? false)
            const restoredReviewGutterVisibleBySection = appState.menu.reviewGutterVisibleBySection ?? {}
            setReviewGutterVisibleBySection(restoredReviewGutterVisibleBySection)
            // Legacy migration: states saved before the line-number/review-flag
            // split have no reviewFlagsVisibleBySection field at all -- seed it
            // from the old combined gutter value so upgrading doesn't silently
            // hide flags that were visible before. Once the user toggles
            // anything post-upgrade, the field gets persisted for real and this
            // fallback no longer applies.
            setReviewFlagsVisibleBySection(appState.menu.reviewFlagsVisibleBySection ?? restoredReviewGutterVisibleBySection)

            // Cursor appearance (color/size/speed) now lives in the active
            // UiLayoutLoadout, restored when that loadout is applied below.
            // enabled is kept out of layouts on purpose -- always defaults
            // to off and persists independently in app state.
            setCustomCursorEnabled(appState.menu.customCursorEnabled ?? DEFAULT_CUSTOM_CURSOR_SETTINGS.enabled)

            setCurrentPage(loadedSidebarViewState[appState.menu.sidebarMode].page)
            setCategoryCollapsedPrimary(loadedSidebarViewState.category.collapsedPrimary)
            setCategoryCollapsedSecondary(loadedSidebarViewState.category.collapsedSecondary)
            setArchiveCollapsedPrimary(loadedSidebarViewState.archive.collapsedPrimary)
            setArchiveCollapsedSecondary(loadedSidebarViewState.archive.collapsedSecondary)
            pendingSidebarScrollRestoreRef.current = {
              mode: appState.menu.sidebarMode,
              scrollTop: loadedSidebarViewState[appState.menu.sidebarMode].scrollTop,
            }

            persistedMenuStateRef.current = {
              ...appState.menu,
              sidebarViewState: loadedSidebarViewState,
            }
            setExportFolder(appState.menu.exportFolder ?? null)
          } else {
            persistedMenuStateRef.current = null
            setExportFolder(null)
          }

          const preferredId = appState.selectedNoteId
          const selectedSummary = (
            preferredId
              ? listed.find((note) => note.id === preferredId)
              : undefined
          ) ?? listed[0]

          if (disposed) return

          setNotes((previous) => mergeNoteSummaries(previous, listed))

          // Resolve which sections actually occupy a slot right now (sorted
          // left-to-right); fall back to the single default section if the
          // bridge isn't available or nothing is placed yet, so there's
          // never a moment with zero sections rendered.
          const rawSections = (await window.thockdownSections?.listSections()) ?? []
          const placedSections = rawSections
            .filter((entry) => entry.position !== null)
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          const resolvedSections = placedSections.length > 0
            ? placedSections
            : [{ id: DEFAULT_EDITOR_SECTION_ID, name: null, position: 0, widthFraction: null, fixedWidthPx: null, lastActiveNoteId: null, noteSlotInitialized: false }]
          if (disposed) return

          // Each section resolves its own initial note from its own
          // lastActiveNoteId; the leftmost section falls back to the
          // legacy app-wide selectedNoteId (pre-split-view installs, or a
          // fresh one, have no per-section memory yet), every other section
          // falls back to the first note in the list. That fallback only
          // applies to a section that's never had setActiveNote called on it
          // at all (noteSlotInitialized false) -- a section whose note was
          // explicitly cleared (e.g. via the section picker's "load empty"
          // option) has lastActiveNoteId: null too, but must stay empty
          // rather than being silently refilled on every restart.
          resolvedSections.forEach((entry, index) => {
            const persistedNoteId = (
              entry.lastActiveNoteId && listed.some((note) => note.id === entry.lastActiveNoteId)
            ) ? entry.lastActiveNoteId : null
            if (persistedNoteId) {
              initialNoteIdBySectionIdRef.current.set(entry.id, persistedNoteId)
              return
            }
            if (entry.noteSlotInitialized) return
            const fallbackNoteId = index === 0 ? selectedSummary.id : listed[0].id
            initialNoteIdBySectionIdRef.current.set(entry.id, fallbackNoteId)
          })
          setEditorSections(resolvedSections)
          setActiveSectionId((previous) => (
            resolvedSections.some((entry) => entry.id === previous) ? previous : resolvedSections[0].id
          ))

          // Restore the fixed/flexible pin state persisted for the placed
          // sections. Marking hydration complete (even when nothing is
          // pinned) is what arms the persist-on-change effect below.
          const restoredFixedWidths = new Map<string, number>()
          for (const entry of resolvedSections) {
            if (typeof entry.fixedWidthPx === 'number' && entry.fixedWidthPx > 0) {
              restoredFixedWidths.set(entry.id, entry.fixedWidthPx)
            }
          }
          if (restoredFixedWidths.size > 0) {
            setFixedWidthPxBySectionId(restoredFixedWidths)
          }
          fixedWidthsHydratedRef.current = true

          setPersistenceReady(true)
          setBootstrapError(null)
          return
        } catch (error) {
          attempt += 1
          const message = error instanceof Error ? error.message : String(error)
          console.error(`Failed to initialize note lifecycle (attempt ${attempt})`, error)
          // Keep retrying (transient startup races are real -- e.g. the IPC
          // bridge not being ready yet) but stop suffering in silence after
          // a few tries: tell the user something is actually wrong instead
          // of leaving them looking at an app with no active note, no
          // timeline, and no way to tell why.
          if (attempt >= 3 && !disposed) {
            setBootstrapError(message)
          }
          await new Promise((resolve) => window.setTimeout(resolve, Math.min(1500, 200 * attempt)))
        }
      }
    }

    void bootstrap()

    return () => {
      disposed = true
      const section = getActiveSection()
      section?.cancelPendingEditUiStatePersist()
      section?.cancelPendingSave()
      if (appStateSaveTimerRef.current !== null) {
        window.clearTimeout(appStateSaveTimerRef.current)
        appStateSaveTimerRef.current = null
      }
    }
    // Deliberately mount-once: this bootstraps the app exactly one time.
    // getActiveSection changes identity on every active-section switch (it
    // depends on activeSectionId) -- adding it here would re-run the entire
    // bootstrap (re-fetch notes, re-init sections, etc.) on every note
    // switch. applyDarkModePreset is only called from within bootstrap()
    // itself using the freshly-loaded appState, not a value that needs to
    // stay in sync with later renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Drains initialNoteIdBySectionIdRef (populated by the bootstrap effect
  // above) once each section it names has actually mounted and registered
  // -- registerSectionHandle runs synchronously during a section's own
  // render, so by the time this effect fires after that commit, a
  // newly-listed section is already in the registry. Re-checks whenever
  // editorSections changes, so it naturally covers a section created later
  // (the "+" button) the same way it covers bootstrap's initial list.
  useEffect(() => {
    for (const entry of editorSections) {
      const pendingNoteId = initialNoteIdBySectionIdRef.current.get(entry.id)
      if (!pendingNoteId) continue
      const handle = getActiveSectionHandle(sectionRegistryRef, entry.id)
      if (!handle) continue
      initialNoteIdBySectionIdRef.current.delete(entry.id)
      if (handle.activeNoteId !== null) continue
      void handle.activateNote(pendingNoteId)
    }
  }, [editorSections])

  // Same drain pattern as above, for pendingTabBarModeBySectionIdRef.
  useEffect(() => {
    for (const entry of editorSections) {
      const pendingMode = pendingTabBarModeBySectionIdRef.current.get(entry.id)
      if (!pendingMode) continue
      const handle = getActiveSectionHandle(sectionRegistryRef, entry.id)
      if (!handle) continue
      pendingTabBarModeBySectionIdRef.current.delete(entry.id)
      handle.setTabBarMode(pendingMode)
    }
  }, [editorSections])

  const applyResolvedSections = useCallback((resolved: EditorSectionEntry[]) => {
    const placed = resolved
      .filter((entry) => entry.position !== null)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    const nextSections = placed.length > 0
      ? placed
      : [{ id: DEFAULT_EDITOR_SECTION_ID, name: null, position: 0, widthFraction: null, fixedWidthPx: null, lastActiveNoteId: null, noteSlotInitialized: false }]
    setEditorSections(nextSections)
    return nextSections
  }, [])

  // Sections the user has "pinned" by shrinking them via a divider drag:
  // id -> the pixel width they were pinned at. Fixed sections hold that width
  // while flexible ones absorb window resizes; growing a fixed section via a
  // divider drag makes it flexible again (removed from this map). The map is
  // kept even while a shrunken window forces fixed sections below their
  // pinned width (computeSlotWidthsPx handles that), so re-growing the
  // window restores the pins exactly. Hydrated from the sections table
  // during bootstrap and re-persisted whenever it changes (effect below).
  const [fixedWidthPxBySectionId, setFixedWidthPxBySectionId] = useState<ReadonlyMap<string, number>>(new Map())
  // Blocks the persist effect from writing (and clobbering the stored pins
  // with the empty pre-bootstrap map) before hydration has happened.
  const fixedWidthsHydratedRef = useRef(false)

  useEffect(() => {
    if (!fixedWidthsHydratedRef.current) return
    const sectionsApi = window.thockdownSections
    if (!sectionsApi?.updateSectionFixedWidths) return
    // Explicit nulls for unpinned sections so clearing a pin (growing the
    // section back via a divider drag) also clears it in the store.
    void sectionsApi.updateSectionFixedWidths(editorSections.map((entry) => ({
      id: entry.id,
      fixedWidthPx: fixedWidthPxBySectionId.get(entry.id) ?? null,
    }))).catch((error) => {
      console.error('Failed to persist section fixed widths', error)
    })
  }, [fixedWidthPxBySectionId, editorSections])

  // After a structural change (create/close), any fixed section whose width
  // the recomputation moved keeps its fixed status at the new width.
  const syncFixedWidthsToComputed = useCallback((widths: SectionWidthPx[], removedIds: string[] = []) => {
    setFixedWidthPxBySectionId((previous) => {
      let changed = false
      const next = new Map(previous)
      for (const id of removedIds) {
        if (next.delete(id)) changed = true
      }
      for (const { id, widthPx } of widths) {
        const pinnedPx = next.get(id)
        if (pinnedPx !== undefined && Math.abs(pinnedPx - widthPx) > 0.5) {
          next.set(id, widthPx)
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [])

  const measureSectionWidthsPx = useCallback((): SectionWidthPx[] => (
    editorSections.map((entry) => {
      const el = sectionSlotElByIdRef.current.get(entry.id)
      return { id: entry.id, widthPx: el ? el.getBoundingClientRect().width : 0 }
    })
  ), [editorSections])

  const persistSectionWidthsPx = useCallback(async (widthsPx: SectionWidthPx[]) => {
    const sectionsApi = window.thockdownSections
    if (!sectionsApi) return null
    const totalWidthPx = widthsPx.reduce((sum, entry) => sum + entry.widthPx, 0)
    const widths = widthsPx.map((entry) => ({
      id: entry.id,
      widthFraction: totalWidthPx > 0 ? entry.widthPx / totalWidthPx : null,
    }))
    return sectionsApi.updateSectionWidths(widths)
  }, [])

  // Always creates a new section immediately to the right of the one the
  // "+" button was clicked on, per the handover doc's split-view design.
  // Sizing policy: halve the flexible section adjacent to the new slot
  // (source first, then the source's old right neighbor); when neither
  // adjacent section is flexible, fund the new slot in equal parts from all
  // flexible sections wherever they sit; only when nothing flexible can fund
  // it do fixed sections get raided (legacy proportional split, and their
  // pinned widths are updated to match). See sectionWidths.ts.
  const handleCreateSection = useCallback(async (afterPosition: number, sourceSectionId: string) => {
    const sectionsApi = window.thockdownSections
    if (!sectionsApi) return

    const currentWidthsPx = measureSectionWidthsPx()
    const { updatedWidths, newSectionWidthPx } = computeSectionWidthsForNewSectionFlexAware(
      currentWidthsPx,
      sourceSectionId,
      new Set(fixedWidthPxBySectionId.keys()),
      SECTION_MIN_WIDTH_PX,
      GRID_DIVIDER_PX,
    )
    syncFixedWidthsToComputed(updatedWidths)

    const updated = await sectionsApi.createSection(null, afterPosition)
    const createdEntry = updated.find((entry) => entry.position === afterPosition + 1)
    const widthsWithNew = createdEntry
      ? [...updatedWidths, { id: createdEntry.id, widthPx: newSectionWidthPx }]
      : updatedWidths

    // Overlay the computed fractions synchronously so the very first render
    // of the new slot already has its exact width -- waiting for the persist
    // round-trip would flash a frame where the new slot has no fraction at all.
    const totalWidthPx = widthsWithNew.reduce((sum, entry) => sum + entry.widthPx, 0)
    const fractionById = new Map(widthsWithNew.map((entry) => [
      entry.id,
      totalWidthPx > 0 ? entry.widthPx / totalWidthPx : null,
    ]))
    const nextSections = applyResolvedSections(updated.map((entry) => (
      fractionById.has(entry.id)
        ? { ...entry, widthFraction: fractionById.get(entry.id) ?? entry.widthFraction }
        : entry
    )))
    const created = nextSections.find((entry) => entry.position === afterPosition + 1)
    if (created) {
      markSectionActive(created.id)
    }

    const finalized = await persistSectionWidthsPx(widthsWithNew)
    if (finalized) {
      applyResolvedSections(finalized)
    }
  }, [applyResolvedSections, fixedWidthPxBySectionId, markSectionActive, measureSectionWidthsPx, persistSectionWidthsPx, syncFixedWidthsToComputed])

  // Closes a section's slot -- deletes it outright if unnamed (the only
  // kind the "+" button creates today), parks it if named. Reassigns
  // activeSectionId to a sane neighbor if the closed section was active.
  // Sizing policy: the freed width goes to an adjacent flexible section
  // (left first, then right); if neither neighbor is flexible it's split
  // equally across all flexible sections; only when everything is fixed does
  // a fixed neighbor absorb it (and its pinned width is updated to match).
  // Persists a review-gutter-visibility change through persistMenuStateNow
  // (see its own doc comment -- this hand-rolled buildMenuStateSnapshot/
  // saveAppState call used to be the norm other toggles copied, which is
  // exactly how this bug spread). Takes both maps explicitly rather than
  // reading state directly, since every caller below already has the
  // just-computed next value for (at least) one of the two and the current
  // value of the other in scope.
  const persistReviewGutterVisibility = useCallback((
    nextLineNumbers: Record<string, boolean>,
    nextReviewFlags: Record<string, boolean>,
  ) => {
    persistMenuStateNow({
      reviewGutterVisibleBySection: nextLineNumbers,
      reviewFlagsVisibleBySection: nextReviewFlags,
    })
  }, [persistMenuStateNow])

  // Left click on the toggle button: both columns move together, driven by
  // the line-number column's CURRENT visibility -- not by independently
  // flipping each column's own state, which would incorrectly turn flags
  // back on if a prior right click had turned them off while line numbers
  // stayed on. "Off" -> both on; "on" -> both off.
  const handleToggleReviewGutter = useCallback((sectionId: string) => {
    setReviewGutterVisibleBySection((previousLineNumbers) => {
      const nextValue = !previousLineNumbers[sectionId]
      const nextLineNumbers = { ...previousLineNumbers, [sectionId]: nextValue }
      setReviewFlagsVisibleBySection((previousFlags) => {
        const nextFlags = { ...previousFlags, [sectionId]: nextValue }
        persistReviewGutterVisibility(nextLineNumbers, nextFlags)
        return nextFlags
      })
      return nextLineNumbers
    })
  }, [persistReviewGutterVisibility])

  // Right click on the toggle button: flips the review-flag column alone,
  // leaving line-number visibility untouched.
  const handleToggleReviewFlags = useCallback((sectionId: string) => {
    setReviewFlagsVisibleBySection((previousFlags) => {
      const nextFlags = { ...previousFlags, [sectionId]: !previousFlags[sectionId] }
      setReviewGutterVisibleBySection((previousLineNumbers) => {
        persistReviewGutterVisibility(previousLineNumbers, nextFlags)
        return previousLineNumbers
      })
      return nextFlags
    })
  }, [persistReviewGutterVisibility])

  // A slot's gutter toggles are a property of "this occupied slot," not of
  // any section identity that might outlive it (see
  // reviewGutterVisibleBySection's own doc comment) -- called from every
  // path that closes a slot, whether the section itself is deleted
  // (unnamed) or merely parked (named). Prunes both maps: the two columns
  // toggle independently, so a slot can have an entry in one but not the
  // other (e.g. review flags were right-clicked on before line numbers were
  // ever toggled).
  const pruneReviewGutterVisibility = useCallback((sectionId: string) => {
    setReviewGutterVisibleBySection((previousLineNumbers) => {
      const hasLineNumbers = sectionId in previousLineNumbers
      const nextLineNumbers = hasLineNumbers ? { ...previousLineNumbers } : previousLineNumbers
      if (hasLineNumbers) delete nextLineNumbers[sectionId]
      setReviewFlagsVisibleBySection((previousFlags) => {
        const hasFlags = sectionId in previousFlags
        const nextFlags = hasFlags ? { ...previousFlags } : previousFlags
        if (hasFlags) delete nextFlags[sectionId]
        if (hasLineNumbers || hasFlags) persistReviewGutterVisibility(nextLineNumbers, nextFlags)
        return nextFlags
      })
      return nextLineNumbers
    })
  }, [persistReviewGutterVisibility])

  const handleCloseSection = useCallback(async (sectionId: string) => {
    const sectionsApi = window.thockdownSections
    if (!sectionsApi) return

    // Closing parks the section's note (its editor content is about to be
    // unmounted) -- persist its cursor/scroll position now, same checkpoint
    // as beforeunload, so it survives being swapped back in later.
    sectionRegistryRef.current.get(sectionId)?.persistActiveNoteEditModeStateNow()

    const currentWidthsPx = measureSectionWidthsPx()
    const updatedWidths = computeSectionWidthsForCloseFlexAware(
      currentWidthsPx,
      sectionId,
      new Set(fixedWidthPxBySectionId.keys()),
    )
    syncFixedWidthsToComputed(updatedWidths, [sectionId])

    const updated = await sectionsApi.closeSlot(sectionId)
    sectionRegistryRef.current.delete(sectionId)
    pruneReviewGutterVisibility(sectionId)

    // Same synchronous overlay as creation: the left neighbor inherits the
    // closed slot's width on the very first post-close render.
    const totalWidthPx = updatedWidths.reduce((sum, entry) => sum + entry.widthPx, 0)
    const fractionById = new Map(updatedWidths.map((entry) => [
      entry.id,
      totalWidthPx > 0 ? entry.widthPx / totalWidthPx : null,
    ]))
    const nextSections = applyResolvedSections(updated.map((entry) => (
      fractionById.has(entry.id)
        ? { ...entry, widthFraction: fractionById.get(entry.id) ?? entry.widthFraction }
        : entry
    )))
    setActiveSectionId((previous) => (previous === sectionId ? nextSections[0].id : previous))

    const finalized = await persistSectionWidthsPx(updatedWidths)
    if (finalized) {
      applyResolvedSections(finalized)
    }
  }, [applyResolvedSections, fixedWidthPxBySectionId, measureSectionWidthsPx, persistSectionWidthsPx, pruneReviewGutterVisibility, syncFixedWidthsToComputed])

  const handleRenameSection = useCallback(async (sectionId: string, name: string | null) => {
    const sectionsApi = window.thockdownSections
    if (!sectionsApi) return
    const updated = await sectionsApi.renameSection(sectionId, name)
    applyResolvedSections(updated)
  }, [applyResolvedSections])

  // Permanently deletes a named section -- its row and any pinned tabs --
  // triggered by the section picker's right-click-then-left-click confirm
  // gesture. Unlike closeSlot (which only parks a named section so it can be
  // swapped back in later), this actually removes it for good. Reuses the
  // same close-time width redistribution as handleCloseSection for the
  // uncommon case where the deleted section happens to be occupying a
  // visible slot right now; computeSectionWidthsForCloseFlexAware is a
  // no-op when the id isn't currently placed, which covers the common case
  // (deleting a parked section straight out of the picker).
  const handleDeleteSection = useCallback(async (sectionId: string) => {
    const sectionsApi = window.thockdownSections
    if (!sectionsApi) return

    // Same checkpoint as handleCloseSection: the note itself may live on
    // (only this section slot is being removed), so its cursor/scroll
    // position is still worth persisting before the editor unloads.
    sectionRegistryRef.current.get(sectionId)?.persistActiveNoteEditModeStateNow()

    const currentWidthsPx = measureSectionWidthsPx()
    const updatedWidths = computeSectionWidthsForCloseFlexAware(
      currentWidthsPx,
      sectionId,
      new Set(fixedWidthPxBySectionId.keys()),
    )
    syncFixedWidthsToComputed(updatedWidths, [sectionId])

    const updated = await sectionsApi.removeSection(sectionId)
    sectionRegistryRef.current.delete(sectionId)

    const totalWidthPx = updatedWidths.reduce((sum, entry) => sum + entry.widthPx, 0)
    const fractionById = new Map(updatedWidths.map((entry) => [
      entry.id,
      totalWidthPx > 0 ? entry.widthPx / totalWidthPx : null,
    ]))
    const nextSections = applyResolvedSections(updated.map((entry) => (
      fractionById.has(entry.id)
        ? { ...entry, widthFraction: fractionById.get(entry.id) ?? entry.widthFraction }
        : entry
    )))
    setActiveSectionId((previous) => (previous === sectionId ? nextSections[0].id : previous))

    const finalized = await persistSectionWidthsPx(updatedWidths)
    if (finalized) {
      applyResolvedSections(finalized)
    }
  }, [applyResolvedSections, fixedWidthPxBySectionId, measureSectionWidthsPx, persistSectionWidthsPx, syncFixedWidthsToComputed])

  // Fetched fresh each time the identity tab's right-click menu opens,
  // rather than kept as ongoing state -- named-but-parked sections (not in
  // editorSections, which only holds placed ones) only matter at the
  // moment the menu is actually open.
  const handleFetchSwapCandidates = useCallback(async (sectionId: string) => {
    const sectionsApi = window.thockdownSections
    if (!sectionsApi) return []
    const all = await sectionsApi.listSections()
    return all
      .filter((entry): entry is EditorSectionEntry & { name: string } => entry.name !== null && entry.id !== sectionId)
      .map((entry) => ({ id: entry.id, name: entry.name }))
  }, [])

  // Sizing policy for swap: dimensions belong to the *slot*, not whichever
  // section happens to be showing in it. Swapping never creates or removes
  // a slot -- it only ever changes what's on screen -- so no width
  // recalculation happens here at all, just reassigning each slot's
  // existing widthFraction to whatever now occupies it.
  const handleSwapSection = useCallback(async (outgoingSectionId: string, incomingSectionId: string) => {
    const sectionsApi = window.thockdownSections
    if (!sectionsApi) return

    // If the incoming section was already occupying a different slot, that
    // slot is about to be silently vacated -- swapIntoSlot only fills the
    // *destination* (outgoing's) slot, it has no notion of "what incoming
    // left behind." Capture both slots' identities and widths beforehand so
    // the vacated one can be backfilled with a fresh section afterward
    // (inheriting its width), rather than the pane count quietly shrinking.
    const incomingEntryBefore = editorSections.find((entry) => entry.id === incomingSectionId)
    const outgoingEntryBefore = editorSections.find((entry) => entry.id === outgoingSectionId)
    const incomingPreviousPosition = incomingEntryBefore?.position ?? null
    const incomingPreviousWidthFraction = incomingEntryBefore?.widthFraction ?? null
    const outgoingWidthFraction = outgoingEntryBefore?.widthFraction ?? null

    // outgoingSectionId's editor is about to unload its note -- persist its
    // cursor/scroll position first, same checkpoint as handleCloseSection.
    sectionRegistryRef.current.get(outgoingSectionId)?.persistActiveNoteEditModeStateNow()

    let updated = await sectionsApi.swapIntoSlot(outgoingSectionId, incomingSectionId)
    sectionRegistryRef.current.delete(outgoingSectionId)
    // outgoingSectionId's slot is closed the same way handleCloseSection's
    // is (see swapIntoSlot's own doc comment) -- same prune. incomingSectionId
    // is a fresh occupant of a slot it wasn't showing in before, so it
    // correctly has no entry yet either (default off, per spec).
    pruneReviewGutterVisibility(outgoingSectionId)

    const widthFixups: { id: string; widthFraction: number | null }[] = [
      { id: incomingSectionId, widthFraction: outgoingWidthFraction },
    ]

    let backfilledSectionId: string | null = null
    if (incomingPreviousPosition !== null && incomingPreviousPosition !== outgoingEntryBefore?.position) {
      updated = await sectionsApi.createSection(null, incomingPreviousPosition - 1)
      const backfilled = updated.find((entry) => entry.position === incomingPreviousPosition)
      if (backfilled) {
        backfilledSectionId = backfilled.id
        widthFixups.push({ id: backfilled.id, widthFraction: incomingPreviousWidthFraction })
      }
    }

    // Fixed pins belong to the *slot* just like widthFraction does: the
    // destination slot's pin carries over to whichever section now occupies
    // it, and the vacated slot's pin transfers to its backfilled section.
    setFixedWidthPxBySectionId((previous) => {
      if (previous.size === 0) return previous
      const outgoingPinPx = previous.get(outgoingSectionId)
      const incomingPinPx = previous.get(incomingSectionId)
      if (outgoingPinPx === undefined && incomingPinPx === undefined) return previous

      const next = new Map(previous)
      next.delete(outgoingSectionId)
      next.delete(incomingSectionId)
      if (outgoingPinPx !== undefined) {
        next.set(incomingSectionId, outgoingPinPx)
      }
      if (incomingPinPx !== undefined && backfilledSectionId !== null) {
        next.set(backfilledSectionId, incomingPinPx)
      }
      return next
    })

    updated = await sectionsApi.updateSectionWidths(widthFixups)

    // swapIntoSlot only ever reassigns the *destination* slot's position to
    // incomingSectionId -- it never renumbers incoming's own old position,
    // so when incoming was already placed elsewhere, that old slot is left
    // as a gap (e.g. positions land on 0, 1, 3 instead of 0, 1, 2). The
    // createSection backfill above expects contiguous positions to shift
    // into place correctly, so a pre-existing gap makes it shift the wrong
    // rows too far, corrupting positions further down the row. Re-deriving
    // the visible order from the (still correctly *ordered*, just not
    // necessarily *contiguous*) positions and renumbering through
    // reorderSections cleans that up without changing what's visually
    // where.
    const visibleOrderedIds = updated
      .filter((entry) => entry.position !== null)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((entry) => entry.id)
    updated = await sectionsApi.reorderSections(visibleOrderedIds)

    const incomingEntry = updated.find((entry) => entry.id === incomingSectionId)
    if (incomingEntry?.lastActiveNoteId && notesRef.current.some((note) => note.id === incomingEntry.lastActiveNoteId)) {
      initialNoteIdBySectionIdRef.current.set(incomingSectionId, incomingEntry.lastActiveNoteId)
    }
    // Swapping is only reachable via the tab-bar-mode section picker, so the
    // incoming section should keep showing the tab bar too, rather than its
    // own fresh EditorSection instance defaulting back to 'tags'.
    pendingTabBarModeBySectionIdRef.current.set(incomingSectionId, 'tabs')
    applyResolvedSections(updated)
    setActiveSectionId((previous) => (previous === outgoingSectionId ? incomingSectionId : previous))
  }, [applyResolvedSections, editorSections, pruneReviewGutterVisibility])

  // "Clear this section" from the section picker's leading pill. This must
  // NOT touch the section's own data (name, pinned tabs, last-active note) --
  // those belong to the section, not the slot, and clearing is meant to be
  // reversible via the picker later. So instead of resetting the section's
  // content, this closes its slot exactly like handleCloseSection (parks it
  // if named, deletes it if unnamed) and immediately backfills the vacated
  // slot with a brand-new blank section, inheriting the outgoing section's
  // widthFraction/pin so the slot's size never visibly changes -- same
  // backfill trick handleSwapSection uses for a slot an incoming section
  // vacates, just applied to the outgoing slot instead of skipping resize
  // entirely like a normal close does.
  const handleClearSection = useCallback(async (sectionId: string) => {
    const sectionsApi = window.thockdownSections
    if (!sectionsApi) return

    const outgoingEntryBefore = editorSections.find((entry) => entry.id === sectionId)
    const outgoingPosition = outgoingEntryBefore?.position ?? null
    const outgoingWidthFraction = outgoingEntryBefore?.widthFraction ?? null

    // Same checkpoint as handleCloseSection: this slot's editor is unloading
    // its note before the fresh blank section backfills it.
    sectionRegistryRef.current.get(sectionId)?.persistActiveNoteEditModeStateNow()

    let updated = await sectionsApi.closeSlot(sectionId)
    sectionRegistryRef.current.delete(sectionId)
    pruneReviewGutterVisibility(sectionId)

    updated = await sectionsApi.createSection(null, (outgoingPosition ?? 1) - 1)
    const created = updated.find((entry) => entry.position === outgoingPosition)

    if (created) {
      updated = await sectionsApi.updateSectionWidths([
        { id: created.id, widthFraction: outgoingWidthFraction },
      ])
    }

    setFixedWidthPxBySectionId((previous) => {
      const outgoingPinPx = previous.get(sectionId)
      if (outgoingPinPx === undefined) return previous
      const next = new Map(previous)
      next.delete(sectionId)
      if (created) {
        next.set(created.id, outgoingPinPx)
      }
      return next
    })

    // Clearing is only reachable via the tab-bar-mode section picker, so the
    // backfilled section should keep showing the tab bar too, rather than
    // its own fresh EditorSection instance defaulting back to 'tags'.
    if (created) {
      pendingTabBarModeBySectionIdRef.current.set(created.id, 'tabs')
    }

    applyResolvedSections(updated)
    if (created) {
      setActiveSectionId((previous) => (previous === sectionId ? created.id : previous))
    }
  }, [applyResolvedSections, editorSections, pruneReviewGutterVisibility])

  const editorSectionsRowRef = useRef<HTMLDivElement | null>(null)
  const sectionSlotElByIdRef = useRef<Map<string, HTMLDivElement>>(new Map())

  // Deterministic slot sizing: the row's live width is observed and each
  // slot's exact pixel width is derived from it (see computeSlotWidthsPx),
  // rather than letting flex-grow weights improvise. This is what makes
  // window shrinks reflow sections (down to their minimum, never clipping)
  // and makes create/close/drag arithmetic land exactly as computed.
  const [sectionsRowWidthPx, setSectionsRowWidthPx] = useState<number | null>(null)

  useLayoutEffect(() => {
    const rowEl = editorSectionsRowRef.current
    if (!rowEl) return

    const applyMeasuredWidth = (widthPx: number) => {
      setSectionsRowWidthPx((previous) => (
        previous !== null && Math.abs(previous - widthPx) < 0.5 ? previous : widthPx
      ))
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        applyMeasuredWidth(entry.contentRect.width)
      }
    })
    observer.observe(rowEl)
    applyMeasuredWidth(rowEl.getBoundingClientRect().width)

    return () => observer.disconnect()
  }, [])

  const sectionSlotWidthsPx = useMemo(() => {
    if (sectionsRowWidthPx === null || sectionsRowWidthPx <= 0) return null
    return computeSlotWidthsPx(
      editorSections.map((entry) => ({
        id: entry.id,
        widthFraction: entry.widthFraction,
        fixedWidthPx: fixedWidthPxBySectionId.get(entry.id) ?? null,
      })),
      sectionsRowWidthPx,
      GRID_DIVIDER_PX,
      SECTION_MIN_WIDTH_PX,
    )
  }, [editorSections, sectionsRowWidthPx, fixedWidthPxBySectionId])

  // Drag-resizes exactly the two sections on either side of the divider that
  // was grabbed. Slots render with an exact pixel flex-basis (grow/shrink 0,
  // derived from computeSlotWidthsPx), so during a drag only the two dragged
  // neighbors' bases need direct DOM writes as the mouse moves -- the same
  // style properties React itself renders, so no React/DOM style desync can
  // survive the drag. Not routed through React state per mousemove (kept as
  // direct DOM writes) so dragging stays smooth; on release the final widths
  // are committed to React state synchronously (so the very next render
  // reproduces them exactly) and persisted as fractions. Releasing also
  // updates the fixed/flexible model: the shrunken side pins at its dragged
  // width, the grown side (re)joins the flexible pool.
  const handleDividerMouseDown = useCallback((leftSectionId: string, rightSectionId: string) => (
    event: MouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault()
    const leftEl = sectionSlotElByIdRef.current.get(leftSectionId)
    const rightEl = sectionSlotElByIdRef.current.get(rightSectionId)
    if (!leftEl || !rightEl) return

    const pinnedWidthsPx = editorSections.map((entry) => {
      const el = sectionSlotElByIdRef.current.get(entry.id)
      return { entry, el, widthPx: el ? el.getBoundingClientRect().width : 0 }
    })
    pinnedWidthsPx.forEach(({ el, widthPx }) => {
      if (el) {
        el.style.flexGrow = '0'
        el.style.flexShrink = '0'
        el.style.flexBasis = `${widthPx}px`
      }
    })

    const startLeftWidthPx = leftEl.getBoundingClientRect().width
    const startRightWidthPx = rightEl.getBoundingClientRect().width
    const combinedWidthPx = startLeftWidthPx + startRightWidthPx
    const startClientX = event.clientX

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const deltaX = moveEvent.clientX - startClientX
      const nextLeftWidthPx = clamp(startLeftWidthPx + deltaX, SECTION_MIN_WIDTH_PX, combinedWidthPx - SECTION_MIN_WIDTH_PX)
      const nextRightWidthPx = combinedWidthPx - nextLeftWidthPx
      leftEl.style.flexBasis = `${nextLeftWidthPx}px`
      rightEl.style.flexBasis = `${nextRightWidthPx}px`
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)

      const finalWidthsPx = pinnedWidthsPx.map(({ entry, el }) => ({
        id: entry.id,
        widthPx: el ? el.getBoundingClientRect().width : 0,
      }))
      const totalWidthPx = finalWidthsPx.reduce((sum, { widthPx }) => sum + widthPx, 0) || 1
      const widths = finalWidthsPx.map(({ id, widthPx }) => ({
        id,
        widthFraction: widthPx / totalWidthPx,
      }))

      // The drag transfers width between exactly two sections: the one the
      // user shrank becomes "fixed" at its new width (window resizes leave it
      // alone), the one that grew becomes flexible again. An unchanged drag
      // (released where it started) alters neither.
      const finalWidthById = new Map(finalWidthsPx.map(({ id, widthPx }) => [id, widthPx]))
      setFixedWidthPxBySectionId((previous) => {
        const next = new Map(previous)
        const classify = (id: string, startPx: number) => {
          const finalPx = finalWidthById.get(id)
          if (finalPx === undefined) return
          if (finalPx < startPx - 0.5) {
            next.set(id, finalPx)
          } else if (finalPx > startPx + 0.5) {
            next.delete(id)
          }
        }
        classify(leftSectionId, startLeftWidthPx)
        classify(rightSectionId, startRightWidthPx)
        return next
      })

      // Commit the dragged fractions to state immediately: any re-render
      // between mouseup and the async persist resolving must reproduce the
      // dragged widths, not snap back to the pre-drag fractions.
      const fractionById = new Map(widths.map(({ id, widthFraction }) => [id, widthFraction]))
      setEditorSections((previous) => previous.map((entry) => (
        fractionById.has(entry.id)
          ? { ...entry, widthFraction: fractionById.get(entry.id) ?? entry.widthFraction }
          : entry
      )))

      void window.thockdownSections?.updateSectionWidths(widths).then((updated) => {
        applyResolvedSections(updated)
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [applyResolvedSections, editorSections])

  // Right-click a divider to instantly equalize its two flanking sections'
  // widths, rather than dragging to eyeball it. Shares its commit shape with
  // handleDividerMouseDown's mouseup (final width -> widthFraction, then
  // classify each side fixed/flexible by comparing against its start width)
  // so an equalizing click behaves exactly like a drag dropped dead center.
  const handleDividerContextMenu = useCallback((leftSectionId: string, rightSectionId: string) => (
    event: MouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault()

    const widthsPx = editorSections.map((entry) => {
      const el = sectionSlotElByIdRef.current.get(entry.id)
      return { id: entry.id, widthPx: el ? el.getBoundingClientRect().width : 0 }
    })
    const startLeftWidthPx = widthsPx.find((entry) => entry.id === leftSectionId)?.widthPx ?? 0
    const startRightWidthPx = widthsPx.find((entry) => entry.id === rightSectionId)?.widthPx ?? 0
    const combinedWidthPx = startLeftWidthPx + startRightWidthPx
    if (combinedWidthPx <= 0) return

    const nextLeftWidthPx = clamp(combinedWidthPx / 2, SECTION_MIN_WIDTH_PX, combinedWidthPx - SECTION_MIN_WIDTH_PX)
    const nextRightWidthPx = combinedWidthPx - nextLeftWidthPx

    const finalWidthsPx = widthsPx.map((entry) => {
      if (entry.id === leftSectionId) return { id: entry.id, widthPx: nextLeftWidthPx }
      if (entry.id === rightSectionId) return { id: entry.id, widthPx: nextRightWidthPx }
      return entry
    })
    const totalWidthPx = finalWidthsPx.reduce((sum, { widthPx }) => sum + widthPx, 0) || 1
    const widths = finalWidthsPx.map(({ id, widthPx }) => ({ id, widthFraction: widthPx / totalWidthPx }))

    const finalWidthById = new Map(finalWidthsPx.map(({ id, widthPx }) => [id, widthPx]))
    setFixedWidthPxBySectionId((previous) => {
      const next = new Map(previous)
      const classify = (id: string, startPx: number) => {
        const finalPx = finalWidthById.get(id)
        if (finalPx === undefined) return
        if (finalPx < startPx - 0.5) {
          next.set(id, finalPx)
        } else if (finalPx > startPx + 0.5) {
          next.delete(id)
        }
      }
      classify(leftSectionId, startLeftWidthPx)
      classify(rightSectionId, startRightWidthPx)
      return next
    })

    // Only the two flanking sections' fractions actually change value here
    // (redistributing between just them, off an unchanged total) -- touching
    // just their entries, not the rest, keeps every other section's object
    // reference stable so it doesn't re-render along with them.
    const leftWidthFraction = nextLeftWidthPx / totalWidthPx
    const rightWidthFraction = nextRightWidthPx / totalWidthPx
    setEditorSections((previous) => previous.map((entry) => {
      if (entry.id === leftSectionId) return { ...entry, widthFraction: leftWidthFraction }
      if (entry.id === rightSectionId) return { ...entry, widthFraction: rightWidthFraction }
      return entry
    }))

    void window.thockdownSections?.updateSectionWidths(widths).then((updated) => {
      applyResolvedSections(updated)
    })
  }, [applyResolvedSections, editorSections])

  useEffect(() => {
    // Prime immediately once assets are loaded, not just on a later user
    // gesture (see the effect below): Electron's default autoplay policy is
    // no-user-gesture-required, so there's nothing to wait for, and if the
    // user's first action after launch is typing rather than clicking, the
    // pointerdown/focus listeners below would never have fired before that
    // first keystroke -- leaving the ~100-300ms hardware spin-up to land on
    // it anyway.
    void typingSoundManager.load().then(() => {
      typingSoundManager.primeAudioContext()
    })
  }, [])

  useEffect(() => {
    // Belt-and-suspenders fallback for contexts where the eager prime above
    // couldn't run (resume() rejected, or load() still in flight when a
    // gesture happens first anyway) -- resume the AudioContext on the
    // earliest real user gesture (window focus, first pointer press) rather
    // than waiting for the first keystroke. primeAudioContext()'s own
    // ensureContextRunning() no-ops once the context is already running, so
    // this is safe to fire alongside the eager prime above.
    const primeAudio = () => {
      typingSoundManager.primeAudioContext()
    }
    window.addEventListener('pointerdown', primeAudio, { once: true })
    window.addEventListener('focus', primeAudio, { once: true })
    return () => {
      window.removeEventListener('pointerdown', primeAudio)
      window.removeEventListener('focus', primeAudio)
    }
  }, [])

  useEffect(() => {
    typingSoundManager.setLayerGain('click', audioKeyVolume)
  }, [audioKeyVolume])

  useEffect(() => {
    typingSoundManager.setTypingSoundVariance(audioKeyVariance)
  }, [audioKeyVariance])

  useEffect(() => {
    typingSoundManager.setTypingSoundPitch(audioPitch)
  }, [audioPitch])

  useEffect(() => {
    typingSoundManager.setLayerGain('bass', audioBassVolume)
  }, [audioBassVolume])

  useEffect(() => {
    typingSoundManager.setTypingSoundSet(typingSoundSet)
  }, [typingSoundSet])

  useEffect(() => {
    typingSoundManager.setTypingSoundEnabled(typingSoundEnabled)
  }, [typingSoundEnabled])

  useEffect(() => {
    typingSoundManager.setReverbStrength(audioReverbStrength)
  }, [audioReverbStrength])

  useEffect(() => {
    typingSoundManager.setReverbSpace(audioReverbSpace)
  }, [audioReverbSpace])

  useEffect(() => {
    typingSoundManager.setPitchJitterAmount(pitchJitterAmount)
  }, [pitchJitterAmount])

  useEffect(() => {
    typingSoundManager.setSpatialAmount(audioSpatial)
  }, [audioSpatial])

  useEffect(() => {
    // The blink animation keeps the compositor busy indefinitely while the
    // caret is idle, not just while typing -- toggled via a body class
    // rather than threading a prop through BlockCaretPlugin/Editor.tsx.
    document.body.classList.toggle('thockdown-reduced-caret-animation', reducedCaretAnimation)
    return () => {
      document.body.classList.remove('thockdown-reduced-caret-animation')
    }
  }, [reducedCaretAnimation])

  useEffect(() => {
    typingSoundManager.setLayerGain('treble', audioTrebleVolume)
  }, [audioTrebleVolume])

  const handleExportPdf = useCallback(async () => {
    const activeNoteId = getActiveSection()?.activeNoteId
    if (!activeNoteId || isExportingPdf) return
    setIsExportingPdf(true)

    try {
      const exportApi = window.thockdownExport
      const exportPdf = exportApi
        ? exportApi.exportPdf
        : (folderPath: string, fileName: string, htmlContent?: string) => window.ipcRenderer?.invoke<{ ok: boolean; path?: string; error?: string }>('export-pdf', folderPath, fileName, htmlContent)

      const folderPath = exportFolder ?? await chooseExportFolder()
      if (!folderPath) return

      const fileName = `${deriveNoteTitleFromText(getActiveSection()?.activeNoteText || '')}.pdf`
      const htmlContent = await buildExportHtmlContent()
      const result = await exportPdf(folderPath, fileName, htmlContent)

      if (!result?.ok) {
        console.error('Export PDF failed', result?.error)
      }
    } catch (error) {
      console.error('Export PDF failed', error)
    } finally {
      setIsExportingPdf(false)
    }
  }, [getActiveSection, exportFolder, isExportingPdf, chooseExportFolder, buildExportHtmlContent])

  const handleExportMd = useCallback(async (forceChooseFolder = false) => {
    const activeNoteId = getActiveSection()?.activeNoteId
    if (!activeNoteId || isExportingMd) return
    setIsExportingMd(true)

    try {
      const folderPath = (!exportFolder || forceChooseFolder)
        ? await chooseExportFolder()
        : exportFolder
      if (!folderPath) return

      const fileName = `${deriveNoteTitleFromText(getActiveSection()?.activeNoteText || '')}.md`
      const result = await window.ipcRenderer?.invoke<{ ok: boolean; error?: string }>('export-md', activeNoteId, folderPath, fileName)

      if (!result?.ok) {
        console.error('Export MD failed', result?.error)
      }
    } catch (error) {
      console.error('Export MD failed', error)
    } finally {
      setIsExportingMd(false)
    }
  }, [getActiveSection, exportFolder, isExportingMd, chooseExportFolder])

  useEffect(() => {
    const activeNoteId = activeSectionSnapshot?.activeNoteId
    if (!window.thockdownState || !activeNoteId) return
    queueAppStateSave(activeNoteId)
  }, [activeSectionSnapshot?.activeNoteId, queueAppStateSave])

  useEffect(() => {
    if (!persistenceReady) return

    const externalApi = window.thockdownExternalFiles
    if (!externalApi || !window.thockdownNotes) return

    let disposed = false

    const processPending = async () => {
      const pendingPaths = await externalApi.getPendingFilePaths()
      if (disposed) return
      for (const filePath of pendingPaths) {
        enqueueExternalFileImport(filePath)
      }
    }

    void processPending()

    const unsubscribe = externalApi.onOpenFile((filePath) => {
      if (disposed) return
      enqueueExternalFileImport(filePath)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [enqueueExternalFileImport, persistenceReady])

  useEffect(() => {
    const shellElement = appShellRef.current
    if (!shellElement) return

    const effectiveMin = isSidebarVisible ? appShellMinWidthPx : (appShellMinWidthPx - (sidebarWidthPx + GRID_DIVIDER_PX))

    const updateShellWidth = () => {
      setAppShellWidthPx(Math.max(effectiveMin, Math.round(shellElement.clientWidth)))
    }

    updateShellWidth()

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setAppShellWidthPx(Math.max(effectiveMin, Math.round(entry.contentRect.width)))
    })

    observer.observe(shellElement)
    return () => observer.disconnect()
  }, [isSidebarVisible, appShellMinWidthPx, sidebarWidthPx])

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  }, [notes])

  const searchedNotes = useMemo(() => {
    // The User Guide's whole family (parent + auto-TOC + real chapters) is
    // excluded here, upstream of every sidebar view (Date/Category/Archive/
    // Trash/Find all derive from this), rather than at each of their own
    // filters individually -- unlike a chapterOnly note, this family should
    // never resurface under any circumstance (not even an active search or
    // Trash's own blanket chapter inclusion), since it's only ever reachable
    // through the dedicated help button or a `$HELP` link. It still stays in
    // the raw `notes`/`notesRef` array those links resolve against -- only
    // filtered out of the menu-facing lists here.
    return sortedNotes
      .filter((note) => !HELP_GUIDE_NOTE_IDS.has(note.id))
      .filter((note) => matchesNoteSearchQuery(
        {
          title: note.title,
          fileName: note.fileName,
          tags: note.tags,
          contentText: note.contentText,
        },
        searchQuery,
        isSearchQueryCaseSensitive,
      ))
  }, [isSearchQueryCaseSensitive, searchQuery, sortedNotes])

  const isFindMode = sidebarMode === 'find'
  const isReplaceMode = isFindMode && Boolean(activeSectionSnapshot?.isDocumentReplaceMode)
  const hasMonthFilter = selectedMonths.size > 0
  const hasYearFilter = selectedYears.size > 0
  const hasDateFilter = hasMonthFilter || hasYearFilter

  const matchesSelectedDateFilter = useCallback((timestampMs: number) => {
    const date = new Date(timestampMs)
    const noteMonth = date.getMonth() + 1
    const noteYear = date.getFullYear()
    const oldestYear = new Date().getFullYear() - 4

    const monthMatch = !hasMonthFilter || selectedMonths.has(noteMonth)

    let yearMatch = !hasYearFilter
    if (hasYearFilter) {
      if (selectedYears.has(noteYear)) {
        yearMatch = true
      } else if (selectedYears.has('older') && noteYear < oldestYear) {
        yearMatch = true
      }
    }

    return monthMatch && yearMatch
  }, [hasMonthFilter, hasYearFilter, selectedMonths, selectedYears])

  const filterNotesBySelectedDate = useCallback((source: NoteSummary[]) => {
    if (!hasDateFilter) {
      return source
    }

    return source.filter((note) => matchesSelectedDateFilter(note.updatedAtMs))
  }, [hasDateFilter, matchesSelectedDateFilter])

  const isSidebarSearchActive = isNoteSearchQueryActive(searchQuery)

  const notesById = useMemo(() => {
    return new Map(notes.map((note) => [note.id, note]))
  }, [notes])

  const dateEligibleNotes = useMemo(() => {
    return searchedNotes.filter((note) => {
      if (isDeletedNote(note)) return false
      if (isArchivedNote(note)) return false
      // Chapters only ever exist to be shown through their parent's chapter
      // bar -- excluded from 'date', unlike external notes (which still show
      // there). The one exception is an active search: a chapter whose own
      // content/title matched is surfaced like any other note (see
      // NoteListItem's chapterParentTitle, shown alongside -- not in place
      // of -- the chapter's own title). A deleted chapter is a second,
      // separate exception, handled entirely by trashEligibleNotes below
      // (deleted notes are already filtered out above this check, so this
      // branch never even sees one).
      if (isChapterOnlyNote(note) && !isSidebarSearchActive) return false
      return true
    })
  }, [isSidebarSearchActive, searchedNotes])

  const categoryEligibleNotes = useMemo(() => {
    // The category tree groups by tag, and a chapter has no tags of its own
    // (see isChapterOnlyNote's other callers) -- surfacing it here would
    // just dump it into an untagged bucket with the wrong title. Chapters
    // stay search-only, in the flat 'date' list.
    const categoryNotes = dateEligibleNotes.filter((note) => !isExternalNote(note) && !isChapterOnlyNote(note))
    return filterNotesBySelectedDate(categoryNotes)
  }, [dateEligibleNotes, filterNotesBySelectedDate])

  // A non-self-archived parent's own archived chapters -- detached (see
  // detachChapter), so they carry no `chapters`-table row and would
  // otherwise be unreachable anywhere. Keyed by parentNoteId
  // (detachedChapterParentId), sorted alphabetically by title; this is the
  // Archive tree's fold-out contents, not restore-order, so exact DB
  // position doesn't matter here the way it does for the chapter bar's own
  // virtual merge (useNoteChapters.ts, which reads position from the real
  // IPC call instead). Built from searchedNotes, same as every other
  // view-eligible list, so an active search also filters which archived
  // chapters a fold-out shows.
  const archivedChaptersByParentId = useMemo(() => {
    const map = new Map<string, NoteSummary[]>()
    for (const note of searchedNotes) {
      if (!note.chapterOnly || !isArchivedNote(note) || !note.detachedChapterParentId) continue
      const bucket = map.get(note.detachedChapterParentId)
      if (bucket) {
        bucket.push(note)
      } else {
        map.set(note.detachedChapterParentId, [note])
      }
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    }
    return map
  }, [searchedNotes])

  const archiveEligibleNotes = useMemo(() => {
    // Unlike categoryEligibleNotes, this also includes a parent that isn't
    // itself archived but has at least one archived chapter -- its own
    // fold-out row in the Archive tree (see CategoryTreeView), toggled
    // open/closed rather than opened in the editor. A tagless chapter
    // itself still never lands here directly -- same "no sensible bucket"
    // reasoning as categoryEligibleNotes -- it only ever surfaces as a
    // fold-out child of its qualifying parent.
    const archiveNotes = searchedNotes.filter((note) => (
      (isArchivedNote(note) || archivedChaptersByParentId.has(note.id))
      && !isDeletedNote(note) && !isExternalNote(note) && !isChapterOnlyNote(note)
    ))
    return filterNotesBySelectedDate(archiveNotes)
  }, [filterNotesBySelectedDate, searchedNotes, archivedChaptersByParentId])

  const trashEligibleNotes = useMemo(() => {
    // Unlike every other menu view, a deleted chapter *does* show here --
    // a chapter can now carry its own 'archived'/'deleted' protected tag
    // (see ChapterBar.tsx's archive/delete split pill), and a deleted
    // chapter needs to be discoverable somewhere other than its parent's
    // chapter bar. Trash is a flat, ungrouped list (unlike archive/
    // category's tag-tree view, which has no sensible bucket for a
    // tagless chapter -- deliberately not extended the same way), so a
    // chapter row fits here naturally. See NoteListItem's chapterParentTitle
    // for how it's labeled to stay legible out of its normal context.
    return searchedNotes.filter((note) => isDeletedNote(note) && !isExternalNote(note))
  }, [searchedNotes])

  const dateFilteredNotes = useMemo(() => {
    return filterNotesBySelectedDate(dateEligibleNotes).sort(compareExternalNotesFirst)
  }, [dateEligibleNotes, filterNotesBySelectedDate])

  const trashFilteredNotes = useMemo(() => {
    return trashEligibleNotes
  }, [trashEligibleNotes])

  const categoryTree = useMemo<PrimaryGroup[]>(() => {
    return buildHierarchyGroups(categoryEligibleNotes)
  }, [categoryEligibleNotes])

  const archiveTree = useMemo<PrimaryGroup[]>(() => {
    return buildHierarchyGroups(archiveEligibleNotes)
  }, [archiveEligibleNotes])

  useEffect(() => {
    dateFilteredNotesRef.current = dateFilteredNotes
  }, [dateFilteredNotes])

  useEffect(() => {
    trashFilteredNotesRef.current = trashFilteredNotes
  }, [trashFilteredNotes])

  useEffect(() => {
    categoryTreeRef.current = categoryTree
  }, [categoryTree])

  useEffect(() => {
    archiveTreeRef.current = archiveTree
  }, [archiveTree])



  const visibleNotes = useMemo(() => {
    if (sidebarMode === 'date') {
      return dateFilteredNotes
    }

    if (sidebarMode === 'trash') {
      return trashFilteredNotes
    }

    return []
  }, [dateFilteredNotes, sidebarMode, trashFilteredNotes])

  const totalPagedNotes = (sidebarMode === 'date' || sidebarMode === 'trash')
    ? visibleNotes.length
    : 0

  // The menu is deliberately a stable "file cabinet," not something that
  // chases the active note -- browsing the sidebar (changing a filter,
  // switching views) never used to reach back into the editor and swap the
  // active note out from under the user (that used to happen here; removed).
  // The one deliberate exception is this: clicking an already-selected tab
  // explicitly asks to locate that note in the menu. Reused wholesale:
  // isDeletedNote/isArchivedNote for where a note lives, matchesNoteSearchQuery/
  // matchesSelectedDateFilter for which filter (if any) is actually hiding it,
  // and the existing runSidebarMenuTransition/focusActiveNoteInSidebarMode
  // pair for switching view + unfolding tree branches + scrolling into view --
  // all of which already exist and already operate on activeNoteId, which is
  // exactly what this reveals (the note the section that triggered this was
  // already showing).
  const revealNoteInMenu = useCallback(() => {
    const section = getActiveSection()
    // menuIdentityNoteId/menuIdentityNoteSummary, not the true active note --
    // chapters never appear in the menu, so revealing one means revealing
    // its parent instead (see sectionRegistry.ts's SectionHandle doc comment).
    const activeNoteId = section?.menuIdentityNoteId
    const activeNoteSummary = section?.menuIdentityNoteSummary
    if (!activeNoteId || !activeNoteSummary) return

    // Clear only whichever filter is actually hiding the note -- never one
    // that isn't in the way.
    if (isSidebarSearchActive && !matchesNoteSearchQuery(
      { title: activeNoteSummary.title, fileName: activeNoteSummary.fileName, tags: activeNoteSummary.tags, contentText: activeNoteSummary.contentText },
      searchQuery,
      isSearchQueryCaseSensitive,
    )) {
      setSearchQuery('')
    }
    const isDeleted = isDeletedNote(activeNoteSummary)
    const isArchived = isArchivedNote(activeNoteSummary)
    const isExternal = isExternalNote(activeNoteSummary)

    // The month/year filter never applies to trash (trashEligibleNotes skips
    // it entirely) -- clearing it there would be an unrelated side effect,
    // not "clearing whichever filter is actually hiding the note."
    if (!isDeleted && hasDateFilter && !matchesSelectedDateFilter(activeNoteSummary.updatedAtMs)) {
      setSelectedMonths(new Set())
      setSelectedYears(new Set())
    }

    const targetMode: SidebarMode = isDeleted
      ? 'trash'
      : isArchived
        ? 'archive'
        // Category/archive trees exclude external (filesystem-synced) notes
        // entirely, regardless of any filter -- 'date' is the only view
        // that can ever show one, so there's no "stay in category" option
        // for it even if that's the current mode.
        : isExternal
          ? 'date'
          : (sidebarMode === 'date' || sidebarMode === 'category')
            ? sidebarMode
            : 'category'

    const staysInCurrentMode = targetMode === sidebarMode
    const needsDatePaginationPrep = !isDeleted && !isArchived && !isExternal && targetMode === 'category' && !staysInCurrentMode

    // Deferred a frame: the filter-clearing state updates above need to
    // commit (and dateFilteredNotes/categoryTree recompute) before switching
    // mode / unfolding / paginating can find the note where it now is.
    requestAnimationFrame(() => {
      if (staysInCurrentMode) {
        focusActiveNoteInSidebarMode(sidebarMode)
      } else {
        runSidebarMenuTransition(targetMode)
      }

      // Silently prep date view's pagination so it's already positioned
      // right if the user switches there by hand later -- without actually
      // switching to date view now. This writes the *persisted* per-mode
      // page (sidebarViewStateByMode.date.page), not the live currentPage,
      // since currentPage only reflects whichever mode is presently active
      // and would just get discarded the next time date mode is entered.
      if (needsDatePaginationPrep) {
        const noteIndex = dateFilteredNotesRef.current.findIndex((note) => note.id === activeNoteId)
        if (noteIndex >= 0) {
          const container = sidebarContentRef.current
          const list = container?.querySelector('.notes-list') as HTMLElement | null
          const firstItem = list?.querySelector('.note-list-item') as HTMLElement | null
          const listStyles = list ? window.getComputedStyle(list) : null
          const rowHeight = firstItem ? Math.round(firstItem.getBoundingClientRect().height) : 48
          const rowGap = listStyles ? Math.round(parseFloat(listStyles.rowGap || listStyles.gap || '8')) : 8
          const paddingTop = listStyles ? Math.round(parseFloat(listStyles.paddingTop || '10')) : 10
          const paddingBottom = listStyles ? Math.round(parseFloat(listStyles.paddingBottom || '10')) : 10
          const contentHeight = container ? container.clientHeight - paddingTop - paddingBottom : 0
          const measuredItemsPerPage = Math.max(1, Math.floor((contentHeight + rowGap) / (rowHeight + rowGap)))
          const targetPage = Math.floor(noteIndex / measuredItemsPerPage) + 1

          setSidebarViewStateByMode((previous) => ({
            ...previous,
            date: { ...previous.date, page: targetPage },
          }))
        }
      }
    })
  }, [getActiveSection, focusActiveNoteInSidebarMode, hasDateFilter, isSearchQueryCaseSensitive, isSidebarSearchActive, matchesSelectedDateFilter, runSidebarMenuTransition, searchQuery, sidebarMode])
  revealNoteInMenuRef.current = revealNoteInMenu

  const totalPages = Math.max(1, Math.ceil(totalPagedNotes / Math.max(1, itemsPerPage)))
  const effectiveCurrentPage = Math.min(Math.max(1, currentPage), totalPages)
  const isSidebarTreeMode = sidebarMode === 'category' || sidebarMode === 'archive'
  const isSidebarCustomScrollbarMode = isSidebarTreeMode || isFindMode
  const isSidebarScrollbarMode = isSidebarCustomScrollbarMode || sidebarMode === 'options'

  // Direct-DOM helpers: per-frame scroll events would otherwise trigger React
  // state updates that re-render the entire App component (heavy for long
  // notes), starving rAF and producing slow/standstill/fast scroll artefacts.
  // We mutate thumb DOM nodes imperatively and reserve React state only for
  // visibility toggles (rare).
  const applySidebarThumbDom = useCallback((topPx: number, heightPx: number) => {
    sidebarScrollThumbTopRef.current = topPx
    sidebarScrollThumbHeightRef.current = heightPx
    const thumbEl = sidebarScrollbarThumbRef.current
    if (!thumbEl) return
    thumbEl.style.top = `${topPx}px`
    thumbEl.style.height = `${Math.max(0, heightPx)}px`
  }, [])

  const syncSidebarCustomScrollbar = useCallback(() => {
    if (!isSidebarScrollbarMode) {
      applySidebarThumbDom(0, 0)
      setIsSidebarScrollThumbActive(false)
      return
    }

    const scroller = sidebarTreeScrollerEl || sidebarContentRef.current
    const track = sidebarScrollbarTrackRef.current
    if (!scroller || !track) return

    if (sidebarTextureRef.current) {
      syncTextureToScroll(scroller.scrollTop, sidebarTextureRef.current)
    }

    const viewportHeight = scroller.clientHeight
    const contentHeight = scroller.scrollHeight
    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    if (viewportHeight <= 0 || contentHeight <= 0 || trackHeight <= 0) {
      applySidebarThumbDom(0, 0)
      setIsSidebarScrollThumbActive(false)
      return
    }

    if (contentHeight <= viewportHeight) {
      applySidebarThumbDom(SCROLL_TRACK_EDGE_GAP_PX, usableTrackHeight)
      setIsSidebarScrollThumbActive(false)
      return
    }

    const visibleRatio = viewportHeight / contentHeight
    const nextThumbHeight = Math.max(
      SCROLL_TRACK_MIN_THUMB_HEIGHT_PX,
      Math.min(usableTrackHeight, Math.round(usableTrackHeight * visibleRatio)),
    )

    const maxScrollTop = contentHeight - viewportHeight
    const maxThumbTop = Math.max(0, usableTrackHeight - nextThumbHeight)
    const scrollRatio = maxScrollTop > 0 ? scroller.scrollTop / maxScrollTop : 0
    const nextThumbTop = SCROLL_TRACK_EDGE_GAP_PX + Math.round(maxThumbTop * scrollRatio)

    applySidebarThumbDom(nextThumbTop, nextThumbHeight)
    setIsSidebarScrollThumbActive(true)
  }, [applySidebarThumbDom, isSidebarScrollbarMode, sidebarTreeScrollerEl])

  const sidebarScrollFromThumbTop = useCallback((thumbTopPx: number) => {
    const scroller = sidebarTreeScrollerEl || sidebarContentRef.current
    const track = sidebarScrollbarTrackRef.current
    if (!scroller || !track) return

    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    const maxThumbTravel = Math.max(0, usableTrackHeight - sidebarScrollThumbHeightRef.current)
    const minThumbTop = SCROLL_TRACK_EDGE_GAP_PX
    const maxThumbTop = SCROLL_TRACK_EDGE_GAP_PX + maxThumbTravel
    const clampedTop = Math.max(minThumbTop, Math.min(thumbTopPx, maxThumbTop))
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const ratio = maxThumbTravel > 0 ? (clampedTop - SCROLL_TRACK_EDGE_GAP_PX) / maxThumbTravel : 0
    scroller.scrollTop = ratio * maxScrollTop
  }, [sidebarTreeScrollerEl])

  const pagedVisibleNotes = useMemo(() => {
    if (sidebarMode !== 'date' && sidebarMode !== 'trash') {
      return visibleNotes
    }

    const startIndex = (effectiveCurrentPage - 1) * itemsPerPage
    return visibleNotes.slice(startIndex, startIndex + itemsPerPage)
  }, [effectiveCurrentPage, itemsPerPage, sidebarMode, visibleNotes])

  useEffect(() => {
    const pending = pendingSidebarScrollRestoreRef.current
    if (!pending || pending.mode !== sidebarMode) {
      return
    }

    let cancelled = false
    let attempts = 0

    const apply = () => {
      if (cancelled) return

      const scroller = getSidebarScrollerForMode(sidebarMode)
      if (!scroller) {
        if (attempts < 8) {
          attempts += 1
          requestAnimationFrame(apply)
        }
        return
      }

      scroller.scrollTop = pending.scrollTop
      pendingSidebarScrollRestoreRef.current = null
      syncSidebarCustomScrollbar()
    }

    requestAnimationFrame(apply)
    return () => {
      cancelled = true
    }
  }, [
    archiveTree,
    categoryTree,
    activeSectionSnapshot?.documentFindHits.length,
    getSidebarScrollerForMode,
    pagedVisibleNotes.length,
    sidebarMode,
    syncSidebarCustomScrollbar,
  ])

  const activeSection = activeSectionSnapshot

  const handleFindViewButtonContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    getActiveSection()?.replaceAllDocumentFindHits()
  }, [getActiveSection])

  const handleMonthToggle = useCallback((month: number, event: MouseEvent<HTMLButtonElement>) => {
    handleMultiSelect(month, event, selectedMonths, FILTER_MONTHS, setSelectedMonths)
  }, [selectedMonths])

  const handleYearToggle = useCallback((year: number | 'older', event: MouseEvent<HTMLButtonElement>) => {
    handleMultiSelect(year, event, selectedYears, FILTER_YEARS, setSelectedYears)
  }, [selectedYears])

  const handleMonthRowContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    setSelectedMonths(new Set())
  }, [])

  const handleYearRowContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    setSelectedYears(new Set())
  }, [])

  const handleCategoryCollapseChange = useCallback((next: { collapsedPrimary: string[]; collapsedSecondary: string[] }) => {
    setCategoryCollapsedPrimary((previous) => (
      areStringArraysEqual(previous, next.collapsedPrimary) ? previous : next.collapsedPrimary
    ))
    setCategoryCollapsedSecondary((previous) => (
      areStringArraysEqual(previous, next.collapsedSecondary) ? previous : next.collapsedSecondary
    ))
    setSidebarViewStateByMode((previous) => ({
      ...previous,
      category: {
        ...previous.category,
        collapsedPrimary: areStringArraysEqual(previous.category.collapsedPrimary, next.collapsedPrimary)
          ? previous.category.collapsedPrimary
          : next.collapsedPrimary,
        collapsedSecondary: areStringArraysEqual(previous.category.collapsedSecondary, next.collapsedSecondary)
          ? previous.category.collapsedSecondary
          : next.collapsedSecondary,
      },
    }))
  }, [])

  const handleArchiveCollapseChange = useCallback((next: { collapsedPrimary: string[]; collapsedSecondary: string[] }) => {
    setArchiveCollapsedPrimary((previous) => (
      areStringArraysEqual(previous, next.collapsedPrimary) ? previous : next.collapsedPrimary
    ))
    setArchiveCollapsedSecondary((previous) => (
      areStringArraysEqual(previous, next.collapsedSecondary) ? previous : next.collapsedSecondary
    ))
    setSidebarViewStateByMode((previous) => ({
      ...previous,
      archive: {
        ...previous.archive,
        collapsedPrimary: areStringArraysEqual(previous.archive.collapsedPrimary, next.collapsedPrimary)
          ? previous.archive.collapsedPrimary
          : next.collapsedPrimary,
        collapsedSecondary: areStringArraysEqual(previous.archive.collapsedSecondary, next.collapsedSecondary)
          ? previous.archive.collapsedSecondary
          : next.collapsedSecondary,
      },
    }))
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [isSearchQueryCaseSensitive, selectedMonths, selectedYears, searchQuery])


  useLayoutEffect(() => {
    // Only the paged views lay the sidebar out the way this floor is about --
    // in Options or Find, `.sidebar-content` is holding something else
    // entirely and would measure nonsense. Elsewhere the last good
    // measurement stands (or the arithmetic, if there hasn't been one yet).
    if (sidebarMode !== 'date' && sidebarMode !== 'trash') return
    const contentEl = sidebarContentRef.current
    const sidebarEl = contentEl?.closest('.notes-sidebar') as HTMLElement | null
    if (!contentEl || !sidebarEl) return

    const measure = () => {
      const contentRectPx = contentEl.getBoundingClientRect().height
      const windowHeightPx = window.innerHeight
      const listEl = sidebarEl.querySelector('.notes-list')
      const cardEl = listEl?.querySelector('.note-list-item')
      if (!contentRectPx || !windowHeightPx || !listEl || !cardEl) return

      // How tall the card area has to be for the sidebar to actually show
      // SIDEBAR_MIN_VISIBLE_NOTE_CARDS of them -- derived by inverting the very
      // formula that decides it (the itemsPerPage effect below), down to the
      // same Math.round of each term. Fitting four cards' worth of pixels is
      // NOT the same question: that formula reads `clientHeight`, which is an
      // integer and excludes .sidebar-content's 1px top/bottom borders, so it
      // can conclude "three" while nearly a whole extra card's worth of space
      // sits there. Two independent calculations of one number is what kept
      // this floor a pixel short; now there is only one.
      const listStyles = window.getComputedStyle(listEl)
      const rowHeightPx = Math.round(cardEl.getBoundingClientRect().height)
      const rowGapPx = Math.round(parseFloat(listStyles.rowGap))
      const listPaddingPx = Math.round(parseFloat(listStyles.paddingTop))
        + Math.round(parseFloat(listStyles.paddingBottom))
      if (!rowHeightPx || !Number.isFinite(rowGapPx) || !Number.isFinite(listPaddingPx)) return

      // itemsPerPage = floor((clientHeight - listPadding + rowGap) / (rowHeight + rowGap))
      const minClientHeightPx = SIDEBAR_MIN_VISIBLE_NOTE_CARDS * (rowHeightPx + rowGapPx)
        - rowGapPx
        + listPaddingPx

      // clientHeight is a rounded integer of the *padding* box, so the border
      // box has to carry the borders on top -- and only needs to reach half a
      // pixel below the target for the rounding to land on it.
      const contentStyles = window.getComputedStyle(contentEl)
      const contentBordersPx = parseFloat(contentStyles.borderTopWidth) + parseFloat(contentStyles.borderBottomWidth)
      const minContentRectPx = minClientHeightPx - 0.5 + SUB_PIXEL_QUANTUM_PX
        + (Number.isFinite(contentBordersPx) ? contentBordersPx : 0)

      // Everything the window pays for that isn't the card area, measured as a
      // difference so there's nothing left to model: the sidebar's chrome above
      // and below the list, plus anything between window and sidebar.
      let outsideContentPx = windowHeightPx - contentRectPx
      // The pagination bar is only in the DOM once the list runs to more than
      // one page -- which it always does at this height, so reserve its row
      // (and the gap it brings as another sidebar child) when it isn't.
      if (!sidebarEl.querySelector('.sidebar-pagination')) {
        outsideContentPx += SIDEBAR_MINI_CONTROL_HEIGHT_PX + spacingRegularPx
      }
      // Likewise the date-filter rail, which collapses to a zero-height
      // placeholder outside the Date/Trash views this floor is measured for.
      const railEl = sidebarEl.querySelector('.date-filter-rail')
      if (!railEl || railEl.classList.contains('date-filter-rail-placeholder')) {
        outsideContentPx += 2 * SIDEBAR_MINI_CONTROL_HEIGHT_PX + 2 * spacingRegularPx
      }

      const requiredPx = outsideContentPx + minContentRectPx
      setMeasuredMinHeightPx((previous) => (
        previous !== null && Math.abs(previous - requiredPx) < 0.01 ? previous : requiredPx
      ))
    }

    measure()
    // Both boxes: the sidebar's own height follows the window, while the
    // content box also changes when the pagination bar or the rail appears.
    const observer = new ResizeObserver(measure)
    observer.observe(sidebarEl)
    observer.observe(contentEl)
    return () => observer.disconnect()
    // totalPagedNotes/itemsPerPage are in here so the card measurement re-runs
    // once notes actually populate the list -- the observers above only fire on
    // box changes, and filling an already-sized list isn't one.
  }, [isSidebarVisible, sidebarMode, spacingRegularPx, totalPagedNotes, itemsPerPage])

  useLayoutEffect(() => {
    const compute = () => {
      const container = sidebarContentRef.current
      if (!container) return

      const list = container.querySelector('.notes-list') as HTMLElement | null
      const firstItem = list?.querySelector('.note-list-item') as HTMLElement | null
      const listStyles = list ? window.getComputedStyle(list) : null

      const rowHeight = firstItem ? Math.round(firstItem.getBoundingClientRect().height) : 48
      const rowGap = listStyles ? Math.round(parseFloat(listStyles.rowGap || listStyles.gap || '8')) : 8
      const paddingTop = listStyles ? Math.round(parseFloat(listStyles.paddingTop || '10')) : 10
      const paddingBottom = listStyles ? Math.round(parseFloat(listStyles.paddingBottom || '10')) : 10

      const contentHeight = container.clientHeight - paddingTop - paddingBottom
      const nextItemsPerPage = Math.max(1, Math.floor((contentHeight + rowGap) / (rowHeight + rowGap)))

      const nextTotalPages = Math.max(1, Math.ceil(totalPagedNotes / Math.max(1, nextItemsPerPage)))
      const shouldShowPagination =
        (sidebarMode === 'date' || sidebarMode === 'trash') && nextTotalPages > 1

      if (nextItemsPerPage !== itemsPerPage) {
        setItemsPerPage(nextItemsPerPage)
      }

      if (currentPage > nextTotalPages) {
        setCurrentPage(nextTotalPages)
      }

      setShowPagination(shouldShowPagination)
    }

    const container = sidebarContentRef.current
    const resizeObserver = new ResizeObserver(compute)

    if (container) {
      compute()
      resizeObserver.observe(container)
      window.requestAnimationFrame(compute)
    }

    window.addEventListener('resize', compute)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', compute)
    }
  }, [currentPage, itemsPerPage, sidebarMode, totalPagedNotes])

  useEffect(() => {
    if (!isSidebarScrollbarMode) return
    syncSidebarCustomScrollbar()
  }, [isSidebarScrollbarMode, syncSidebarCustomScrollbar, sidebarMode, categoryTree, archiveTree, activeSection?.documentFindHits])

  useEffect(() => {
    if (!isSidebarScrollbarMode) return

    const scroller = sidebarTreeScrollerEl || sidebarContentRef.current
    if (!scroller) return

    const onScroll = () => {
      syncSidebarCustomScrollbar()
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [isSidebarScrollbarMode, sidebarTreeScrollerEl, syncSidebarCustomScrollbar])

  useEffect(() => {
    if (!isSidebarScrollbarMode) return

    const scroller = sidebarTreeScrollerEl || sidebarContentRef.current
    if (!scroller) return

    const scheduleSync = () => {
      if (sidebarScrollbarRafRef.current !== null) {
        cancelAnimationFrame(sidebarScrollbarRafRef.current)
      }

      sidebarScrollbarRafRef.current = requestAnimationFrame(() => {
        sidebarScrollbarRafRef.current = null
        syncSidebarCustomScrollbar()
      })
    }

    scheduleSync()
    const observedContentEl = (sidebarTreeScrollerEl?.firstElementChild as HTMLElement | null)
      ?? (sidebarMode === 'options' ? optionsContentRef.current : null)

    const resizeObserver = new ResizeObserver(() => scheduleSync())
    resizeObserver.observe(scroller)
    if (observedContentEl) {
      resizeObserver.observe(observedContentEl)
    }

    const mutationObserver = new MutationObserver(() => scheduleSync())
    mutationObserver.observe(scroller, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['open', 'style'],
    })

    const onDetailsToggle = (event: Event) => {
      if (event.target instanceof HTMLDetailsElement) {
        scheduleSync()
      }
    }

    scroller.addEventListener('toggle', onDetailsToggle, true)

    return () => {
      scroller.removeEventListener('toggle', onDetailsToggle, true)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      if (sidebarScrollbarRafRef.current !== null) {
        cancelAnimationFrame(sidebarScrollbarRafRef.current)
        sidebarScrollbarRafRef.current = null
      }
    }
  }, [isSidebarScrollbarMode, sidebarMode, sidebarTreeScrollerEl, syncSidebarCustomScrollbar])

  useEffect(() => {
    if (!isDraggingSidebarScrollThumb) return

    const onMouseMove = (event: globalThis.MouseEvent) => {
      const origin = sidebarScrollbarDragOriginRef.current
      if (!origin) return
      const deltaY = event.clientY - origin.pointerY
      sidebarScrollFromThumbTop(origin.thumbTopPx + deltaY)
      syncSidebarCustomScrollbar()
    }

    const onMouseUp = () => {
      setIsDraggingSidebarScrollThumb(false)
      sidebarScrollbarDragOriginRef.current = null
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDraggingSidebarScrollThumb, sidebarScrollFromThumbTop, syncSidebarCustomScrollbar])

  const handleSidebarTrackMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const track = sidebarScrollbarTrackRef.current
    if (!track) return

    const rect = track.getBoundingClientRect()
    const clickY = event.clientY - rect.top
    const thumbHeightPx = sidebarScrollThumbHeightRef.current
    const targetThumbTop = clickY - (thumbHeightPx / 2)
    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    const maxThumbTravel = Math.max(0, usableTrackHeight - thumbHeightPx)
    const minThumbTop = SCROLL_TRACK_EDGE_GAP_PX
    const maxThumbTop = SCROLL_TRACK_EDGE_GAP_PX + maxThumbTravel
    const clampedTop = Math.max(minThumbTop, Math.min(targetThumbTop, maxThumbTop))

    const scroller = sidebarTreeScrollerEl || sidebarContentRef.current
    if (!scroller) {
      sidebarScrollFromThumbTop(clampedTop)
      syncSidebarCustomScrollbar()
      return
    }

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const ratio = maxThumbTravel > 0 ? (clampedTop - SCROLL_TRACK_EDGE_GAP_PX) / maxThumbTravel : 0
    const targetScrollTop = ratio * maxScrollTop

    scrollToNonQuantizedSmooth(scroller, targetScrollTop)
  }, [sidebarScrollFromThumbTop, sidebarTreeScrollerEl, syncSidebarCustomScrollbar])

  const handleSidebarThumbMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDraggingSidebarScrollThumb(true)
    sidebarScrollbarDragOriginRef.current = {
      pointerY: event.clientY,
      thumbTopPx: sidebarScrollThumbTopRef.current,
    }
  }, [])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  useEffect(() => {
    if (!isPageJumpEditing) {
      setPageJumpInput(String(effectiveCurrentPage))
    }
  }, [effectiveCurrentPage, isPageJumpEditing])

  useEffect(() => {
    if (!isTextureSeedEditing) {
      setTextureSeedInput(String(texturePreviewMaterial.seed))
    }
  }, [isTextureSeedEditing, texturePreviewMaterial.seed])

  useEffect(() => {
    if (!isGlazeLinearSeedEditing) {
      setGlazeLinearSeedInput(String(glazeSettings.linearSeed))
    }
  }, [glazeSettings.linearSeed, isGlazeLinearSeedEditing])

  useEffect(() => {
    if (!isGlazeRadialSeedEditing) {
      setGlazeRadialSeedInput(String(glazeSettings.radialSeed))
    }
  }, [glazeSettings.radialSeed, isGlazeRadialSeedEditing])

  const commitPageJump = useCallback(() => {
    const parsed = Number.parseInt(pageJumpInput.trim(), 10)
    const safePage = Number.isFinite(parsed)
      ? clamp(parsed, 1, totalPages)
      : effectiveCurrentPage

    setCurrentPage(safePage)
    setPageJumpInput(String(safePage))
    setIsPageJumpEditing(false)
  }, [effectiveCurrentPage, pageJumpInput, totalPages])

  const startPageJumpEdit = useCallback(() => {
    setPageJumpInput(String(effectiveCurrentPage))
    setIsPageJumpEditing(true)
  }, [effectiveCurrentPage])

  const cancelPageJumpEdit = useCallback(() => {
    setPageJumpInput(String(effectiveCurrentPage))
    setIsPageJumpEditing(false)
  }, [effectiveCurrentPage])

  useEffect(() => {
    if (!isPageJumpEditing) return
    window.requestAnimationFrame(() => {
      pageJumpInputRef.current?.focus()
      pageJumpInputRef.current?.select()
    })
  }, [isPageJumpEditing])

  const commitTextureSeedEdit = useCallback(() => {
    const parsed = Number.parseInt(textureSeedInput.trim(), 10)
    const safeSeed = Number.isFinite(parsed)
      ? clamp(parsed, 0, 1000000)
      : clamp(texturePreviewMaterial.seed, 0, 1000000)

    setTexturePreviewMaterial((current) => ({
      ...current,
      seed: safeSeed,
    }))
    setTextureSeedInput(String(safeSeed))
    setIsTextureSeedEditing(false)
  }, [texturePreviewMaterial.seed, textureSeedInput])

  const commitGlazeLinearSeedEdit = useCallback(() => {
    const parsed = Number.parseInt(glazeLinearSeedInput.trim(), 10)
    const safeSeed = Number.isFinite(parsed)
      ? clamp(parsed, 0, 1000000)
      : clamp(glazeSettings.linearSeed, 0, 1000000)

    setGlazeSettings((current) => ({
      ...current,
      linearSeed: safeSeed,
    }))
    setGlazeLinearSeedInput(String(safeSeed))
    setIsGlazeLinearSeedEditing(false)
  }, [glazeLinearSeedInput, glazeSettings.linearSeed])

  const commitGlazeRadialSeedEdit = useCallback(() => {
    const parsed = Number.parseInt(glazeRadialSeedInput.trim(), 10)
    const safeSeed = Number.isFinite(parsed)
      ? clamp(parsed, 0, 1000000)
      : clamp(glazeSettings.radialSeed, 0, 1000000)

    setGlazeSettings((current) => ({
      ...current,
      radialSeed: safeSeed,
    }))
    setGlazeRadialSeedInput(String(safeSeed))
    setIsGlazeRadialSeedEditing(false)
  }, [glazeRadialSeedInput, glazeSettings.radialSeed])


  const cancelTextureSeedEdit = useCallback(() => {
    setTextureSeedInput(String(texturePreviewMaterial.seed))
    setIsTextureSeedEditing(false)
  }, [texturePreviewMaterial.seed])

  const cancelGlazeLinearSeedEdit = useCallback(() => {
    setGlazeLinearSeedInput(String(glazeSettings.linearSeed))
    setIsGlazeLinearSeedEditing(false)
  }, [glazeSettings.linearSeed])

  const cancelGlazeRadialSeedEdit = useCallback(() => {
    setGlazeRadialSeedInput(String(glazeSettings.radialSeed))
    setIsGlazeRadialSeedEditing(false)
  }, [glazeSettings.radialSeed])

  const randomizeTextureSeed = useCallback(() => {
    if (isTextureSeedEditing) return

    const nextSeed = Math.floor(Math.random() * 1000001)
    setTexturePreviewMaterial((current) => ({
      ...current,
      seed: nextSeed,
    }))
  }, [isTextureSeedEditing])

  const randomizeGlazeLinearSeed = useCallback(() => {
    if (isGlazeLinearSeedEditing) return

    const nextSeed = Math.floor(Math.random() * 1000001)
    setGlazeSettings((current) => ({
      ...current,
      linearSeed: nextSeed,
    }))
  }, [isGlazeLinearSeedEditing])

  const randomizeGlazeRadialSeed = useCallback(() => {
    if (isGlazeRadialSeedEditing) return

    const nextSeed = Math.floor(Math.random() * 1000001)
    setGlazeSettings((current) => ({
      ...current,
      radialSeed: nextSeed,
    }))
  }, [isGlazeRadialSeedEditing])

  const startTextureSeedEdit = useCallback(() => {
    setTextureSeedInput(String(texturePreviewMaterial.seed))
    setIsTextureSeedEditing(true)
  }, [texturePreviewMaterial.seed])

  const startGlazeLinearSeedEdit = useCallback(() => {
    setGlazeLinearSeedInput(String(glazeSettings.linearSeed))
    setIsGlazeLinearSeedEditing(true)
  }, [glazeSettings.linearSeed])

  const startGlazeRadialSeedEdit = useCallback(() => {
    setGlazeRadialSeedInput(String(glazeSettings.radialSeed))
    setIsGlazeRadialSeedEditing(true)
  }, [glazeSettings.radialSeed])

  useEffect(() => {
    if (!isTextureSeedEditing) return
    window.requestAnimationFrame(() => {
      textureSeedInputRef.current?.focus()
      textureSeedInputRef.current?.select()
    })
  }, [isTextureSeedEditing])

  useEffect(() => {
    if (!isGlazeLinearSeedEditing) return
    window.requestAnimationFrame(() => {
      glazeLinearSeedInputRef.current?.focus()
      glazeLinearSeedInputRef.current?.select()
    })
  }, [isGlazeLinearSeedEditing])

  useEffect(() => {
    if (!isGlazeRadialSeedEditing) return
    window.requestAnimationFrame(() => {
      glazeRadialSeedInputRef.current?.focus()
      glazeRadialSeedInputRef.current?.select()
    })
  }, [isGlazeRadialSeedEditing])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return

      const target = event.target instanceof HTMLElement ? event.target : null
      const isEditorTarget = Boolean(target?.closest('.editor-stage'))
      const isSearchField = target === sidebarSearchInputRef.current
      const isReplaceField = target === documentReplaceInputRef.current
      const isTagField = target === activeSection?.tagInputRef.current
      const isPageJumpField = target === pageJumpInputRef.current
      const isTextureSeedField = target === textureSeedInputRef.current
      const isGlazeLinearSeedField = target === glazeLinearSeedInputRef.current
      const isGlazeRadialSeedField = target === glazeRadialSeedInputRef.current
      const isEditorControlField = isSearchField || isReplaceField || isTagField || isPageJumpField || isTextureSeedField || isGlazeLinearSeedField || isGlazeRadialSeedField

      // In find-and-replace mode, an un-shifted Tab in the find field should
      // move focus to the sibling replace field rather than jump to the
      // editor -- only the last field in the pair still does that.
      const shouldPassThroughToReplaceField = isReplaceMode && isSearchField && event.key === 'Tab' && !event.shiftKey

      if (isEditorControlField && ['Escape', 'Enter', 'Tab'].includes(event.key) && !shouldPassThroughToReplaceField) {
        event.preventDefault()
        event.stopImmediatePropagation()
        activeSection?.scheduleFocusEditorInEditMode()
        return
      }

      if (isFindMode && event.ctrlKey && !event.shiftKey && event.key === 'Enter') {
        event.preventDefault()
        activeSection?.replaceAllDocumentFindHits()
        return
      }

      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        getActiveSection()?.setIsDocumentReplaceMode(false)
        runSidebarMenuTransition('find')
        requestAnimationFrame(() => {
          sidebarSearchInputRef.current?.focus()
          sidebarSearchInputRef.current?.select()
        })
        return
      }

      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'h') {
        event.preventDefault()
        getActiveSection()?.setIsDocumentReplaceMode(true)
        runSidebarMenuTransition('find')
        requestAnimationFrame(() => {
          sidebarSearchInputRef.current?.focus()
          sidebarSearchInputRef.current?.select()
        })
        return
      }

      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createNoteFromClipboardTitle()
        return
      }

      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createNote()
        return
      }

      // Alt (not Ctrl/Cmd) so this never collides with the editor's own
      // word-jump caret navigation -- see CM6Editor.tsx's
      // CM6_DEFAULT_KEYMAP_WITHOUT_ALT_ARROW doc comment for why plain
      // Ctrl/Cmd-ArrowLeft/Right had to stay free for that instead. Tab no
      // longer cycles sections at all (it's an ordinary in-editor
      // indent/focus key elsewhere in the app, and stealing it globally was
      // one interference too many); Left/Right are the only way to switch.
      if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && !isEditorControlField
        && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        const activeIndex = editorSections.findIndex((entry) => entry.id === activeSectionId)
        if (activeIndex !== -1) {
          const sectionCount = editorSections.length
          const targetIndex = event.key === 'ArrowLeft'
            ? Math.max(0, activeIndex - 1)
            : Math.min(sectionCount - 1, activeIndex + 1)

          event.preventDefault()
          const targetSectionId = editorSections[targetIndex].id
          markSectionActive(targetSectionId)
          // Not when the quick-actions panel is open: it moves itself into
          // the newly active section and refocuses its own top cell (see
          // EscapeHoldPanel.tsx), and this scheduled focus call -- deferred
          // via setTimeout+rAF, so it lands a moment later -- would
          // otherwise steal focus back into the editor out from under it,
          // which reads to the panel as a genuine loss of focus and closes
          // it entirely (see EscapeHoldPanel.tsx's handleRingBlur).
          if (!isEscapeHoldPanelOpen) {
            sectionRegistryRef.current.get(targetSectionId)?.scheduleFocusEditorInEditMode()
          }
          return
        }
      }

      if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && !isEditorControlField
        && !activeSection?.isPreviewMode && activeSection?.activeNoteId
        && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        const adapter = activeSection.adapterRef.current
        const targetOffset = event.key === 'ArrowUp' ? 0 : activeSection.currentEditorText.length
        adapter?.applySnapshot({
          selection: {
            anchor: targetOffset,
            focus: targetOffset,
            start: targetOffset,
            end: targetOffset,
            isCollapsed: true,
          },
          selectionScrollBehavior: 'center-caged',
        })
        return
      }

      if (isEditorTarget && activeSection?.activeNoteId && event.ctrlKey && !event.altKey && !event.metaKey) {
        const key = event.key.toLowerCase()

        if (!event.shiftKey && key === 'b') {
          event.preventDefault()
          activeSection.applyTextDecoration('bold')
          return
        }

        if (!event.shiftKey && key === 'i') {
          event.preventDefault()
          activeSection.applyTextDecoration('italic')
          return
        }

        if (!event.shiftKey && key === 'j') {
          event.preventDefault()
          activeSection.applyTextDecoration('strikethrough')
          return
        }

        if (!event.shiftKey && key === 't') {
          event.preventDefault()
          activeSection.toggleCurrentLineHeading()
          return
        }

        if (key === 'l') {
          event.preventDefault()
          if (event.shiftKey) {
            activeSection.applyAnchor()
          } else {
            activeSection.applyLink()
          }
          return
        }

        const isOrderedListShortcut = event.key === '#' || (event.shiftKey && event.key === '3')
        if (isOrderedListShortcut) {
          event.preventDefault()
          activeSection.toggleNumberedList()
          return
        }

        if (!event.shiftKey && event.key === '-') {
          event.preventDefault()
          activeSection.toggleBulletedList()
          return
        }
      }

      if (isEditorTarget && activeSection?.activeNoteId && event.shiftKey && event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.key === 'Delete') {
          event.preventDefault()
          void activeSection.handleChapterForwardSplitOrMerge()
          return
        }

        if (event.key === 'Backspace') {
          event.preventDefault()
          void activeSection.handleChapterBackwardSplitOrMerge()
          return
        }

        if (event.key.toLowerCase() === 'n') {
          event.preventDefault()
          void activeSection.handleCreateChapter()
          return
        }
      }

      if (event.key === 'Escape') {
        const activeElement = document.activeElement
        // The main editor's own contentEditable root is deliberately excluded
        // from the generic "blur an editable field" branch below: that branch
        // exists for secondary inputs (note title/tab rename, etc.) where
        // Escape should just defocus the field, not switch modes. The main
        // editor is not one of those -- Escape from inside it should switch
        // straight to render view in one press, matching every other
        // note-activation shortcut in this handler. Without this exclusion,
        // isEditableField was true for the editor's own contentEditable (CM6's
        // `.cm-content`), so the first Escape only blurred it (suspending the
        // caret) and only a second Escape actually toggled the view.
        const isEditableField =
          !isEditorTarget && (
            activeElement instanceof HTMLInputElement ||
            activeElement instanceof HTMLTextAreaElement ||
            activeElement instanceof HTMLSelectElement ||
            Boolean(activeElement && (activeElement as HTMLElement).isContentEditable)
          )

        if (isEditableField && activeElement instanceof HTMLElement) {
          event.preventDefault()
          activeElement.blur()
          return
        }

        if (isEscapeHoldPanelOpen) {
          if (!event.repeat) {
            escapeFreshCycleWhilePanelOpenRef.current = true
          }
          event.preventDefault()
          return
        }

        // Deliberately not gated on activeSection?.isForcedPreviewNote (or
        // on activeNoteId at all) -- the quick-actions panel has its own
        // real actions (New Note, Export, Help, ...) that make sense with
        // no note open, or with a read-only/auto-generated one active, so
        // the hold gesture has to start regardless. The keyup handler below
        // still checks isForcedPreviewNote before its own plain-tap
        // toggleRenderViewMode, since THAT specific action never makes
        // sense on such a note.
        if (event.repeat) return

        clearEscapeHoldTimer()
        escapeHoldTriggeredRef.current = false
        escapeFreshCycleWhilePanelOpenRef.current = false
        escapeHoldTimerRef.current = window.setTimeout(() => {
          escapeHoldTriggeredRef.current = true
          setIsEscapeHoldPanelOpen(true)
        }, ESCAPE_HOLD_MS)
      }
    }

    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return

      clearEscapeHoldTimer()

      if (escapeHoldTriggeredRef.current) {
        escapeHoldTriggeredRef.current = false
        event.preventDefault()
        return
      }

      if (escapeFreshCycleWhilePanelOpenRef.current) {
        escapeFreshCycleWhilePanelOpenRef.current = false
        event.preventDefault()
        handleEscapeHoldPanelClose()
        return
      }

      if (isEscapeHoldPanelOpen) {
        event.preventDefault()
        return
      }

      if (activeSection?.isForcedPreviewNote) return

      event.preventDefault()
      void activeSection?.toggleRenderViewMode()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      clearEscapeHoldTimer()
    }
  }, [
    activeSection,
    activeSectionId,
    clearEscapeHoldTimer,
    createNote,
    createNoteFromClipboardTitle,
    editorSections,
    getActiveSection,
    handleEscapeHoldPanelClose,
    isEscapeHoldPanelOpen,
    isFindMode,
    isReplaceMode,
    markSectionActive,
    runSidebarMenuTransition,
  ])

  useEffect(() => {
    const onMouseDownCapture = (event: globalThis.MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return

      if (target.closest('.editor-stage .editor-text[contenteditable="true"]')) {
        return
      }

      // Read-only editor text (debug-tagged notes, snapshot previews) is
      // never focused into edit mode, but clicks inside it should still be
      // allowed to start a native text selection so users can select/copy.
      if (target.closest('.editor-stage .editor-text[contenteditable="false"]')) {
        return
      }

      if (isAllowedNonEditorFocusTarget(target)) {
        return
      }

      // Resolve which section to refocus from the click's own DOM position
      // (via .editor-section-column's data-section-id), NOT from
      // activeSection/activeSectionId React state. This listener is attached
      // on `window` -- an ANCESTOR of every .editor-section-column -- so its
      // capture phase fires BEFORE that column's own onMouseDownCapture
      // (EditorSection.tsx), which is what actually marks a still-inactive
      // section active. A click on a still-inactive section's own chrome
      // (e.g. its flag-jump arrow) therefore reaches this handler first,
      // while activeSection/activeSectionId still reflect whichever section
      // was PREVIOUSLY active -- refocusing that stale section instead of
      // the one actually clicked. Found live as an instant, wrongly-targeted
      // scroll/refocus racing ahead of (and stomping) the correct section's
      // own just-activated flag jump. Falls back to getActiveSection() only
      // for clicks that land outside every section entirely (sidebar,
      // toolbar, dialogs), where there's no clicked section to resolve and
      // refocusing whatever's currently active is still the right call.
      const sectionEl = target.closest<HTMLElement>('[data-section-id]')
      const targetSectionId = sectionEl?.dataset.sectionId
      const targetSection = targetSectionId
        ? sectionRegistryRef.current.get(targetSectionId)
        : getActiveSection()

      if (targetSection?.isPreviewMode || !targetSection?.activeNoteId) return

      // Not when the quick-actions panel is open: same reasoning as the
      // Alt+Arrow section-switch handler above -- the panel moves itself
      // into whichever section a click just activated and refocuses its
      // own top cell (EscapeHoldPanel.tsx), and this scheduled call would
      // otherwise steal focus back into that section's editor out from
      // under it a moment later, reading to the panel as a genuine loss of
      // focus and closing it.
      if (isEscapeHoldPanelOpen) return

      event.preventDefault()
      targetSection.scheduleFocusEditorInEditMode()
    }

    window.addEventListener('mousedown', onMouseDownCapture, true)
    return () => window.removeEventListener('mousedown', onMouseDownCapture, true)
  }, [getActiveSection, isAllowedNonEditorFocusTarget, isEscapeHoldPanelOpen])

  useEffect(() => {
    const handleBeforeUnload = () => {
      // Flush any pending debounced app-state save immediately so the main
      // process receives the latest viewport/menu state before the renderer
      // is torn down. The main process will also re-save its cached copy on
      // before-quit as a belt-and-suspenders guarantee.
      if (appStateSaveTimerRef.current !== null) {
        window.clearTimeout(appStateSaveTimerRef.current)
        appStateSaveTimerRef.current = null
        const viewport = activeSection?.latestViewportRef.current
        void window.thockdownState?.saveAppState({
          selectedNoteId: activeSection?.activeNoteId ?? null,
          viewport: viewport ?? undefined,
          menu: persistedMenuStateRef.current ?? buildMenuStateSnapshot(),
        })
      }

      // Flush every open section, not just the active one -- each has its
      // own note with its own cursor/scroll position that would otherwise
      // be lost on quit.
      for (const section of sectionRegistryRef.current.values()) {
        section.persistActiveNoteEditModeStateNow()
      }
      persistMenuStateOnUnload()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [activeSection, buildMenuStateSnapshot, persistMenuStateOnUnload])

  const syncSidebarTexture = useCallback(() => {
    const scroller = sidebarTreeScrollerEl || sidebarContentRef.current
    if (!scroller || !sidebarTextureRef.current) return
    syncTextureToScroll(scroller.scrollTop, sidebarTextureRef.current)
  }, [sidebarTreeScrollerEl])

  const handleSidebarScroll = useCallback(() => {
    syncSidebarTexture()
  }, [syncSidebarTexture])

  useEffect(() => {
    syncSidebarTexture()
  }, [syncSidebarTexture, sidebarMode, isSidebarScrollbarMode])

  return (
    <div
      className={`app-root${customCursorSettings.enabled ? ' hide-native-cursor' : ''}`}
      style={appRootStyle}
      onDragOver={handleAppDragOver}
      onDrop={handleAppDrop}
    >
      {bootstrapError ? (
        <div
          role="alert"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 999999,
            padding: '10px 16px',
            background: '#b3261e',
            color: '#ffffff',
            fontSize: '13px',
            fontFamily: 'sans-serif',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <span>
            Thockdown Notes couldn't load your notes ({bootstrapError}). It will keep retrying, but your notes
            and the timeline may not appear until this is resolved.
          </span>
          <button
            type="button"
            onClick={() => setBootstrapError(null)}
            style={{
              background: 'transparent',
              border: '1px solid #ffffff',
              color: '#ffffff',
              borderRadius: '4px',
              padding: '2px 8px',
              flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <div className="app-saturate-wrapper" style={{ ...appOuterStyle, position: 'fixed', inset: 0 }}>
        <div className={`glaze-overlay-stack${glazeSettings.radialAboveLinear ? ' radial-above-linear' : ''}`} aria-hidden="true">
          {/* mix-blend-mode forces the browser to blend against every repaint
              underneath it (i.e. every keystroke's repaint of the editor),
              not just paint once -- only mount a layer when its glaze
              setting is actually active. */}
          {glazeLinearBackgroundImage !== 'none' && <div className="glaze-overlay-layer glaze-overlay-layer-linear" />}
          {glazeRadialBackgroundImage !== 'none' && <div className="glaze-overlay-layer glaze-overlay-layer-radial" />}
          {glazeGloomBackgroundImage !== 'none' && <div className="glaze-overlay-layer glaze-overlay-layer-gloom" />}
        </div>
        {/* Mounted here (inside .app-saturate-wrapper, not as a sibling of
            it like MouseCursorOverlay) deliberately -- unlike the cursor
            overlay, tooltips should still pick up this wrapper's own
            filter/glaze/colorize layers, same as the rest of the app's UI.
            See the component's own doc comment. */}
        <TooltipLayer />
        {windowModeTransitionOverlayNonce > 0 ? (
          <div key={windowModeTransitionOverlayNonce} className="window-mode-transition-overlay" aria-hidden="true" />
        ) : null}
        <div className="app-sheen">
          <div
            className={`app-shell app-grid${filterInvert > 0.5 ? ' shadow-flip' : ''}${windowIsCollapsed ? ' is-window-collapsed' : ''}`}
            ref={appShellRef}
            style={appShellStyle}
          >
            {isSidebarVisible ? (
            <aside className="notes-sidebar" style={{ gridArea: 'sidebar' }}>
              <div className="search-box" aria-label="Search panel">
                <div className={`search-input-shell${isReplaceMode ? ' search-replace-row' : ''}`}>
                {isReplaceMode ? (
                  <div className="search-input-shell search-replace-find-shell">
                    <input
                      className="search-input-field"
                      ref={sidebarSearchInputRef}
                      type="text"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      placeholder="Find..."
                      value={activeSection?.documentFindQuery ?? ''}
                      onChange={(event) => getActiveSection()?.setDocumentFindQuery(event.target.value)}
                      onBlur={() => {
                        window.setTimeout(() => {
                          if (!isAllowedNonEditorFocusTarget(document.activeElement)) {
                            getActiveSection()?.scheduleFocusEditorInEditMode()
                          }
                        }, 0)
                      }}
                    />
                  </div>
                ) : (
                <input
                  className="search-input-field has-case-toggle"
                  ref={sidebarSearchInputRef}
                  type="text"
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  placeholder={isFindMode ? 'Find in current note...' : 'Search for content or #tag...'}
                  value={isFindMode ? (activeSection?.documentFindQuery ?? '') : searchQuery}
                  onChange={(event) => {
                    const value = event.target.value
                    if (isFindMode) {
                      getActiveSection()?.setDocumentFindQuery(value)
                    } else {
                      setSearchQuery(value)
                    }
                  }}
                  onBlur={() => {
                    window.setTimeout(() => {
                      if (!isAllowedNonEditorFocusTarget(document.activeElement)) {
                        getActiveSection()?.scheduleFocusEditorInEditMode()
                      }
                    }, 0)
                  }}
                />
                )}
                {isReplaceMode ? (
                  <div className="search-input-shell search-replace-replace-shell">
                    <input
                      className="search-input-field has-case-toggle"
                      ref={documentReplaceInputRef}
                      type="text"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      placeholder="Replace..."
                      value={activeSection?.documentReplaceQuery ?? ''}
                      onChange={(event) => getActiveSection()?.setDocumentReplaceQuery(event.target.value)}
                      onBlur={() => {
                        window.setTimeout(() => {
                          if (!isAllowedNonEditorFocusTarget(document.activeElement)) {
                            getActiveSection()?.scheduleFocusEditorInEditMode()
                          }
                        }, 0)
                      }}
                    />
                    <button
                      type="button"
                      className={`btn-icon search-input-case-toggle${activeSection?.isDocumentFindCaseSensitive ? ' is-active' : ''}`}
                      aria-pressed={activeSection?.isDocumentFindCaseSensitive}
                      data-tooltip="Keep case"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => getActiveSection()?.setIsDocumentFindCaseSensitive((previous: boolean) => !previous)}
                    >
                      Aa
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`btn-icon search-input-case-toggle${(isFindMode ? activeSection?.isDocumentFindCaseSensitive : isSearchQueryCaseSensitive) ? ' is-active' : ''}`}
                    aria-pressed={isFindMode ? activeSection?.isDocumentFindCaseSensitive : isSearchQueryCaseSensitive}
                    data-tooltip="Match letter case"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (isFindMode) {
                        getActiveSection()?.setIsDocumentFindCaseSensitive((previous: boolean) => !previous)
                      } else {
                        setIsSearchQueryCaseSensitive((previous) => !previous)
                      }
                    }}
                  >
                    Aa
                  </button>
                )}
                </div>
              </div>

              <div className="view-toggle" role="tablist" aria-label="Note view modes">
                {SIDEBAR_MODES.map(({ mode, label }) => {
                  const isActive = sidebarMode === mode
                  const iconClassByMode: Record<SidebarMode, string> = {
                    date: 'btn-date',
                    category: 'btn-category',
                    archive: 'btn-archived',
                    trash: 'btn-deleted',
                    find: 'btn-find',
                    options: 'btn-options',
                  }
                  return (
                    <button
                      key={mode}
                      className={`toggle-btn notes-mode-button icon-btn ${iconClassByMode[mode]}${isActive ? ' is-active' : ''}${mode === 'trash' && activeSection?.isTrashViewDeletePrimed ? ' is-primed-for-deletion' : ''}`}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      data-tooltip={label}
                      aria-label={label}
                      onClick={mode === 'options' ? toggleSidebarOptionsMenu : () => handleViewModeButtonClick(mode)}
                      onContextMenu={
                        mode === 'trash'
                          ? activeSection?.handleTrashViewButtonContextMenu
                          : mode === 'find'
                            ? handleFindViewButtonContextMenu
                            : undefined
                      }
                      onMouseDown={mode === 'trash' ? activeSection?.handleTrashViewButtonMouseDown : undefined}
                      onMouseUp={mode === 'trash' ? activeSection?.handleTrashViewButtonMouseUp : undefined}
                      onMouseLeave={mode === 'trash' ? () => {
                        activeSection?.clearTrashButtonArmTimer()
                        activeSection?.setIsTrashViewDeletePrimed(false)
                      } : undefined}
                    >
                      {/* Unlike the other 5 modes, .btn-options has no
                          /assets/buttons/*.png mask asset (see sidebar.css) --
                          it was already styled for an inline glyph instead
                          (color, not background-color), matching this. */}
                      {mode === 'options' ? <span className="view-toggle-options-glyph fa-solid fa-gear" aria-hidden="true" /> : null}
                      <span className="sr-only-mode-label">{label}</span>
                    </button>
                  )
                })}
              </div>

              <div className={`sidebar-scroll-frame${isSidebarCustomScrollbarMode ? ' is-tree-mode' : ''}`}>
                <div className="sidebar-wrapper">
                  <div
                    className={`sidebar-content${(sidebarMode === 'date' || sidebarMode === 'trash') ? ' is-paged-mode' : ''}${isSidebarCustomScrollbarMode ? ' is-tree-mode' : ''}${isSidebarScrollbarMode && !isSidebarCustomScrollbarMode ? ' is-scrollbar-mode' : ''}`}
                    ref={sidebarContentRef}
                    onScroll={handleSidebarScroll}
                  >
                    <div ref={sidebarTextureRef} className="sidebar-content-texture" />
                    {(sidebarMode === 'date' || sidebarMode === 'trash') ? (
                      <div
                        className={`notes-list date-view${hasDateFilter ? ' is-filtered' : ''}`}
                        role="listbox"
                        aria-label="Note list"
                      >
                        {pagedVisibleNotes.map((note) => {
                          // menuIdentityNoteId collapses an active chapter to
                          // its parent (so the chapter bar's owner note
                          // highlights normally) -- but a chapter can now
                          // appear as its own row via search or (if deleted)
                          // trash, so it needs to compare against the true
                          // active note instead.
                          const isActive = note.chapterOnly
                            ? note.id === activeSection?.activeNoteId
                            : note.id === activeSection?.menuIdentityNoteId
                          const isModified = isExternalNote(note) && getCurrentExternalNoteModifiedState(note)
                          // chapterParentId goes null the instant a chapter
                          // is deleted (detachChapterForTrash removes its
                          // `chapters` row entirely -- see
                          // detachedChapterParentId's own doc comment), so a
                          // deleted chapter's row in Trash has to fall back
                          // to that instead, or it silently drops to the
                          // plain created-date meta below.
                          const chapterParentNoteId = note.chapterOnly
                            ? (note.chapterParentId ?? note.detachedChapterParentId)
                            : null
                          const chapterParentNote = chapterParentNoteId
                            ? notesById.get(chapterParentNoteId)
                            : undefined
                          const chapterParentTitle = chapterParentNote?.title
                          // A missing parent (purged) or one itself sitting in
                          // Trash can't host an Archive fold-out, so this
                          // chapter has nowhere to be archived to.
                          const isChapterParentUnavailable = Boolean(chapterParentNoteId)
                            && (!chapterParentNote || isDeletedNote(chapterParentNote))
                          return (
                            <NoteListItem
                              key={note.id}
                              note={note}
                              isActive={isActive}
                              isModified={isModified}
                              chapterParentTitle={chapterParentTitle}
                              isChapterParentUnavailable={isChapterParentUnavailable}
                              onSelect={handleSelectNote}
                              onPrimedLeftClick={(noteId) => getActiveSection()?.handlePrimedNoteLeftClick(noteId)}
                              onSaveClick={activeSection?.handleSaveButtonClick}
                              onCloseClick={activeSection?.handleCloseButtonClick}
                              onArchiveClick={activeSection?.handleArchiveClick}
                              onTrashClick={activeSection?.handleTrashClick}
                              isTrashMode={sidebarMode === 'trash'}
                              primedAction={activeSection?.primedNoteActionById.get(note.id) ?? null}
                              onRightPressStart={(noteId, event) => getActiveSection()?.handleNoteRightPressStart(noteId, event)}
                              onRightPressEnd={(noteId, event) => getActiveSection()?.handleNoteRightPressEnd(noteId, event)}
                              onMouseLeave={activeSection?.handleNoteMouseLeave}
                            />
                          )
                        })}
                        {pagedVisibleNotes.length === 0 ? (
                          <div className="notes-empty-state">
                            {searchQuery.trim()
                              ? 'No notes match the current search.'
                              : 'No notes match the current date filters.'}
                          </div>
                        ) : null}
                      </div>
                    ) : isFindMode ? (
                      <div
                        className="notes-list find-view thockdown-custom-scrollbar"
                        ref={setSidebarTreeScrollerEl}
                      >
                        {(activeSection?.documentFindHits ?? []).map((hit, index) => (
                          <button
                            key={hit.id}
                            type="button"
                            className="find-hit-item"
                            onClick={() => getActiveSection()?.handleJumpToDocumentFindHit(hit)}
                            onContextMenu={(event) => {
                              event.preventDefault()
                              getActiveSection()?.replaceDocumentFindHit(hit)
                            }}
                            data-tooltip={`Jump to occurrence ${index + 1}`}
                          >
                            <span className="find-hit-snippet">
                              {hit.hasSnippetPrefixEllipsis ? '... ' : ''}
                              {hit.snippetBefore}
                              <span className="find-hit-match">{hit.snippetMatch}</span>
                              {hit.snippetAfter}
                              {hit.hasSnippetSuffixEllipsis ? ' ...' : ''}
                            </span>
                          </button>
                        ))}
                        {(activeSection?.documentFindHits.length ?? 0) === 0 ? (
                          <div className="notes-empty-state">
                            {(activeSection?.documentFindQuery ?? '').trim()
                              ? 'No matches in the current note.'
                              : 'Type in the search field to find text in the current note.'}
                          </div>
                        ) : null}
                      </div>
                    ) : sidebarMode === 'options' ? (
                      <SidebarOptionsPanel
                        isPreviewMode={activeSection?.isPreviewMode ?? false}
                        uiMode={uiMode}
                        optionsContentRef={optionsContentRef}
                        viewStyle={viewStyle}
                        setViewStyle={setViewStyle}
                        viewFontSize={viewFontSize}
                        setViewFontSize={setViewFontSize}
                        viewSpacing={viewSpacing}
                        setViewSpacing={setViewSpacing}
                        viewLetterSpacingEm={viewLetterSpacingEm}
                        setViewLetterSpacingEm={setViewLetterSpacingEm}
                        editorStyle={editorStyle}
                        setEditorStyle={setEditorStyle}
                        editorFontSize={editorFontSize}
                        setEditorFontSize={setEditorFontSize}
                        editorSpacing={editorSpacing}
                        setEditorSpacing={setEditorSpacing}
                        scheduleFocusEditorInEditMode={() => getActiveSection()?.scheduleFocusEditorInEditMode()}
                        uiFontStyle={uiFontStyle}
                        setUiFontStyle={setUiFontStyle}
                        uiFontScale={uiFontScale}
                        setUiFontScale={setUiFontScale}
                        factoryPresetEntriesForCurrentMode={factoryPresetEntriesForCurrentMode}
                        activeEntryForCurrentMode={activeEntryForCurrentMode}
                        selectLoadoutPreset={selectLoadoutPreset}
                        isDynamicCustomPresetActive={isDynamicCustomPresetActive}
                        selectDynamicCustomPreset={selectDynamicCustomPreset}
                        customSlotEntriesForCurrentMode={customSlotEntriesForCurrentMode}
                        primedCustomLayoutId={primedCustomLayoutId}
                        handleCustomLoadoutSlotClick={handleCustomLoadoutSlotClick}
                        handleCustomLoadoutSlotRightMouseDown={handleCustomLoadoutSlotRightMouseDown}
                        handleCustomLoadoutSlotRightMouseUp={handleCustomLoadoutSlotRightMouseUp}
                        handleCustomLoadoutSlotMouseLeave={handleCustomLoadoutSlotMouseLeave}
                        handleCustomLoadoutSlotContextMenu={handleCustomLoadoutSlotContextMenu}
                        hasUnsavedUiLoadoutChanges={hasUnsavedUiLoadoutChanges}
                        saveCustomLoadout={saveCustomLoadout}
                        resetCustomLoadout={resetCustomLoadout}
                        primedColorSource={primedColorSource}
                        setPrimedColorSource={setPrimedColorSource}
                        highlightColors={highlightColors}
                        editorTextColors={editorTextColors}
                        applyActiveColorToElement={applyActiveColorToElement}
                        updateHighlightColor={updateHighlightColor}
                        applyHsvaValueToElement={applyHsvaValueToElement}
                        applyActiveColorToEditorText={applyActiveColorToEditorText}
                        updateEditorTextColor={updateEditorTextColor}
                        applyHsvaValueToEditorText={applyHsvaValueToEditorText}
                        startElementPreviewCopyHold={startElementPreviewCopyHold}
                        clearColorArmTimer={clearColorArmTimer}
                        hsvaDragState={hsvaDragState}
                        hsvaDisplayColors={hsvaDisplayColors}
                        activeColorHsva={activeColorHsva}
                        activeColorHex={activeColorHex}
                        activeColorCss={activeColorCss}
                        startHsvaDrag={startHsvaDrag}
                        handleHsvaDragMove={handleHsvaDragMove}
                        stopHsvaDrag={stopHsvaDrag}
                        startColorArmHold={startColorArmHold}
                        wheelAdjustHsvaControl={wheelAdjustHsvaControl}
                        applyActiveColorToTexture={applyActiveColorToTexture}
                        applyTexturePreviewToSurface={applyTexturePreviewToSurface}
                        applyHsvaValueToTexture={applyHsvaValueToTexture}
                        textureMaterials={textureMaterials}
                        texturePreviewMaterial={texturePreviewMaterial}
                        texturePreviewHex={texturePreviewHex}
                        texturePreviewTintCss={texturePreviewTintCss}
                        texturePreviewCss={texturePreviewCss}
                        isTextureSeedEditing={isTextureSeedEditing}
                        textureSeedInputRef={textureSeedInputRef}
                        textureSeedInput={textureSeedInput}
                        setTextureSeedInput={setTextureSeedInput}
                        commitTextureSeedEdit={commitTextureSeedEdit}
                        cancelTextureSeedEdit={cancelTextureSeedEdit}
                        randomizeTextureSeed={randomizeTextureSeed}
                        startTextureSeedEdit={startTextureSeedEdit}
                        isAllowedNonEditorFocusTarget={isAllowedNonEditorFocusTarget}
                        textureControlDragState={textureControlDragState}
                        startTextureControlDrag={startTextureControlDrag}
                        handleTextureControlDragMove={handleTextureControlDragMove}
                        stopTextureControlDrag={stopTextureControlDrag}
                        wheelAdjustTextureControl={wheelAdjustTextureControl}
                        glazeSettings={glazeSettings}
                        setGlazeSettings={setGlazeSettings}
                        isGlazeLinearSeedEditing={isGlazeLinearSeedEditing}
                        glazeLinearSeedInputRef={glazeLinearSeedInputRef}
                        glazeLinearSeedInput={glazeLinearSeedInput}
                        setGlazeLinearSeedInput={setGlazeLinearSeedInput}
                        commitGlazeLinearSeedEdit={commitGlazeLinearSeedEdit}
                        cancelGlazeLinearSeedEdit={cancelGlazeLinearSeedEdit}
                        randomizeGlazeLinearSeed={randomizeGlazeLinearSeed}
                        startGlazeLinearSeedEdit={startGlazeLinearSeedEdit}
                        isGlazeRadialSeedEditing={isGlazeRadialSeedEditing}
                        glazeRadialSeedInputRef={glazeRadialSeedInputRef}
                        glazeRadialSeedInput={glazeRadialSeedInput}
                        setGlazeRadialSeedInput={setGlazeRadialSeedInput}
                        commitGlazeRadialSeedEdit={commitGlazeRadialSeedEdit}
                        cancelGlazeRadialSeedEdit={cancelGlazeRadialSeedEdit}
                        randomizeGlazeRadialSeed={randomizeGlazeRadialSeed}
                        startGlazeRadialSeedEdit={startGlazeRadialSeedEdit}
                        filterInvert={filterInvert}
                        setFilterInvert={setFilterInvert}
                        filterSepia={filterSepia}
                        setFilterSepia={setFilterSepia}
                        filterHueRotate={filterHueRotate}
                        setFilterHueRotate={setFilterHueRotate}
                        filterBrightness={filterBrightness}
                        setFilterBrightness={setFilterBrightness}
                        filterContrast={filterContrast}
                        setFilterContrast={setFilterContrast}
                        filterSaturate={filterSaturate}
                        setFilterSaturate={setFilterSaturate}
                        filterColorize={filterColorize}
                        setFilterColorize={setFilterColorize}
                        renderScrollDynamic={renderScrollDynamic}
                        setRenderScrollDynamic={setRenderScrollDynamic}
                        renderScrollTotalTimeSec={renderScrollTotalTimeSec}
                        setRenderScrollTotalTimeSec={setRenderScrollTotalTimeSec}
                        renderScrollMaxSpeedPxPerSec={renderScrollMaxSpeedPxPerSec}
                        setRenderScrollMaxSpeedPxPerSec={setRenderScrollMaxSpeedPxPerSec}
                        renderScrollSkew={renderScrollSkew}
                        setRenderScrollSkew={setRenderScrollSkew}
                        typingSoundEnabled={typingSoundEnabled}
                        setTypingSoundEnabled={setTypingSoundEnabled}
                        typingSoundSet={typingSoundSet}
                        setTypingSoundSet={setTypingSoundSet}
                        audioKeyVolume={audioKeyVolume}
                        setAudioKeyVolume={setAudioKeyVolume}
                        audioKeyVariance={audioKeyVariance}
                        setAudioKeyVariance={setAudioKeyVariance}
                        audioPitch={audioPitch}
                        setAudioPitch={setAudioPitch}
                        audioBassVolume={audioBassVolume}
                        setAudioBassVolume={setAudioBassVolume}
                        audioTrebleVolume={audioTrebleVolume}
                        setAudioTrebleVolume={setAudioTrebleVolume}
                        audioReverbStrength={audioReverbStrength}
                        setAudioReverbStrength={setAudioReverbStrength}
                        audioReverbSpace={audioReverbSpace}
                        setAudioReverbSpace={setAudioReverbSpace}
                        pitchJitterAmount={pitchJitterAmount}
                        setPitchJitterAmount={setPitchJitterAmount}
                        audioSpatial={audioSpatial}
                        setAudioSpatial={setAudioSpatial}
                        reduceVisualEffects={reduceVisualEffects}
                        setReduceVisualEffects={setReduceVisualEffects}
                        spellCheckEnabled={spellCheckEnabled}
                        setSpellCheckEnabled={setSpellCheckEnabled}
                        reducedCaretAnimation={reducedCaretAnimation}
                        setReducedCaretAnimation={setReducedCaretAnimation}
                        deferPreviewOnRapidInput={deferPreviewOnRapidInput}
                        setDeferPreviewOnRapidInput={setDeferPreviewOnRapidInput}
                        musicAccordionNonce={musicAccordionNonce}
                        musicVolume={musicVolume}
                        setMusicVolume={setMusicVolume}
                        musicReverbAmount={musicReverbAmount}
                        setMusicReverbAmount={setMusicReverbAmount}
                        musicReverbRoom={musicReverbRoom}
                        setMusicReverbRoom={setMusicReverbRoom}
                        borderRadiusRegularPx={borderRadiusRegularPx}
                        setBorderRadiusRegularPx={setBorderRadiusRegularPx}
                        spacingRegularPx={spacingRegularPx}
                        setSpacingRegularPx={setSpacingRegularPx}
                        borderAlphaPercent={borderAlphaPercent}
                        setBorderAlphaPercent={setBorderAlphaPercent}
                        boxShadowAlphaPercent={boxShadowAlphaPercent}
                        setBoxShadowAlphaPercent={setBoxShadowAlphaPercent}
                        editorGlyphPaddingPx={editorGlyphPaddingPx}
                        setEditorGlyphPaddingPx={setEditorGlyphPaddingPx}
                        syncExistingNotes={syncExistingNotes}
                        importNotes={importNotes}
                        openNotesFolder={openNotesFolder}
                        exportLayoutsTdl={exportLayoutsTdl}
                        importLayoutsTdl={importLayoutsTdl}
                        debuggingEnabled={debuggingEnabled}
                        setDebuggingEnabled={setDebuggingEnabled}
                        debugNoteIdRef={debugNoteIdRef}
                        queueAppStateSave={queueAppStateSave}
                        activeNoteId={activeSection?.activeNoteId ?? null}
                        customCursorEnabled={customCursorEnabled}
                        setCustomCursorEnabled={setCustomCursorEnabled}
                        customCursorDotColor={customCursorDotColor}
                        customCursorCenterColor={customCursorCenterColor}
                        customCursorTrailColor={customCursorTrailColor}
                        customCursorDotCount={customCursorDotCount}
                        setCustomCursorDotCount={setCustomCursorDotCount}
                        customCursorRadiusPx={customCursorRadiusPx}
                        setCustomCursorRadiusPx={setCustomCursorRadiusPx}
                        customCursorSpinHz={customCursorSpinHz}
                        setCustomCursorSpinHz={setCustomCursorSpinHz}
                        customCursorTrailThicknessPx={customCursorTrailThicknessPx}
                        setCustomCursorTrailThicknessPx={setCustomCursorTrailThicknessPx}
                        customCursorTrailFadeMs={customCursorTrailFadeMs}
                        setCustomCursorTrailFadeMs={setCustomCursorTrailFadeMs}
                        customCursorDotSizePx={customCursorDotSizePx}
                        setCustomCursorDotSizePx={setCustomCursorDotSizePx}
                        customCursorCenterSizePx={customCursorCenterSizePx}
                        setCustomCursorCenterSizePx={setCustomCursorCenterSizePx}
                        customCursorHaloColor={customCursorHaloColor}
                        customCursorHaloRadiusPx={customCursorHaloRadiusPx}
                        setCustomCursorHaloRadiusPx={setCustomCursorHaloRadiusPx}
                        customCursorHaloFalloff={customCursorHaloFalloff}
                        setCustomCursorHaloFalloff={setCustomCursorHaloFalloff}
                        customCursorPulseMagnitude={customCursorPulseMagnitude}
                        setCustomCursorPulseMagnitude={setCustomCursorPulseMagnitude}
                        customCursorPulseHz={customCursorPulseHz}
                        setCustomCursorPulseHz={setCustomCursorPulseHz}
                        customCursorClickRamp={customCursorClickRamp}
                        setCustomCursorClickRamp={setCustomCursorClickRamp}
                        customCursorClickSkew={customCursorClickSkew}
                        setCustomCursorClickSkew={setCustomCursorClickSkew}
                        customCursorClickSpeedX={customCursorClickSpeedX}
                        setCustomCursorClickSpeedX={setCustomCursorClickSpeedX}
                        customCursorClickMaxSpeed={customCursorClickMaxSpeed}
                        setCustomCursorClickMaxSpeed={setCustomCursorClickMaxSpeed}
                        customCursorClickMinHoldMs={customCursorClickMinHoldMs}
                        setCustomCursorClickMinHoldMs={setCustomCursorClickMinHoldMs}
                        customCursorClickBalance={customCursorClickBalance}
                        setCustomCursorClickBalance={setCustomCursorClickBalance}
                        cursorColorHsva={cursorColorHsva}
                        cursorHsvaDisplayColors={cursorHsvaDisplayColors}
                        cursorHsvaDragState={cursorHsvaDragState}
                        startCursorHsvaDrag={startCursorHsvaDrag}
                        handleCursorHsvaDragMove={handleCursorHsvaDragMove}
                        stopCursorHsvaDrag={stopCursorHsvaDrag}
                        wheelAdjustCursorHsvaControl={wheelAdjustCursorHsvaControl}
                        applyCursorColorToTarget={applyCursorColorToTarget}
                        startCursorColorCopyHold={startCursorColorCopyHold}
                        clearCursorColorArmTimer={clearCursorColorArmTimer}
                      />
                    ) : (
                      <div
                        className={`notes-list tree-view thockdown-custom-scrollbar${hasDateFilter ? ' is-filtered' : ''}`}
                        ref={setSidebarTreeScrollerEl}
                      >
                        <CategoryTreeView
                          groups={sidebarMode === 'category' ? categoryTree : archiveTree}
                          activeNoteId={activeSection?.menuIdentityNoteId ?? null}
                          persistedCollapsedPrimary={sidebarMode === 'category' ? categoryCollapsedPrimary : archiveCollapsedPrimary}
                          persistedCollapsedSecondary={sidebarMode === 'category' ? categoryCollapsedSecondary : archiveCollapsedSecondary}
                          focusNoteRequestKey={sidebarMode === 'category' ? categoryFocusRequestKey : archiveFocusRequestKey}
                          onCollapseChange={sidebarMode === 'category' ? handleCategoryCollapseChange : handleArchiveCollapseChange}
                          onSelect={handleSelectNote}
                          onPrimedLeftClick={(noteId) => getActiveSection()?.handlePrimedNoteLeftClick(noteId)}
                          primedNoteActionById={activeSection?.primedNoteActionById ?? EMPTY_MAP}
                          onNoteRightPressStart={(noteId, event) => getActiveSection()?.handleNoteRightPressStart(noteId, event)}
                          onNoteRightPressEnd={(noteId, event) => getActiveSection()?.handleNoteRightPressEnd(noteId, event)}
                          onNoteMouseLeave={activeSection?.handleNoteMouseLeave}
                          archivedChaptersByParentId={sidebarMode === 'archive' ? archivedChaptersByParentId : undefined}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {isSidebarScrollbarMode ? (
                  <aside className="sidebar-scrollbar-slot" aria-hidden="true">
                    <div className="sidebar-scrollbar-slot-inner">
                      <div className="thockdown-scroll-rail sidebar-thockdown-scroll-rail">
                        <div
                          ref={sidebarScrollbarTrackRef}
                          className="thockdown-scroll-track"
                          onMouseDown={handleSidebarTrackMouseDown}
                        >
                          <div
                            ref={sidebarScrollbarThumbRef}
                            className={`thockdown-scroll-thumb${isDraggingSidebarScrollThumb ? ' is-dragging' : ''}${isSidebarScrollThumbActive ? '' : ' is-inactive'}`}
                            onMouseDown={handleSidebarThumbMouseDown}
                          />
                        </div>
                      </div>
                    </div>
                  </aside>
                ) : null}
              </div>

              {showPagination ? (
                <div className="sidebar-pagination" aria-label="Sidebar pagination">
                  <button
                    type="button"
                    className="sidebar-page-btn"
                    disabled={effectiveCurrentPage === 1}
                    onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
                  >
                    &lt;
                  </button>
                  {isPageJumpEditing ? (
                    <label className="sidebar-page-number-btn" aria-label="Jump to page">
                      <input
                        ref={pageJumpInputRef}
                        type="number"
                        min={1}
                        max={totalPages}
                        step={1}
                        inputMode="numeric"
                        className="sidebar-page-number-input sidebar-page-number-input--edit"
                        value={pageJumpInput}
                        onChange={(event) => {
                          setPageJumpInput(event.target.value.replace(/[^0-9]/g, ''))
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            commitPageJump()
                            getActiveSection()?.scheduleFocusEditorInEditMode()
                            return
                          }

                          if (event.key === 'Escape' || event.key === 'Tab') {
                            event.preventDefault()
                            cancelPageJumpEdit()
                            getActiveSection()?.scheduleFocusEditorInEditMode()
                          }
                        }}
                        onBlur={() => {
                          window.setTimeout(() => {
                            if (!isAllowedNonEditorFocusTarget(document.activeElement)) {
                              getActiveSection()?.scheduleFocusEditorInEditMode()
                            }
                          }, 0)
                        }}
                      />
                    </label>
                  ) : (
                    <button
                      type="button"
                      className="sidebar-page-number-btn sidebar-page-number-display"
                      aria-label={`Current page ${effectiveCurrentPage} of ${totalPages}. Click to edit.`}
                      onClick={startPageJumpEdit}
                    >
                      {`${effectiveCurrentPage} / ${totalPages}`}
                    </button>
                  )}
                  <button
                    type="button"
                    className="sidebar-page-btn"
                    disabled={effectiveCurrentPage === totalPages}
                    onClick={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
                  >
                    &gt;
                  </button>
                </div>
              ) : null}

              {(sidebarMode === 'options' || isFindMode) ? (
                <div className="date-filter-rail date-filter-rail-placeholder" aria-hidden="true" />
              ) : null}

              {(sidebarMode === 'date' || sidebarMode === 'trash' || isSidebarTreeMode) ? (
                <div className="date-filter-rail" aria-label="Date filters">
                  <div
                    className="date-filter-line"
                    onContextMenu={handleMonthRowContextMenu}
                  >
                    {FILTER_MONTHS.map((month) => (
                      <button
                        key={month}
                        type="button"
                        className={`date-filter-chip${selectedMonths.has(month) ? ' is-active' : ''}`}
                        onClick={(event) => handleMonthToggle(month, event)}
                        onContextMenu={(event) => event.preventDefault()}
                      >
                        {month}
                      </button>
                    ))}
                  </div>
                  <div
                    className="date-filter-line"
                    onContextMenu={handleYearRowContextMenu}
                  >
                    {FILTER_YEARS.map((year) => (
                      <button
                        key={year}
                        type="button"
                        className={`date-filter-chip${selectedYears.has(year) ? ' is-active' : ''}`}
                        onClick={(event) => handleYearToggle(year, event)}
                        onContextMenu={(event) => event.preventDefault()}
                      >
                        {year === 'older' ? 'Older' : year}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </aside>
            ) : null}

            {isSidebarVisible ? (
            <div
              className="grid-divider divider-sidebar"
              style={{ gridArea: 'd-sidebar' }}
            />) : null}

            <section
              className={`window-controls-grid${windowIsCollapsed ? ' is-collapsed' : ''}`}
              ref={windowControlsGridRef}
              style={{ gridArea: 'window_control' }}
              aria-label="Window controls grid"
            >

              <AudioControls
                volume={musicVolume}
                reverbAmount={musicReverbAmount}
                reverbRoom={musicReverbRoom}
                activeSlots={musicActiveSlots}
                onActiveSlotsChange={setMusicActiveSlots}
                initialSongId={musicRestoreSongId}
                initialPositionSec={musicRestorePositionSec}
                initialWasPlaying={musicRestoreWasPlaying}
                playbackStateRef={musicPlaybackRef}
                isOptionsOpen={sidebarMode === 'options'}
                isMiniMode={windowIsCollapsed}
                onOpenMusicOptions={() => {
                  if (sidebarMode !== 'options') setMusicAccordionNonce((n) => n + 1)
                  toggleSidebarOptionsMenu()
                }}
                onAdjustMusicVolume={(delta) => setMusicVolume((v) => clamp(v + delta, 0, 1))}
                onAdjustMusicReverb={(delta) => setMusicReverbAmount((v) => clamp(v + delta, 0, 1))}
                onAdjustMusicRoom={(delta) => setMusicReverbRoom((v) => clamp(v + delta, 0, 1))}
              />

              <div className="window-controls window-controls-right" aria-label="Window controls right">
                <div className="window-minimize-split" role="group" aria-label="Mini mode and minimize controls">
                  <button
                    type="button"
                    className="window-control-btn btn-icon window-minimize-split-btn mini-mode"
                    data-tooltip={windowIsCollapsed ? 'Exit mini mode' : 'Enter mini mode'}
                    aria-label={windowIsCollapsed ? 'Exit mini mode' : 'Enter mini mode'}
                    onClick={handleWindowUtilityCollapseToggle}
                  >
                    <span
                      className={windowIsCollapsed ? 'diagonal-arrow-glyph fa-solid fa-up-right-and-down-left-from-center' : 'fa-solid fa-caret-up'}
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    className="window-control-btn btn-icon window-minimize-split-btn minimize"
                    data-tooltip="Minimize"
                    aria-label="Minimize window"
                    onClick={handleWindowMinimize}
                  >
                    <span className="fa-solid fa-caret-down" aria-hidden="true" />
                  </button>
                </div>
                <div className="window-maximize-split" role="group" aria-label="User guide and maximize controls">
                  {/* Top slot: the User Guide, the same handleHelpModeOpen the
                      escape-hold panel's own User Guide cell calls. Took over the
                      slot double size vacated when it moved to the display-modes
                      split button; maximize/restore moved down to the bottom arm. */}
                  <button
                    type="button"
                    className="window-control-btn btn-icon window-maximize-split-btn help-guide"
                    data-tooltip="User Guide"
                    aria-label="Open the User Guide"
                    onClick={handleHelpModeOpen}
                  >
                    <span className="fa-solid fa-lightbulb" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="window-control-btn btn-icon window-maximize-split-btn maximize"
                    data-tooltip={windowIsMaximized ? 'Restore' : 'Maximize'}
                    aria-label={windowIsMaximized ? 'Restore window' : 'Maximize window'}
                    onClick={handleWindowToggleMaximize}
                  >
                    <span
                      className={`diagonal-arrow-glyph fa-solid ${windowIsMaximized ? 'fa-down-left-and-up-right-to-center' : 'fa-up-right-and-down-left-from-center'}`}
                      aria-hidden="true"
                    />
                  </button>
                </div>
                <button
                  type="button"
                  className="window-control-btn btn-icon close-btn"
                  data-tooltip="Close"
                  aria-label="Close window"
                  onClick={handleWindowClose}
                >
                  <span className="fa-solid fa-dove" aria-hidden="true" />
                </button>
              </div>
            </section>

            <EditorToolbar
              isPreviewMode={activeSection?.isPreviewMode ?? false}
              isForcedPreview={activeSection?.isForcedPreviewNote ?? false}
              activeNoteId={activeSection?.activeNoteId ?? null}
              toggleRenderViewMode={activeSection?.isForcedPreviewNote ? noopAsync : (activeSection?.toggleRenderViewMode ?? noopAsync)}
              uiMode={uiMode}
              toggleUiMode={toggleUiMode}
              isDoubleSizeMode={isDoubleSizeMode}
              handleToggleDoubleSizeMode={handleToggleDoubleSizeMode}
              activeDecorationFormats={activeSection?.activeDecorationFormats ?? EMPTY_DECORATION_FORMATS}
              activeHeadingLevel={activeSection?.activeHeadingLevel ?? 0}
              isChecklistActive={activeSection?.isChecklistActive ?? false}
              isBulletedListActive={activeSection?.isBulletedListActive ?? false}
              isNumberedListActive={activeSection?.isNumberedListActive ?? false}
              isBlockquoteActive={activeSection?.isBlockquoteActive ?? false}
              isCodeBlockActive={activeSection?.isCodeBlockActive ?? false}
              isInlineCodeActive={activeSection?.isInlineCodeActive ?? false}
              isTableOfContentsActive={activeSection?.isTableOfContentsActive ?? false}
              applyTextDecoration={activeSection?.applyTextDecoration ?? noop}
              applyHeading={activeSection?.applyHeading ?? noop}
              toggleCurrentLineHeading={activeSection?.toggleCurrentLineHeading ?? noop}
              toggleBulletedList={activeSection?.toggleBulletedList ?? noop}
              toggleNumberedList={activeSection?.toggleNumberedList ?? noop}
              toggleChecklistList={activeSection?.toggleChecklistList ?? noop}
              toggleBlockquote={activeSection?.toggleBlockquote ?? noop}
              applyLink={activeSection?.applyLink ?? noop}
              applyAnchor={activeSection?.applyAnchor ?? noop}
              applyInlineCode={activeSection?.applyInlineCode ?? noop}
              applyCodeBlock={activeSection?.applyCodeBlock ?? noop}
              insertHorizontalRule={activeSection?.insertHorizontalRule ?? noop}
              insertTableOfContents={activeSection?.insertTableOfContents ?? noop}
              toggleTableOfContents={activeSection?.toggleTableOfContents ?? noop}
            />

            <div className="editor-sections-row" ref={editorSectionsRowRef}>
              {editorSections.map((entry, index) => (
              <Fragment key={entry.id}>
                {index > 0 ? (
                  <div
                    className="editor-section-divider"
                    onMouseDown={handleDividerMouseDown(editorSections[index - 1].id, entry.id)}
                    onContextMenu={handleDividerContextMenu(editorSections[index - 1].id, entry.id)}
                    data-tooltip="Drag to resize -- right-click to split evenly"
                  />
                ) : null}
                <div
                  className="editor-section-slot"
                  data-section-id={entry.id}
                  style={sectionSlotWidthsPx?.has(entry.id)
                    ? { flexGrow: 0, flexShrink: 0, flexBasis: `${sectionSlotWidthsPx.get(entry.id)}px` }
                    : { flexGrow: entry.widthFraction ?? (1 / editorSections.length), flexShrink: 1, flexBasis: 0 }}
                  ref={(el) => {
                    if (el) {
                      sectionSlotElByIdRef.current.set(entry.id, el)
                    } else {
                      sectionSlotElByIdRef.current.delete(entry.id)
                    }
                  }}
                >
                <EditorSection
                  sectionId={entry.id}
                  isLeftmostSection={index === 0}
                  canCreateSection={canCreateSection}
                  onCreateSection={() => void handleCreateSection(entry.position ?? index, entry.id)}
                  onCloseSection={() => void handleCloseSection(entry.id)}
                  onClearSection={() => void handleClearSection(entry.id)}
                  sectionName={entry.name}
                  onRenameSection={(name) => void handleRenameSection(entry.id, name)}
                  onFetchSwapCandidates={() => handleFetchSwapCandidates(entry.id)}
                  onSwapSection={(incomingSectionId) => void handleSwapSection(entry.id, incomingSectionId)}
                  onDeleteSection={(id) => void handleDeleteSection(id)}
                  unpinNoteFromSection={unpinNoteFromSection}
                  isNoteOpenInOtherSection={isNoteOpenInOtherSection}
                  markSectionActive={markSectionActive}
                  isSidebarVisible={isSidebarVisible}
                  toggleSidebarVisible={toggleSidebarVisible}
                  persistenceReady={persistenceReady}
                  notes={notes}
                  setNotes={setNotes}
                  notesRef={notesRef}
                  activeSectionId={activeSectionId}
                  registerSectionHandle={registerSectionHandle}
                  reportSectionHandle={reportSectionHandle}
                  isApplyingInitialViewportRef={isApplyingInitialViewportRef}
                  pendingViewportRestoreRef={pendingViewportRestoreRef}
                  externalNoteOriginalTextByIdRef={externalNoteOriginalTextByIdRef}
                  externalNoteOriginalHashByIdRef={externalNoteOriginalHashByIdRef}
                  activeNoteExternalPathRef={activeNoteExternalPathRef}
                  setCurrentExternalNoteHash={setCurrentExternalNoteHash}
                  queueAppStateSaveStable={queueAppStateSaveStable}
                  updateActiveNoteTitlePreviewStable={updateActiveNoteTitlePreviewStable}
                  revealNoteInMenuStable={revealNoteInMenuStable}
                  writeDebugEntryStable={writeDebugEntryStable}
                  activeNoteHasDebugTagRef={activeNoteHasDebugTagRef}
                  saveSelectedNoteState={saveSelectedNoteState}
                  refreshNotes={refreshNotes}
                  noteTransitionLockRef={noteTransitionLockRef}
                  updateNoteAssignedId={updateNoteAssignedId}
                  recordLastAnchor={recordLastAnchor}
                  getLinkTargetPrefill={getLinkTargetPrefill}
                  restoredTabBarMode={restoredTabBarMode}
                  tabBarModeRef={tabBarModeRef}
                  sidebarMode={sidebarMode}
                  restoredDocumentFindCaseSensitive={restoredDocumentFindCaseSensitive}
                  documentFindCaseSensitiveRef={documentFindCaseSensitiveRef}
                  editorRuntimeMetrics={editorRuntimeMetrics}
                  deferPreviewOnRapidInput={deferPreviewOnRapidInput}
                  viewStyle={viewStyle}
                  viewFontSize={viewFontSize}
                  viewSpacing={viewSpacing}
                  viewLetterSpacingEm={viewLetterSpacingEm}
                  editorStageRef={editorStageRef}
                  editorFontFamily={editorFontFamily}
                  editorFontLoadVersion={editorFontLoadVersion}
                  spellCheckEditEnabled={spellCheckEnabled}
                  spellCheckRenderEnabled={spellCheckEnabled}
                  highlightSearchColor={highlightColors.search}
                  isEscapeHoldPanelOpen={isEscapeHoldPanelOpen}
                  onEscapeHoldPanelClose={handleEscapeHoldPanelClose}
                  onEscapeHoldCreateNote={createNote}
                  onEscapeHoldCreateChapter={activeSection?.handleCreateChapter ?? noopAsync}
                  onEscapeHoldExportPdf={handleExportPdf}
                  onEscapeHoldExportMd={handleExportMd}
                  onEscapeHoldOpenHelp={handleHelpModeOpen}
                  isExportingPdf={isExportingPdf}
                  isExportingMd={isExportingMd}
                  borderRadiusRegularPx={borderRadiusRegularPx}
                  spacingRegularPx={spacingRegularPx}
                  reduceVisualEffects={reduceVisualEffects}
                  showLineNumbers={reviewGutterVisibleBySection[entry.id] ?? false}
                  showReviewFlags={reviewFlagsVisibleBySection[entry.id] ?? false}
                  onToggleReviewGutter={() => handleToggleReviewGutter(entry.id)}
                  onToggleReviewFlags={() => handleToggleReviewFlags(entry.id)}
                />
                </div>
              </Fragment>
              ))}
            </div>
          </div>
        </div>
        {invertViaBlendMode && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: '#fff',
              // 'difference' against a solid white top layer is an exact
              // per-channel invert (|255 - c| = 255 - c) -- unlike the
              // filter: invert() this replaces, this is a genuinely cheap
              // compositor blend rather than a re-rasterize-on-every-repaint
              // filter effect (see the appOuterStyle comment above).
              mixBlendMode: 'difference',
              pointerEvents: 'none',
              zIndex: 9998,
            }}
            aria-hidden="true"
          />
        )}
        {filterColorize > 0 && !reduceVisualEffects && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              // 50% saturation gives a GIMP-colorize-like result: strong enough to
              // be visible on neutral text colours, not so strong it oversaturates
              // already-colourful UI elements. Lightness 50% keeps the hue pure.
              background: `hsl(${filterHueRotate}deg, 50%, 50%)`,
              opacity: filterColorize,
              // 'color' blend mode takes hue+saturation from this overlay and keeps
              // only the backdrop's luminosity â€” unlike 'hue', it still colorizes
              // near-neutral/grey pixels (e.g. text at #222) since the saturation
              // comes entirely from the overlay rather than being multiplied by
              // the (near-zero) backdrop saturation.
              mixBlendMode: 'color',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
            aria-hidden="true"
          />
        )}
      </div>
      {/* Mounted once, app-wide -- not scoped to the editor. See that
          component's own doc comment for why it's a sibling of
          .app-saturate-wrapper (not nested inside it) and how it tracks the
          pointer/hides the native cursor across the whole app instead of
          just one part of it. */}
      {customCursorSettings.enabled ? <MouseCursorOverlay settings={customCursorSettings} filterInvert={filterInvert} /> : null}
    </div>
  )
}

export default App


